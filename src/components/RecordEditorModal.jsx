import React, { useDeferredValue, useId, useMemo, useRef, useState } from 'react'
import Modal from './Modal.jsx'
import Medal from './Medal.jsx'
import ProgressBar from './ProgressBar.jsx'
import CategoryPicker from './CategoryPicker.jsx'
import TagInput from './TagInput.jsx'
import { useApp } from '@/context/AppContext.jsx'
import { useToast } from '@/context/ToastContext.jsx'
import { useConfirm } from '@/hooks/useConfirm.jsx'
import { getTier } from '@/constants/tiers.js'
import { recordFromInput } from '@/lib/appState.js'
import { addDays, isValidDateStr, todayStr } from '@/utils/dates.js'
import { getDirectChildren } from '@/utils/categoryTree.js'
import { imageFileToDataUrl } from '@/utils/image.js'
import { achievementUnits, recentUnits, suggestTags } from '@/utils/suggestions.js'
import { evaluateAchievements, isMetaCondition, normalizeTag } from '@/utils/achievementEvaluator.js'
import { hasMeasurableProgress, progressLabel, progressRatio } from '@/utils/achievementText.js'
import { canConvert, parseValueInput } from '@/utils/units.js'
import { AlertIcon, ImageIcon, PlusIcon, TrashIcon, XIcon } from './Icons.jsx'

const SUGGESTION_PREVIEW = 8
const IMPACT_PREVIEW = 3
const DRAFT_ID = '__draft-record__'
const PHOTO_URL_RE = /^https?:\/\/\S+$/

/**
 * Unit and tags a new record in `categoryId` starts with: the category's saved
 * defaults, otherwise the unit its achievements are measured in — so a quick
 * "5" in 러닝 is saved as 5km instead of a bare number.
 */
function startingValues(categoryId, prefs, achievements, categories) {
  const saved = categoryId ? prefs.categoryDefaults[categoryId] : null
  if (!categoryId || saved?.autoApply === false) return { unit: '', tags: [] }
  return {
    unit: saved?.defaultUnit || achievementUnits(categoryId, achievements, categories)[0] || '',
    tags: [...(saved?.defaultTags ?? [])],
  }
}

function initialForm(record, categoryId, prefs, achievements, categories, draft) {
  if (draft) {
    // A proposal (Life Hub): its values as given; a missing unit falls back to the category's.
    const start = startingValues(draft.categoryId, prefs, achievements, categories)
    return {
      categoryId: draft.categoryId ?? null,
      date: draft.date,
      value: draft.value != null ? String(draft.value) : '',
      unit: draft.unit ?? (draft.value != null ? start.unit : ''),
      memo: draft.memo ?? '',
      photoUrl: '',
      tags: [...(draft.tags ?? [])],
    }
  }
  if (record) {
    return {
      categoryId: record.categoryId,
      date: record.date,
      value: record.value != null ? String(record.value) : '',
      unit: record.unit ?? '',
      memo: record.memo ?? '',
      photoUrl: record.photoUrl ?? '',
      tags: [...(record.tags || [])],
    }
  }
  const startCategory = categoryId ?? prefs.lastCategoryId ?? null
  const start = startingValues(startCategory, prefs, achievements, categories)
  return { categoryId: startCategory, date: todayStr(), value: '', unit: start.unit, memo: '', photoUrl: '', tags: start.tags }
}

/** The form with a unit typed into the value box ('5km') moved to the unit field. */
function withSplitValue(form) {
  const parsed = parseValueInput(form.value)
  if (parsed.error || !parsed.unit) return form
  return { ...form, value: String(parsed.value), unit: parsed.unit }
}

function byTier(a, b) {
  return getTier(b.tier).rank - getTier(a.tier).rank
}

