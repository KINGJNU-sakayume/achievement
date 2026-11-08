import { describe, it, expect, vi } from 'vitest'
import { accessToken, isConnected } from '@/lifehub/remote.js'
import { validateManifest } from './vendor/schema.js'
import { SAMPLE_INPUT, SAMPLE_NOW } from './sampleState.js'
import { POLICY } from './testPolicy.js'
import {
  BOARD_URL, boardEnabled, boardNeedsReconnect, clearBoardReconnect, DAILY_MS, maybeUploadBoard, MIN_INTERVAL_MS, setBoardEnabled, takeBoardHint,
} from './upload.js'

// Synthetic data and a fake fetch only.
const TOKENS_KEY = 'achievement.lifehub.tokens.v1'
const MIN = 60 * 1000

function memory() {
  const m = new Map()
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: k => void m.delete(k) }
}
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

function setup({ board = () => json({ ok: true }), token = () => json({ access_token: 'new-access', refresh_token: 'new-refresh', token_type: 'Bearer', expires_in: 3600 }), enabled = true, connected = true } = {}) {
  const clock = { now: SAMPLE_NOW }
  const calls = []
  let n = 0
  const deps = {
    calls, clock, storage: memory(), session: memory(), now: () => clock.now,
    random: len => new Uint8Array(len).fill(++n),
    sha256: async d => new Uint8Array(await crypto.subtle.digest('SHA-256', d)),
    fetch: async (url, init) => {
      calls.push({ url: String(url), init })
      return String(url) === BOARD_URL ? board(init, calls.filter(c => c.url === BOARD_URL).length) : token(init)
    },
  }
  if (connected) deps.storage.setItem(TOKENS_KEY, JSON.stringify({ access_token: 'old-access', refresh_token: 'old-refresh', access_expires_at: SAMPLE_NOW + 3_000_000 }))
  if (enabled) setBoardEnabled(deps, true)
  return deps
}
const puts = deps => deps.calls.filter(c => c.url === BOARD_URL)
const changed = () => ({ ...SAMPLE_INPUT, achievements: SAMPLE_INPUT.achievements.map(a => (a.id === 'read-10' ? { ...a, isEarned: true, earnedAt: '2026-11-05' } : a)) })

describe('what gets sent', () => {
  it('PUTs the manifest with the token; the body passes the board schema', async () => {
    const deps = setup()
    expect(await maybeUploadBoard(SAMPLE_INPUT, deps)).toEqual({ status: 'sent' })
    const [put] = puts(deps)
    expect(put.init.method).toBe('PUT')
    expect(put.init.headers).toEqual({ Authorization: 'Bearer old-access', 'Content-Type': 'application/json' })
    const body = JSON.parse(put.init.body)
    expect(body.generated_at).toBe('2026-11-05T12:00:00.000Z')
    const checked = validateManifest(body, POLICY)
    expect(checked.errors).toEqual([])
    expect(checked.tiles).toHaveLength(2)
    expect(put.init.body).not.toMatch(/가상의 메모|photoUrl|rec-1/)
  })

  it('treats `unchanged` and `ignored` answers as done', async () => {
    for (const answer of [{ unchanged: true }, { ignored: true }]) {
      const deps = setup({ board: () => json(answer) })
      expect(await maybeUploadBoard(SAMPLE_INPUT, deps)).toEqual({ status: 'sent' })
      expect((await maybeUploadBoard(SAMPLE_INPUT, deps)).status).toBe('same')
      expect(puts(deps)).toHaveLength(1)
    }
  })
})

describe('when nothing is sent', () => {
  it('stays off until this device is switched on', async () => {
    const deps = setup({ enabled: false })
    expect(boardEnabled(deps)).toBe(false)
    expect((await maybeUploadBoard(SAMPLE_INPUT, deps)).status).toBe('off')
    expect(deps.calls).toHaveLength(0)
  })

  it('needs a connection', async () => {
    const deps = setup({ connected: false })
    expect((await maybeUploadBoard(SAMPLE_INPUT, deps)).status).toBe('not_connected')
    expect(deps.calls).toHaveLength(0)
  })

  it('does not send with no records and nothing earned (a new device must not overwrite)', async () => {
    const deps = setup()
    const empty = { achievements: SAMPLE_INPUT.achievements.map(a => ({ ...a, isEarned: false, earnedAt: null })), records: [], categories: SAMPLE_INPUT.categories }
    expect((await maybeUploadBoard(empty, deps)).status).toBe('empty')
    expect(deps.calls).toHaveLength(0)
  })

  it('does not send the same content again, but does once a day', async () => {
    const deps = setup()
    await maybeUploadBoard(SAMPLE_INPUT, deps)
    deps.clock.now += MIN_INTERVAL_MS + MIN
    expect((await maybeUploadBoard(SAMPLE_INPUT, deps)).status).toBe('same')
    deps.clock.now += DAILY_MS
    deps.storage.setItem(TOKENS_KEY, JSON.stringify({ access_token: 'a', refresh_token: 'r', access_expires_at: deps.clock.now + 3_000_000 }))
    expect((await maybeUploadBoard(SAMPLE_INPUT, deps)).status).toBe('sent')
    expect(puts(deps)).toHaveLength(2)
  })
})

