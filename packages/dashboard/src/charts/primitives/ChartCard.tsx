import { Card, Tooltip as AntTooltip } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import type { ReactNode } from 'react'

function ChartTitle({
  title,
  subtitle,
  tooltip,
}: {
  title: string
  subtitle?: string
  tooltip: string
}) {
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.15 }}>
      <span>
        {title}
        <AntTooltip title={tooltip} placement="right">
          <InfoCircleOutlined
            style={{ fontSize: 11, marginLeft: 6, color: 'rgba(128,128,128,0.45)', cursor: 'help' }}
          />
        </AntTooltip>
      </span>
      {subtitle && (
        <span
          style={{
            fontSize: 11,
            fontWeight: 400,
            color: 'rgba(128,128,128,0.65)',
            marginTop: 2,
          }}
        >
          {subtitle}
        </span>
      )}
    </span>
  )
}

/**
 * Standard wrapper for every visx chart — Card with info-tooltip title + optional
 * subtitle (the question the chart answers) + optional extra slot (current value
 * badge etc.). Do not wrap visx charts in bare <Card>.
 */
export function ChartCard({
  title,
  subtitle,
  tooltip,
  extra,
  children,
}: {
  title: string
  subtitle?: string
  tooltip: string
  extra?: ReactNode
  children: ReactNode
}) {
  return (
    <Card
      title={<ChartTitle title={title} subtitle={subtitle} tooltip={tooltip} />}
      size="small"
      style={{ marginBottom: 16 }}
      extra={extra}
    >
      {children}
    </Card>
  )
}
