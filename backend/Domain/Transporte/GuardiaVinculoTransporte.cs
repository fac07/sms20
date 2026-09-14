using Microsoft.EntityFrameworkCore;
using SmsBackend.Data;

namespace SmsBackend.Domain.Transporte;

/// <summary>
/// Candado del par piloto+transportista antes de persistir un PreIngreso o una
/// Boleta creada por la vía central típada (design D2). Estático y devuelve
/// <c>IResult?</c> — la misma forma que <c>GuardiaEstandar</c>
/// (<c>GuardiaEstandar.cs:11-13</c>) y <c>PreIngresoEndpoints.ValidarCentro</c>
/// (<c>:159-178</c>): <c>null</c> = el par tiene un vínculo activo y la
/// operación puede seguir, no nulo = el 400 que el endpoint debe devolver TAL
/// CUAL, antes de mutar nada.
///
/// <para>NO se usa para rechazar en la rama de ingesta de sync de Boleta
/// (design D3): esa rama nunca devuelve 4xx por esto, marca
/// <see cref="Boletas.MarcaVinculoTransporte"/> en su lugar — el llamador de
/// esa rama usa <see cref="ExisteVinculoActivoAsync"/> directamente, sin pasar
/// por el <c>IResult</c> de rechazo.</para>
/// </summary>
public static class GuardiaVinculoTransporte
{
    public static async Task<IResult?> ValidarAsync(
        SmsDbContext db, Guid pilotoId, Guid transportistaId, CancellationToken ct)
    {
        var vinculado = await ExisteVinculoActivoAsync(db, pilotoId, transportistaId, ct);
        return vinculado
            ? null
            : Results.BadRequest(
                $"No existe un vínculo activo entre el piloto {pilotoId} y el transportista {transportistaId}.");
    }

    /// <summary>
    /// Chequeo puro de existencia (sin forma de <c>IResult</c>) — lo usa la
    /// ingesta de sync de Boleta (design D3) para decidir si marca
    /// <see cref="Boletas.MarcaVinculoTransporte.VinculoInvalido"/> en vez de
    /// rechazar el evento.
    /// </summary>
    public static Task<bool> ExisteVinculoActivoAsync(
        SmsDbContext db, Guid pilotoId, Guid transportistaId, CancellationToken ct) =>
        db.VinculosPilotoTransportista.AsNoTracking().AnyAsync(
            v => v.PilotoId == pilotoId && v.TransportistaId == transportistaId && v.Activo, ct);
}
