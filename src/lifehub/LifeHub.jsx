import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@/context/AppContext.jsx'
import { useUI } from '@/context/UIContext.jsx'
import { formatNumber } from '@/utils/formatters.js'
import { InfoIcon } from '@/components/Icons.jsx'
import Switch from '@/components/Switch.jsx'
import { tierLabel } from '@/constants/tiers.js'
import {
  achievementFor, autoApplyEnabled, autoPlan, beginConnect, browserDeps, completeStoredCallback, connectAvailable,
  disconnect as disconnectHub, draftFor, isConnected, LifeHubError, matchCategory, recordIdFor, rejectLocally,
  setAutoApply as storeAutoApply, sync as syncHub,
} from './remote.js'

const LifeHubContext = createContext(null)
const FOCUS_SYNC_MS = 60 * 1000

/** One token exchange per page load, even when effects run twice (StrictMode). */
let callbackOnce = null
const finishCallback = () => (callbackOnce ??= completeStoredCallback(browserDeps()))

/** Life Hub state for the whole app: connection, pending proposals, review and reject. */
export function LifeHubProvider({ children }) {
  const { records, categories, achievements, addRecord, saveAchievement } = useApp()
  const [connected, setConnected] = useState(() => isConnected(browserDeps()))
  const [proposals, setProposals] = useState([])
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const recordsRef = useRef(records)
  useEffect(() => { recordsRef.current = records }, [records])
  const achievementsRef = useRef(achievements)
  useEffect(() => { achievementsRef.current = achievements }, [achievements])
  const categoriesRef = useRef(categories)
  useEffect(() => { categoriesRef.current = categories }, [categories])
  const [autoApply, setAutoApplyState] = useState(() => autoApplyEnabled(browserDeps()))
  const lastSync = useRef(0)

  const sync = useCallback(async (extraRecords = [], extraAchievements = []) => {
    if (!isConnected(browserDeps())) return
    lastSync.current = Date.now()
    setSyncing(true)
    setError(null)
    try {
      const deps = browserDeps()
      const run = (moreRecords, moreAchievements) => syncHub([...recordsRef.current, ...moreRecords], deps, {
        achievements: [...achievementsRef.current, ...moreAchievements], categories: categoriesRef.current,
      })
      let result = await run(extraRecords, extraAchievements)
      // Approved in a Claude card with nothing left to decide: save it now, then send the receipts right away.
      const savedRecords = []
      const savedAchievements = []
      const on = autoApplyEnabled(deps)
      for (const p of result.proposals) {
        const plan = autoPlan(p, categoriesRef.current, on)
        if (!plan) continue
        const id = plan.kind === 'record' ? plan.draft.id : plan.achievement.id
        if (recordsRef.current.some(r => r.id === id) || achievementsRef.current.some(a => a.id === id)) continue
        if (plan.kind === 'record') savedRecords.push(addRecord(plan.draft))
        else savedAchievements.push(saveAchievement(plan.achievement))
      }
      if (savedRecords.length || savedAchievements.length) {
        result = await run([...extraRecords, ...savedRecords], [...extraAchievements, ...savedAchievements])
        const parts = [savedRecords.length && `기록 ${savedRecords.length}개`, savedAchievements.length && `업적 ${savedAchievements.length}개`].filter(Boolean)
        setNotice(`Claude에서 승인한 ${parts.join('·')}를 저장했어요.`)
      }
      setProposals(result.proposals)
      if (result.conflicts) setError(`${result.conflicts}개 제안은 Life Hub와 상태가 달라요. 이 기기의 기록은 그대로예요.`)
    } catch (e) {
      if (e instanceof LifeHubError && e.kind === 'not_connected') {
        setConnected(false)
        setProposals([])
      }
      setError(e instanceof Error ? e.message : '동기화하지 못했어요.')
    } finally {
      setSyncing(false)
    }
  }, [addRecord, saveAchievement])

  // Finish a sign-in handed over by the callback page, then load proposals.
  useEffect(() => {
    let active = true
    finishCallback()
      .then(done => {
        if (!active) return
        if (done) {
          setConnected(true)
          setNotice('Life Hub에 연결했어요.')
        }
        sync()
      })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Life Hub에 연결하지 못했어요.') })
    return () => { active = false }
  }, [sync])

  // Coming back to the app picks up new proposals, at most once a minute.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastSync.current > FOCUS_SYNC_MS) sync()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [sync])

  /** Record editor options for a proposal, or null when it was already saved (e.g. in another tab). */
  const reviewOptions = useCallback((proposal) => {
    const id = recordIdFor(proposal.key)
    if (recordsRef.current.some(r => r.id === id)) {
      // Only the receipt is missing.
      setProposals(old => old.filter(p => p.key !== proposal.key))
      sync()
      return null
    }
    const draft = draftFor(proposal, categories)
    return {
      draft,
      draftNote: draft.categoryId
        ? 'Claude가 제안한 기록이에요. 확인하고 저장하면 기록돼요.'
        : `Claude가 제안한 기록이에요. 제안된 카테고리 '${proposal.category}'와 맞는 카테고리를 골라 주세요.`,
      onSaved: (saved) => {
        setProposals(old => old.filter(p => p.key !== proposal.key))
        sync([saved])
      },
    }
  }, [categories, sync])

  /** Add a proposed achievement after the owner said yes here. Null when its category needs choosing first. */
  const addAchievement = useCallback((proposal) => {
    const categoryId = proposal.category === null ? null : matchCategory(proposal.category, categoriesRef.current)
    if (proposal.category !== null && !categoryId) return null
    const saved = saveAchievement(achievementFor(proposal, categoryId))
    setProposals(old => old.filter(p => p.key !== proposal.key))
    sync([], [saved])
    return saved
  }, [saveAchievement, sync])

  const setAutoApply = useCallback((on) => {
    storeAutoApply(browserDeps(), on)
    setAutoApplyState(on)
    if (on) sync()
  }, [sync])

  const reject = useCallback((proposal) => {
    rejectLocally(proposal.key, browserDeps())
    setProposals(old => old.filter(p => p.key !== proposal.key))
    sync()
  }, [sync])

  const connect = useCallback(() => {
    beginConnect(browserDeps())
      .then(url => window.location.assign(url))
      .catch(e => setError(e instanceof Error ? e.message : '연결을 시작하지 못했어요.'))
  }, [])

  const disconnect = useCallback(() => {
    disconnectHub(browserDeps())
    setConnected(false)
    setProposals([])
    setNotice('Life Hub 연결을 해제했어요.')
  }, [])

  const value = useMemo(() => ({
    connected, proposals, syncing, error, notice, canConnect: connectAvailable(window.location), autoApply, categories,
    sync, reviewOptions, addAchievement, setAutoApply, reject, connect, disconnect, dismissNotice: () => setNotice(null),
  }), [connected, proposals, syncing, error, notice, autoApply, categories, sync, reviewOptions, addAchievement, setAutoApply, reject, connect, disconnect])

  return <LifeHubContext.Provider value={value}>{children}</LifeHubContext.Provider>
}

