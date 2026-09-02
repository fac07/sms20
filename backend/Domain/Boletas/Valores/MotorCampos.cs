using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using SmsBackend.Data;
using SmsBackend.Domain.Configuracion;
using SmsBackend.Domain.Maestros;

namespace SmsBackend.Domain.Boletas.Valores;

/// <summary>
/// Único resolver/validador del conjunto de campos configurable. Compartido por
/// el crear tipado, el endpoint de cierre y la rama cruda de sync. Devuelve
/// resultados de dominio (<see cref="ErrorCampo"/>), nunca <c>IResult</c> — los
/// endpoints deciden el shape HTTP.
///
/// El conjunto de campos aplicable a una boleta es función pura de
/// <c>(TipoMovimientoId, asOf)</c> donde <c>asOf = boleta.FechaHoraIngreso</c>:
/// no hay tabla de snapshot.
/// </summary>
public sealed class MotorCampos(SmsDbContext db)
{
    /// <summary>
    /// Campos vigentes para el tipo de movimiento en el instante <paramref name="asOf"/>:
    /// asignaciones <see cref="TipoMovimientoSeccion"/> abiertas en <paramref name="asOf"/>
    /// ⋈ <see cref="Campo"/> con <c>VigenteDesde &lt;= asOf AND (VigenteHasta IS NULL OR VigenteHasta &gt; asOf)</c>.
    /// </summary>
    public async Task<IReadOnlyList<CampoAplicable>> ResolverCamposAsync(
        Guid tipoMovimientoId,
        DateTime asOf,
        CancellationToken ct)
    {
        var query =
            from tms in db.TipoMovimientoSecciones
            where tms.TipoMovimientoId == tipoMovimientoId
                  && tms.VigenteDesde <= asOf
                  && (tms.VigenteHasta == null || tms.VigenteHasta > asOf)
            join s in db.Secciones on tms.SeccionId equals s.Id
            join c in db.Campos on s.Id equals c.SeccionId
            where c.VigenteDesde <= asOf
                  && (c.VigenteHasta == null || c.VigenteHasta > asOf)
            select new CampoAplicable(
                c.Id,
                s.Id,
                s.Clave,
                c.Clave,
                c.TipoCampo,
                c.TipoCatalogoRef,
                c.Requerido,
                s.Cardinalidad,
                tms.Requerida,
                c.Configuracion);

        return await query.ToListAsync(ct);
    }

    /// <summary>
    /// Valida una lista de valores capturados contra el conjunto vigente en
    /// <paramref name="asOf"/>: rechaza todo <c>CampoId</c> fuera del conjunto y
    /// aplica los chequeos de columna tipada + <see cref="ConfiguracionCampo"/>
    /// por <see cref="TipoCampo"/>.
    /// </summary>
    public async Task<IReadOnlyList<ErrorCampo>> ValidarValoresAsync(
        Guid tipoMovimientoId,
        DateTime asOf,
        IReadOnlyList<ValorCampoDto> valores,
        CancellationToken ct)
    {
        var aplicables = await ResolverCamposAsync(tipoMovimientoId, asOf, ct);
        return await ValidarValoresContraAsync(aplicables, valores, ct);
    }

