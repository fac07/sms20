using Microsoft.EntityFrameworkCore;
using SmsBackend.Data;

namespace SmsBackend.Domain.Boletas;

/// <summary>
/// Candado de la muestra de calidad de fruta antes de cerrar (espejo del
/// guard de grabado de NAT_Basculas frmCalidadFruta.cs:117-128:
/// 0 &lt; verdes + maduros + sobremaduros + pasados &lt;= 30). Estático y
/// devuelve <c>IResult?</c> — la misma forma que
/// <see cref="Transporte.GuardiaVinculoTransporte"/>: <c>null</c> = puede
/// seguir, no nulo = el 400 que el endpoint devuelve TAL CUAL antes de mutar.
///
/// <para>Vive AFUERA de <c>MotorCampos</c> (congelado por paridad C#/TS):
/// es una regla de negocio entre campos, no una validación de forma por
/// campo. <c>racimos_pedunculo_largo</c> NO entra en la suma — tampoco en el
/// legacy.</para>
///
/// <para>Si la boleta no capturó ninguno de los cuatro contadores, el guard
/// pasa: no toda boleta pesa fruta con muestra de calidad, y un 0 explícito
/// SÍ es una muestra capturada (y se rechaza). La ingesta de sync NO revalida
/// (design D3/D8): la decisión se tomó al cerrar, acá o en la terminal.</para>
/// </summary>
public static class GuardiaMuestraFruta
{
    private static readonly string[] ClavesMuestra =
    {
        "racimos_verdes", "racimos_maduros", "racimos_sobremaduros", "racimos_pasados",
    };

    private const decimal MaximoMuestra = 30;

    public static async Task<IResult?> ValidarCierreAsync(
        SmsDbContext db, Guid boletaId, CancellationToken ct)
    {
        // Los valores apuntan al CampoId vigente a la captura (versionable);
        // se resuelve por Clave para atravesar versiones sin re-resolver asOf.
        var contadores = await db.BoletaValores.AsNoTracking()
            .Where(v => v.BoletaId == boletaId
                && db.Campos.Any(c => c.Id == v.CampoId && ClavesMuestra.Contains(c.Clave)))
            .Select(v => v.ValorNumero)
            .ToListAsync(ct);

        if (contadores.Count == 0)
        {
            return null;
        }

        var suma = contadores.Sum(v => v ?? 0m);
        if (suma <= 0m)
        {
            return Results.BadRequest(
                "La muestra de racimos debe ser mayor a 0 — los contadores están "
                + $"cargados pero su suma es {suma}.");
        }
        if (suma > MaximoMuestra)
        {
            return Results.BadRequest(
                $"La muestra de racimos no puede superar {MaximoMuestra} — suma actual: {suma}.");
        }

        return null;
    }
}