describe('frequency', () => {
  it('waits out 10 minutes after an attempt, then sends the change', async () => {
    const deps = setup()
    await maybeUploadBoard(SAMPLE_INPUT, deps)
    deps.clock.now += 3 * MIN
    const wait = await maybeUploadBoard(changed(), deps)
    expect(wait).toEqual({ status: 'wait', retryInMs: 7 * MIN })
    expect(puts(deps)).toHaveLength(1)
    deps.clock.now += 7 * MIN
    expect((await maybeUploadBoard(changed(), deps)).status).toBe('sent')
    expect(puts(deps)).toHaveLength(2)
  })

  it('a change left waiting is sent by the next run after the app was closed', async () => {
    const deps = setup()
    await maybeUploadBoard(SAMPLE_INPUT, deps)
    deps.clock.now += MIN
    await maybeUploadBoard(changed(), deps)
    expect(JSON.parse(deps.storage.getItem('achievement.board.state.v1')).pending).toBe(true)
    deps.clock.now += 20 * MIN // "next time the app opens": a fresh run with the same storage
    expect((await maybeUploadBoard(changed(), deps)).status).toBe('sent')
    expect(JSON.parse(deps.storage.getItem('achievement.board.state.v1')).pending).toBe(false)
  })

  it('two tabs sharing storage send once', async () => {
    const deps = setup()
    const tab2 = { ...deps, random: len => new Uint8Array(len).fill(99) }
    const results = await Promise.all([maybeUploadBoard(SAMPLE_INPUT, deps), maybeUploadBoard(SAMPLE_INPUT, tab2)])
    expect(puts(deps)).toHaveLength(1)
    expect(results.map(r => r.status)).toContain('sent')
    expect(results.map(r => r.status).filter(x => x !== 'sent')[0]).toMatch(/^(wait|same)$/)
  })

  it('counts a failed attempt too: a 5xx is tried again only after 10 minutes', async () => {
    const deps = setup({ board: (_, n) => (n === 1 ? json({}, 503) : json({ ok: true })) })
    expect(await maybeUploadBoard(SAMPLE_INPUT, deps)).toEqual({ status: 'retry', retryInMs: MIN_INTERVAL_MS })
    deps.clock.now += MIN
    expect((await maybeUploadBoard(SAMPLE_INPUT, deps)).status).toBe('wait')
    deps.clock.now += MIN_INTERVAL_MS
    expect((await maybeUploadBoard(SAMPLE_INPUT, deps)).status).toBe('sent')
    expect(puts(deps)).toHaveLength(2)
  })

  it('a network error is not an exception', async () => {
    const deps = setup()
    deps.fetch = async () => { throw new TypeError('offline') }
    expect((await maybeUploadBoard(SAMPLE_INPUT, deps)).status).toBe('retry')
    expect(isConnected(deps)).toBe(true)
  })

  it('generated_at never goes back, even when the clock does', async () => {
    const deps = setup()
    await maybeUploadBoard(SAMPLE_INPUT, deps)
    deps.clock.now -= 3 * 60 * MIN
    deps.storage.setItem('achievement.board.state.v1', JSON.stringify({ ...JSON.parse(deps.storage.getItem('achievement.board.state.v1')), attemptAt: 0 }))
    await maybeUploadBoard(changed(), deps)
    const [first, second] = puts(deps).map(p => Date.parse(JSON.parse(p.init.body).generated_at))
    expect(second).toBeGreaterThan(first)
  })
})

