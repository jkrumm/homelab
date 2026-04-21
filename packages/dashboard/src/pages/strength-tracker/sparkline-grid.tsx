import { Table } from 'antd'
import { useMemo } from 'react'
import { BarSparkline, LineSparkline, VX } from '../../charts'
import { EXERCISE_COLORS, EXERCISES } from './constants'
import type { ExerciseKey, Workout } from './types'
import {
  buildInolChartData,
  buildOneRmChartData,
  buildWeeklyVolumeData,
  exerciseLabel,
  strengthDirection,
  velocityPctPerDay,
} from './utils'

const SPARK_W = 80
const SPARK_H = 28

type SparkRow = {
  key: ExerciseKey
  label: string
  color: string
  e1rmSpark: number[]
  volSpark: number[]
  inolSpark: number[]
  vel: number | null
  dir: ReturnType<typeof strengthDirection>
}

function directionArrow(dir: ReturnType<typeof strengthDirection>): string {
  if (dir === 'improving') return '▲'
  if (dir === 'declining') return '▼'
  return '►'
}

function statusColor(dir: ReturnType<typeof strengthDirection>): string {
  if (dir === 'improving') return VX.goodSolid
  if (dir === 'declining') return VX.badSolid
  return VX.warnSolid
}

type Props = {
  workouts: Workout[]
  activeExercises: ExerciseKey[]
}

export function StrengthSparklineGrid({ workouts, activeExercises }: Props) {
  const e1rmData = useMemo(
    () => buildOneRmChartData(workouts, activeExercises),
    [workouts, activeExercises],
  )

  const rows: SparkRow[] = useMemo(
    () =>
      EXERCISES.filter((e) => activeExercises.includes(e.value)).map((e) => {
        const ex = e.value

        const e1rmSpark = e1rmData
          .filter((d) => d.e1rm[ex] !== null)
          .slice(-20)
          .map((d) => d.e1rm[ex]!)

        const volSpark = buildWeeklyVolumeData(workouts, ex)
          .slice(-10)
          .map((d) => d.total)

        const inolSpark = buildInolChartData(workouts, ex)
          .filter((d) => d.inol !== null)
          .slice(-15)
          .map((d) => d.inol!)

        const vel = velocityPctPerDay(workouts, ex)
        const dir = strengthDirection(vel)

        return {
          key: ex,
          label: exerciseLabel(ex),
          color: EXERCISE_COLORS[ex],
          e1rmSpark,
          volSpark,
          inolSpark,
          vel,
          dir,
        }
      }),
    [workouts, activeExercises, e1rmData],
  )

  const columns = [
    {
      title: 'Exercise',
      dataIndex: 'label',
      key: 'exercise',
      render: (_: string, row: SparkRow) => (
        <span style={{ fontWeight: 600, color: row.color }}>{row.label}</span>
      ),
    },
    {
      title: '1RM',
      key: 'e1rm',
      render: (_: unknown, row: SparkRow) => (
        <LineSparkline data={row.e1rmSpark} width={SPARK_W} height={SPARK_H} color={row.color} />
      ),
    },
    {
      title: 'Volume',
      key: 'volume',
      render: (_: unknown, row: SparkRow) => (
        <BarSparkline data={row.volSpark} width={SPARK_W} height={SPARK_H} color={row.color} />
      ),
    },
    {
      title: 'INOL',
      key: 'inol',
      render: (_: unknown, row: SparkRow) => (
        <LineSparkline data={row.inolSpark} width={SPARK_W} height={SPARK_H} color={row.color} />
      ),
    },
    {
      title: 'Momentum',
      key: 'momentum',
      render: (_: unknown, row: SparkRow) => (
        <span style={{ fontSize: 13, color: statusColor(row.dir) }}>
          <span style={{ fontWeight: 700 }}>{directionArrow(row.dir)}</span>{' '}
          {row.vel !== null && (
            <span>
              {row.vel >= 0 ? '+' : ''}
              {row.vel.toFixed(2)}%/d
            </span>
          )}
        </span>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      render: (_: unknown, row: SparkRow) => (
        <span
          style={{
            display: 'inline-block',
            width: 10,
            height: 10,
            borderRadius: '50%',
            backgroundColor: statusColor(row.dir),
          }}
        />
      ),
    },
  ]

  return (
    <Table<SparkRow>
      dataSource={rows}
      columns={columns}
      size="small"
      pagination={false}
      rowKey="key"
      style={{ marginTop: 8 }}
    />
  )
}