/** What saving this record would change: achievements gained, lost, or moved forward. */
function useImpact({ form, record, records, achievements, categories }) {
  // Memo and photo never change an achievement, so typing there doesn't re-evaluate.
  const key = JSON.stringify([form.categoryId, form.date, form.value, form.unit, form.tags])
  const deferredKey = useDeferredValue(key)
  return useMemo(() => {
    const [categoryId, date, value, unit, tags] = JSON.parse(deferredKey)
    if (!categoryId || !isValidDateStr(date) || date > todayStr()) return null
    const parsed = parseValueInput(value)
    if (parsed.error || (parsed.value != null && parsed.value < 0)) return null

    const draft = recordFromInput({
      id: record?.id ?? DRAFT_ID, categoryId, date, value: parsed.value ?? '', unit: parsed.unit ?? unit, tags,
    })
    const nextRecords = record ? records.map(r => (r.id === record.id ? draft : r)) : [...records, draft]
    const after = evaluateAchievements(achievements, nextRecords, categories)

    const gained = []
    const lost = []
    const closer = []
    for (const a of achievements) {
      const r = after.get(a.id)
      if (!r || r.error) continue
      if (r.earned && !a.isEarned) gained.push(a)
      else if (!r.earned && a.isEarned) lost.push(a)
      // Only goals this record itself moves; achievements about other achievements would crowd them out.
      else if (!r.earned && !a.isHidden && !isMetaCondition(a.condition) && hasMeasurableProgress(a.condition) && r.progress > a.progress) {
        closer.push({ ...a, progress: r.progress, target: r.target })
      }
    }
    gained.sort(byTier)
    closer.sort((x, y) => progressRatio(y) - progressRatio(x) || byTier(x, y))
    return { gained, lost, closer }
  }, [deferredKey, record, records, achievements, categories])
}

function ImpactList({ title, tone = 'accent', items, render, showRest = true }) {
  if (items.length === 0) return null
  const rest = items.length - IMPACT_PREVIEW
  return (
    <div>
      <p className={`text-xs font-semibold mb-1.5 ${tone === 'danger' ? 'text-danger' : 'text-accent-ink'}`}>{title}</p>
      <ul className="space-y-1.5">
        {items.slice(0, IMPACT_PREVIEW).map(render)}
      </ul>
      {showRest && rest > 0 && <p className="mt-1 text-xs text-ink-3">외 {rest}개</p>}
    </div>
  )
}

function ImpactPreview({ impact, isEditing }) {
  if (!impact) return null
  const { gained, lost, closer } = impact
  if (gained.length + lost.length + closer.length === 0) return null
  return (
    <section className="rounded-xl bg-sunken/60 px-3.5 py-3 space-y-3" aria-label="이 기록이 반영되는 업적" aria-live="polite">
      <ImpactList
        title={isEditing ? '이렇게 고치면 달성해요' : '저장하면 달성해요'}
        items={gained}
        render={a => {
          const secret = a.isHidden
          return (
            <li key={a.id} className="flex items-center gap-2.5">
              <Medal tier={a.tier} earned={!secret} hidden={secret} size={24} />
              <span className="min-w-0 truncate text-sm font-semibold text-ink">{secret ? '숨겨진 업적' : a.title}</span>
            </li>
          )
        }}
      />
      <ImpactList
        title="이렇게 고치면 다시 잠겨요"
        tone="danger"
        items={lost}
        render={a => (
          <li key={a.id} className="flex items-center gap-2.5">
            <Medal tier={a.tier} size={24} />
            <span className="min-w-0 truncate text-sm font-medium text-ink-2">{a.title}</span>
          </li>
        )}
      />
      <ImpactList
        title="가까워지는 업적"
        items={closer}
        showRest={false}
        render={a => (
          <li key={a.id} className="flex items-center gap-2.5">
            <Medal tier={a.tier} size={24} />
            <span className="flex-1 min-w-0">
              <span className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium text-ink">{a.title}</span>
                <span className="flex-shrink-0 text-xs text-ink-2 tabular">{progressLabel(a)}</span>
              </span>
              <ProgressBar value={progressRatio(a)} height={3} className="mt-1" label={`${a.title} 진행도`} />
            </span>
          </li>
        )}
      />
    </section>
  )
}

/**
 * Add a record (`record` null) or edit one. `categoryId` preselects a category.
 * `draft` pre-fills a new record from a proposal (it keeps the draft's ID); `onSaved` gets the saved record.
 */