describe('refused uploads', () => {
  it('insufficient_scope (header): keeps the tokens, stops, asks for a new connection, resumes after it', async () => {
    const deps = setup({ board: () => json({}, 403, { 'WWW-Authenticate': 'Bearer error="insufficient_scope", scope="achievement:board"' }) })
    expect(await maybeUploadBoard(SAMPLE_INPUT, deps)).toEqual({ status: 'reconnect' })
    expect(isConnected(deps)).toBe(true)
    expect(boardNeedsReconnect(deps)).toBe(true)
    deps.clock.now += 2 * MIN_INTERVAL_MS
    expect((await maybeUploadBoard(changed(), deps)).status).toBe('reconnect')
    expect(puts(deps)).toHaveLength(1)
    clearBoardReconnect(deps)
    expect(boardNeedsReconnect(deps)).toBe(false)
  })

  it('insufficient_scope is also found in the body when the browser hides the header', async () => {
    const deps = setup({ board: () => json({ error: 'insufficient_scope' }, 403) })
    expect((await maybeUploadBoard(SAMPLE_INPUT, deps)).status).toBe('reconnect')
    expect(isConnected(deps)).toBe(true)
  })

  it('any other 403 follows the old rule: the connection is dropped', async () => {
    const deps = setup({ board: () => json({ error: 'forbidden' }, 403) })
    expect((await maybeUploadBoard(SAMPLE_INPUT, deps)).status).toBe('not_connected')
    expect(isConnected(deps)).toBe(false)
  })

  it('a 401 is retried once with a fresh token; if it stays 401 the connection is dropped', async () => {
    const ok = setup({ board: (init) => (init.headers.Authorization === 'Bearer new-access' ? json({ ok: true }) : json({}, 401)) })
    expect((await maybeUploadBoard(SAMPLE_INPUT, ok)).status).toBe('sent')
    const bad = setup({ board: () => json({}, 401) })
    expect((await maybeUploadBoard(SAMPLE_INPUT, bad)).status).toBe('not_connected')
    expect(isConnected(bad)).toBe(false)
  })

  it('a 400 or 413 is logged, never resent with the same content, and resent when the content changes', async () => {
    for (const status of [400, 413]) {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const deps = setup({ board: (_, n) => (n === 1 ? json({ error: 'bad' }, status) : json({ ok: true })) })
      expect((await maybeUploadBoard(SAMPLE_INPUT, deps)).status).toBe('failed')
      expect(spy).toHaveBeenCalled()
      deps.clock.now += DAILY_MS * 2
      deps.storage.setItem(TOKENS_KEY, JSON.stringify({ access_token: 'a', refresh_token: 'r', access_expires_at: deps.clock.now + 3_000_000 }))
      expect((await maybeUploadBoard(SAMPLE_INPUT, deps)).status).toBe('rejected')
      expect(puts(deps)).toHaveLength(1)
      expect((await maybeUploadBoard(changed(), deps)).status).toBe('sent')
      expect(isConnected(deps)).toBe(true)
      spy.mockRestore()
    }
  })
})

describe('tokens stay safe', () => {
  const expired = deps => deps.storage.setItem(TOKENS_KEY, JSON.stringify({ access_token: 'old-access', refresh_token: 'old-refresh', access_expires_at: 0 }))

  it('refreshes once when two requests need a new token at the same time', async () => {
    const deps = setup()
    expired(deps)
    const tokens = await Promise.all([accessToken(deps), accessToken(deps), accessToken(deps)])
    expect(tokens).toEqual(['new-access', 'new-access', 'new-access'])
    expect(deps.calls.filter(c => c.url.endsWith('/oauth/token'))).toHaveLength(1)
  })

  it('an invalid_grant after another flow rotated the token does not drop the connection', async () => {
    const deps = setup({
      token: () => {
        // While this request is in flight another tab stored a newer refresh token.
        deps.storage.setItem(TOKENS_KEY, JSON.stringify({ access_token: 'rotated-access', refresh_token: 'rotated-refresh', access_expires_at: SAMPLE_NOW + 3_000_000 }))
        return json({ error: 'invalid_grant' }, 400)
      },
    })
    expired(deps)
    expect(await accessToken(deps)).toBe('rotated-access')
    expect(isConnected(deps)).toBe(true)
  })

  it('an invalid_grant with nothing newer still reads as not connected', async () => {
    const deps = setup({ token: () => json({ error: 'invalid_grant' }, 400) })
    expired(deps)
    await expect(accessToken(deps)).rejects.toMatchObject({ kind: 'not_connected' })
    expect(isConnected(deps)).toBe(false)
  })
})

describe('the one-time hint', () => {
  it('shows once, and not at all when the device is already switched on', () => {
    const deps = setup({ enabled: false })
    expect(takeBoardHint(deps)).toBe(true)
    expect(takeBoardHint(deps)).toBe(false)
    expect(takeBoardHint(setup())).toBe(false)
  })
})
