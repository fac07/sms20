import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  App,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Switch,
  Table,
  Tag,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useState } from 'react'
import {
  actualizarTipoMovimiento,
  crearTipoMovimiento,
  desactivarTipoMovimiento,
  listarTiposMovimiento,
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

export function TiposMovimientoPage() {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm<GuardarTipoMovimientoInput>()
  const [editando, setEditando] = useState<TipoMovimiento | null>(null)
  const [modalAbierto, setModalAbierto] = useState(false)

  const { data: tipos, isLoading } = useQuery({
    queryKey: ['tipos-movimiento'],
    queryFn: () => listarTiposMovimiento(),
  })

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
    { title: 'Código', dataIndex: 'codigo', key: 'codigo' },
    { title: 'Nombre', dataIndex: 'nombre', key: 'nombre' },
    { title: 'Dirección', dataIndex: 'direccion', key: 'direccion' },
    {
      title: 'Secciones habilitadas',
      key: 'habilita',
      render: (_, tipo) => (
        <>
          {CAMPOS_HABILITA.filter(({ name }) => tipo[name]).map(({ name, label }) => (
            <Tag key={name}>{label}</Tag>
          ))}
        </>
      ),
    },
    {
      title: 'Estado',
      dataIndex: 'activo',
      key: 'activo',
      render: (activo: boolean) => (
        <Tag color={activo ? 'green' : 'default'}>{activo ? 'Activo' : 'Inactivo'}</Tag>
      ),
    },
    {
      title: '',
      key: 'acciones',
      render: (_, tipo) => (
        <>
          <Button type="link" onClick={() => abrirModalEditar(tipo)}>
            Editar
          </Button>
          {tipo.activo && (
            <Popconfirm
              title="¿Desactivar este tipo de movimiento?"
              description="Las boletas ya creadas con este tipo no se ven afectadas."
              onConfirm={() => desactivar.mutate(tipo.id)}
            >
              <Button type="link" danger>
                Desactivar
              </Button>
            </Popconfirm>
          )}
        </>
      ),
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1>Tipos de movimiento</h1>
        <Button type="primary" onClick={abrirModalCrear}>
          Nuevo tipo de movimiento
        </Button>
      </div>

      <Table
        rowKey="id"
        columns={columnas}
        dataSource={tipos}
        loading={isLoading}
      />

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