export default function RecordEditorModal({ record = null, categoryId = null, draft = null, draftNote = null, onSaved = null, onClose }) {
  const {
    categories, records, achievements, prefs,
    addRecord, updateRecord, deleteRecord, setCategoryDefaults,
  } = useApp()
  const toast = useToast()
  const { confirm, confirmDialog } = useConfirm()
  const uid = useId()
  const isEditing = record != null

  const [initial] = useState(() => initialForm(record, categoryId, prefs, achievements, categories, isEditing ? null : draft))
  const [form, setForm] = useState(initial)
  const [touched, setTouched] = useState({ unit: false, tags: false })
  const [showAllSuggestions, setShowAllSuggestions] = useState(false)
  const [photoMode, setPhotoMode] = useState(() => (/^https?:/.test(record?.photoUrl ?? '') ? 'url' : 'file'))
  const [photoBusy, setPhotoBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [errors, setErrors] = useState({})
  const fileInputRef = useRef(null)

  const set = (patch) => setForm(f => ({ ...f, ...patch }))
  const clearError = (field) => setErrors(e => (e[field] ? { ...e, [field]: null } : e))
  const dirty = JSON.stringify(form) !== JSON.stringify(initial)

  const changeCategory = (nextId) => {
    const patch = { categoryId: nextId }
    // Fill in that category's unit and tags unless the user already typed something.
    if (!isEditing) {
      const start = startingValues(nextId, prefs, achievements, categories)
      if (!touched.unit) patch.unit = start.unit
      if (!touched.tags) patch.tags = start.tags
    }
    set(patch)
    clearError('categoryId')
    setShowAllSuggestions(false)
  }

  const subcategories = form.categoryId ? getDirectChildren(form.categoryId, categories) : []

  const tagSuggestions = useMemo(
    () => (form.categoryId ? suggestTags({ categoryId: form.categoryId, achievements, categories, records, exclude: form.tags }) : []),
    [form.categoryId, form.tags, achievements, categories, records],
  )
  const units = useMemo(
    () => (form.categoryId ? achievementUnits(form.categoryId, achievements, categories) : []),
    [form.categoryId, achievements, categories],
  )
  const unitOptions = useMemo(
    () => [...new Set([...units, ...(form.categoryId ? recentUnits(form.categoryId, records) : [])])],
    [units, form.categoryId, records],
  )
  const impact = useImpact({ form, record, records, achievements, categories })

  // ── Value and unit ──
  const parsedValue = parseValueInput(form.value)
  const hasValue = !parsedValue.error && parsedValue.value != null
  const enteredUnit = (parsedValue.unit ?? form.unit).trim()
  const unitNote = (() => {
    if (units.length === 0) return null
    const list = units.join(', ')
    if (hasValue && !enteredUnit) {
      return units.length === 1
        ? { warn: false, text: `단위를 비워 두면 ${list} 기준으로 계산돼요.` }
        : { warn: true, text: `이 카테고리 업적은 ${list} 단위를 함께 써요. 어느 단위인지 적어 주세요.` }
    }
    if (hasValue && enteredUnit) {
      const unusable = units.filter(u => !canConvert(enteredUnit, u))
      if (unusable.length === units.length) {
        return { warn: true, text: `'${enteredUnit}' 단위는 ${list} 기준 업적에 반영되지 않아요. 횟수나 연속 기록 업적에만 반영돼요.` }
      }
      if (unusable.length > 0) {
        return { warn: true, text: `'${enteredUnit}' 단위는 ${unusable.join(', ')} 기준 업적에는 반영되지 않아요.` }
      }
    }
    return { warn: false, text: `이 카테고리 업적은 ${list} 기준으로 계산돼요. 다른 단위도 바꿀 수 있으면 알아서 바꿔서 더해요.` }
  })()

  const splitValue = () => {
    const next = withSplitValue(form)
    if (next === form) return
    set({ value: next.value, unit: next.unit })
    setTouched(t => ({ ...t, unit: true }))
  }

  // ── Tags ──
  const setTags = (tags) => {
    setTouched(t => ({ ...t, tags: true }))
    set({ tags })
  }
  const addSuggestedTag = (tag) => {
    if (!form.tags.some(t => normalizeTag(t) === normalizeTag(tag))) setTags([...form.tags, tag])
  }

  // ── Photo ──
  const acceptFile = async (file) => {
    if (!file) return
    setPhotoBusy(true)
    try {
      set({ photoUrl: await imageFileToDataUrl(file) })
      clearError('photoUrl')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setPhotoBusy(false)
    }
  }

  // ── Save / delete / close ──
  const validate = (data) => {
    const next = {}
    if (!data.categoryId) next.categoryId = '카테고리를 골라 주세요.'
    if (!isValidDateStr(data.date)) next.date = '날짜를 확인해 주세요.'
    else if (data.date > todayStr()) next.date = '미래 날짜는 기록할 수 없어요.'
    const parsed = parseValueInput(data.value)
    if (parsed.error) next.value = '숫자로 입력해 주세요. 예: 5.2, 1,000, 5km'
    else if (parsed.value != null && parsed.value < 0) next.value = '0 이상의 값을 입력해 주세요.'
    const photoUrl = data.photoUrl.trim()
    if (photoMode === 'url' && photoUrl && !PHOTO_URL_RE.test(photoUrl)) next.photoUrl = '사진 링크는 http:// 또는 https://로 시작해야 해요.'
    return next
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const data = withSplitValue(form)
    const problems = validate(data)
    setErrors(problems)
    if (Object.keys(problems).length > 0) return
    const input = { ...data, value: parseValueInput(data.value).value ?? '', photoUrl: data.photoUrl.trim() }

    if (isEditing) {
      updateRecord({ ...record, ...input })
      toast.success('기록을 수정했어요.')
    } else {
      const saved = addRecord(draft ? { ...input, id: draft.id } : input)
      // Remember the unit the first time one is used in a category.
      if (saved.unit && !prefs.categoryDefaults[saved.categoryId]?.defaultUnit) {
        setCategoryDefaults(saved.categoryId, { defaultUnit: saved.unit })
      }
      toast.success('기록을 저장했어요.')
      onSaved?.(saved)
    }
    onClose()
  }

  const requestClose = async () => {
    if (dirty && !(await confirm(
      isEditing ? '고친 내용을 버릴까요?' : '작성 중인 기록을 버릴까요?',
      '저장하지 않은 내용은 사라져요.',
      { confirmLabel: '버리기' },
    ))) return
    onClose()
  }

  const handleDelete = async () => {
    const ok = await confirm('이 기록을 삭제할까요?', '삭제한 직후에는 알림에서 되돌릴 수 있어요.', { confirmLabel: '삭제' })
    if (!ok) return
    deleteRecord(record.id)
    onClose()
  }

  const visibleSuggestions = showAllSuggestions ? tagSuggestions : tagSuggestions.slice(0, SUGGESTION_PREVIEW)
  const today = todayStr()

  return (
    <Modal
      title={isEditing ? '기록 수정' : '기록하기'}
      onClose={requestClose}
      footer={
        <div className="flex items-center gap-2">
          {isEditing && (
            <button type="button" onClick={handleDelete} className="btn btn-ghost text-danger hover:text-danger px-3" aria-label="기록 삭제">
              <TrashIcon size={18} />
              <span className="hidden sm:inline">삭제</span>
            </button>
          )}
          <div className="flex-1" />
          <button type="button" onClick={requestClose} className="btn btn-secondary">취소</button>
          <button type="submit" form={`${uid}-form`} className="btn btn-primary" disabled={photoBusy}>
            {isEditing ? '수정 완료' : '저장'}
          </button>
        </div>
      }
    >
      <form id={`${uid}-form`} onSubmit={handleSubmit} className="space-y-5" noValidate>
        {draftNote && !isEditing && (
          <p className="rounded-xl bg-accent-soft px-3.5 py-3 text-sm text-accent-ink" role="note">{draftNote}</p>
        )}
        {/* Category */}
        <div>
          <label className="field-label" htmlFor={`${uid}-category`}>카테고리</label>
          <CategoryPicker id={`${uid}-category`} value={form.categoryId} onChange={changeCategory} placeholder="어디에 기록할까요?" />
          {subcategories.length > 0 && (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-ink-3 mr-0.5">더 자세히</span>
                {subcategories.map(child => (
                  <button key={child.id} type="button" className="chip h-7 px-2.5" onClick={() => changeCategory(child.id)}>
                    {child.name}
                  </button>
                ))}
              </div>
              <p className="field-hint">여기에 바로 기록하면 하위 카테고리의 업적에는 반영되지 않아요.</p>
            </>
          )}
          {errors.categoryId && <p className="field-error">{errors.categoryId}</p>}
        </div>

        {/* Date */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="field-label mb-0" htmlFor={`${uid}-date`}>날짜</label>
            <div className="flex gap-1">
              {[['오늘', today], ['어제', addDays(today, -1)]].map(([label, date]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => { set({ date }); clearError('date') }}
                  className={`chip h-7 px-2.5 ${form.date === date ? 'chip-active' : ''}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <input
            id={`${uid}-date`}
            type="date"
            className="input"
            value={form.date}
            max={today}
            onChange={e => { set({ date: e.target.value }); clearError('date') }}
            aria-invalid={!!errors.date}
          />
          {errors.date && <p className="field-error">{errors.date}</p>}
        </div>

        {/* Value + unit */}
        <div>
          <div className="grid grid-cols-[1fr_120px] gap-2">
            <div>
              <label className="field-label" htmlFor={`${uid}-value`}>값 <span className="font-normal text-ink-3">(선택)</span></label>
              <input
                id={`${uid}-value`}
                type="text"
                inputMode="decimal"
                className="input tabular"
                value={form.value}
                onChange={e => { set({ value: e.target.value }); clearError('value') }}
                onBlur={splitValue}
                placeholder="예: 5.2"
                autoComplete="off"
                aria-invalid={!!errors.value}
              />
            </div>
            <div>
              <label className="field-label" htmlFor={`${uid}-unit`}>단위</label>
              <input
                id={`${uid}-unit`}
                type="text"
                className="input"
                value={form.unit}
                onChange={e => { set({ unit: e.target.value }); setTouched(t => ({ ...t, unit: true })) }}
                placeholder="km, 분…"
                list={`${uid}-units`}
                autoComplete="off"
              />
              <datalist id={`${uid}-units`}>
                {unitOptions.map(u => <option key={u} value={u} />)}
              </datalist>
            </div>
          </div>
          {errors.value && <p className="field-error">{errors.value}</p>}
          {!errors.value && unitNote && (
            unitNote.warn ? (
              <p className="mt-1.5 flex gap-1.5 text-xs text-warn">
                <AlertIcon size={14} className="flex-shrink-0 mt-px" />
                <span>{unitNote.text}</span>
              </p>
            ) : (
              <p className="field-hint">{unitNote.text}</p>
            )
          )}
        </div>

        <ImpactPreview impact={impact} isEditing={isEditing} />

        {/* Memo */}
        <div>
          <label className="field-label" htmlFor={`${uid}-memo`}>메모</label>
          <textarea
            id={`${uid}-memo`}
            className="input"
            rows={3}
            value={form.memo}
            onChange={e => set({ memo: e.target.value })}
            placeholder="오늘은 어땠나요?"
          />
        </div>

        {/* Tags */}
        <div>
          <label className="field-label" htmlFor={`${uid}-tag`}>태그</label>
          <TagInput id={`${uid}-tag`} value={form.tags} onChange={setTags} />
          {visibleSuggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-ink-3 mr-0.5">추천</span>
              {visibleSuggestions.map(({ tag, fromAchievement }) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => addSuggestedTag(tag)}
                  className={`chip h-7 px-2.5 ${fromAchievement ? 'border-dashed' : ''}`}
                  title={fromAchievement ? '업적과 관련된 태그예요' : '전에 쓴 태그예요'}
                >
                  <PlusIcon size={12} />
                  {tag}
                </button>
              ))}
              {!showAllSuggestions && tagSuggestions.length > SUGGESTION_PREVIEW && (
                <button type="button" className="text-sm font-medium text-accent-ink hover:underline px-1" onClick={() => setShowAllSuggestions(true)}>
                  {tagSuggestions.length - SUGGESTION_PREVIEW}개 더
                </button>
              )}
            </div>
          )}
        </div>

        {/* Photo */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="field-label mb-0">사진</span>
            {!(photoMode === 'file' && form.photoUrl) && (
              <button
                type="button"
                className="text-sm font-medium text-ink-2 hover:text-ink"
                onClick={() => { setPhotoMode(m => (m === 'file' ? 'url' : 'file')); set({ photoUrl: '' }); clearError('photoUrl') }}
              >
                {photoMode === 'file' ? '링크로 넣기' : '파일로 넣기'}
              </button>
            )}
          </div>
          {photoMode === 'file' && form.photoUrl ? (
            <div className="relative">
              <img src={form.photoUrl} alt="기록에 첨부한 사진" className="w-full max-h-56 object-cover rounded-xl border border-line" />
              <button
                type="button"
                onClick={() => set({ photoUrl: '' })}
                className="absolute top-2 right-2 btn btn-sm btn-secondary shadow-card"
              >
                <XIcon size={14} /> 빼기
              </button>
            </div>
          ) : photoMode === 'file' ? (
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); acceptFile(e.dataTransfer.files?.[0]) }}
              className={`rounded-xl border border-dashed transition-colors ${dragOver ? 'border-accent bg-accent-soft' : 'border-line-strong'}`}
            >
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 py-5 text-sm font-medium text-ink-2 hover:text-ink"
                disabled={photoBusy}
              >
                <ImageIcon size={18} />
                {photoBusy ? '사진 줄이는 중…' : '사진 고르기 또는 여기로 끌어오기'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="sr-only"
                tabIndex={-1}
                onChange={e => { acceptFile(e.target.files?.[0]); e.target.value = '' }}
              />
            </div>
          ) : (
            <>
              <input
                type="url"
                className="input"
                value={form.photoUrl}
                onChange={e => { set({ photoUrl: e.target.value }); clearError('photoUrl') }}
                placeholder="https://…"
                aria-label="사진 링크"
                aria-invalid={!!errors.photoUrl}
              />
              {PHOTO_URL_RE.test(form.photoUrl.trim()) && (
                <img src={form.photoUrl.trim()} alt="링크 사진 미리보기" className="mt-2 w-full max-h-56 object-cover rounded-xl border border-line" />
              )}
            </>
          )}
          {errors.photoUrl && <p className="field-error">{errors.photoUrl}</p>}
        </div>
      </form>
      {confirmDialog}
    </Modal>
  )
}
