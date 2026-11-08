// Made-up data for board/sample.json and the tests. Nothing here comes from a real record.

export const SAMPLE_NOW = Date.UTC(2026, 10, 5, 12, 0, 0)

export const SAMPLE_CATEGORIES = [
  { id: 'cat-run', name: '러닝', parentId: null },
  { id: 'cat-read', name: '독서', parentId: null },
]

const count = { type: 'count', target: 1 }

function achievement(id, title, categoryId, tier, extra = {}) {
  return { id, title, description: '', categoryId, tier, condition: count, isHidden: false, isEarned: false, earnedAt: null, ...extra }
}

export const SAMPLE_ACHIEVEMENTS = [
  achievement('run-first', '첫 달리기', 'cat-run', 'bronze', { isEarned: true, earnedAt: '2026-10-20' }),
  achievement('run-10km', '누적 10km', 'cat-run', 'silver', { isEarned: true, earnedAt: '2026-11-05' }),
  achievement('run-50km', '누적 50km', 'cat-run', 'gold'),
  achievement('run-secret', '숨은 달리기', 'cat-run', 'platinum', { isHidden: true }),
  achievement('read-first', '첫 독서', 'cat-read', 'bronze', { isEarned: true, earnedAt: '2026-11-01' }),
  achievement('read-10', '책 10권', 'cat-read', 'silver'),
]

export const SAMPLE_RECORDS = [
  { id: 'rec-1', categoryId: 'cat-run', date: '2026-11-05', value: 5, unit: 'km', memo: '가상의 메모', photoUrl: null, tags: ['새벽'] },
]

export const SAMPLE_INPUT = { achievements: SAMPLE_ACHIEVEMENTS, records: SAMPLE_RECORDS, categories: SAMPLE_CATEGORIES }
