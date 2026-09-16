namespace SmsBackend.Domain.Seguridad;

/// <summary>
/// Marca las entidades cuyo alcance de lectura se filtra por Centro (design
/// D6): <c>SmsDbContext.OnModelCreating</c> aplica un <c>HasQueryFilter</c>
/// global contra <see cref="ICentroContext.Permitidos"/> a cada implementor,
/// en vez de repetir un <c>Where</c> manual en cada endpoint — ese es
/// precisamente el modo de falla legacy que este mecanismo reemplaza (un
/// <c>Where</c> olvidado en alguno de los 61 handlers habría sido una fuga
/// silenciosa entre Centros).
///
/// <c>Boleta</c> NO implementa esta interfaz a propósito: no tiene
/// <c>CentroId</c> propio (solo <c>BasculaId</c>), así que su filtro es un
/// subquery correlacionado dedicado en <c>SmsDbContext</c>, no este mecanismo
/// genérico.
/// </summary>
public interface ICentroScoped
{
    Guid CentroId { get; }
}
