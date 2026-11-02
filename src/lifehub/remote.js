// 업적 라이브러리 ↔ Life Hub.
//
// - Connect: OAuth 2.1 authorization code + PKCE (S256). The app is a public client identified by
//   public/lifehub-client.json and receives only an `achievement:inbox` token for /achievement.
//   Life Hub returns to /lifehub/ (public/lifehub/index.html), which hands the result to the app.
// - Proposals (`activity_record`, and `achievement_definition` for a custom achievement) are fetched live
//   and validated again here. Nothing is saved until the owner saves it here, or approved it in a Claude card
//   (Life Hub cards stage 4) and the category is certain: then it is saved on sync, with the setting
//   「Claude에서 승인된 항목 자동 반영」 (default on).
// - The owner's category names (ids, names, top-level group) are shared for the card's category picker.
// - A record saved from a proposal gets the ID `lh_<base64url(key)>`, so the receipt can always be
//   rebuilt from the records themselves. Receipts and rejections are retried until answered.

export const LIFEHUB_ORIGIN = 'https://life-hub-api.213303.workers.dev'
export const APP_URL = 'https://kingjnu-sakayume.github.io/achievement/'
export const CALLBACK_URL = APP_URL + 'lifehub/'
export const CLIENT_ID = APP_URL + 'lifehub-client.json'
export const RESOURCE = LIFEHUB_ORIGIN + '/achievement'
export const SCOPE = 'achievement:inbox'
const API = LIFEHUB_ORIGIN + '/achievement/v1'
/** Written by public/lifehub/index.html. */
export const CALLBACK_KEY = 'achievement.lifehub.callback.v1'

const TOKENS_KEY = 'achievement.lifehub.tokens.v1'
const PENDING_AUTH_KEY = 'achievement.lifehub.pending-auth.v1'
const OUTCOMES_KEY = 'achievement.lifehub.outcomes.v1'
const REJECTIONS_KEY = 'achievement.lifehub.rejections.v1'
const AUTO_APPLY_KEY = 'achievement.lifehub.auto-apply.v1'
const CATEGORY_REFS_KEY = 'achievement.lifehub.category-refs.v1'
const AUTH_MAX_AGE_MS = 10 * 60 * 1000

export function browserDeps() {
  return {
    fetch: (input, init) => fetch(input, init),
    storage: window.localStorage,
    session: window.sessionStorage,
    now: () => Date.now(),
    random: n => crypto.getRandomValues(new Uint8Array(n)),
    sha256: async d => new Uint8Array(await crypto.subtle.digest('SHA-256', d)),
  }
}

export class LifeHubError extends Error {
  constructor(kind, message) {
    super(message)
    this.kind = kind // not_connected | denied | state | network | server
  }
}

// ── contract (mirrors life-hub src/adapters/achievement.js) ─────────────────

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)
const only = (v, keys) => Object.keys(v).every(k => keys.includes(k))
const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max
const optText = (v, max) => v === undefined || text(v, max)
// Keys short enough that `lh_<base64url(key)>` stays a valid hub entity ID (≤ 128 chars).
const KEY = /^(claude|chatgpt|codex|manual):[A-Za-z0-9_.:-]{8,80}$/
export const validDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(new Date(v).getTime()) && new Date(v).toISOString().slice(0, 10) === v

export const TIERS = ['bronze', 'silver', 'gold', 'platinum', 'diamond']
const CONDITIONS = ['count', 'total', 'streak', 'tag', 'tag_count']
const whole = v => Number.isInteger(v) && v >= 1 && v <= 100000

