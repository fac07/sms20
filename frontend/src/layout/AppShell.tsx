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

// Barra superior oscura + sidebar claro debajo, mismo esquema que NatPlus
// (la app web interna de Naturaceites) en vez de un estilo propio aislado.
const HEADER_BG = '#0D3B36'

export function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header
        style={{
          background: HEADER_BG,
          padding: '0 20px',
          display: 'flex',
          alignItems: 'center',
          height: 56,
          lineHeight: '56px',
        }}
      >
        <Typography.Text strong style={{ fontSize: 17 }}>
          <span style={{ color: '#4CB556' }}>SMS</span>{' '}
          <span style={{ color: '#EFA400' }}>2.0</span>
        </Typography.Text>
      </Header>
      <Layout>
        <Sider theme="light" width={232} style={{ borderRight: '1px solid #f0f0f0' }}>
          <Menu
            mode="inline"
            selectedKeys={[location.pathname]}
            items={NAV_ITEMS}
            onClick={({ key }) => navigate(key)}
            style={{ borderInlineEnd: 'none', paddingTop: 8 }}
          />
        </Sider>
        <Layout>
          <div
            style={{
              background: '#fff',
              borderBottom: '1px solid #f0f0f0',
              padding: '14px 24px',
            }}
          >
            <Typography.Title level={4} style={{ margin: 0, color: HEADER_BG }}>
              {PAGE_TITLES[location.pathname] ?? ''}
            </Typography.Title>
          </div>
          <Content style={{ padding: 24, background: '#F5F6F8' }}>
            <Outlet />
          </Content>
        </Layout>
      </Layout>
    </Layout>
  )
}
