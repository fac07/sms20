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
/// <para>Granularidad POR OCURRENCIA (regla explícita, no elección
/// silenciosa): en el legacy los contadores eran columnas 1:1 de la Boleta
/// (<c>Boleta.Racimos_*</c> en clsDatosCalidadFruta) — había UNA muestra por
/// boleta y la suma global era la única posible. En SMS 2.0 <c>detalle_fruta</c>
/// es Repetible y cada ocurrencia es un envío/lote con su propia muestra
/// (esquema 2.0: "Repetible = N ... envíos de fruta"; <c>finca</c>,
/// <c>lote</c>, <c>numero_envio</c> viajan dentro de la ocurrencia). El cap
/// de 30 acota el tamaño de UNA muestra física, no la carga del camión: dos
/// envíos de 25 son dos muestras válidas y deben cerrar. Una ocurrencia con
/// alguno de los cuatro contadores cargado se evalúa sola (suma 0 ⇒ rechazo,
/// aunque otra ocurrencia sea válida); una ocurrencia sin contadores no
/// participa. Con una sola ocurrencia el comportamiento es idéntico al
/// legacy: la regla generaliza sin cambiar el caso típico.</para>
///
/// <para>Vive AFUERA de <c>MotorCampos</c> (congelado por paridad C#/TS):
/// es una regla de negocio entre campos, no una validación de forma por
/// campo. <c>racimos_pedunculo_largo</c> NO entra en la suma — tampoco en el
/// legacy.</para>
///
/// <para>Si la boleta no capturó ningún contador en ninguna ocurrencia, el
/// guard pasa: no toda boleta pesa fruta con muestra de calidad, y un 0
/// explícito SÍ es una muestra capturada (y se rechaza). La ingesta de sync
/// NO revalida (design D3/D8): la decisión se tomó al cerrar, acá o en la
/// terminal.</para>
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
        var filas = await db.BoletaValores.AsNoTracking()
            .Where(v => v.BoletaId == boletaId
                && db.Campos.Any(c => c.Id == v.CampoId && ClavesMuestra.Contains(c.Clave)))
            .Select(v => new { v.Ocurrencia, v.ValorNumero })
            .ToListAsync(ct);

        foreach (var grupo in filas.GroupBy(f => f.Ocurrencia))
        {
            var suma = grupo.Sum(f => f.ValorNumero ?? 0m);
            if (suma <= 0m)
            {
                return Results.BadRequest(
                    "La muestra de racimos de la ocurrencia "
                    + $"{grupo.Key} debe ser mayor a 0 — los contadores están "
                    + $"cargados pero su suma es {suma}.");
            }
            if (suma > MaximoMuestra)
            {
                return Results.BadRequest(
                    $"La muestra de racimos de la ocurrencia {grupo.Key} no puede "
                    + $"superar {MaximoMuestra} — suma actual: {suma}.");
            }
        }

        return null;
    }
}
