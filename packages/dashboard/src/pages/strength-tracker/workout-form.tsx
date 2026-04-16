import { useCreate } from '@refinedev/core'
import { App, Button, Card, DatePicker, Select, Space, Typography } from 'antd'
import { TrophyOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { detectAchievements, fireConfetti } from './achievements'
import { EXERCISES } from './constants'
import { SetEditor } from './set-editor'
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

// ── WorkoutForm ────────────────────────────────────────────────────────────

export function WorkoutForm({
  onSuccess,
  workouts,
}: {
  onSuccess?: () => void
  workouts: Workout[]
}) {
  const { message, notification } = App.useApp()

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

  const handleSubmit = () => {
    if (sets.length === 0) {
      void message.error('Add at least one set')
      return
    }
    const submittedSets = sets.map((s, i) => ({
      set_number: i + 1,
      set_type: s.set_type,
      weight_kg: s.weight_kg,
      reps: s.reps,
    }))
    mutate(
      {
        resource: 'workouts',
        values: { date: date.format('YYYY-MM-DD'), exercise, sets: submittedSets },
      },
      {
        onSuccess: () => {
          const achievements = detectAchievements(exercise, submittedSets, workouts)

          if (achievements.length > 0) {
            if (achievements.some((a) => a.confetti)) fireConfetti()
            for (const a of achievements) {
              notification.open({
                message: a.title,
                description: a.description,
                placement: 'top',
                duration: 6,
                icon: <TrophyOutlined style={{ color: '#faad14' }} />,
              })
            }
          } else {
            void message.success('Workout logged!')
          }

          localStorage.removeItem(FORM_STORAGE_KEY)
          setSets([{ set_type: 'work', weight_kg: sets[0]?.weight_kg ?? 60, reps: 5 }])
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

        <SetEditor sets={sets} onChange={setSets} showConfirm />

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
