import { Card, Tooltip as AntTooltip } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { DailyMetric } from './types'
import { METRIC_TOOLTIPS } from './constants'
import { VX } from '../../charts'
import { buildBodyBatteryData, buildStressData, formatXDate } from './utils'

const SYNC_ID = 'garmin'
const GRID_STROKE = 'rgba(128,128,128,0.15)'
const CHART_MARGIN = { top: 5, right: 16, bottom: 5, left: 0 }
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtDate(label: unknown): string {
  if (label instanceof Date) {
    return `${SHORT_DAYS[label.getDay()]} ${MONTHS[label.getMonth()]} ${label.getDate()} ${label.getFullYear()}`
  }
  const s = String(label ?? '')
  const match = s.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return s
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (Number.isNaN(d.getTime())) return s
  return `${SHORT_DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`
}

const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: 'rgba(0, 0, 0, 0.88)',
    border: 'none',
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 12,
    lineHeight: '18px',
  },
  labelStyle: { color: 'rgba(255, 255, 255, 0.65)', fontSize: 11, marginBottom: 2 },
  itemStyle: { color: 'rgba(255, 255, 255, 0.85)', padding: 0, fontSize: 12 },
  labelFormatter: fmtDate,
}

function ChartTitle({ title, tooltip }: { title: string; tooltip: string }) {
  return (
    <span>
      {title}
      <AntTooltip title={tooltip} placement="right">
        <InfoCircleOutlined
          style={{ fontSize: 11, marginLeft: 6, color: 'rgba(128,128,128,0.45)', cursor: 'help' }}
        />
      </AntTooltip>
    </span>
  )
}

// ── Body Battery — range area band ────────────────────────────────────────

export function BodyBatteryChart({ data }: { data: DailyMetric[] }) {
  const chartData = useMemo(() => buildBodyBatteryData(data), [data])

  return (
    <Card
      title={<ChartTitle title="Body Battery" tooltip={METRIC_TOOLTIPS.bodyBattery} />}
      size="small"
      style={{ marginBottom: 16 }}
    >
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={chartData} margin={CHART_MARGIN} syncId={SYNC_ID}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="date" tickFormatter={formatXDate} tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={36} />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(value: number, name: string) => {
              const labels: Record<string, string> = {
                low: 'Morning Low',
                range: 'Daily Range',
              }
              return [`${value}`, labels[name] ?? name]
            }}
          />
          <ReferenceLine y={50} stroke="rgba(255,61,0,0.3)" strokeDasharray="4 4" />
          <Area
            type="monotone"
            dataKey="low"
            stackId="bb"
            fill="transparent"
            stroke={VX.series.bodyBatteryLow}
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
            connectNulls
          />
          <Area
            type="monotone"
            dataKey="range"
            stackId="bb"
            fill={VX.series.bodyBatteryHigh}
            fillOpacity={0.25}
            stroke={VX.series.bodyBatteryHigh}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  )
}

// ── Stress — average + sleep stress ──────────────────────────────────────

export function StressChart({ data }: { data: DailyMetric[] }) {
  const chartData = useMemo(() => buildStressData(data), [data])

  return (
    <Card
      title={<ChartTitle title="Stress Levels" tooltip={METRIC_TOOLTIPS.stress} />}
      size="small"
      style={{ marginBottom: 16 }}
    >
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={chartData} margin={CHART_MARGIN} syncId={SYNC_ID}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="date" tickFormatter={formatXDate} tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={36} />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(value: number, name: string) => {
              const labels: Record<string, string> = {
                avgStress: 'Avg Stress',
                sleepStress: 'Sleep Stress',
              }
              return [`${Math.round(value)}`, labels[name] ?? name]
            }}
          />
          <ReferenceLine y={25} stroke="rgba(0,200,83,0.2)" strokeDasharray="4 4" />
          <ReferenceLine y={50} stroke="rgba(255,214,0,0.2)" strokeDasharray="4 4" />
          <Area
            type="monotone"
            dataKey="avgStress"
            stroke={VX.series.stress}
            fill={VX.series.stress}
            fillOpacity={0.15}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="sleepStress"
            stroke={VX.series.sleepStress}
            dot={false}
            strokeWidth={1.5}
            connectNulls
          />
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  )
}
