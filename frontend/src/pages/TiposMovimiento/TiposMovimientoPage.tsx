import {
  ApiOutlined,
  AppstoreOutlined,
  CheckCircleFilled,
  EditOutlined,
  ExportOutlined,
  ImportOutlined,
  MinusCircleFilled,
  PlusOutlined,
  StopOutlined,
  SwapOutlined,
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  App,
  Button,
  Card,
  Col,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Select,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useMemo, useState } from 'react'
import {
  actualizarTipoMovimiento,
  crearTipoMovimiento,
  desactivarTipoMovimiento,
  listarTiposMovimiento,
  type DireccionMovimiento,
  type GuardarTipoMovimientoInput,
  type TipoMovimiento,
} from '../../api/tiposMovimiento'

const CAMPOS_HABILITA: { name: keyof GuardarTipoMovimientoInput; label: string }[] = [
  { name: 'habilitaCalidad', label: 'Calidad' },
  { name: 'habilitaMarchamos', label: 'Marchamos' },
  { name: 'habilitaQR', label: 'QR (transferencias)' },
  { name: 'habilitaDatosFinca', label: 'Datos de finca' },
  { name: 'habilitaDetalleFruta', label: 'Detalle de fruta' },
  { name: 'habilitaCompostera', label: 'Compostera' },
  { name: 'integracionD365', label: 'Integración D365' },
]

const DIRECCION_UI: Record<
  DireccionMovimiento,
  { tagColor: string; iconColor: string; iconBg: string; icon: React.ReactNode }
> = {
  Entrada: { tagColor: 'green', iconColor: '#3F8F6E', iconBg: '#3F8F6E1a', icon: <ImportOutlined /> },
  Salida: { tagColor: 'gold', iconColor: '#B8711F', iconBg: '#B8711F1a', icon: <ExportOutlined /> },
  Transferencia: { tagColor: 'blue', iconColor: '#2F6FED', iconBg: '#2F6FED1a', icon: <SwapOutlined /> },
}

