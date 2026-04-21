import { Card, Tooltip as AntTooltip } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import type { ReactNode } from 'react'

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

/**
 * Standard wrapper for every visx chart — Card with info-tooltip title + optional
 * extra slot (current value badge etc.). Do not wrap visx charts in bare <Card>.
 */
export function ChartCard({
  title,
  tooltip,
  extra,
  children,
}: {
  title: string
  tooltip: string
  extra?: ReactNode
  children: ReactNode
}) {
  return (
    <Card
      title={<ChartTitle title={title} tooltip={tooltip} />}
      size="small"
      style={{ marginBottom: 16 }}
      extra={extra}
    >
      {children}
    </Card>
  )
}