    /// <summary>
    /// Validación de cierre (bloqueo duro, sin <c>forzar</c>): contra el conjunto
    /// resuelto a <c>asOf = boleta.FechaHoraIngreso</c> —
    /// (1) toda sección requerida tiene >= 1 ocurrencia;
    /// (2) dentro de cada ocurrencia existente, todo campo requerido tiene valor;
    /// (3) cardinalidad Única -> solo la ocurrencia 0;
    /// (4) toda columna capturada respeta su tipo y su configuración.
    /// Una sección Repetible no requerida con cero ocurrencias está OK.
    /// </summary>
    public async Task<IReadOnlyList<ErrorCampo>> ValidarCierreAsync(Boleta boleta, CancellationToken ct)
    {
        var asOf = boleta.FechaHoraIngreso;
        var aplicables = await ResolverCamposAsync(boleta.TipoMovimientoId, asOf, ct);

        var filas = await db.BoletaValores
            .Where(x => x.BoletaId == boleta.Id)
            .ToListAsync(ct);

        var errores = new List<ErrorCampo>();

        // Regla 4: toda columna capturada respeta su TipoCampo + Configuracion.
        var comoDto = filas
            .Select(x => new ValorCampoDto(
                x.CampoId,
                x.Ocurrencia,
                x.ValorTexto,
                x.ValorNumero,
                x.ValorFecha,
                x.ValorBooleano,
                x.ValorMaestroId))
            .ToList();
        errores.AddRange(await ValidarValoresContraAsync(aplicables, comoDto, ct));

        var valorPorCampoOcc = filas.ToLookup(x => (x.CampoId, x.Ocurrencia));

        var ocurrenciasPorSeccion = filas
            .GroupBy(x => x.SeccionId)
            .ToDictionary(
                g => g.Key,
                g => g.Select(x => x.Ocurrencia).Distinct().OrderBy(o => o).ToList());

        foreach (var grupo in aplicables.GroupBy(c => c.SeccionId))
        {
            var campos = grupo.ToList();
            var muestra = campos[0];
            var ocurrencias = ocurrenciasPorSeccion.TryGetValue(grupo.Key, out var occ)
                ? occ
                : new List<int>();

            // Regla 1: sección requerida necesita al menos una ocurrencia.
            if (muestra.SeccionRequerida && ocurrencias.Count == 0)
            {
                errores.Add(new ErrorCampo(
                    muestra.SeccionClave,
                    "(seccion)",
                    0,
                    "La sección es requerida y no tiene ninguna ocurrencia capturada."));
                continue;
            }

            // Regla 3: Cardinalidad.Unica -> solo la ocurrencia 0.
            if (muestra.Cardinalidad == Cardinalidad.Unica)
            {
                foreach (var o in ocurrencias.Where(o => o != 0))
                {
                    errores.Add(new ErrorCampo(
                        muestra.SeccionClave,
                        "(seccion)",
                        o,
                        "La sección es de cardinalidad Única; solo admite la ocurrencia 0."));
                }
            }

            // Regla 2: dentro de cada ocurrencia existente, todo campo requerido
            // tiene un valor no nulo.
            foreach (var o in ocurrencias)
            {
                foreach (var campo in campos.Where(c => c.Requerido))
                {
                    var fila = valorPorCampoOcc[(campo.CampoId, o)].FirstOrDefault();
                    if (fila is null || !TieneValor(fila))
                    {
                        errores.Add(new ErrorCampo(
                            campo.SeccionClave,
                            campo.CampoClave,
                            o,
                            "Campo requerido sin valor."));
                    }
                }
            }
        }

        return errores;
    }

    private async Task<IReadOnlyList<ErrorCampo>> ValidarValoresContraAsync(
        IReadOnlyList<CampoAplicable> aplicables,
        IReadOnlyList<ValorCampoDto> valores,
        CancellationToken ct)
    {
        var porId = aplicables.ToDictionary(c => c.CampoId);

        var maestroIds = valores
            .Where(v => v.ValorMaestroId is not null)
            .Select(v => v.ValorMaestroId!.Value)
            .Distinct()
            .ToList();

        var maestros = maestroIds.Count == 0
            ? new Dictionary<Guid, Maestro>()
            : await db.Maestros
                .Where(m => maestroIds.Contains(m.Id))
                .ToDictionaryAsync(m => m.Id, ct);

        var errores = new List<ErrorCampo>();
        foreach (var v in valores)
        {
            if (!porId.TryGetValue(v.CampoId, out var campo))
            {
                errores.Add(new ErrorCampo(
                    "(desconocida)",
                    "(desconocido)",
                    v.Ocurrencia,
                    $"El campo {v.CampoId} no pertenece al conjunto de campos vigente al crear la boleta."));
                continue;
            }

            errores.AddRange(ValidarValor(campo, v, maestros));
        }

        return errores;
    }

