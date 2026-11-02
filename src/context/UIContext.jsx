import React, { createContext, lazy, Suspense, useContext, useMemo, useState } from 'react'
import RecordEditorModal from '@/components/RecordEditorModal.jsx'
import AchievementDetailModal from '@/components/AchievementDetailModal.jsx'

const SettingsModal = lazy(() => import('@/components/SettingsModal.jsx'))

const UIContext = createContext(null)

/** App-wide sheets that any page (or a toast) can open. */
export function UIProvider({ children }) {
  const [recordEditor, setRecordEditor] = useState(null)
  const [achievementId, setAchievementId] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const api = useMemo(() => ({
    /** openRecordEditor({ categoryId }) to add, ({ record }) to edit, ({ draft, draftNote, onSaved }) to review a proposal */
    openRecordEditor: (options = {}) => setRecordEditor({ key: Date.now(), ...options }),
    openAchievement: (id) => setAchievementId(id),
    openSettings: () => setSettingsOpen(true),
  }), [])

  return (
    <UIContext.Provider value={api}>
      {children}
      {recordEditor && (
        <RecordEditorModal
          key={recordEditor.key}
          record={recordEditor.record ?? null}
          categoryId={recordEditor.categoryId ?? null}
          draft={recordEditor.draft ?? null}
          draftNote={recordEditor.draftNote ?? null}
          onSaved={recordEditor.onSaved ?? null}
          onClose={() => setRecordEditor(null)}
        />
      )}
      {achievementId && (
        <AchievementDetailModal id={achievementId} onClose={() => setAchievementId(null)} />
      )}
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal onClose={() => setSettingsOpen(false)} />
        </Suspense>
      )}
    </UIContext.Provider>
  )
}

export function useUI() {
  const ctx = useContext(UIContext)
  if (!ctx) throw new Error('useUI must be used within a UIProvider')
  return ctx
}
