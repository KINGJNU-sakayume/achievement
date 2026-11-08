import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { validateManifest } from './vendor/schema.js'
import { buildBoardTiles, clip, hasBoardData } from './buildBoardTiles.js'
import { POLICY } from './testPolicy.js'
import { SAMPLE_ACHIEVEMENTS, SAMPLE_CATEGORIES, SAMPLE_INPUT, SAMPLE_NOW } from './sampleState.js'

const build = (input = SAMPLE_INPUT, now = SAMPLE_NOW) => buildBoardTiles(input, now)
const tile = (m, id) => m.tiles.find(t => t.id === id)
const ach = (id, extra = {}) => ({ id, title: id, categoryId: 'cat-run', tier: 'bronze', condition: { type: 'count', target: 1 }, isHidden: false, isEarned: true, earnedAt: '2026-11-01', ...extra })

function expectValid(manifest) {
  const result = validateManifest(manifest, POLICY)
  expect(result.errors).toEqual([])
  expect(result.tiles).toHaveLength(manifest.tiles.length)
  return result
}

describe('manifest', () => {
  it('passes the board schema with the board policy, losing no tile', () => {
    const m = build()
    expect(m.tiles.map(t => t.id)).toEqual(['recent', 'trophy'])
    expectValid(m)
  })

  it('board/sample.json is exactly what the builder makes from the made-up state', () => {
    const sample = JSON.parse(readFileSync(new URL('../../board/sample.json', import.meta.url), 'utf8'))
    expect(sample).toEqual(build())
    expectValid(sample)
  })

  it('same input, same output', () => {
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()))
  })

  it('fixed ids, sizes, first size and default', () => {
    const m = build()
    expect(tile(m, 'recent')).toMatchObject({ tone: 'type', form: 'line', sizes: ['1x1', '2x1'], size: '2x1', default: true })
    expect(tile(m, 'trophy')).toMatchObject({ tone: 'type', form: 'cells', sizes: ['2x1', '4x1'], size: '2x1', default: true })
    expect(m.tiles.every(t => t.href === 'https://kingjnu-sakayume.github.io/achievement/' && !('cover' in t) && !('accent' in t))).toBe(true)
  })

  it('has no tiles, and still a valid list, when nothing is earned', () => {
    const m = build({ achievements: SAMPLE_ACHIEVEMENTS.map(a => ({ ...a, isEarned: false, earnedAt: null })), records: [], categories: SAMPLE_CATEGORIES })
    expect(m.tiles).toEqual([])
    expect(validateManifest(m, POLICY)).toMatchObject({ errors: [], tiles: [] })
    expect(build({}).tiles).toEqual([])
  })
})

describe('recent', () => {
  it('is the latest earned achievement with tier, category and a date, never "yesterday"', () => {
    expect(tile(build(), 'recent').data).toEqual({ label: '최근 취득', title: '누적 10km', sub: '실버 · 러닝 · 11/5' })
  })

  it('breaks a tie: record-based before combined, then the harder tier, then id', () => {
    const achievements = [
      ach('b', { earnedAt: '2026-11-03', tier: 'gold', condition: { type: 'meta_count', target: 2 } }),
      ach('c', { earnedAt: '2026-11-03', tier: 'silver' }),
      ach('a', { earnedAt: '2026-11-03', tier: 'silver' }),
      ach('d', { earnedAt: '2026-11-03', tier: 'bronze' }),
    ]
    expect(tile(build({ achievements, categories: SAMPLE_CATEGORIES }), 'recent').data.title).toBe('a')
    expect(tile(build({ achievements: achievements.filter(a => a.id !== 'a' && a.id !== 'c' && a.id !== 'd'), categories: SAMPLE_CATEGORIES }), 'recent').data.title).toBe('b')
  })

  it('ignores a date in the future', () => {
    const achievements = [ach('now', { earnedAt: '2026-11-05' }), ach('later', { earnedAt: '2026-11-30' })]
    expect(tile(build({ achievements, categories: SAMPLE_CATEGORIES }), 'recent').data.title).toBe('now')
  })

  it('drops the category from the line when there is none', () => {
    const m = build({ achievements: [ach('x', { categoryId: null, title: '제목' })], categories: SAMPLE_CATEGORIES })
    expect(tile(m, 'recent').data.sub).toBe('브론즈 · 11/1')
    expect(tile(m, 'trophy')).toBeUndefined()
    expectValid(m)
  })

  it('shows an earned hidden achievement but never an unearned one', () => {
    const achievements = [ach('seen', { isHidden: true, title: '숨은 업적' }), ach('secret', { isHidden: true, isEarned: false, earnedAt: null, title: '아직 비밀' })]
    const text = JSON.stringify(build({ achievements, categories: SAMPLE_CATEGORIES }))
    expect(text).toContain('숨은 업적')
    expect(text).not.toContain('아직 비밀')
  })
})

