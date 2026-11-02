import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@/context/AppContext.jsx'
import { useUI } from '@/context/UIContext.jsx'
import { formatNumber } from '@/utils/formatters.js'
import { InfoIcon } from '@/components/Icons.jsx'
import {
  beginConnect, browserDeps, completeStoredCallback, connectAvailable, disconnect as disconnectHub, draftFor,
  isConnected, LifeHubError, recordIdFor, rejectLocally, sync as syncHub,
} from './remote.js'

const LifeHubContext = createContext(null)
const FOCUS_SYNC_MS = 60 * 1000

/** One token exchange per page load, even when effects run twice (StrictMode). */
let callbackOnce = null
const finishCallback = () => (callbackOnce ??= completeStoredCallback(browserDeps()))

/** Life Hub state for the whole app: connection, pending proposals, review and reject. */
export function LifeHubProvider({ children }) {
  const { records, categories } = useApp()
  const [connected, setConnected] = useState(() => isConnected(browserDeps()))
  const [proposals, setProposals] = useState([])
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const recordsRef = useRef(records)
  useEffect(() => { recordsRef.current = records }, [records])
  const lastSync = useRef(0)

  const sync = useCallback(async (extraRecords = []) => {
    if (!isConnected(browserDeps())) return
    lastSync.current = Date.now()
    setSyncing(true)
    setError(null)
    try {
      const result = await syncHub([...recordsRef.current, ...extraRecords], browserDeps())
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
  }, [])

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
    connected, proposals, syncing, error, notice, canConnect: connectAvailable(window.location),
    sync, reviewOptions, reject, connect, disconnect, dismissNotice: () => setNotice(null),
  }), [connected, proposals, syncing, error, notice, sync, reviewOptions, reject, connect, disconnect])

  return <LifeHubContext.Provider value={value}>{children}</LifeHubContext.Provider>
}

export function useLifeHub() {
  const ctx = useContext(LifeHubContext)
  if (!ctx) throw new Error('useLifeHub must be used within a LifeHubProvider')
  return ctx
}

const shortDate = d => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`
export const describeProposal = p =>
  [p.category, p.value != null ? `${formatNumber(p.value)}${p.unit ?? ''}` : null, shortDate(p.date)].filter(Boolean).join(' · ')

/** Under the top bar: proposals waiting for review, and connection messages. */
export function LifeHubBanner() {
  const { proposals, reviewOptions, reject, notice, error, dismissNotice } = useLifeHub()
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
                      {p.tags.length > 0 && <span className="text-ink-3"> {p.tags.map(t => `#${t}`).join(' ')}</span>}
                      {p.memo && <span className="block text-xs text-ink-3 truncate">{p.memo}</span>}
                    </span>
                    <span className="flex gap-1.5">
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => review(p)}>확인</button>
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

/** Settings section: connect, sync now, disconnect. */
export function LifeHubSettings() {
  const { connected, syncing, canConnect, connect, disconnect, sync, proposals } = useLifeHub()
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
