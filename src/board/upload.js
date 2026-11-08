// Sends the board tile list (src/board/buildBoardTiles.js) to Life Hub: PUT /achievement/v1/board.
//
// Rules (see README 「보드 타일」):
// - Only when connected, switched on for this device, and there is something to share.
// - Only when the content changed (sha256 without `generated_at`), at most once per 10 minutes (counted per attempt,
//   shared by all tabs), plus once a day even when nothing changed (the board marks lists older than 14 days).
// - A 403 `insufficient_scope` never drops the tokens: it only asks for a new connection that includes the board scope.
// - Nothing here throws: a failed upload must never get in the way of the rest of the app.

import { accessToken, dropTokens, isConnected, LIFEHUB_ORIGIN } from '@/lifehub/remote.js'
import { buildBoardTiles, hasBoardData } from './buildBoardTiles.js'

export const BOARD_URL = LIFEHUB_ORIGIN + '/achievement/v1/board'
export const MIN_INTERVAL_MS = 10 * 60 * 1000
export const DAILY_MS = 24 * 60 * 60 * 1000

const ENABLED_KEY = 'achievement.board.enabled.v1'
const STATE_KEY = 'achievement.board.state.v1'

function readState(storage) {
  try {
    const raw = storage.getItem(STATE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function patchState(storage, patch) {
  try {
    storage.setItem(STATE_KEY, JSON.stringify({ ...readState(storage), ...patch }))
  } catch {
    // Storage full or blocked: the next attempt simply starts from what it can read.
  }
}

/** Off unless this device was switched on (the list of another device would be overwritten). */
export const boardEnabled = deps => deps.storage.getItem(ENABLED_KEY) === 'on'
export function setBoardEnabled(deps, on) {
  if (on) deps.storage.setItem(ENABLED_KEY, 'on')
  else deps.storage.removeItem(ENABLED_KEY)
}

export const boardNeedsReconnect = deps => readState(deps.storage).needsReconnect === true
/** After a new sign-in (the new token carries the board scope). */
export const clearBoardReconnect = deps => patchState(deps.storage, { needsReconnect: false })
/** The one-time hint after connecting, shown at most once. True when it should be shown now. */
export function takeBoardHint(deps) {
  if (boardEnabled(deps) || readState(deps.storage).prompted) return false
  patchState(deps.storage, { prompted: true })
  return true
}

const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')

/** The manifest and the hash of its content (everything but `generated_at`). */
export async function boardContent(input, now, deps) {
  const manifest = buildBoardTiles(input, now)
  const { generated_at: _ignored, ...rest } = manifest
  const sha = hex(await deps.sha256(new TextEncoder().encode(JSON.stringify(rest))))
  return { manifest, sha }
}

/** Reads `error` out of a WWW-Authenticate header or, when the browser hides it (CORS), the JSON body. */
async function isInsufficientScope(response) {
  let header = null
  try { header = response.headers.get('WWW-Authenticate') } catch { /* hidden */ }
  if (header && /insufficient_scope/.test(header)) return true
  const body = await response.json().catch(() => null)
  return body?.error === 'insufficient_scope'
}

async function put(deps, token, body) {
  return deps.fetch(BOARD_URL, {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body,
  })
}

/**
 * One upload attempt if the rules allow it.
 * Returns { status, retryInMs? } with status one of: off, not_connected, reconnect, empty, rejected, same,
 * wait, lost_claim, sent, retry, failed.
 */
export async function maybeUploadBoard(input, deps) {
  try {
    if (!isConnected(deps)) return { status: 'not_connected' }
    if (!boardEnabled(deps)) return { status: 'off' }
    if (readState(deps.storage).needsReconnect) return { status: 'reconnect' }
    if (!hasBoardData(input)) return { status: 'empty' }

    const now = deps.now()
    const { manifest, sha } = await boardContent(input, now, deps)
    const state = readState(deps.storage)
    if (state.rejectedSha === sha) return { status: 'rejected' }
    const fresh = state.sha === sha && typeof state.okAt === 'number' && now - state.okAt < DAILY_MS
    if (fresh) {
      if (state.pending) patchState(deps.storage, { pending: false })
      return { status: 'same' }
    }

    // Another tab may have tried a moment ago: look again at what is stored now, then claim this attempt.
    const latest = readState(deps.storage)
    if (typeof latest.attemptAt === 'number' && now >= latest.attemptAt && now - latest.attemptAt < MIN_INTERVAL_MS) {
      patchState(deps.storage, { pending: true })
      return { status: 'wait', retryInMs: MIN_INTERVAL_MS - (now - latest.attemptAt) }
    }
    const claim = hex(deps.random(8))
    patchState(deps.storage, { attemptAt: now, claim })
    if (readState(deps.storage).claim !== claim) return { status: 'lost_claim' }

    // Never goes backwards, even when the clock does (the hub ignores a list that is not newer).
    const at = Math.max(now, (latest.lastGeneratedAt ?? 0) + 1000)
    const body = JSON.stringify({ ...manifest, generated_at: new Date(at).toISOString() })

    let response
    try {
      response = await put(deps, await accessToken(deps), body)
      if (response.status === 401) response = await put(deps, await accessToken(deps, true), body)
    } catch (e) {
      if (e?.kind === 'not_connected') return { status: 'not_connected' }
      patchState(deps.storage, { pending: true })
      return { status: 'retry', retryInMs: MIN_INTERVAL_MS }
    }

    if (response.ok) {
      patchState(deps.storage, { sha, okAt: now, lastGeneratedAt: at, pending: false, rejectedSha: null })
      return { status: 'sent' }
    }
    if (response.status === 401) {
      dropTokens(deps)
      return { status: 'not_connected' }
    }
    if (response.status === 403) {
      if (await isInsufficientScope(response)) {
        patchState(deps.storage, { needsReconnect: true, pending: false })
        return { status: 'reconnect' }
      }
      dropTokens(deps)
      return { status: 'not_connected' }
    }
    if (response.status === 400 || response.status === 413) {
      // A bug on this side: do not send the same content again.
      console.error(`Life Hub board upload refused (${response.status}); not retrying the same content.`)
      patchState(deps.storage, { rejectedSha: sha, pending: false })
      return { status: 'failed' }
    }
    patchState(deps.storage, { pending: true })
    return { status: 'retry', retryInMs: MIN_INTERVAL_MS }
  } catch (e) {
    console.error('Life Hub board upload failed.', e)
    return { status: 'failed' }
  }
}
