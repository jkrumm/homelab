import { useDelete, useUpdate } from '@refinedev/core'
import {
  App,
  Button,
  Card,
  DatePicker,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import { DeleteOutlined, EditOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useCallback, useMemo, useState } from 'react'
import { EXERCISE_COLORS, EXERCISES, SET_TYPE_OPTIONS } from './constants'
import { SetEditor } from './set-editor'
import type { ExerciseKey, SetEntry, SetType, Workout, WorkoutSet } from './types'
import { exerciseLabel } from './utils'

// ── Edit State ────────────────────────────────────────────────────────────

interface EditState {
  id: number
  exercise: ExerciseKey
  date: Dayjs
  sets: SetEntry[]
}

// ── WorkoutHistory ────────────────────────────────────────────────────────

export function WorkoutHistory({
  workouts,
  activeExercises,
  isLoading,
  onMutate,
}: {
  workouts: Workout[]
  activeExercises: ExerciseKey[]
  isLoading: boolean
  onMutate: () => void
}) {
  const { message } = App.useApp()
  const { mutate: updateMutate, mutation: updateMutation } = useUpdate()
  const { mutate: deleteMutate } = useDelete()
  const [editing, setEditing] = useState<EditState | null>(null)

  const filtered = useMemo(
    () =>
      workouts
        .filter((w) => activeExercises.includes(w.exercise))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [workouts, activeExercises],
  )

  const openEdit = useCallback((w: Workout) => {
    setEditing({
      id: w.id,
      exercise: w.exercise,
      date: dayjs(w.date),
      sets: [...w.sets]
        .sort((a, b) => a.set_number - b.set_number)
        .map((s) => ({
          set_type: s.set_type as SetType,
          weight_kg: s.weight_kg,
          reps: s.reps,
        })),
    })
  }, [])

  const handleSave = useCallback(() => {
    if (!editing || editing.sets.length === 0) return
    updateMutate(
      {
        resource: 'workouts',
        id: editing.id,
        values: {
          date: editing.date.format('YYYY-MM-DD'),
          exercise: editing.exercise,
          sets: editing.sets.map((s, i) => ({
            set_number: i + 1,
            set_type: s.set_type,
            weight_kg: s.weight_kg,
            reps: s.reps,
          })),
        },
      },
      {
        onSuccess: () => {
          void message.success('Workout updated')
          setEditing(null)
          onMutate()
        },
        onError: (err) => void message.error(`Failed: ${String(err)}`),
      },
    )
  }, [editing, updateMutate, message, onMutate])

  const handleDelete = useCallback(
    (id: number) => {
      deleteMutate(
        { resource: 'workouts', id },
        {
          onSuccess: () => {
            void message.success('Workout deleted')
            onMutate()
          },
          onError: (err) => void message.error(`Failed: ${String(err)}`),
        },
      )
    },
    [deleteMutate, message, onMutate],
  )

  const columns = [
    {
      title: 'Date',
      dataIndex: 'date',
      sorter: (a: Workout, b: Workout) => a.date.localeCompare(b.date),
      defaultSortOrder: 'descend' as const,
      render: (date: string) => dayjs(date).format('MMM D'),
      width: 80,
    },
    {
      title: 'Exercise',
      dataIndex: 'exercise',
      render: (ex: string) => (
        <Tag color={EXERCISE_COLORS[ex as ExerciseKey]}>{exerciseLabel(ex)}</Tag>
      ),
      width: 130,
    },
    {
      title: 'Sets',
      render: (_: unknown, record: Workout) => {
        const work = record.sets.filter((s) => s.set_type === 'work').length
        const warmup = record.sets.filter((s) => s.set_type === 'warmup').length
        const drop = record.sets.filter((s) => s.set_type === 'drop').length
        const parts = [`${work}W`]
        if (warmup) parts.push(`${warmup}WU`)
        if (drop) parts.push(`${drop}D`)
        return parts.join(' + ')
      },
      width: 110,
    },
    {
      title: 'Top Set',
      render: (_: unknown, record: Workout) => {
        const workSets = record.sets.filter((s) => s.set_type === 'work')
        if (!workSets.length) return '\u2014'
        const heaviest = workSets.reduce(
          (max, s) => (s.weight_kg > max.weight_kg ? s : max),
          workSets[0],
        )
        return `${heaviest.weight_kg}kg \u00d7 ${heaviest.reps}`
      },
      width: 110,
    },
    {
      title: 'Volume',
      dataIndex: 'total_volume',
      render: (v: number) => `${Math.round(v).toLocaleString()} kg`,
      sorter: (a: Workout, b: Workout) => a.total_volume - b.total_volume,
      width: 100,
    },
    {
      title: '1RM',
      dataIndex: 'estimated_1rm',
      render: (v: number | null) => (v ? `${v.toFixed(1)} kg` : '\u2014'),
      sorter: (a: Workout, b: Workout) => (a.estimated_1rm ?? 0) - (b.estimated_1rm ?? 0),
      width: 90,
    },
    {
      title: '',
      width: 80,
      render: (_: unknown, record: Workout) => (
        <Space size={4}>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={(e) => {
              e.stopPropagation()
              openEdit(record)
            }}
          />
          <Popconfirm
            title="Delete this workout?"
            onConfirm={() => handleDelete(record.id)}
            okText="Delete"
            okType="danger"
          >
            <Button
              type="text"
              danger
              size="small"
              icon={<DeleteOutlined />}
              onClick={(e) => e.stopPropagation()}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const setColumns = [
    { title: '#', dataIndex: 'set_number', width: 40 },
    {
      title: 'Type',
      dataIndex: 'set_type',
      width: 80,
      render: (v: string) => <Tag>{SET_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? v}</Tag>,
    },
    {
      title: 'Weight',
      dataIndex: 'weight_kg',
      width: 80,
      render: (v: number) => `${v} kg`,
    },
    { title: 'Reps', dataIndex: 'reps', width: 60 },
  ]

  return (
    <>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Table<Workout>
          dataSource={filtered}
          columns={columns}
          rowKey="id"
          size="small"
          loading={isLoading}
          pagination={{ pageSize: 15, size: 'small', showSizeChanger: false }}
          scroll={{ x: 700 }}
          expandable={{
            expandedRowRender: (record) => (
              <Table<WorkoutSet>
                dataSource={[...record.sets].sort((a, b) => a.set_number - b.set_number)}
                columns={setColumns}
                pagination={false}
                size="small"
                rowKey="id"
              />
            ),
            expandRowByClick: true,
          }}
        />
      </Card>

      <Modal
        title="Edit Workout"
        open={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={handleSave}
        okText="Save"
        confirmLoading={updateMutation.isPending}
        width={480}
        destroyOnClose
      >
        {editing && (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Exercise
              </Typography.Text>
              <Select
                value={editing.exercise}
                onChange={(v) => setEditing({ ...editing, exercise: v })}
                options={EXERCISES}
                style={{ width: '100%', marginTop: 4 }}
              />
            </div>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Date
              </Typography.Text>
              <DatePicker
                value={editing.date}
                onChange={(d) => d && setEditing({ ...editing, date: d })}
                style={{ width: '100%', marginTop: 4 }}
                allowClear={false}
              />
            </div>
            <SetEditor sets={editing.sets} onChange={(sets) => setEditing({ ...editing, sets })} />
          </Space>
        )}
      </Modal>
    </>
  )
}