function parseRecord(p) {
  if (!only(p, ['category', 'date', 'value', 'unit', 'tags', 'memo']) || !text(p.category, 60) || !validDate(p.date) ||
    !optText(p.unit, 20) || !optText(p.memo, 500)) return null
  if (p.value !== undefined && (typeof p.value !== 'number' || !Number.isFinite(p.value) || p.value < 0 || p.value > 1e9)) return null
  if (p.unit !== undefined && p.value === undefined) return null
  if (p.tags !== undefined && (!Array.isArray(p.tags) || p.tags.length === 0 || p.tags.length > 10 ||
    !p.tags.every(t => text(t, 30)) || new Set(p.tags.map(t => t.trim())).size !== p.tags.length)) return null
  return {
    kind: 'record',
    category: p.category.trim(),
    date: p.date,
    value: p.value ?? null,
    unit: p.unit?.trim() ?? null,
    tags: (p.tags ?? []).map(t => t.trim().replace(/^#+/, '')),
    memo: p.memo?.trim() ?? null,
  }
}

function parseDefinition(p) {
  if (!only(p, ['title', 'description', 'category', 'tier', 'condition_type', 'target', 'unit', 'tag']) || !text(p.title, 40) ||
    !optText(p.description, 200) || !optText(p.category, 60) || !TIERS.includes(p.tier) || !CONDITIONS.includes(p.condition_type) ||
    !optText(p.unit, 20) || !optText(p.tag, 30)) return null
  const t = p.condition_type
  const ok = t === 'total' ? typeof p.target === 'number' && Number.isFinite(p.target) && p.target > 0 && p.target <= 1e9 && p.unit !== undefined && p.tag === undefined
    : p.unit !== undefined ? false
      : t === 'tag' ? p.tag !== undefined && p.target === undefined
        : t === 'tag_count' ? p.tag !== undefined && whole(p.target)
          : p.tag === undefined && whole(p.target)
  if (!ok) return null
  return {
    kind: 'achievement',
    title: p.title.trim(),
    description: p.description?.trim() ?? '',
    category: p.category?.trim() ?? null,
    tier: p.tier,
    conditionType: t,
    target: p.target ?? null,
    unit: p.unit?.trim() ?? null,
    tag: p.tag?.trim().replace(/^#+/, '') ?? null,
  }
}

/**
 * One item from the hub as a proposal, or null when it does not match the contract. The owner's edit from a
 * Claude card (`final_candidate`) wins; `status` 'approved' means approved there (not saved yet).
 */
export function parseProposal(item) {
  if (!isObj(item) || typeof item.key !== 'string' || !KEY.test(item.key)) return null
  if (item.status !== undefined && item.status !== 'pending' && item.status !== 'approved') return null
  const c = item.final_candidate ?? item.candidate
  if (!isObj(c) || c.schema_version !== 1 || typeof c.source !== 'string' ||
    `${c.source}:${String(c.idempotency_key)}` !== item.key || typeof c.created_at !== 'string' || !isObj(c.payload)) return null
  const body = c.candidate_type === 'activity_record' ? parseRecord(c.payload)
    : c.candidate_type === 'achievement_definition' ? parseDefinition(c.payload) : null
  if (!body) return null
  return {
    key: item.key,
    createdAt: c.created_at,
    status: item.status === 'approved' ? 'approved' : 'pending',
    needsAppReview: item.needs_app_review === true,
    ...body,
  }
}

/** The app's condition for a proposed achievement (see utils/achievementEvaluator.js). */
export function conditionFor(p) {
  switch (p.conditionType) {
    case 'count': return { type: 'count', target: p.target }
    case 'total': return { type: 'cumulative', target: p.target, unit: p.unit }
    case 'streak': return { type: 'streak', target: p.target }
    case 'tag': return { type: 'tag_match', tag: p.tag }
    default: return { type: 'tag_count', tag: p.tag, target: p.target }
  }
}

// ── record IDs and categories ───────────────────────────────────────────────

const b64url = bytes => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromB64url = s => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0)))
}

/** The ID a record saved from this proposal gets. */
export const recordIdFor = key => 'lh_' + b64url(new TextEncoder().encode(key))

/** The proposal key a record came from, or null for ordinary records. */
export function keyOfRecord(id) {
  if (typeof id !== 'string' || !id.startsWith('lh_')) return null
  try {
    const key = fromB64url(id.slice(3))
    return KEY.test(key) ? key : null
  } catch {
    return null
  }
}

const norm = s => s.normalize('NFKC').toLowerCase().replace(/[\s·・.,/_-]+/g, '')

