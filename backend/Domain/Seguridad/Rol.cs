namespace SmsBackend.Domain.Seguridad;

/// <summary>
/// Rol jerárquico de usuario humano (design D1/D4): Administrador ⊇
/// Supervisor ⊇ Operador — un rol superior cumple las políticas de los
/// inferiores. Enum, no tabla: tres valores fijos no justifican un catálogo
/// ni una pantalla CRUD que nadie pidió.
/// </summary>
public enum Rol
{
    Operador,
    Supervisor,
    Administrador,
}
