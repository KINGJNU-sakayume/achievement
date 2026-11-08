// Life Board tiles (board repository docs/TILES.md, manifest v1) from the app's own data.
//
// Pure: the same input gives the same output, nothing is read from the network, storage or the clock.
// It only sends achievement titles, tiers, category names and dates. Records (values, memo, tags, photos)
// and achievements that are hidden and not earned yet never leave the device.

import { getTier, tierLabel } from '@/constants/tiers.js'
import { toDateStr } from '@/utils/dates.js'
import { isMetaCondition } from '@/utils/achievementEvaluator.js'
import { APP_URL } from '@/lifehub/remote.js'

export const BOARD_APP = 'achievement'
export const TILE_IDS = Object.freeze({ recent: 'recent', trophy: 'trophy' })
const MAX_CELLS = 60
const LABEL_MAX = 80
const LONG_MAX = 160
const SUB_MAX = 80

/** At most `max` UTF-16 units (the board counts with `.length`), never splitting a surrogate pair. Undefined when empty. */
export function clip(value, max) {
  if (typeof value !== 'string') return undefined
  let out = ''
  for (const ch of value.trim()) {
    if (out.length + ch.length > max) break
    out += ch
  }
  out = out.trim()
  return out === '' ? undefined : out
}

const shortDate = d => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`

/** Earned, with a valid date that is not in the future. Hidden ones count only once earned. */
function earnedList(achievements, today) {
  return achievements.filter(a => a.isEarned && typeof a.earnedAt === 'string' && a.earnedAt <= today)
}

// Same order as the "achievement earned" toast: record-based before combined ones, then the harder tier, then id.
function newestFirst(a, b) {
  return (b.earnedAt < a.earnedAt ? -1 : b.earnedAt > a.earnedAt ? 1 : 0)
    || Number(isMetaCondition(a.condition)) - Number(isMetaCondition(b.condition))
    || getTier(b.tier).rank - getTier(a.tier).rank
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

function recentTile(newest, categoryName) {
  const title = clip(newest.title, LONG_MAX)
  if (!title) return null
  // `line` allows 80 characters in `sub` (only `title` has 160). The category name gives way so the date stays.
  const head = `${tierLabel(newest.tier)} · `
  const tail = ` · ${shortDate(newest.earnedAt)}`
  const category = clip(categoryName, SUB_MAX - head.length - tail.length)
  const sub = category ? `${head}${category}${tail}` : `${head}${shortDate(newest.earnedAt)}`
  return {
    id: TILE_IDS.recent,
    name: '업적 · 최근 취득',
    tone: 'type',
    form: 'line',
    sizes: ['1x1', '2x1'],
    size: '2x1',
    default: true,
    href: APP_URL,
    data: { label: '최근 취득', title, sub },
  }
}

function trophyTile(newest, achievements, categoryName) {
  // Hidden and not earned: not even counted, so the number cannot give them away.
  const inCategory = achievements.filter(a => a.categoryId === newest.categoryId && (a.isEarned || !a.isHidden))
  const total = inCategory.length
  if (!categoryName || total < 1 || total > MAX_CELLS) return null
  const label = clip(`트로피 · ${categoryName}`, LABEL_MAX)
  return {
    id: TILE_IDS.trophy,
    name: '업적 · 트로피 칸',
    tone: 'type',
    form: 'cells',
    sizes: ['2x1', '4x1'],
    size: '2x1',
    default: true,
    href: APP_URL,
    data: { label, total, filled: inCategory.filter(a => a.isEarned).length },
  }
}

/**
 * @param {{ achievements: Object[], categories: Object[] }} input  achievements as AppContext evaluated them
 *   (isEarned, earnedAt, isHidden, categoryId, tier, condition). `records` is accepted but never read.
 * @param {number} now  milliseconds; the date it falls on (local time, like every date in the app) is "today"
 * @returns the manifest. The uploader replaces `generated_at` with a value that never goes backwards.
 */
export function buildBoardTiles({ achievements = [], categories = [] } = {}, now) {
  const today = toDateStr(new Date(now))
  const names = new Map(categories.map(c => [c.id, c.name]))
  const tiles = []
  const earned = earnedList(achievements, today).sort(newestFirst)
  const newest = earned[0]
  if (newest) {
    const recent = recentTile(newest, names.get(newest.categoryId))
    if (recent) tiles.push(recent)
  }
  const withCategory = earned.find(a => a.categoryId != null && names.has(a.categoryId))
  if (withCategory) {
    const trophy = trophyTile(withCategory, achievements, names.get(withCategory.categoryId))
    if (trophy) tiles.push(trophy)
  }
  return { version: 1, app: BOARD_APP, generated_at: new Date(now).toISOString(), tiles }
}

/** True when there is something worth sharing: any record or any earned achievement (a new device must not overwrite with nothing). */
export function hasBoardData({ achievements = [], records = [] } = {}) {
  return records.length > 0 || achievements.some(a => a.isEarned)
}
