import { Button, InputNumber, Select, Typography } from 'antd'
import { CheckOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { useCallback } from 'react'
import { SET_TYPE_OPTIONS } from './constants'
import type { SetEntry, SetType } from './types'

interface SetEditorProps {
  sets: SetEntry[]
  onChange: (sets: SetEntry[]) => void
  showConfirm?: boolean
}

export function SetEditor({ sets, onChange, showConfirm = false }: SetEditorProps) {
  const addSet = useCallback(() => {
    const last = sets[sets.length - 1] ?? { set_type: 'work' as SetType, weight_kg: 60, reps: 5 }
    onChange([...sets, { set_type: last.set_type, weight_kg: last.weight_kg, reps: last.reps }])
  }, [sets, onChange])

  const updateSet = useCallback(
    (i: number, field: keyof SetEntry, value: SetEntry[keyof SetEntry]) => {
      onChange(sets.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)))
    },
    [sets, onChange],
  )

  const removeSet = useCallback(
    (i: number) => onChange(sets.filter((_, idx) => idx !== i)),
    [sets, onChange],
  )

  const confirmSet = useCallback(
    (i: number) =>
      onChange(sets.map((s, idx) => (idx === i ? { ...s, confirmed: !s.confirmed } : s))),
    [sets, onChange],
  )

  const firstUnconfirmedIdx = showConfirm ? sets.findIndex((s) => !s.confirmed) : -1

  return (
    <div>
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
        Sets
      </Typography.Text>
      {sets.map((s, i) => {
        const locked = showConfirm && s.confirmed === true
        const canConfirm = showConfirm && i === firstUnconfirmedIdx
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              marginBottom: 8,
              opacity: locked ? 0.45 : 1,
              transition: 'opacity 0.2s',
            }}
          >
            <Typography.Text type="secondary" style={{ minWidth: 18, fontSize: 12 }}>
              {i + 1}
            </Typography.Text>
            <Select
              value={s.set_type}
              onChange={(v) => updateSet(i, 'set_type', v)}
              options={SET_TYPE_OPTIONS}
              size="small"
              style={{ flex: '1 1 30%', minWidth: 0 }}
              popupMatchSelectWidth={false}
              disabled={locked}
            />
            <InputNumber
              value={s.weight_kg}
              onChange={(v) => v !== null && updateSet(i, 'weight_kg', v)}
              min={0}
              step={2.5}
              size="small"
              style={{ flex: '1 1 35%', minWidth: 0 }}
              addonAfter="kg"
              disabled={locked}
            />
            <InputNumber
              value={s.reps}
              onChange={(v) => v !== null && updateSet(i, 'reps', Number(v))}
              min={1}
              max={100}
              size="small"
              style={{ flex: '1 1 25%', minWidth: 0 }}
              addonAfter="x"
              disabled={locked}
            />
            {showConfirm && (
              <Button
                type="text"
                size="small"
                icon={<CheckOutlined />}
                onClick={() => confirmSet(i)}
                disabled={!canConfirm && !locked}
                style={{ color: locked ? '#52c41a' : undefined }}
              />
            )}
            {sets.length > 1 && (
              <Button
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
                onClick={() => removeSet(i)}
                disabled={locked}
              />
            )}
          </div>
        )
      })}
      <Button
        type="dashed"
        icon={<PlusOutlined />}
        onClick={addSet}
        style={{ width: '100%', marginTop: 4 }}
        size="small"
      >
        Add Set
      </Button>
    </div>
  )
}
