import { useCreate } from '@refinedev/core'
import { App, Button, Card, DatePicker, InputNumber, Select, Space, Typography } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { EXERCISES, SET_TYPE_OPTIONS } from './constants'
import type { ExerciseKey, SetEntry, SetType, Workout } from './types'

export const FORM_STORAGE_KEY = 'strength-tracker-form'
export const DEFAULT_SETS: SetEntry[] = [{ set_type: 'work', weight_kg: 60, reps: 5 }]

export interface StoredForm {
  exercise: ExerciseKey
  date: string
  sets: SetEntry[]
}

export function loadStoredForm(): StoredForm | null {
  try {
    const raw = localStorage.getItem(FORM_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as StoredForm
  } catch {
    return null
  }
}

// ── SetRow ─────────────────────────────────────────────────────────────────

function SetRow({
  index,
  set,
  onChange,
  onRemove,
  showRemove,
}: {
  index: number
  set: SetEntry
  onChange: (field: keyof SetEntry, value: SetEntry[keyof SetEntry]) => void
  onRemove: () => void
  showRemove: boolean
}) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
      <Typography.Text type="secondary" style={{ minWidth: 18, fontSize: 12 }}>
        {index + 1}
      </Typography.Text>
      <Select
        value={set.set_type}
        onChange={(v) => onChange('set_type', v)}
        options={SET_TYPE_OPTIONS}
        size="small"
        style={{ flex: '1 1 30%', minWidth: 0 }}
        popupMatchSelectWidth={false}
      />
      <InputNumber
        value={set.weight_kg}
        onChange={(v) => v !== null && onChange('weight_kg', v)}
        min={0}
        step={2.5}
        size="small"
        style={{ flex: '1 1 35%', minWidth: 0 }}
        addonAfter="kg"
      />
      <InputNumber
        value={set.reps}
        onChange={(v) => v !== null && onChange('reps', Number(v))}
        min={1}
        max={100}
        size="small"
        style={{ flex: '1 1 25%', minWidth: 0 }}
        addonAfter="×"
      />
      {showRemove && (
        <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={onRemove} />
      )}
    </div>
  )
}

// ── WorkoutForm ────────────────────────────────────────────────────────────

export function WorkoutForm({
  onSuccess,
  workouts,
}: {
  onSuccess?: () => void
  workouts: Workout[]
}) {
  const { message } = App.useApp()

  const stored = useMemo(() => loadStoredForm(), [])
  const [exercise, setExercise] = useState<ExerciseKey>(stored?.exercise ?? 'bench_press')
  const [date, setDate] = useState<Dayjs>(stored?.date ? dayjs(stored.date) : dayjs())
  const [sets, setSets] = useState<SetEntry[]>(stored?.sets ?? DEFAULT_SETS)

  useEffect(() => {
    const data: StoredForm = { exercise, date: date.format('YYYY-MM-DD'), sets }
    localStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(data))
  }, [exercise, date, sets])

  const handleExerciseChange = useCallback(
    (ex: ExerciseKey) => {
      setExercise(ex)
      const latest = [...workouts]
        .filter((w) => w.exercise === ex)
        .sort((a, b) => b.date.localeCompare(a.date))[0]
      if (latest?.sets.length) {
        setSets(
          latest.sets
            .sort((a, b) => a.set_number - b.set_number)
            .map((s) => ({
              set_type: s.set_type as SetType,
              weight_kg: s.weight_kg,
              reps: s.reps,
            })),
        )
      }
    },
    [workouts],
  )

  const { mutate, mutation } = useCreate()

  const addSet = useCallback(() => {
    setSets((prev) => {
      const last = prev[prev.length - 1] ?? { set_type: 'work' as SetType, weight_kg: 60, reps: 5 }
      return [...prev, { ...last }]
    })
  }, [])

  const updateSet = useCallback(
    (i: number, field: keyof SetEntry, value: SetEntry[keyof SetEntry]) => {
      setSets((prev) => prev.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)))
    },
    [],
  )

  const removeSet = useCallback((i: number) => {
    setSets((prev) => prev.filter((_, idx) => idx !== i))
  }, [])

  const handleSubmit = () => {
    if (sets.length === 0) {
      void message.error('Add at least one set')
      return
    }
    mutate(
      {
        resource: 'workouts',
        values: {
          date: date.format('YYYY-MM-DD'),
          exercise,
          sets: sets.map((s, i) => ({ ...s, set_number: i + 1 })),
        },
      },
      {
        onSuccess: () => {
          void message.success('Workout logged!')
          localStorage.removeItem(FORM_STORAGE_KEY)
          setSets((prev) => [{ set_type: 'work', weight_kg: prev[0]?.weight_kg ?? 60, reps: 5 }])
          onSuccess?.()
        },
        onError: (err) => {
          void message.error(`Failed: ${String(err)}`)
        },
      },
    )
  }

  return (
    <Card title="Log Workout" size="small">
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Exercise
          </Typography.Text>
          <Select
            value={exercise}
            onChange={handleExerciseChange}
            options={EXERCISES}
            style={{ width: '100%', marginTop: 4 }}
            size="large"
          />
        </div>

        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Date
          </Typography.Text>
          <DatePicker
            value={date}
            onChange={(d) => d && setDate(d)}
            style={{ width: '100%', marginTop: 4 }}
            allowClear={false}
            size="large"
          />
        </div>

        <div>
          <Typography.Text
            type="secondary"
            style={{ fontSize: 12, display: 'block', marginBottom: 6 }}
          >
            Sets
          </Typography.Text>
          {sets.map((s, i) => (
            <SetRow
              key={i}
              index={i}
              set={s}
              onChange={(field, value) => updateSet(i, field, value)}
              onRemove={() => removeSet(i)}
              showRemove={sets.length > 1}
            />
          ))}
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

        <Button
          type="primary"
          onClick={handleSubmit}
          loading={mutation.isPending}
          size="large"
          style={{ width: '100%', marginTop: 4 }}
        >
          Log Workout
        </Button>
      </Space>
    </Card>
  )
}
