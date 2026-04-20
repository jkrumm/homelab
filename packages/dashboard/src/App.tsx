import '@refinedev/antd/dist/reset.css'

import { Refine } from '@refinedev/core'
import { dataProvider } from './providers/data-provider'
import routerProvider from '@refinedev/react-router'
import { ThemedLayout, ThemedSider, useNotificationProvider } from '@refinedev/antd'
import { App as AntdApp, Button, ConfigProvider, theme } from 'antd'
import {
  BulbOutlined,
  CheckSquareOutlined,
  ContainerOutlined,
  DashboardOutlined,
  HeartOutlined,
  MoonFilled,
  TrophyOutlined,
} from '@ant-design/icons'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router'
import { useCallback, useState } from 'react'

import GarminHealthPage from './pages/garmin-health'
import StrengthTrackerPage from './pages/strength-tracker'

function getInitialDark(): boolean {
  const stored = localStorage.getItem('theme')
  if (stored) return stored === 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

const COMING_SOON = [
  { key: 'docker', label: 'Docker', icon: <ContainerOutlined /> },
  { key: 'monitoring', label: 'Monitoring', icon: <DashboardOutlined /> },
  { key: 'tasks', label: 'Tasks', icon: <CheckSquareOutlined /> },
]

export default function App() {
  const [isDark, setIsDark] = useState(getInitialDark)

  const toggleTheme = useCallback(() => {
    setIsDark((prev) => {
      const next = !prev
      localStorage.setItem('theme', next ? 'dark' : 'light')
      return next
    })
  }, [])

  return (
    <BrowserRouter>
      <ConfigProvider
        theme={{
          algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
          token: { colorPrimary: '#1677ff' },
        }}
      >
        <AntdApp>
          <Refine
            dataProvider={dataProvider}
            routerProvider={routerProvider}
            notificationProvider={useNotificationProvider}
            resources={[
              {
                name: 'daily-metrics',
                list: '/garmin-health',
                meta: {
                  label: 'Garmin Health',
                  icon: <HeartOutlined />,
                },
              },
              {
                name: 'workouts',
                list: '/strength-tracker',
                meta: {
                  label: 'Strength Tracker',
                  icon: <TrophyOutlined />,
                },
              },
            ]}
            options={{ syncWithLocation: false, disableTelemetry: true }}
          >
            <Routes>
              <Route
                element={
                  <ThemedLayout
                    Header={() => null}
                    Title={({ collapsed }: { collapsed: boolean }) => (
                      <span style={{ fontWeight: 700, fontSize: collapsed ? 14 : 18 }}>
                        {collapsed ? 'HL' : 'HomeLab'}
                      </span>
                    )}
                    Sider={() => (
                      <ThemedSider
                        render={({
                          items,
                          collapsed,
                        }: {
                          items: React.ReactNode
                          collapsed: boolean
                        }) => (
                          <>
                            {items}
                            {COMING_SOON.map(({ key, label, icon }) => (
                              <div
                                key={key}
                                style={{
                                  padding: collapsed ? '8px 24px' : '8px 16px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 10,
                                  opacity: 0.35,
                                  cursor: 'not-allowed',
                                  fontSize: 14,
                                }}
                                title={`${label} — coming soon`}
                              >
                                {icon}
                                {!collapsed && <span>{label}</span>}
                              </div>
                            ))}
                            <div style={{ flex: 1 }} />
                            <div
                              style={{
                                padding: collapsed ? '12px 24px' : '12px 16px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: collapsed ? 'center' : 'flex-start',
                              }}
                            >
                              <Button
                                type="text"
                                size="small"
                                icon={isDark ? <BulbOutlined /> : <MoonFilled />}
                                onClick={toggleTheme}
                                title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                              >
                                {!collapsed && (isDark ? 'Light' : 'Dark')}
                              </Button>
                            </div>
                          </>
                        )}
                      />
                    )}
                  >
                    <Outlet />
                  </ThemedLayout>
                }
              >
                <Route index element={<Navigate to="/garmin-health" replace />} />
                <Route path="/garmin-health" element={<GarminHealthPage />} />
                <Route path="/strength-tracker" element={<StrengthTrackerPage />} />
                <Route path="*" element={<Navigate to="/garmin-health" replace />} />
              </Route>
            </Routes>
          </Refine>
        </AntdApp>
      </ConfigProvider>
    </BrowserRouter>
  )
}
