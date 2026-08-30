import {
  AppstoreOutlined,
  BarChartOutlined,
  DatabaseOutlined,
  DesktopOutlined,
  FileTextOutlined,
} from '@ant-design/icons'
import { Layout, Menu, Typography } from 'antd'
import { useNavigate, useLocation, Outlet } from 'react-router-dom'

const { Sider, Header, Content } = Layout

const NAV_ITEMS = [
  { key: '/basculas', icon: <DesktopOutlined />, label: 'Básculas', disabled: true },
  { key: '/tipos-movimiento', icon: <AppstoreOutlined />, label: 'Tipos de movimiento' },
  { key: '/maestros', icon: <DatabaseOutlined />, label: 'Maestros', disabled: true },
  { key: '/boletas', icon: <FileTextOutlined />, label: 'Boletas', disabled: true },
  { key: '/reportes', icon: <BarChartOutlined />, label: 'Reportes', disabled: true },
]

const PAGE_TITLES: Record<string, string> = {
  '/tipos-movimiento': 'Tipos de movimiento',
}

export function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="light" width={232} style={{ borderRight: '1px solid #f0f0f0' }}>
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '0 20px',
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: '#B8711F',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontWeight: 700,
              fontSize: 14,
              flexShrink: 0,
            }}
          >
            SMS
          </div>
          <Typography.Text strong style={{ fontSize: 16 }}>
            SMS 2.0
          </Typography.Text>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={NAV_ITEMS}
          onClick={({ key }) => navigate(key)}
          style={{ borderInlineEnd: 'none' }}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: '#fff',
            borderBottom: '1px solid #f0f0f0',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Typography.Title level={4} style={{ margin: 0 }}>
            {PAGE_TITLES[location.pathname] ?? ''}
          </Typography.Title>
        </Header>
        <Content style={{ padding: 24, background: '#F5F6F8' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
