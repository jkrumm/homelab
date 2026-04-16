import { CheckOutlined, CloseOutlined, PlusOutlined } from '@ant-design/icons'
import { App, Button } from 'antd'
import { useCallback, useRef, useState } from 'react'
import type { SetEntry, SetType } from './types'

const TYPE_CYCLE: SetType[] = ['work', 'warmup', 'drop']
const TYPE_LABEL: Record<SetType, string> = { warmup: 'Warm-up', work: 'Work', drop: 'Drop' }
const TYPE_ABBREV: Record<SetType, string> = { warmup: 'W', work: '', drop: 'D' }
const TYPE_COLOR: Record<SetType, string> = {
  warmup: 'rgba(128,128,128,0.5)',
  work: 'inherit',
  drop: 'rgba(128,128,128,0.5)',
}

interface SetEditorProps {
  sets: SetEntry[]
  onChange?: (sets: SetEntry[]) => void
  previousSets?: SetEntry[]
  showConfirm?: boolean
  readOnly?: boolean
}

export function SetEditor({
  sets,
  onChange,
  previousSets,
  showConfirm = false,
  readOnly = false,
}: SetEditorProps) {
  const { modal } = App.useApp()
  const [hoveredRow, setHoveredRow] = useState<number | null>(null)
  const repsRefs = useRef<(HTMLInputElement | null)[]>([])

  const emit = useCallback(
    (next: SetEntry[]) => {
      onChange?.(next)
    },
    [onChange],
  )

  const addSet = useCallback(() => {
    const last = sets[sets.length - 1] ?? { set_type: 'work' as SetType, weight_kg: 60, reps: 5 }
    const doAdd = () =>
      emit([...sets, { set_type: last.set_type, weight_kg: last.weight_kg, reps: last.reps }])
    if (showConfirm) {
      modal.confirm({
        title: 'Add set?',
        content: `A new ${TYPE_LABEL[last.set_type].toLowerCase()} set will be added with ${last.weight_kg} kg × ${last.reps} reps.`,
        okText: 'Add',
        centered: true,
        onOk: doAdd,
      })
    } else {
      doAdd()
    }
  }, [sets, emit, showConfirm, modal])

  const updateSet = useCallback(
    (i: number, field: keyof SetEntry, value: SetEntry[keyof SetEntry]) => {
      emit(sets.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)))
    },
    [sets, emit],
  )

  const removeSet = useCallback(
    (i: number) => {
      const doRemove = () => emit(sets.filter((_, idx) => idx !== i))
      if (showConfirm) {
        const s = sets[i]
        modal.confirm({
          title: 'Remove set?',
          content: `Set ${i + 1} (${TYPE_LABEL[s.set_type]} — ${s.weight_kg} kg × ${s.reps}) will be removed.`,
          okText: 'Remove',
          okButtonProps: { danger: true },
          centered: true,
          onOk: doRemove,
        })
      } else {
        doRemove()
      }
    },
    [sets, emit, showConfirm, modal],
  )

  const confirmSet = useCallback(
    (i: number) => {
      const firstUnconfirmed = sets.findIndex((s) => !s.confirmed)
      if (i === firstUnconfirmed) {
        emit(sets.map((s, idx) => (idx === i ? { ...s, confirmed: true } : s)))
        return
      }
      const lastConfirmedIdx = firstUnconfirmed === -1 ? sets.length - 1 : firstUnconfirmed - 1
      if (i === lastConfirmedIdx && sets[i]?.confirmed) {
        emit(sets.map((s, idx) => (idx === i ? { ...s, confirmed: false } : s)))
      }
    },
    [sets, emit],
  )

  const cycleType = useCallback(
    (i: number) => {
      const current = sets[i].set_type
      const next = TYPE_CYCLE[(TYPE_CYCLE.indexOf(current) + 1) % TYPE_CYCLE.length]
      const doCycle = () => updateSet(i, 'set_type', next)
      if (showConfirm) {
        modal.confirm({
          title: 'Change set type?',
          content: `Set ${i + 1} will change from ${TYPE_LABEL[current]} to ${TYPE_LABEL[next]}.`,
          okText: 'Change',
          centered: true,
          onOk: doCycle,
        })
      } else {
        doCycle()
      }
    },
    [sets, updateSet, showConfirm, modal],
  )

  const firstUnconfirmedIdx = showConfirm ? sets.findIndex((s) => !s.confirmed) : -1
  const hasPrevious = previousSets && previousSets.length > 0

  let workNum = 0
  const labels = sets.map((s) => {
    if (s.set_type === 'work') {
      workNum++
      return String(workNum)
    }
    return TYPE_ABBREV[s.set_type]
  })

  const stepperStyle: React.CSSProperties = {
    width: 18,
    height: 18,
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    fontSize: 13,
    fontFamily: 'inherit',
    padding: 0,
    flexShrink: 0,
    transition: 'opacity 0.15s',
    borderRadius: 3,
    lineHeight: 1,
  }

  const inputBase: React.CSSProperties = {
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    outline: 'none',
    fontSize: 13,
    padding: '2px 4px',
    textAlign: 'center',
    width: '100%',
    borderBottom: '1px solid transparent',
    transition: 'border-color 0.15s',
    fontFamily: 'inherit',
  }

  const inputHover: React.CSSProperties = {
    borderBottom: '1px solid rgba(128,128,128,0.3)',
  }

  return (
    <div>
      <style>{`
        .st-set-input::-webkit-outer-spin-button,
        .st-set-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        .st-set-input { -moz-appearance: textfield; }
        .st-set-input:focus { border-bottom-color: rgba(128,128,128,0.5) !important; }
        .st-stepper:hover:not(:disabled) { background: rgba(128,128,128,0.12) !important; opacity: 0.8 !important; }
      `}</style>

      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 0,
          padding: '0 0 4px',
          borderBottom: '1px solid rgba(128,128,128,0.12)',
          marginBottom: 2,
        }}
      >
        <span style={{ width: 30, fontSize: 11, color: 'rgba(128,128,128,0.5)', paddingLeft: 2 }}>
          Set
        </span>
        {hasPrevious && (
          <span style={{ width: 72, fontSize: 11, color: 'rgba(128,128,128,0.5)' }}>Previous</span>
        )}
        <span
          style={{ flex: 1, fontSize: 11, color: 'rgba(128,128,128,0.5)', textAlign: 'center' }}
        >
          KG
        </span>
        <span
          style={{ flex: 1, fontSize: 11, color: 'rgba(128,128,128,0.5)', textAlign: 'center' }}
        >
          Reps
        </span>
        {!readOnly && <span style={{ width: showConfirm ? 52 : 26 }} />}
      </div>

      {/* Rows */}
      {sets.map((s, i) => {
        const isHovered = !readOnly && hoveredRow === i
        const locked = showConfirm && s.confirmed === true
        const active = showConfirm ? i === firstUnconfirmedIdx : true
        const lastConfirmedIdx =
          firstUnconfirmedIdx === -1 ? sets.length - 1 : firstUnconfirmedIdx - 1
        const canUncheck = showConfirm && locked && i === lastConfirmedIdx
        const inactive = showConfirm && !locked && !active
        const disabled = readOnly || locked || inactive
        const prev = previousSets?.[i]

        return (
          <div
            key={i}
            onMouseEnter={() => !readOnly && setHoveredRow(i)}
            onMouseLeave={() => !readOnly && setHoveredRow(null)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 0,
              padding: '5px 0',
              borderBottom: '1px solid rgba(128,128,128,0.06)',
              opacity: !readOnly && disabled ? 0.4 : 1,
              transition: 'all 0.15s',
              borderRadius: 3,
              background: isHovered && !disabled ? 'rgba(128,128,128,0.06)' : 'transparent',
            }}
          >
            {/* Set type label */}
            <button
              type="button"
              onClick={() => !disabled && cycleType(i)}
              disabled={disabled}
              style={{
                width: 30,
                fontSize: 12,
                fontWeight: 600,
                fontFamily: 'inherit',
                border: 'none',
                background: 'transparent',
                cursor: disabled ? 'default' : 'pointer',
                color: TYPE_COLOR[s.set_type],
                padding: '0 0 0 2px',
                textAlign: 'left',
              }}
              title={readOnly ? undefined : 'Click to change set type'}
            >
              {labels[i]}
            </button>

            {/* Previous workout reference */}
            {hasPrevious && (
              <span
                style={{
                  width: 72,
                  fontSize: 11,
                  color: 'rgba(128,128,128,0.4)',
                  whiteSpace: 'nowrap',
                }}
              >
                {prev ? `${prev.weight_kg} × ${prev.reps}` : '—'}
              </span>
            )}

            {/* KG */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
              {!readOnly && (
                <button
                  type="button"
                  className="st-stepper"
                  onClick={() => updateSet(i, 'weight_kg', Math.max(0, s.weight_kg - 0.5))}
                  disabled={disabled}
                  style={{ ...stepperStyle, opacity: isHovered && !disabled ? 0.5 : 0 }}
                >
                  −
                </button>
              )}
              {readOnly ? (
                <span style={{ flex: 1, fontSize: 13, textAlign: 'center' }}>{s.weight_kg}</span>
              ) : (
                <input
                  className="st-set-input"
                  type="number"
                  value={s.weight_kg}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    if (!Number.isNaN(v) && v >= 0) updateSet(i, 'weight_kg', v)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Tab' && !e.shiftKey) {
                      e.preventDefault()
                      repsRefs.current[i]?.focus()
                      repsRefs.current[i]?.select()
                    }
                  }}
                  step={0.5}
                  min={0}
                  disabled={disabled}
                  style={{
                    ...inputBase,
                    flex: 1,
                    minWidth: 0,
                    ...(isHovered && !disabled ? inputHover : {}),
                  }}
                />
              )}
              {!readOnly && (
                <button
                  type="button"
                  className="st-stepper"
                  onClick={() => updateSet(i, 'weight_kg', s.weight_kg + 0.5)}
                  disabled={disabled}
                  style={{ ...stepperStyle, opacity: isHovered && !disabled ? 0.5 : 0 }}
                >
                  +
                </button>
              )}
            </div>

            {/* Reps */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
              {!readOnly && (
                <button
                  type="button"
                  className="st-stepper"
                  onClick={() => updateSet(i, 'reps', Math.max(1, s.reps - 1))}
                  disabled={disabled}
                  style={{ ...stepperStyle, opacity: isHovered && !disabled ? 0.5 : 0 }}
                >
                  −
                </button>
              )}
              {readOnly ? (
                <span style={{ flex: 1, fontSize: 13, textAlign: 'center' }}>{s.reps}</span>
              ) : (
                <input
                  ref={(el) => {
                    repsRefs.current[i] = el
                  }}
                  className="st-set-input"
                  type="number"
                  value={s.reps}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    if (!Number.isNaN(v) && v >= 1) updateSet(i, 'reps', v)
                  }}
                  step={1}
                  min={1}
                  max={100}
                  disabled={disabled}
                  style={{
                    ...inputBase,
                    flex: 1,
                    minWidth: 0,
                    ...(isHovered && !disabled ? inputHover : {}),
                  }}
                />
              )}
              {!readOnly && (
                <button
                  type="button"
                  className="st-stepper"
                  onClick={() => updateSet(i, 'reps', Math.min(100, s.reps + 1))}
                  disabled={disabled}
                  style={{ ...stepperStyle, opacity: isHovered && !disabled ? 0.5 : 0 }}
                >
                  +
                </button>
              )}
            </div>

            {/* Actions */}
            {!readOnly && (
              <div
                style={{
                  width: showConfirm ? 52 : 26,
                  display: 'flex',
                  gap: 0,
                  justifyContent: 'flex-end',
                  opacity: isHovered || disabled ? 1 : 0.25,
                  transition: 'opacity 0.15s',
                }}
              >
                {showConfirm && (
                  <Button
                    type="text"
                    size="small"
                    icon={<CheckOutlined style={{ fontSize: 11 }} />}
                    onClick={() => confirmSet(i)}
                    disabled={!active && !canUncheck}
                    style={{
                      color: locked ? '#52c41a' : undefined,
                      width: 26,
                      height: 26,
                      padding: 0,
                      minWidth: 0,
                    }}
                  />
                )}
                {sets.length > 1 && (
                  <Button
                    type="text"
                    size="small"
                    icon={<CloseOutlined style={{ fontSize: 10 }} />}
                    onClick={() => removeSet(i)}
                    disabled={disabled}
                    style={{
                      width: 26,
                      height: 26,
                      padding: 0,
                      minWidth: 0,
                      opacity: isHovered && !disabled ? 0.6 : 0,
                      transition: 'opacity 0.15s',
                    }}
                  />
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* Add set */}
      {!readOnly && (
        <button
          type="button"
          onClick={addSet}
          style={{
            width: '100%',
            marginTop: 6,
            padding: '5px 0',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontSize: 12,
            color: 'rgba(128,128,128,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            fontFamily: 'inherit',
            borderRadius: 3,
            transition: 'color 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'rgba(128,128,128,0.8)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(128,128,128,0.5)')}
        >
          <PlusOutlined style={{ fontSize: 10 }} /> Add Set
        </button>
      )}
    </div>
  )
}