function StatCard({
  title,
  value,
  icon,
  color,
}: {
  title: string
  value: number
  icon: React.ReactNode
  color: string
}) {
  return (
    <Card
      styles={{ body: { padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 } }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 10,
          background: `${color}1a`,
          color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 20,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <Statistic title={title} value={value} valueStyle={{ fontSize: 22 }} />
    </Card>
  )
}

export function TiposMovimientoPage() {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm<GuardarTipoMovimientoInput>()
  const [editando, setEditando] = useState<TipoMovimiento | null>(null)
  const [modalAbierto, setModalAbierto] = useState(false)

  const { data: tipos, isLoading } = useQuery({
    queryKey: ['tipos-movimiento'],
    queryFn: () => listarTiposMovimiento(true),
  })

  const stats = useMemo(() => {
    const lista = tipos ?? []
    return {
      total: lista.length,
      activos: lista.filter((t) => t.activo).length,
      inactivos: lista.filter((t) => !t.activo).length,
      d365: lista.filter((t) => t.integracionD365 && t.activo).length,
    }
  }, [tipos])

  const invalidar = () => queryClient.invalidateQueries({ queryKey: ['tipos-movimiento'] })

  const crear = useMutation({
    mutationFn: crearTipoMovimiento,
    onSuccess: () => {
      message.success('Tipo de movimiento creado.')
      invalidar()
      cerrarModal()
    },
    onError: (err: Error) => message.error(err.message),
  })

  const actualizar = useMutation({
    mutationFn: ({ id, input }: { id: string; input: GuardarTipoMovimientoInput }) =>
      actualizarTipoMovimiento(id, input),
    onSuccess: () => {
      message.success('Tipo de movimiento actualizado.')
      invalidar()
      cerrarModal()
    },
    onError: (err: Error) => message.error(err.message),
  })

  const desactivar = useMutation({
    mutationFn: desactivarTipoMovimiento,
    onSuccess: () => {
      message.success('Tipo de movimiento desactivado.')
      invalidar()
    },
    onError: (err: Error) => message.error(err.message),
  })

  function abrirModalCrear() {
    setEditando(null)
    form.resetFields()
    form.setFieldsValue({
      direccion: 'Entrada',
      habilitaCalidad: false,
      habilitaMarchamos: false,
      habilitaQR: false,
      habilitaDatosFinca: false,
      habilitaDetalleFruta: false,
      habilitaCompostera: false,
      integracionD365: false,
    })
    setModalAbierto(true)
  }

  function abrirModalEditar(tipo: TipoMovimiento) {
    setEditando(tipo)
    form.setFieldsValue(tipo)
    setModalAbierto(true)
  }

  function cerrarModal() {
    setModalAbierto(false)
    setEditando(null)
  }

  function guardar() {
    form.validateFields().then((values) => {
      const input: GuardarTipoMovimientoInput = { ...values, formatoBoletaId: null }
      if (editando) {
        actualizar.mutate({ id: editando.id, input })
      } else {
        crear.mutate(input)
      }
    })
  }

  const columnas: ColumnsType<TipoMovimiento> = [
    {
      title: 'Tipo de movimiento',
      key: 'nombre',
      render: (_, tipo) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: DIRECCION_UI[tipo.direccion].iconBg,
              color: DIRECCION_UI[tipo.direccion].iconColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {DIRECCION_UI[tipo.direccion].icon}
          </div>
          <div>
            <div style={{ fontWeight: 500 }}>{tipo.nombre}</div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', fontFamily: 'monospace' }}>
              {tipo.codigo}
            </div>
          </div>
        </div>
      ),
    },
    {
      title: 'Dirección',
      dataIndex: 'direccion',
      key: 'direccion',
      render: (direccion: DireccionMovimiento) => (
        <Tag color={DIRECCION_UI[direccion].tagColor} icon={DIRECCION_UI[direccion].icon}>
          {direccion}
        </Tag>
      ),
    },
    {
      title: 'Secciones habilitadas',
      key: 'habilita',
      render: (_, tipo) => (
        <>
          {CAMPOS_HABILITA.filter(({ name }) => tipo[name]).map(({ name, label }) => (
            <Tag key={name} color="purple" bordered={false}>
              {label}
            </Tag>
          ))}
        </>
      ),
    },
    {
      title: 'D365',
      dataIndex: 'integracionD365',
      key: 'integracionD365',
      align: 'center',
      render: (habilitado: boolean) =>
        habilitado ? (
          <Tooltip title="Sincroniza a D365">
            <ApiOutlined style={{ color: '#3F8F6E', fontSize: 16 }} />
          </Tooltip>
        ) : (
          <span style={{ color: 'rgba(0,0,0,0.25)' }}>—</span>
        ),
    },
    {
      title: 'Estado',
      dataIndex: 'activo',
      key: 'activo',
      render: (activo: boolean) => (
        <Tag
          color={activo ? 'success' : 'default'}
          icon={activo ? <CheckCircleFilled /> : <MinusCircleFilled />}
        >
          {activo ? 'Activo' : 'Inactivo'}
        </Tag>
      ),
    },
    {
      title: '',
      key: 'acciones',
      align: 'right',
      render: (_, tipo) => (
        <>
          <Tooltip title="Editar">
            <Button
              type="text"
              icon={<EditOutlined />}
              onClick={() => abrirModalEditar(tipo)}
            />
          </Tooltip>
          {tipo.activo && (
            <Popconfirm
              title="¿Desactivar este tipo de movimiento?"
              description="Las boletas ya creadas con este tipo no se ven afectadas."
              onConfirm={() => desactivar.mutate(tipo.id)}
            >
              <Tooltip title="Desactivar">
                <Button type="text" danger icon={<StopOutlined />} />
              </Tooltip>
            </Popconfirm>
          )}
        </>
      ),
    },
  ]

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 20 }}>
        <Col span={6}>
          <StatCard
            title="Total"
            value={stats.total}
            icon={<AppstoreOutlined />}
            color="#B8711F"
          />
        </Col>
        <Col span={6}>
          <StatCard
            title="Activos"
            value={stats.activos}
            icon={<CheckCircleFilled />}
            color="#3F8F6E"
          />
        </Col>
        <Col span={6}>
          <StatCard title="Con D365" value={stats.d365} icon={<ApiOutlined />} color="#2F6FED" />
        </Col>
        <Col span={6}>
          <StatCard
            title="Inactivos"
            value={stats.inactivos}
            icon={<StopOutlined />}
            color="#8c8c8c"
          />
        </Col>
      </Row>

      <Card
        styles={{ body: { padding: 0 } }}
        title="Catálogo"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={abrirModalCrear}>
            Nuevo tipo de movimiento
          </Button>
        }
      >
        <Table
          rowKey="id"
          columns={columnas}
          dataSource={tipos}
          loading={isLoading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      <Modal
        title={editando ? 'Editar tipo de movimiento' : 'Nuevo tipo de movimiento'}
        open={modalAbierto}
        onCancel={cerrarModal}
        onOk={guardar}
        confirmLoading={crear.isPending || actualizar.isPending}
        okText="Guardar"
        cancelText="Cancelar"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="codigo" label="Código" rules={[{ required: true }]}>
            <Input placeholder="ING-FRUTA" />
          </Form.Item>
          <Form.Item name="nombre" label="Nombre" rules={[{ required: true }]}>
            <Input placeholder="Ingreso de fruta" />
          </Form.Item>
          <Form.Item name="direccion" label="Dirección" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'Entrada', label: 'Entrada' },
                { value: 'Salida', label: 'Salida' },
                { value: 'Transferencia', label: 'Transferencia' },
              ]}
            />
          </Form.Item>

          {CAMPOS_HABILITA.map(({ name, label }) => (
            <Form.Item
              key={name}
              name={name}
              label={label}
              valuePropName="checked"
              style={{ marginBottom: 8 }}
            >
              <Switch />
            </Form.Item>
          ))}
        </Form>
      </Modal>
    </div>
  )
}
