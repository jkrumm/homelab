import { useCreate, useList } from '@refinedev/core'
import {
  App,
  Button,
  Card,
  Col,
  DatePicker,
  InputNumber,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Typography,
} from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

// ── Types ──────────────────────────────────────────────────────────────────

interface WorkoutSet {
  id: number
  workout_id: number
  set_number: number
  set_type: string
  weight_kg: number
  reps: number
  created_at: string | null
}

interface Workout {
  id: number
  date: string
  exercise: string
  notes: string | null
  created_at: string | null
  sets: WorkoutSet[]
  estimated_1rm_epley: number | null
  estimated_1rm_brzycki: number | null
  estimated_1rm: number | null
  total_volume: number
}

type ExerciseKey = 'bench_press' | 'deadlift' | 'squat' | 'pull_ups'
type SetType = 'warmup' | 'work' | 'drop'

interface SetEntry {
  set_type: SetType
  weight_kg: number
  reps: number
}

// ── Constants ──────────────────────────────────────────────────────────────

const EXERCISES: { value: ExerciseKey; label: string }[] = [
  { value: 'bench_press', label: 'Bench Press' },
  { value: 'deadlift', label: 'Deadlift' },
  { value: 'squat', label: 'Squat' },
  { value: 'pull_ups', label: 'Pull-ups' },
]

const EXERCISE_COLORS: Record<ExerciseKey, string> = {
  bench_press: '#1677ff',
  deadlift: '#ff4d4f',
  squat: '#52c41a',
  pull_ups: '#fa8c16',
}

const SET_TYPE_OPTIONS: { value: SetType; label: string }[] = [
  { value: 'warmup', label: 'Warm-up' },
  { value: 'work', label: 'Work' },
  { value: 'drop', label: 'Drop' },
]

// ── Helpers ────────────────────────────────────────────────────────────────

function formatXDate(dateStr: string) {
  const [, m, d] = dateStr.split('-')
  return `${parseInt(m)}/${parseInt(d)}`
}

function buildChartData(workouts: Workout[], type: 'estimated_1rm' | 'total_volume') {
  const byDate = new Map<string, Partial<Record<ExerciseKey, number>>>()

  for (const w of workouts) {
    const ex = w.exercise as ExerciseKey
    const entry = byDate.get(w.date) ?? {}
    const value = w[type]
    if (value !== null && value !== undefined) {
      entry[ex] = Math.max(entry[ex] ?? 0, value)
    }
    byDate.set(w.date, entry)
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => ({ date, ...values }))
}

function computeSummaryStats(workouts: Workout[], exercises: ExerciseKey[]) {
  const now = dayjs()
  const weekStart = now.subtract(7, 'day').format('YYYY-MM-DD')
  const monthStart = now.subtract(30, 'day').format('YYYY-MM-DD')

  const weeklyVolume = workouts
    .filter((w) => w.date >= weekStart && exercises.includes(w.exercise as ExerciseKey))
    .reduce((sum, w) => sum + w.total_volume, 0)

  const monthlyCount = workouts.filter((w) => w.date >= monthStart).length

  const best1rm = workouts
    .filter((w) => exercises.includes(w.exercise as ExerciseKey) && w.estimated_1rm !== null)
    .reduce((max, w) => Math.max(max, w.estimated_1rm!), 0)

  const latestByExercise = new Map<ExerciseKey, number>()
  for (const w of [...workouts].reverse()) {
    const ex = w.exercise as ExerciseKey
    if (!latestByExercise.has(ex) && w.estimated_1rm !== null && exercises.includes(ex)) {
      latestByExercise.set(ex, w.estimated_1rm)
    }
  }
  const latest1rm = latestByExercise.size > 0 ? Math.max(...latestByExercise.values()) : 0

  return [
    {
      label: 'Best 1RM',
      value: best1rm > 0 ? best1rm.toFixed(1) : '—',
      suffix: best1rm > 0 ? 'kg' : '',
    },
    {
      label: 'Latest 1RM',
      value: latest1rm > 0 ? latest1rm.toFixed(1) : '—',
      suffix: latest1rm > 0 ? 'kg' : '',
    },
    { label: 'Vol. / 7d', value: Math.round(weeklyVolume), suffix: 'kg' },
    { label: 'Sets / 30d', value: monthlyCount, suffix: '' },
  ]
}

