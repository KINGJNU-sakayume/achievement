import React, { useMemo, useRef } from 'react'
import Modal from './Modal.jsx'
import { useApp } from '@/context/AppContext.jsx'
import { useToast } from '@/context/ToastContext.jsx'
import { useConfirm } from '@/hooks/useConfirm.jsx'
import { todayStr } from '@/utils/dates.js'
import { formatNumber, relativeDay } from '@/utils/formatters.js'
import { DownloadIcon, InfoIcon, TrashIcon, UploadIcon } from './Icons.jsx'
import { LifeHubSettings } from '@/lifehub/LifeHub.jsx'

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${formatNumber(Math.max(1, Math.round(bytes / 1024)))}KB`
  return `${formatNumber(bytes / (1024 * 1024), 1)}MB`
}

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function Section({ title, children }) {
  return (
    <section className="py-5 first:pt-1 border-b border-line last:border-b-0">
      <h3 className="text-base font-semibold text-ink mb-1">{title}</h3>
      {children}
    </section>
  )
}

export default function SettingsModal({ onClose }) {
  const { records, achievements, prefs, exportBackup, importBackup, resetAll, setPrefs } = useApp()
  const toast = useToast()
  const { confirm, confirmDialog } = useConfirm()
  const fileRef = useRef(null)

  const usage = useMemo(() => ({
    bytes: new Blob([JSON.stringify(exportBackup())]).size,
    photos: records.filter(r => r.photoUrl?.startsWith('data:')).length,
  }), [exportBackup, records])

  const handleExport = () => {
    download(`업적라이브러리-백업-${todayStr()}.json`, JSON.stringify(exportBackup(), null, 2))
    setPrefs({ lastBackupAt: todayStr() })
    toast.success('백업 파일을 저장했어요.')
  }

  const handleImport = async (file) => {
    if (!file) return
    let payload
    try {
      payload = JSON.parse(await file.text())
    } catch {
      toast.error('파일을 읽지 못했어요. 업적 라이브러리에서 받은 백업 파일인지 확인해 주세요.')
      return
    }
    const incoming = Array.isArray(payload?.data?.records) ? payload.data.records.length : 0
    const ok = await confirm(
      '백업 파일로 바꿀까요?',
      `지금 있는 기록 ${formatNumber(records.length)}개와 업적 설정이 백업 파일의 내용(기록 ${formatNumber(incoming)}개)으로 바뀌어요.`,
      { confirmLabel: '바꾸기' },
    )
    if (!ok) return
    try {
      importBackup(payload)
      toast.success('백업 파일을 불러왔어요.')
      onClose()
    } catch (error) {
      toast.error(error.message)
    }
  }

  const handleReset = async () => {
    const ok = await confirm(
      '모든 데이터를 지울까요?',
      '기록, 직접 만든 업적, 카테고리가 모두 지워지고 처음 상태로 돌아가요. 되돌릴 수 없으니 먼저 백업해 두세요.',
      { confirmLabel: '모두 지우기' },
    )
    if (!ok) return
    resetAll()
    toast.success('처음 상태로 돌아갔어요.')
    onClose()
  }

  return (
    <Modal title="설정" onClose={onClose}>
      <div className="flex gap-2.5 rounded-xl bg-sunken px-3.5 py-3 text-sm text-ink-2">
        <InfoIcon size={18} className="flex-shrink-0 mt-px" />
        <p>
          모든 데이터는 이 기기의 브라우저에만 저장돼요. 브라우저 데이터를 지우거나 다른 기기에서 열면 보이지 않으니,
          가끔 백업 파일을 받아 두세요.
        </p>
      </div>

      <Section title="백업">
        <p className="text-sm text-ink-2 mb-3">
          {prefs.lastBackupAt ? `마지막 백업: ${relativeDay(prefs.lastBackupAt)}` : '아직 백업한 적이 없어요.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={handleExport}>
            <DownloadIcon size={18} /> 백업 파일 받기
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
            <UploadIcon size={18} /> 백업 불러오기
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            tabIndex={-1}
            onChange={e => { handleImport(e.target.files?.[0]); e.target.value = '' }}
          />
        </div>
      </Section>

      <Section title="Life Hub">
        <LifeHubSettings />
      </Section>

      <Section title="저장 공간">
        <p className="text-sm text-ink-2">
          기록 {formatNumber(records.length)}개 · 업적 {formatNumber(achievements.length)}개 · 사진 {formatNumber(usage.photos)}장 ·
          약 {formatBytes(usage.bytes)} 사용 중
        </p>
        <p className="field-hint">브라우저마다 다르지만 보통 5MB 안팎까지 저장할 수 있어요. 사진이 가장 많은 공간을 차지해요.</p>
      </Section>

      <Section title="초기화">
        <p className="text-sm text-ink-2 mb-3">기록과 업적을 모두 지우고 처음 상태로 돌아가요.</p>
        <button type="button" className="btn btn-danger-outline" onClick={handleReset}>
          <TrashIcon size={18} /> 모든 데이터 지우기
        </button>
      </Section>

      {confirmDialog}
    </Modal>
  )
}
