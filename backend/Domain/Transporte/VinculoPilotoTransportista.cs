using SmsBackend.Domain.Configuracion;

namespace SmsBackend.Domain.Transporte;

/// <summary>
/// Vínculo piloto↔transportista (design D1): un piloto solo puede transportar
/// para un transportista con el que tenga un vínculo activo. Es una entidad
/// N:N pura — <see cref="PilotoId"/> y <see cref="TransportistaId"/> son FKs
/// lógicas hacia <c>Maestro</c> (TipoCatalogo Piloto/Transportista
/// respectivamente), sin navigation property ni FK real en SQL Server, igual
/// que las seis referencias a <c>Maestro</c> de <c>PreIngreso</c>.
///
/// Se sincroniza a las básculas para escopear el combo de piloto offline
/// (design D3 — fuera de alcance de este slice, ver PR5). El enforcement
/// central de "solo un par vinculado puede crear PreIngreso/Boleta" vive en
/// <c>GuardiaVinculoTransporte</c> (design D2, PR4), no acá — este slice es
/// solo el CRUD del vínculo.
/// </summary>
public class VinculoPilotoTransportista : IFechaModificable
{
    public Guid Id { get; set; }

    /// <summary>FK lógica hacia Maestro (TipoCatalogo = Piloto).</summary>
    public Guid PilotoId { get; set; }

    /// <summary>FK lógica hacia Maestro (TipoCatalogo = Transportista).</summary>
    public Guid TransportistaId { get; set; }

    /// <summary>
    /// Nunca se borra en duro — desactivar es <c>Activo=false</c>, misma
    /// convención que <c>Maestro</c>/<c>PreIngreso</c>. Reactivar un par
    /// existente es la acción explícita <c>POST /{id}/reactivar</c>, nunca un
    /// upsert implícito del alta.
    /// </summary>
    public bool Activo { get; set; } = true;

    /// <summary>UPN de quien creó el vínculo — VARCHAR plano, sin FK ni validación (sin sistema de auth, igual que PreIngreso.UsuarioCreacion).</summary>
    public string UsuarioCreacion { get; set; } = string.Empty;

    public DateTime FechaCreacion { get; set; }

    /// <summary>
    /// Marca de agua del delta-sync central→terminal. La sella
    /// <c>SmsDbContext.SaveChanges</c> en cada alta, desactivación o
    /// reactivación (<c>IFechaModificable</c>).
    /// </summary>
    public DateTime FechaModificacion { get; set; }
}
