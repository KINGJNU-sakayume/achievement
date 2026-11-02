import { describe, it, expect } from 'vitest'
import { categories } from '@/data/categories.js'
import { normalizeState, recordFromInput } from '@/lib/appState.js'
import {
  beginConnect, CALLBACK_KEY, CALLBACK_URL, CLIENT_ID, completeStoredCallback, connectAvailable, draftFor, isConnected,
  keyOfRecord, LIFEHUB_ORIGIN, matchCategory, parseProposal, receipts, recordIdFor, rejectLocally, RESOURCE, sync,
} from './remote.js'

// Synthetic data only.
const KEY = 'claude:mcp-' + 'a'.repeat(40)
function candidate(payload, key = KEY) {
  const i = key.indexOf(':')
  return { key, candidate: { schema_version: 1, candidate_type: 'activity_record', source: key.slice(0, i), idempotency_key: key.slice(i + 1), created_at: '2026-11-02T01:00:00Z', payload } }
}
function memory() {
  const m = new Map()
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: k => void m.delete(k) }
}
function makeDeps(handler) {
  const calls = []
  let n = 0
  return {
    calls, storage: memory(), session: memory(), now: () => 1_000_000,
    random: len => new Uint8Array(len).fill(++n),
    sha256: async d => new Uint8Array(await crypto.subtle.digest('SHA-256', d)),
    fetch: async (url, init) => { calls.push({ url: String(url), init }); return handler(String(url), init) },
  }
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const tokens = () => json({ access_token: 'access-synthetic', refresh_token: 'refresh-synthetic', token_type: 'Bearer', expires_in: 3600 })

describe('proposal contract', () => {
  it('accepts the hub shape and rejects anything else', () => {
    expect(parseProposal(candidate({ category: '러닝', date: '2026-11-02', value: 5, unit: 'km', tags: ['새벽'], memo: '가상' })))
      .toEqual({ key: KEY, createdAt: '2026-11-02T01:00:00Z', category: '러닝', date: '2026-11-02', value: 5, unit: 'km', tags: ['새벽'], memo: '가상' })
    expect(parseProposal(candidate({ category: '명상', date: '2026-11-01' }))).toMatchObject({ value: null, unit: null, tags: [], memo: null })
    for (const bad of [
      candidate({ category: '러닝' }),
      candidate({ category: '러닝', date: '2026-02-30' }),
      candidate({ category: '러닝', date: '2026-11-02', unit: 'km' }),
      candidate({ category: '러닝', date: '2026-11-02', value: -2 }),
      candidate({ category: '러닝', date: '2026-11-02', tags: ['a', 'a'] }),
      candidate({ category: '러닝', date: '2026-11-02', photoUrl: 'https://example.com/a.jpg' }),
      candidate({ category: '러닝', date: '2026-11-02' }, 'claude:' + 'x'.repeat(81)),
      { ...candidate({ category: '러닝', date: '2026-11-02' }), key: 'claude:mcp-' + 'b'.repeat(40) },
    ]) expect(parseProposal(bad)).toBeNull()
  })
})

describe('records and categories', () => {
  it('record IDs carry the proposal key and survive the app\'s own normalisation', () => {
    const id = recordIdFor(KEY)
    expect(id).toMatch(/^lh_[A-Za-z0-9_-]{1,125}$/)
    expect(keyOfRecord(id)).toBe(KEY)
    expect(keyOfRecord('rec_123')).toBeNull()
    expect(keyOfRecord('lh_!!')).toBeNull()
    const longest = 'chatgpt:' + 'z'.repeat(80)
    expect(recordIdFor(longest).length).toBeLessThanOrEqual(128)
    const state = normalizeState({ categories, records: [recordFromInput({ id, categoryId: 'cat-running', date: '2026-11-02', value: '5', unit: 'km' })], achievements: [] })
    expect(receipts(state.records)).toEqual([{ key: KEY, recordId: id }])
  })

  it('matches a category by exact or normalised name, never by guess', () => {
    expect(matchCategory('러닝', categories)).toBe('cat-running')
    expect(matchCategory('요가 필라테스', categories)).toBe('cat-yoga')
    expect(matchCategory('달리기', categories)).toBeNull()
    expect(matchCategory('국내', [...categories, { id: 'own', name: '국 내', parentId: null }])).toBe('cat-domestic')
    expect(matchCategory('러 닝', [...categories, { id: 'own', name: '러닝 ', parentId: null }])).toBeNull()
    const draft = draftFor(parseProposal(candidate({ category: '독서', date: '2026-11-01', value: 2, unit: '권', tags: ['완독'] })), categories)
    expect(draft).toEqual({ id: recordIdFor(KEY), categoryId: 'cat-books', date: '2026-11-01', value: 2, unit: '권', tags: ['완독'], memo: null })
  })
})

describe('connection', () => {
  it('only from the deployed app', () => {
    expect(connectAvailable({ origin: 'https://kingjnu-sakayume.github.io', pathname: '/achievement/' })).toBe(true)
    expect(connectAvailable({ origin: 'http://localhost:5173', pathname: '/achievement/' })).toBe(false)
  })

  it('PKCE authorize URL; the callback result is exchanged once and checked', async () => {
    const deps = makeDeps(url => (url.endsWith('/oauth/token') ? tokens() : json({}, 404)))
    const url = new URL(await beginConnect(deps))
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code', client_id: CLIENT_ID, redirect_uri: CALLBACK_URL, scope: 'achievement:inbox', resource: RESOURCE, code_challenge_method: 'S256',
    })
    expect(await completeStoredCallback(deps)).toBe(false)
    deps.session.setItem(CALLBACK_KEY, `?code=c1&state=${url.searchParams.get('state')}&iss=${encodeURIComponent(LIFEHUB_ORIGIN)}`)
    expect(await completeStoredCallback(deps)).toBe(true)
    expect(Object.fromEntries(new URLSearchParams(deps.calls[0].init.body))).toMatchObject({ grant_type: 'authorization_code', code: 'c1', resource: RESOURCE })
    expect(isConnected(deps)).toBe(true)

    const other = makeDeps(() => tokens())
    await beginConnect(other)
    other.session.setItem(CALLBACK_KEY, '?code=c1&state=forged')
    await expect(completeStoredCallback(other)).rejects.toMatchObject({ kind: 'state' })
    expect(other.calls).toHaveLength(0)
  })
})