describe('trophy', () => {
  it('fills the category of the latest earned achievement, counting only its own achievements', () => {
    expect(tile(build(), 'trophy').data).toEqual({ label: '트로피 · 러닝', total: 3, filled: 2 })
  })

  it('does not count an unearned hidden achievement, so its existence stays secret', () => {
    // 러닝 has 4 achievements, one of them hidden and not earned.
    expect(SAMPLE_ACHIEVEMENTS.filter(a => a.categoryId === 'cat-run')).toHaveLength(4)
    expect(tile(build(), 'trophy').data.total).toBe(3)
  })

  it('counts an earned hidden achievement', () => {
    const achievements = SAMPLE_ACHIEVEMENTS.map(a => (a.id === 'run-secret' ? { ...a, isEarned: true, earnedAt: '2026-10-01' } : a))
    expect(tile(build({ achievements, categories: SAMPLE_CATEGORIES }), 'trophy').data).toEqual({ label: '트로피 · 러닝', total: 4, filled: 3 })
  })

  it('leaves the tile out above 60 cells or when the category is unknown', () => {
    const many = Array.from({ length: 61 }, (_, i) => ach(`m${i}`, { isEarned: i === 0 }))
    expect(tile(build({ achievements: many, categories: SAMPLE_CATEGORIES }), 'trophy')).toBeUndefined()
    expect(tile(build({ achievements: many.slice(0, 60), categories: SAMPLE_CATEGORIES }), 'trophy').data.total).toBe(60)
    expect(tile(build({ achievements: [ach('x', { categoryId: 'gone' })], categories: SAMPLE_CATEGORIES }), 'trophy')).toBeUndefined()
  })
})

describe('what is sent', () => {
  it('never carries record values, memo, tags or photos', () => {
    const text = JSON.stringify(build())
    for (const secret of ['가상의 메모', '새벽', 'rec-1', 'photoUrl', '5km']) expect(text).not.toContain(secret)
  })

  it('stays well under the 64 KiB limit', () => {
    expect(new TextEncoder().encode(JSON.stringify(build())).length).toBeLessThan(2048)
  })
})

describe('text limits', () => {
  it('cuts to the limit without splitting an emoji, and drops empty text', () => {
    expect(clip('가'.repeat(200), 160)).toHaveLength(160)
    expect(clip('😀'.repeat(100), 160)).toBe('😀'.repeat(80))
    expect(clip('😀😀😀', 5)).toBe('😀😀')
    expect(clip('  ', 10)).toBeUndefined()
    expect(clip('a b   ', 2)).toBe('a')
    expect(clip(undefined, 10)).toBeUndefined()
  })

  it('keeps long titles and category names inside the schema', () => {
    const long = '업'.repeat(300)
    const categories = [{ id: 'cat-run', name: long, parentId: null }]
    const m = build({ achievements: [ach('x', { title: long })], categories })
    expect(tile(m, 'recent').data.title).toHaveLength(160)
    expect(tile(m, 'recent').data.sub.length).toBeLessThanOrEqual(80)
    expect(tile(m, 'recent').data.sub.endsWith(' · 11/1')).toBe(true)
    expect(tile(m, 'trophy').data.label.length).toBeLessThanOrEqual(80)
    expectValid(m)
  })

  it('leaves out a title that is only spaces, rather than sending empty text', () => {
    const m = build({ achievements: [ach('x', { title: '   ' })], categories: SAMPLE_CATEGORIES })
    expect(tile(m, 'recent')).toBeUndefined()
    expectValid(m)
  })
})

describe('hasBoardData', () => {
  it('needs a record or an earned achievement', () => {
    expect(hasBoardData({ achievements: [ach('x', { isEarned: false })], records: [] })).toBe(false)
    expect(hasBoardData({ achievements: [ach('x')], records: [] })).toBe(true)
    expect(hasBoardData({ achievements: [], records: [{ id: 'r' }] })).toBe(true)
  })
})