/**
 * The owner's category for a proposed name: exact name, else the single category whose normalised
 * name matches ("요가 필라테스" → "요가·필라테스"). Null when there is no single answer; the owner picks.
 */
export function matchCategory(name, categories) {
  const exact = categories.filter(c => c.name === name)
  if (exact.length === 1) return exact[0].id
  const wanted = norm(name)
  const loose = categories.filter(c => norm(c.name) === wanted)
  return loose.length === 1 ? loose[0].id : null
}

/** The category with exactly this name, or null (auto-apply never guesses; the editor may match loosely). */
export function exactCategory(name, categories) {
  const hits = categories.filter(c => c.name === name)
  return hits.length === 1 ? hits[0].id : null
}

/** The achievement saved for an approved proposal (ID `lh_<key>`, like records). */
export function achievementFor(proposal, categoryId) {
  return {
    id: recordIdFor(proposal.key),
    title: proposal.title,
    description: proposal.description,
    categoryId,
    tier: proposal.tier,
    condition: conditionFor(proposal),
    isHidden: false,
  }
}

/**
 * What may be saved without asking: approved in the Claude card, no last check asked, auto-apply on, and a
 * category that is exactly one of the owner's (an achievement may have none). Returns
 * { kind: 'record', draft } | { kind: 'achievement', achievement } | null.
 */
export function autoPlan(proposal, categories, autoApply) {
  if (!autoApply || proposal.status !== 'approved' || proposal.needsAppReview) return null
  if (proposal.kind === 'achievement') {
    const categoryId = proposal.category === null ? null : exactCategory(proposal.category, categories)
    if (proposal.category !== null && !categoryId) return null
    return { kind: 'achievement', achievement: achievementFor(proposal, categoryId) }
  }
  const categoryId = exactCategory(proposal.category, categories)
  return categoryId ? { kind: 'record', draft: { ...draftFor(proposal, categories), categoryId } } : null
}

/** What the record editor starts with for a proposal. */
export function draftFor(proposal, categories) {
  return {
    id: recordIdFor(proposal.key),
    categoryId: matchCategory(proposal.category, categories),
    date: proposal.date,
    value: proposal.value,
    unit: proposal.unit,
    tags: proposal.tags,
    memo: proposal.memo,
  }
}

// ── OAuth ───────────────────────────────────────────────────────────────────

