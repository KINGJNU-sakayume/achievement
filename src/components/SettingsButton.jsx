import React from 'react'
import { SettingsIcon } from './Icons.jsx'

/** Header gear. A warning dot and a spoken suffix show when Life Hub needs attention. */
export default function SettingsButton({ attention = false, onClick }) {
  return (
    <button type="button" onClick={onClick} className="icon-btn relative -mr-1.5" aria-label={attention ? '설정 및 백업 (확인 필요)' : '설정 및 백업'}>
      <SettingsIcon size={20} />
      {attention && <span aria-hidden="true" data-testid="settings-attention-dot" className="absolute top-1 right-1 w-2 h-2 rounded-full bg-warn" />}
    </button>
  )
}