export function useLifeHub() {
  const ctx = useContext(LifeHubContext)
  if (!ctx) throw new Error('useLifeHub must be used within a LifeHubProvider')
  return ctx
}

const shortDate = d => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`
const conditionText = p => ({
  count: `기록 ${formatNumber(p.target)}번`, total: `누적 ${formatNumber(p.target)}${p.unit ?? ''}`, streak: `${formatNumber(p.target)}일 연속`,
  tag: `#${p.tag} 기록 한 번`, tag_count: `#${p.tag} 기록 ${formatNumber(p.target)}번`,
})[p.conditionType]
export const describeProposal = p => p.kind === 'achievement'
  ? `새 업적 '${p.title}' · ${[p.category ?? '모든 기록', conditionText(p), tierLabel(p.tier)].join(' · ')}`
  : [p.category, p.value != null ? `${formatNumber(p.value)}${p.unit ?? ''}` : null, shortDate(p.date)].filter(Boolean).join(' · ')

/** Under the top bar: proposals waiting for review, and connection messages. */
export function LifeHubBanner() {
  const { proposals, reviewOptions, addAchievement, reject, notice, error, dismissNotice, categories } = useLifeHub()
  const { openRecordEditor } = useUI()
  const review = (p) => {
    const options = reviewOptions(p)
    if (options) openRecordEditor(options)
  }
  const [open, setOpen] = useState(true)
  if (proposals.length === 0 && !notice && !error) return null
  return (
    <div className="border-b border-line bg-accent-soft/60" role="region" aria-label="Life Hub 제안">
      <div className="px-4 md:px-6 py-2.5 text-sm space-y-2">
        {(notice || error) && (
          <div className="flex items-start gap-2.5">
            <InfoIcon size={18} className="flex-shrink-0 text-accent" />
            <p className={`flex-1 ${error ? 'text-danger' : 'text-ink'}`} role={error ? 'alert' : 'status'}>{error || notice}</p>
            {notice && !error && <button type="button" className="font-semibold underline underline-offset-2" onClick={dismissNotice}>닫기</button>}
          </div>
        )}
        {proposals.length > 0 && (
          <>
            <button type="button" className="font-semibold text-accent-ink" aria-expanded={open} onClick={() => setOpen(v => !v)}>
              Claude가 제안한 기록 {formatNumber(proposals.length)}개 {open ? '접기' : '보기'}
            </button>
            {open && (
              <ul className="space-y-1.5">
                {proposals.map(p => (
                  <li key={p.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="min-w-0 flex-1 text-ink">
                      <strong className="font-semibold">{describeProposal(p)}</strong>
                      {p.kind === 'record' && p.tags.length > 0 && <span className="text-ink-3"> {p.tags.map(t => `#${t}`).join(' ')}</span>}
                      {p.kind === 'record' && p.memo && <span className="block text-xs text-ink-3 truncate">{p.memo}</span>}
                      {p.status === 'approved' && <span className="block text-xs text-ink-3">Claude 카드에서 승인함{p.needsAppReview ? ' · 여기서 한 번 더 확인해 주세요' : ''}</span>}
                      {p.kind === 'achievement' && p.category !== null && !matchCategory(p.category, categories) &&
                        <span className="block text-xs text-ink-3">카테고리 '{p.category}'를 찾지 못했어요. 업적 관리에서 직접 만들어 주세요.</span>}
                    </span>
                    <span className="flex gap-1.5">
                      {p.kind === 'achievement'
                        ? <button type="button" className="btn btn-primary btn-sm" disabled={p.category !== null && !matchCategory(p.category, categories)} onClick={() => addAchievement(p)}>추가</button>
                        : <button type="button" className="btn btn-primary btn-sm" onClick={() => review(p)}>확인</button>}
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => reject(p)}>거절</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** Settings section: connect, sync now, auto-apply, disconnect. */
export function LifeHubSettings() {
  const { connected, syncing, canConnect, connect, disconnect, sync, proposals, autoApply, setAutoApply } = useLifeHub()
  return (
    <>
      <p className="text-sm text-ink-2 mb-3">
        Claude에게 말한 활동을 Life Hub를 거쳐 기록 제안으로 받아요. 제안은 화면 위에 나타나고, 내용을 확인하고 저장해야 기록돼요.
      </p>
      {connected ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-secondary" disabled={syncing} onClick={() => sync()}>
            {syncing ? '동기화 중…' : '지금 동기화'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={disconnect}>연결 해제</button>
          <span className="text-sm text-ink-3">검토할 제안 {formatNumber(proposals.length)}개</span>
          <div className="w-full pt-2">
            <Switch id="lifehub-auto-apply" checked={autoApply} onChange={setAutoApply} label="Claude에서 승인된 항목 자동 반영"
              description="Claude 카드에서 승인한 기록·업적을 카테고리가 정확할 때 바로 저장해요." />
          </div>
        </div>
      ) : (
        <>
          <button type="button" className="btn btn-primary" disabled={!canConnect} onClick={connect}>Life Hub 연결</button>
          {!canConnect && <p className="field-hint">배포된 주소(kingjnu-sakayume.github.io/achievement)에서만 연결할 수 있어요.</p>}
        </>
      )}
    </>
  )
}
