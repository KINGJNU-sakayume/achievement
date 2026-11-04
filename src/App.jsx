import React, { lazy, Suspense, useEffect } from 'react'
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import ToastStack from './components/ToastStack.jsx'
import { LifeHubBanner, LifeHubOpenSettingsOnCallback, useLifeHub } from './lifehub/LifeHub.jsx'
import SettingsButton from './components/SettingsButton.jsx'
import { useApp } from './context/AppContext.jsx'
import { useUI } from './context/UIContext.jsx'
import { AlertIcon, HomeIcon, InfoIcon, LogoMark, MedalIcon, NotebookIcon, TrophyIcon, XIcon } from './components/Icons.jsx'

const Dashboard = lazy(() => import('./pages/Dashboard.jsx'))
const RecordHub = lazy(() => import('./pages/RecordHub.jsx'))
const AchievementManagement = lazy(() => import('./pages/AchievementManagement.jsx'))
const AchievementShowcase = lazy(() => import('./pages/AchievementShowcase.jsx'))

const NAV_ITEMS = [
  { to: '/', label: '홈', icon: HomeIcon },
  { to: '/records', label: '기록', icon: NotebookIcon },
  { to: '/achievements', label: '업적', icon: MedalIcon },
  { to: '/showcase', label: '진열장', icon: TrophyIcon },
]

function TopBar() {
  const { openSettings } = useUI()
  const { status } = useLifeHub()
  return (
    <header className="sticky top-0 z-30 h-14 bg-paper/90 backdrop-blur border-b border-line">
      <div className="h-full px-4 md:px-6 flex items-center gap-8">
        <Link to="/" className="flex items-center gap-2.5 flex-shrink-0 rounded-lg">
          <LogoMark size={28} />
          <span className="text-md font-bold tracking-tight text-ink">업적 라이브러리</span>
        </Link>
        <nav className="hidden md:flex items-center gap-1" aria-label="주요 메뉴">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => [
                'flex items-center gap-2 h-9 px-3 rounded-lg text-base transition-colors',
                isActive ? 'bg-accent-soft text-accent-ink font-semibold' : 'text-ink-2 font-medium hover:bg-sunken hover:text-ink',
              ].join(' ')}
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="flex-1" />
        <SettingsButton attention={status === 'attention'} onClick={openSettings} />
      </div>
    </header>
  )
}

function TabBar() {
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-surface/95 backdrop-blur border-t border-line pb-safe" aria-label="주요 메뉴">
      <div className="grid grid-cols-4" style={{ height: 'var(--tabbar-h)' }}>
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => [
              'flex flex-col items-center justify-center gap-1 text-xs transition-colors',
              isActive ? 'text-accent font-semibold' : 'text-ink-3 font-medium',
            ].join(' ')}
          >
            <Icon size={22} strokeWidth={1.9} />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

function StorageBanner() {
  const { storageError, storageNotice, dismissStorageNotice } = useApp()
  const { openSettings } = useUI()
  if (!storageError && !storageNotice) return null
  const isError = !!storageError
  return (
    <div className={`border-b ${isError ? 'bg-danger-soft border-danger/20 text-danger' : 'bg-warn-soft border-warn/20 text-ink'}`} role={isError ? 'alert' : 'status'}>
      <div className="px-4 md:px-6 py-2.5 flex items-start gap-2.5 text-sm">
        {isError ? <AlertIcon size={18} className="flex-shrink-0" /> : <InfoIcon size={18} className="flex-shrink-0 text-warn" />}
        <p className="flex-1">{storageError || storageNotice}</p>
        {isError ? (
          <button type="button" onClick={openSettings} className="font-semibold underline underline-offset-2 flex-shrink-0">
            백업하기
          </button>
        ) : (
          <button type="button" onClick={dismissStorageNotice} className="icon-btn w-7 h-7 -my-1" aria-label="안내 닫기">
            <XIcon size={16} />
          </button>
        )}
      </div>
    </div>
  )
}

const PAGE_TITLES = { '/': '홈', '/records': '기록', '/achievements': '업적', '/showcase': '진열장' }

function useRouteEffects() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
    const title = PAGE_TITLES[pathname]
    document.title = title ? `${title} · 업적 라이브러리` : '업적 라이브러리'
  }, [pathname])
}

export default function App() {
  useRouteEffects()
  return (
    <div className="min-h-dvh flex flex-col">
      <TopBar />
      <StorageBanner />
      <LifeHubBanner />
      <LifeHubOpenSettingsOnCallback />
      <main className="flex-1 flex flex-col pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] md:pb-0">
        <Suspense fallback={<div className="flex-1" />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/records" element={<RecordHub />} />
            <Route path="/achievements" element={<AchievementManagement />} />
            <Route path="/showcase" element={<AchievementShowcase />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
      <TabBar />
      <ToastStack />
    </div>
  )
}