// ── Responsive hook ────────────────────────────────────────────────────────

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return isMobile
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
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
      <Typography.Text type="secondary" style={{ minWidth: 18, fontSize: 12 }}>
        {index + 1}
      </Typography.Text>
      <Select
        value={set.set_type}
        onChange={(v) => onChange('set_type', v)}
        options={SET_TYPE_OPTIONS}
        size="small"
        style={{ width: 88 }}
        popupMatchSelectWidth={false}
      />
      <InputNumber
        value={set.weight_kg}
        onChange={(v) => v !== null && onChange('weight_kg', v)}
        min={0}
        step={2.5}
        size="small"
        style={{ width: 76 }}
        addonAfter="kg"
      />
      <InputNumber
        value={set.reps}
        onChange={(v) => v !== null && onChange('reps', Number(v))}
        min={1}
        max={100}
        size="small"
        style={{ width: 54 }}
        addonAfter="×"
      />
      {showRemove && (
        <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={onRemove} />
      )}
    </div>
  )
}

// ── WorkoutForm ────────────────────────────────────────────────────────────

function WorkoutForm({ onSuccess }: { onSuccess?: () => void }) {
  const { message } = App.useApp()
  const [exercise, setExercise] = useState<ExerciseKey>('bench_press')
  const [date, setDate] = useState<Dayjs>(dayjs())
  const [sets, setSets] = useState<SetEntry[]>([{ set_type: 'work', weight_kg: 60, reps: 5 }])

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
            onChange={setExercise}
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

// ── Charts ─────────────────────────────────────────────────────────────────

function WorkoutCharts({
  workouts,
  isLoading,
  activeExercises,
}: {
  workouts: Workout[]
  isLoading: boolean
  activeExercises: ExerciseKey[]
}) {
  const filtered = useMemo(
    () => workouts.filter((w) => activeExercises.includes(w.exercise as ExerciseKey)),
    [workouts, activeExercises],
  )

  const orm1Data = useMemo(() => buildChartData(filtered, 'estimated_1rm'), [filtered])
  const volumeData = useMemo(() => buildChartData(filtered, 'total_volume'), [filtered])
  const summaryStats = useMemo(
    () => computeSummaryStats(workouts, activeExercises),
    [workouts, activeExercises],
  )

  const legendFormatter = (value: string) =>
    EXERCISES.find((e) => e.value === value)?.label ?? value

  const tooltipFormatter = (value: number, name: string): [string, string] => [
    `${value.toFixed(1)} kg`,
    legendFormatter(name),
  ]

  return (
    <Spin spinning={isLoading}>
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {summaryStats.map((stat) => (
          <Col xs={12} sm={6} key={stat.label}>
            <Card size="small">
              <Statistic
                title={stat.label}
                value={stat.value}
                suffix={stat.suffix}
                valueStyle={{ fontSize: 18 }}
              />
            </Card>
          </Col>
        ))}
      </Row>

      <Card title="Estimated 1RM Trend" size="small" style={{ marginBottom: 16 }}>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={orm1Data} margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" />
            <XAxis dataKey="date" tickFormatter={formatXDate} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} unit="kg" width={48} />
            <Tooltip formatter={tooltipFormatter} labelFormatter={(l) => `Date: ${l}`} />
            <Legend formatter={legendFormatter} />
            {activeExercises.map((ex) => (
              <Line
                key={ex}
                type="monotone"
                dataKey={ex}
                stroke={EXERCISE_COLORS[ex]}
                dot={false}
                strokeWidth={2}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <Card title="Session Volume (kg)" size="small">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={volumeData} margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" />
            <XAxis dataKey="date" tickFormatter={formatXDate} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} unit="kg" width={48} />
            <Tooltip formatter={tooltipFormatter} />
            <Legend formatter={legendFormatter} />
            {activeExercises.map((ex) => (
              <Bar key={ex} dataKey={ex} fill={EXERCISE_COLORS[ex]} stackId="volume" />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </Spin>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

const DEFAULT_DATE_FROM = dayjs().subtract(90, 'day').format('YYYY-MM-DD')
const DEFAULT_DATE_TO = dayjs().format('YYYY-MM-DD')

export default function StrengthTrackerPage() {
  const isMobile = useIsMobile()
  const [activeExercises, setActiveExercises] = useState<ExerciseKey[]>([
    'bench_press',
    'deadlift',
    'squat',
    'pull_ups',
  ])
  const [dateFrom, setDateFrom] = useState(DEFAULT_DATE_FROM)
  const [dateTo, setDateTo] = useState(DEFAULT_DATE_TO)

  const toggleExercise = useCallback((ex: ExerciseKey) => {
    setActiveExercises((prev) => (prev.includes(ex) ? prev.filter((e) => e !== ex) : [...prev, ex]))
  }, [])

  const { result, query } = useList<Workout>({
    resource: 'workouts',
    pagination: { currentPage: 1, pageSize: 500 },
    sorters: [{ field: 'date', order: 'asc' }],
    filters: [
      { field: 'date', operator: 'gte', value: dateFrom },
      { field: 'date', operator: 'lte', value: dateTo },
    ],
  })

  const workouts = (result.data as Workout[] | undefined) ?? []
  const isLoading = query.isLoading

  const filterBar = (
    <Row gutter={[12, 8]} style={{ marginBottom: 16 }}>
      <Col xs={24} md={14}>
        <Space wrap size={6}>
          {EXERCISES.map((ex) => (
            <Button
              key={ex.value}
              type={activeExercises.includes(ex.value) ? 'primary' : 'default'}
              size="small"
              style={
                activeExercises.includes(ex.value)
                  ? {
                      backgroundColor: EXERCISE_COLORS[ex.value],
                      borderColor: EXERCISE_COLORS[ex.value],
                    }
                  : {}
              }
              onClick={() => toggleExercise(ex.value)}
            >
              {ex.label}
            </Button>
          ))}
        </Space>
      </Col>
      <Col xs={24} md={10}>
        <Space size={6} align="center">
          <DatePicker
            value={dayjs(dateFrom)}
            onChange={(d) => d && setDateFrom(d.format('YYYY-MM-DD'))}
            allowClear={false}
            size="small"
          />
          <Typography.Text type="secondary">—</Typography.Text>
          <DatePicker
            value={dayjs(dateTo)}
            onChange={(d) => d && setDateTo(d.format('YYYY-MM-DD'))}
            allowClear={false}
            size="small"
          />
        </Space>
      </Col>
    </Row>
  )

  return (
    <div style={{ padding: isMobile ? '12px 12px 80px' : '16px 24px 40px' }}>
      {filterBar}

      {isMobile ? (
        // Mobile: form on top, charts below
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          <WorkoutForm onSuccess={() => void query.refetch()} />
          <WorkoutCharts
            workouts={workouts}
            isLoading={isLoading}
            activeExercises={activeExercises}
          />
        </Space>
      ) : (
        // Desktop: charts left (3/4), form right (1/4)
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <WorkoutCharts
              workouts={workouts}
              isLoading={isLoading}
              activeExercises={activeExercises}
            />
          </div>
          <div style={{ width: 360, flexShrink: 0 }}>
            <WorkoutForm onSuccess={() => void query.refetch()} />
          </div>
        </div>
      )}
    </div>
  )
}
