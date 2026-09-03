namespace SmsBackend.Domain.Configuracion;

/// <summary>
/// Marca de las entidades de configuración replicadas central→báscula por marca
/// de agua incremental (igual que <c>Maestro</c>). El override de
/// <c>SmsDbContext.SaveChanges</c>/<c>SaveChangesAsync</c> sella
/// <see cref="FechaModificacion"/> con <c>DateTime.UtcNow</c> en cada entrada
/// <c>Added</c> o <c>Modified</c>, de modo que desactivar
/// (<c>Activa = false</c>), versionar (<c>VigenteHasta</c>) o editar cualquier
/// columna propaga la fila en el próximo <c>?modificadoDesde</c> sin necesidad de
/// una tabla de tombstones.
/// </summary>
public interface IFechaModificable
{
    DateTime FechaModificacion { get; set; }
}