function readJson(store, key) {
  try {
    const raw = store.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function connectAvailable(loc) {
  const app = new URL(APP_URL)
  return loc.origin === app.origin && loc.pathname.startsWith(app.pathname)
}
export const isConnected = deps => typeof readJson(deps.storage, TOKENS_KEY)?.refresh_token === 'string'

export async function beginConnect(deps) {
  const verifier = b64url(deps.random(32))
  const state = b64url(deps.random(16))
  const challenge = b64url(await deps.sha256(new TextEncoder().encode(verifier)))
  deps.session.setItem(PENDING_AUTH_KEY, JSON.stringify({ state, verifier, created_at: deps.now() }))
  const q = new URLSearchParams({
    response_type: 'code', client_id: CLIENT_ID, redirect_uri: CALLBACK_URL, scope: SCOPE, state,
    code_challenge: challenge, code_challenge_method: 'S256', resource: RESOURCE,
  })
  return LIFEHUB_ORIGIN + '/authorize?' + q.toString()
}

async function tokenRequest(deps, params) {
  let response
  try {
    response = await deps.fetch(LIFEHUB_ORIGIN + '/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, ...params }).toString(),
    })
  } catch {
    throw new LifeHubError('network', 'Life Hub에 연결할 수 없어요. 네트워크를 확인해 주세요.')
  }
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (body.error === 'invalid_grant') {
      deps.storage.removeItem(TOKENS_KEY)
      throw new LifeHubError('not_connected', 'Life Hub 연결이 만료됐어요. 다시 연결해 주세요.')
    }
    throw new LifeHubError('server', `Life Hub 인증 서버 오류 (${response.status})`)
  }
  if (typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string' || String(body.token_type).toLowerCase() !== 'bearer')
    throw new LifeHubError('server', 'Life Hub 응답 형식이 올바르지 않아요.')
  const tokens = {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    access_expires_at: deps.now() + (typeof body.expires_in === 'number' ? body.expires_in : 300) * 1000,
  }
  deps.storage.setItem(TOKENS_KEY, JSON.stringify(tokens))
  return tokens
}

/** Finish a sign-in whose result the callback page left in this tab. False when there is none. */
export async function completeStoredCallback(deps) {
  const search = deps.session.getItem(CALLBACK_KEY)
  if (search === null) return false
  deps.session.removeItem(CALLBACK_KEY)
  const q = new URLSearchParams(search)
  const pending = readJson(deps.session, PENDING_AUTH_KEY)
  deps.session.removeItem(PENDING_AUTH_KEY)
  if (!pending || q.get('state') !== pending.state || deps.now() - pending.created_at > AUTH_MAX_AGE_MS)
    throw new LifeHubError('state', '연결 요청이 만료됐거나 이 브라우저에서 시작되지 않았어요. 다시 연결해 주세요.')
  if (q.has('iss') && q.get('iss') !== LIFEHUB_ORIGIN) throw new LifeHubError('state', '다른 서버의 응답이라 연결하지 않았어요.')
  if (q.has('error')) throw new LifeHubError('denied', q.get('error') === 'access_denied' ? 'Life Hub 연결을 거절했어요.' : 'Life Hub 연결에 실패했어요.')
  const code = q.get('code')
  if (!code) throw new LifeHubError('state', '인증 코드가 없어요.')
  await tokenRequest(deps, { grant_type: 'authorization_code', code, redirect_uri: CALLBACK_URL, code_verifier: pending.verifier, resource: RESOURCE })
  return true
}

async function accessToken(deps, force = false) {
  const tokens = readJson(deps.storage, TOKENS_KEY)
  if (!tokens?.refresh_token) throw new LifeHubError('not_connected', 'Life Hub에 연결되어 있지 않아요.')
  if (!force && tokens.access_expires_at - 60_000 > deps.now()) return tokens.access_token
  return (await tokenRequest(deps, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token })).access_token
}

