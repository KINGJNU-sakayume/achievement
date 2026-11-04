import { describe, it, expect } from 'vitest'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LifeHubBanner, LifeHubContext, LifeHubSettings } from './LifeHub.jsx'
import SettingsButton from '@/components/SettingsButton.jsx'
import { UIContext } from '@/context/UIContext.jsx'

const base = {
  connected: false, status: 'none', retrying: false, callbackDone: false, proposals: [], syncing: false, error: null, notice: null,
  canConnect: true, autoApply: true, categories: [], sync() {}, reviewOptions() {}, addAchievement() {}, setAutoApply() {},
  reject() {}, connect() {}, disconnect() {}, dismissNotice() {},
}
const render = (Component, hub = {}) => renderToStaticMarkup(
  h(UIContext.Provider, { value: { openRecordEditor() {}, openSettings() {} } },
    h(LifeHubContext.Provider, { value: { ...base, ...hub } }, h(Component))),
)
const connectedState = { connected: true, status: 'ok' }
const attentionState = { connected: false, status: 'attention' }
const proposal = { key: 'claude:mcp-' + 'a'.repeat(40), kind: 'record', category: '러닝', date: '2026-11-02', value: 5, unit: 'km', tags: [], memo: null, status: 'pending' }

describe('proposal entry point', () => {
  it('renders nothing with zero proposals, whatever the connection state', () => {
    for (const hub of [{}, connectedState, attentionState, { ...connectedState, retrying: true }]) {
      expect(render(LifeHubBanner, hub)).toBe('')
    }
  })
  it('shows the count when there is at least one proposal, and never offers to connect', () => {
    const html = render(LifeHubBanner, { ...connectedState, proposals: [proposal] })
    expect(html).toContain('Claude가 제안한 기록 1개')
    expect(html).not.toContain('Life Hub 연결')
    expect(render(LifeHubBanner, { proposals: [proposal], connected: false })).not.toContain('Life Hub 연결')
  })
})

describe('settings entry point', () => {
  const button = attention => renderToStaticMarkup(h(SettingsButton, { attention, onClick() {} }))
  it('draws a dot and adds "(확인 필요)" to the name only when attention is needed', () => {
    const on = button(true)
    expect(on).toContain('aria-label="설정 및 백업 (확인 필요)"')
    expect(on).toContain('settings-attention-dot')
    const off = button(false)
    expect(off).toContain('aria-label="설정 및 백업"')
    expect(off).not.toContain('settings-attention-dot')
  })
})

describe('Life Hub settings section', () => {
  it('state A: description, connect button, and a hint when connecting is not possible', () => {
    const html = render(LifeHubSettings)
    expect(html).toContain('Claude가 제안한 기록을 받습니다.')
    expect(html.match(/Life Hub 연결/g)).toHaveLength(1)
    expect(html).not.toContain('disabled')
    const off = render(LifeHubSettings, { canConnect: false })
    expect(off).toContain('disabled')
    expect(off).toContain('배포된 주소에서만 연결할 수 있어요.')
  })
  it('state B: status line, sync now, disconnect, auto-apply checkbox, no advanced area', () => {
    const html = render(LifeHubSettings, connectedState)
    for (const text of ['연결됨', '지금 동기화', '연결 해제', 'Claude에서 승인한 기록은 바로 반영']) expect(html).toContain(text)
    expect(html).toContain('type="checkbox"')
    expect(html).not.toContain('Life Hub 연결')
    expect(html).not.toContain('고급')
    expect(html).not.toContain('role="switch"')
    expect(render(LifeHubSettings, { ...connectedState, syncing: true })).toContain('연결됨 · 동기화 중…')
    expect(render(LifeHubSettings, { ...connectedState, retrying: true })).toContain('연결됨 · 잠시 뒤 다시 시도')
    expect(render(LifeHubSettings, { ...connectedState, retrying: true })).not.toContain('확인 필요')
  })
  it('state C: warning line and box with 다시 연결, then 연결 해제', () => {
    const html = render(LifeHubSettings, attentionState)
    expect(html).toContain('확인 필요')
    expect(html).toContain('Life Hub 연결이 끊겼습니다. 다시 연결해 주세요. 이 기기의 기록은 그대로입니다.')
    expect(html.indexOf('다시 연결</button>')).toBeGreaterThan(-1)
    expect(html.indexOf('다시 연결</button>')).toBeLessThan(html.indexOf('연결 해제'))
    expect(html).toContain('bg-warn-soft')
  })
})