    private static IEnumerable<ErrorCampo> ValidarValor(
        CampoAplicable campo,
        ValorCampoDto v,
        IReadOnlyDictionary<Guid, Maestro> maestros)
    {
        ErrorCampo Err(string mensaje) => new(campo.SeccionClave, campo.CampoClave, v.Ocurrencia, mensaje);

        var (count, unica) = Columnas(v);
        if (count != 1)
        {
            yield return Err("Se esperaba exactamente un valor tipado en la entrada.");
            yield break;
        }

        var esperada = ColumnaEsperada(campo.TipoCampo);
        if (unica != esperada)
        {
            yield return Err($"El tipo de campo {campo.TipoCampo} espera un valor en la columna {esperada}.");
            yield break;
        }

        if (!ConfiguracionCampo.TryParse(campo.Configuracion, out var cfg))
        {
            yield return Err("La configuración del campo tiene JSON malformado.");
            yield break;
        }

        switch (campo.TipoCampo)
        {
            case TipoCampo.Texto:
            {
                var texto = v.ValorTexto!;
                if (cfg?.MaxLength is int max && texto.Length > max)
                {
                    yield return Err($"Excede el largo máximo de {max} caracteres.");
                }

                if (cfg?.Regex is { Length: > 0 } patron && !CumpleRegex(texto, patron))
                {
                    yield return Err("No cumple el patrón (regex) configurado.");
                }

                break;
            }

            case TipoCampo.Lista:
            {
                if (cfg?.Opciones is null || cfg.Opciones.Count == 0)
                {
                    yield return Err("El campo Lista no tiene opciones configuradas.");
                }
                else if (!cfg.Opciones.Contains(v.ValorTexto!))
                {
                    yield return Err($"'{v.ValorTexto}' no es una de las opciones configuradas.");
                }

                break;
            }

            case TipoCampo.Entero:
            {
                var numero = v.ValorNumero!.Value;
                if (numero != decimal.Truncate(numero))
                {
                    yield return Err("Se esperaba un entero, sin parte decimal.");
                }

                foreach (var e in RangoNumerico(cfg, numero, Err))
                {
                    yield return e;
                }

                break;
            }

            case TipoCampo.Decimal:
            {
                var numero = v.ValorNumero!.Value;
                if (cfg?.Decimales is int dec && Escala(numero) > dec)
                {
                    yield return Err($"Excede los {dec} decimales configurados.");
                }

                foreach (var e in RangoNumerico(cfg, numero, Err))
                {
                    yield return e;
                }

                break;
            }

            case TipoCampo.Fecha:
            case TipoCampo.FechaHora:
                // ConfiguracionCampo no modela límites de fecha (Min/Max son
                // decimal). El rango de fechas se validará cuando se amplíe esa
                // forma — ver nota de desviación en apply-progress.
                break;

            case TipoCampo.Booleano:
                break;

            case TipoCampo.ReferenciaMaestro:
            {
                var maestroId = v.ValorMaestroId!.Value;
                if (!maestros.TryGetValue(maestroId, out var maestro))
                {
                    yield return Err($"El maestro {maestroId} no existe.");
                }
                else if (!maestro.Activo)
                {
                    yield return Err("El maestro referenciado está inactivo.");
                }
                else if (campo.TipoCatalogoRef is TipoCatalogo tipoEsperado
                         && maestro.TipoCatalogo != tipoEsperado)
                {
                    yield return Err(
                        $"El maestro es de tipo {maestro.TipoCatalogo}; se esperaba {tipoEsperado}.");
                }

                break;
            }
        }
    }

    private enum ColumnaValor
    {
        Texto,
        Numero,
        Fecha,
        Booleano,
        Maestro,
    }

    private static (int Count, ColumnaValor? Unica) Columnas(ValorCampoDto v)
    {
        ColumnaValor? ultima = null;
        var n = 0;

        if (v.ValorTexto is not null)
        {
            n++;
            ultima = ColumnaValor.Texto;
        }

        if (v.ValorNumero is not null)
        {
            n++;
            ultima = ColumnaValor.Numero;
        }

        if (v.ValorFecha is not null)
        {
            n++;
            ultima = ColumnaValor.Fecha;
        }

        if (v.ValorBooleano is not null)
        {
            n++;
            ultima = ColumnaValor.Booleano;
        }

        if (v.ValorMaestroId is not null)
        {
            n++;
            ultima = ColumnaValor.Maestro;
        }

        return (n, n == 1 ? ultima : null);
    }

    private static ColumnaValor ColumnaEsperada(TipoCampo tipo) => tipo switch
    {
        TipoCampo.Texto or TipoCampo.Lista => ColumnaValor.Texto,
        TipoCampo.Entero or TipoCampo.Decimal => ColumnaValor.Numero,
        TipoCampo.Fecha or TipoCampo.FechaHora => ColumnaValor.Fecha,
        TipoCampo.Booleano => ColumnaValor.Booleano,
        TipoCampo.ReferenciaMaestro => ColumnaValor.Maestro,
        _ => ColumnaValor.Texto,
    };

    private static bool CumpleRegex(string valor, string patron)
    {
        try
        {
            return Regex.IsMatch(valor, patron);
        }
        catch (ArgumentException)
        {
            return false;
        }
    }

    private static IEnumerable<ErrorCampo> RangoNumerico(
        ConfiguracionCampo? cfg,
        decimal valor,
        Func<string, ErrorCampo> err)
    {
        if (cfg?.Min is decimal min && valor < min)
        {
            yield return err($"Debe ser mayor o igual a {min}.");
        }

        if (cfg?.Max is decimal max && valor > max)
        {
            yield return err($"Debe ser menor o igual a {max}.");
        }
    }

    private static int Escala(decimal valor) => (decimal.GetBits(valor)[3] >> 16) & 0xFF;

    private static bool TieneValor(BoletaValorCampo x) =>
        x.ValorTexto is not null
        || x.ValorNumero is not null
        || x.ValorFecha is not null
        || x.ValorBooleano is not null
        || x.ValorMaestroId is not null;
}