async function api(deps, method, path, body) {
  const send = async token => {
    try {
      return await deps.fetch(API + path, {
        method,
        headers: { Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch {
      throw new LifeHubError('network', 'Life Hub에 연결할 수 없어요. 네트워크를 확인해 주세요.')
    }
  }
  let response = await send(await accessToken(deps))
  if (response.status === 401) response = await send(await accessToken(deps, true))
  if (response.status === 401 || response.status === 403) {
    deps.storage.removeItem(TOKENS_KEY)
    throw new LifeHubError('not_connected', 'Life Hub 연결이 더 이상 유효하지 않아요. 다시 연결해 주세요.')
  }
  return response
}

export function disconnect(deps) {
  const tokens = readJson(deps.storage, TOKENS_KEY)
  deps.storage.removeItem(TOKENS_KEY)
  if (tokens?.refresh_token) {
    deps.fetch(LIFEHUB_ORIGIN + '/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: tokens.refresh_token, token_type_hint: 'refresh_token', client_id: CLIENT_ID }).toString(),
    }).catch(() => undefined)
  }
}

// ── decisions and sync ──────────────────────────────────────────────────────

export function rejectLocally(key, deps) {
  const list = readJson(deps.storage, REJECTIONS_KEY) ?? []
  if (!list.includes(key)) deps.storage.setItem(REJECTIONS_KEY, JSON.stringify([...list, key]))
}

/** Records and achievements saved from proposals, as receipts: { key, recordId, entityType }. */
export function receipts(records, achievements = []) {
  const out = []
  for (const r of records) {
    const key = keyOfRecord(r.id)
    if (key) out.push({ key, recordId: r.id, entityType: 'activity_record' })
  }
  for (const a of achievements) {
    const key = keyOfRecord(a.id)
    if (key) out.push({ key, recordId: a.id, entityType: 'achievement_definition' })
  }
  return out
}

/** 「Claude에서 승인된 항목 자동 반영」: on unless turned off on this device. */
export const autoApplyEnabled = deps => deps.storage.getItem(AUTO_APPLY_KEY) !== 'off'
export function setAutoApply(deps, on) {
  if (on) deps.storage.removeItem(AUTO_APPLY_KEY)
  else deps.storage.setItem(AUTO_APPLY_KEY, 'off')
}

/** The owner's categories for the card picker: ids, names and the top-level name. Never records. */
export function categoryRefs(categories) {
  const byId = new Map(categories.map(c => [c.id, c]))
  const top = c => {
    const seen = new Set()
    while (c.parentId && byId.has(c.parentId) && !seen.has(c.id)) { seen.add(c.id); c = byId.get(c.parentId) }
    return c.name
  }
  return categories
    .filter(c => /^[A-Za-z0-9_.:-]{1,64}$/.test(c.id) && typeof c.name === 'string' && c.name.trim())
    .slice(0, 500)
    .map(c => ({ id: c.id, label: c.name.trim().slice(0, 80), group: top(c).trim().slice(0, 40) || '기타' }))
}

/** Shares the category list when it changed (a newer revision wins on Life Hub; 409 = a newer one is there). */
export async function uploadCategoryRefs(categories, deps) {
  const items = categoryRefs(categories)
  const body = JSON.stringify(items)
  const last = readJson(deps.storage, CATEGORY_REFS_KEY)
  if (!items.length || last?.body === body) return false
  const revision = Math.max(deps.now(), (last?.revision ?? 0) + 1)
  const response = await api(deps, 'PUT', '/refs/categories', { revision, items })
  if (!response.ok && response.status !== 409) return false
  deps.storage.setItem(CATEGORY_REFS_KEY, JSON.stringify({ revision, body }))
  return true
}

/**
 * Sends receipts and rejections not yet answered, shares the category list when it changed, then fetches
 * open proposals (pending, or approved in a Claude card) not decided here. Saves nothing.
 * Returns { proposals, receiptsSent, rejectionsSent, conflicts, waiting }.
 */
export async function sync(records, deps, { achievements = [], categories = null } = {}) {
  const done = readJson(deps.storage, OUTCOMES_KEY) ?? {}
  const result = { proposals: [], receiptsSent: 0, rejectionsSent: 0, conflicts: 0, waiting: 0 }
  const record = (key, response, ok) => {
    if (response.ok) done[key] = ok
    else if (response.status === 409) done[key] = 'conflict'
    else if (response.status === 404) done[key] = 'missing'
    else {
      result.waiting++
      return false
    }
    deps.storage.setItem(OUTCOMES_KEY, JSON.stringify(done))
    return response.ok
  }
  const decided = new Set()
  for (const r of receipts(records, achievements)) {
    decided.add(r.key)
    if (done[r.key]) continue
    const response = await api(deps, 'POST', '/receipts', { key: r.key, entity_type: r.entityType, entity_id: r.recordId })
    if (record(r.key, response, 'confirmed')) result.receiptsSent++
  }
  for (const key of readJson(deps.storage, REJECTIONS_KEY) ?? []) {
    decided.add(key)
    if (done[key]) continue
    if (record(key, await api(deps, 'POST', '/rejections', { key }), 'rejected')) result.rejectionsSent++
  }
  if (categories) await uploadCategoryRefs(categories, deps).catch(() => false)
  const response = await api(deps, 'GET', '/candidates?status=open&limit=100')
  if (!response.ok) throw new LifeHubError('server', `Life Hub 제안을 가져오지 못했어요 (${response.status})`)
  const body = await response.json().catch(() => null)
  if (!body || !Array.isArray(body.candidates)) throw new LifeHubError('server', 'Life Hub 응답 형식이 올바르지 않아요.')
  for (const item of body.candidates) {
    const p = parseProposal(item)
    if (p && !decided.has(p.key)) result.proposals.push(p)
  }
  result.conflicts = Object.values(done).filter(v => v === 'conflict').length
  return result
}