describe('sync', () => {
  async function connected(handler) {
    const deps = makeDeps((url, init) => (url.endsWith('/oauth/token') ? tokens() : handler(url, init)))
    const state = new URL(await beginConnect(deps)).searchParams.get('state')
    deps.session.setItem(CALLBACK_KEY, `?code=c&state=${state}`)
    await completeStoredCallback(deps)
    deps.calls.length = 0
    return deps
  }

  it('reports saved and rejected proposals once and lists only undecided ones', async () => {
    const rejected = 'claude:mcp-' + 'r'.repeat(40)
    const fresh = 'claude:mcp-' + 'f'.repeat(40)
    const base = { category: '러닝', date: '2026-11-02' }
    const deps = await connected(url => (url.includes('/candidates')
      ? json({ candidates: [candidate(base), candidate(base, rejected), candidate(base, fresh), candidate({ category: '러닝' }, 'claude:mcp-' + 'g'.repeat(40))] })
      : json({ ok: true })))
    rejectLocally(rejected, deps)
    const records = [{ id: recordIdFor(KEY) }, { id: 'rec_own' }]
    const first = await sync(records, deps)
    expect(first).toMatchObject({ receiptsSent: 1, rejectionsSent: 1, conflicts: 0 })
    expect(first.proposals.map(p => p.key)).toEqual([fresh])
    const posted = deps.calls.filter(c => c.init?.method === 'POST').map(c => JSON.parse(c.init.body))
    expect(posted).toEqual([{ key: KEY, entity_type: 'activity_record', entity_id: recordIdFor(KEY) }, { key: rejected }])
    expect(deps.calls.at(-1).url).toBe(LIFEHUB_ORIGIN + '/achievement/v1/candidates?status=pending&limit=100')

    deps.calls.length = 0
    await sync(records, deps)
    expect(deps.calls.filter(c => c.init?.method === 'POST')).toHaveLength(0)
  })

  it('a revoked connection reads as not connected', async () => {
    const deps = await connected(() => json({ error: 'invalid_token' }, 401))
    await expect(sync([], deps)).rejects.toMatchObject({ kind: 'not_connected' })
    expect(isConnected(deps)).toBe(false)
  })
})
