using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SmsBackend.Data;
using SmsBackend.Domain.Basculas;
using SmsBackend.Domain.Boletas;
using SmsBackend.Domain.Boletas.Valores;
using SmsBackend.Domain.Configuracion;
using SmsBackend.Domain.Maestros;
using SmsBackend.Domain.TiposMovimiento;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Paridad ejecutable entre el <see cref="MotorCampos"/> real (C#) y su puerto
/// TypeScript (<c>frontend/electron/motor-campos.ts</c>): los MISMOS vectores
/// (<c>tests/parity/motor-campos/*.json</c>) corren acá contra el motor de
/// dominio y en <c>motor-campos.spec.ts</c> contra las funciones puras. Si un
/// puerto se desvía del otro, uno de los dos suites falla.
///
/// Cada vector se siembra en una transacción que se revierte al terminar el
/// test, así la base de la fixture queda intacta entre casos.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class MotorCamposParityTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;

    public MotorCamposParityTests(ApiFactory factory) => _factory = factory;

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    public static IEnumerable<object[]> Vectores() =>
        ParityVector.CargarTodos().Select(v => new object[] { v.Nombre });

    [Theory]
    [MemberData(nameof(Vectores))]
    public async Task Coincide_con_el_puerto_typescript(string nombre)
    {
        var vector = ParityVector.Por(nombre);
        var e = vector.Entrada;
        var ct = CancellationToken.None;

        using var scope = _factory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SmsDbContext>();
        await using var tx = await db.Database.BeginTransactionAsync(ct);

        await SembrarAsync(db, e, ct);

        var motor = scope.ServiceProvider.GetRequiredService<MotorCampos>();

        if (vector.Fn == "resolverCampos")
        {
            var aplicables = await motor.ResolverCamposAsync(
                Guid.Parse(e.TipoMovimientoId!), Instante(e.AsOf!), ct);

            var actual = aplicables
                .Select(a => new AplicableEsperado(
                    a.CampoId.ToString(),
                    a.SeccionClave,
                    a.CampoClave,
                    a.SeccionRequerida,
                    a.Cardinalidad.ToString()))
                .OrderBy(a => a.CampoId, StringComparer.Ordinal)
                .ToList();

            var esperado = (vector.Esperado.Aplicables ?? new List<AplicableEsperado>())
                .Select(a => a with { CampoId = Guid.Parse(a.CampoId).ToString() })
                .OrderBy(a => a.CampoId, StringComparer.Ordinal)
                .ToList();

            Assert.Equal(esperado, actual);
            return;
        }

        IReadOnlyList<ErrorCampo> errores;
        if (vector.Fn == "validarValores")
        {
            errores = await motor.ValidarValoresAsync(
                Guid.Parse(e.TipoMovimientoId!),
                Instante(e.AsOf!),
                (e.Valores ?? new List<VectorValor>()).Select(ADto).ToList(),
                ct);
        }
        else if (vector.Fn == "validarCierre")
        {
            var b = e.Boleta!;
            var boleta = new Boleta
            {
                Id = Guid.Parse(b.Id),
                TipoMovimientoId = Guid.Parse(b.TipoMovimientoId),
                FechaHoraIngreso = Instante(b.FechaHoraIngreso),
            };
            errores = await motor.ValidarCierreAsync(boleta, ct);
        }
        else
        {
            throw new InvalidOperationException($"fn desconocida en el vector: {vector.Fn}");
        }

        var actualClaves = errores
            .Select(x => $"{x.SeccionClave}|{x.CampoClave}|{x.Ocurrencia}")
            .OrderBy(x => x, StringComparer.Ordinal)
            .ToList();

        var esperadoClaves = (vector.Esperado.Errores ?? new List<ErrorEsperado>())
            .Select(x => $"{x.SeccionClave}|{x.CampoClave}|{x.Ocurrencia}")
            .OrderBy(x => x, StringComparer.Ordinal)
            .ToList();

        Assert.Equal(esperadoClaves, actualClaves);
    }

    private static async Task SembrarAsync(SmsDbContext db, VectorEntrada e, CancellationToken ct)
    {
        var tipoMovimientoId = Guid.Parse(e.TipoMovimientoId ?? e.Boleta!.TipoMovimientoId);

        db.Add(new TipoMovimiento
        {
            Id = tipoMovimientoId,
            Codigo = $"TMP{tipoMovimientoId:N}"[..12],
            Nombre = "Paridad motor",
            Prefijo = "REC",
            Direccion = DireccionMovimiento.Entrada,
            Activo = true,
        });

        foreach (var s in e.Secciones ?? new List<VectorSeccion>())
        {
            db.Secciones.Add(new Seccion
            {
                Id = Guid.Parse(s.Id),
                Clave = s.Clave,
                Nombre = s.Nombre ?? s.Clave,
                Cardinalidad = Enum.Parse<Cardinalidad>(s.Cardinalidad),
                Reportable = false,
                Estandar = false,
                Orden = s.Orden ?? 1,
                Activa = s.Activa ?? true,
            });
        }

        foreach (var c in e.Campos ?? new List<VectorCampo>())
        {
            db.Campos.Add(new Campo
            {
                Id = Guid.Parse(c.Id),
                SeccionId = Guid.Parse(c.SeccionId),
                Clave = c.Clave,
                Etiqueta = c.Etiqueta ?? c.Clave,
                TipoCampo = Enum.Parse<TipoCampo>(c.TipoCampo),
                TipoCatalogoRef = c.TipoCatalogoRef is null
                    ? null
                    : Enum.Parse<TipoCatalogo>(c.TipoCatalogoRef),
                Requerido = c.Requerido ?? false,
                Configuracion = c.Configuracion,
                Orden = c.Orden ?? 1,
                VigenteDesde = Instante(c.VigenteDesde),
                VigenteHasta = c.VigenteHasta is null ? null : Instante(c.VigenteHasta),
            });
        }

        foreach (var a in e.Asignaciones ?? new List<VectorAsignacion>())
        {
            db.TipoMovimientoSecciones.Add(new TipoMovimientoSeccion
            {
                TipoMovimientoId = Guid.Parse(a.TipoMovimientoId),
                SeccionId = Guid.Parse(a.SeccionId),
                VigenteDesde = Instante(a.VigenteDesde),
                VigenteHasta = a.VigenteHasta is null ? null : Instante(a.VigenteHasta),
                Requerida = a.Requerida ?? false,
                Orden = a.Orden ?? 1,
            });
        }

        foreach (var m in e.Maestros ?? new List<VectorMaestro>())
        {
            db.Maestros.Add(new Maestro
            {
                Id = Guid.Parse(m.Id),
                TipoCatalogo = Enum.Parse<TipoCatalogo>(m.TipoCatalogo),
                Codigo = m.Codigo ?? $"M-{m.Id[..8]}",
                Nombre = m.Nombre ?? "Maestro paridad",
                Estado = EstadoMaestro.Oficial,
                Activo = m.Activo ?? true,
            });
        }

        if (e.Boleta is { } boleta)
        {
            var centroId = Guid.NewGuid();
            var basculaId = Guid.NewGuid();

            db.Maestros.Add(new Maestro
            {
                Id = centroId,
                TipoCatalogo = TipoCatalogo.Centro,
                Codigo = $"CEN{centroId:N}"[..12],
                Nombre = "Centro paridad",
                Estado = EstadoMaestro.Oficial,
                Activo = true,
            });

            db.Add(new Bascula
            {
                Id = basculaId,
                Codigo = $"BP{basculaId:N}"[..12],
                Nombre = "Bascula paridad",
                CentroId = centroId,
                TipoConexion = TipoConexion.Serial,
                Activa = true,
            });

            db.Boletas.Add(new Boleta
            {
                Id = Guid.Parse(boleta.Id),
                NumeroBoleta = $"PARIDAD-{boleta.Id[..8]}",
                BasculaId = basculaId,
                TipoMovimientoId = Guid.Parse(boleta.TipoMovimientoId),
                Estado = EstadoBoleta.EnTransito,
                EstadoSync = EstadoSyncBoleta.Local,
                PesoIngreso = 1000m,
                OrigenPesoIngreso = OrigenPeso.Bascula,
                FechaHoraIngreso = Instante(boleta.FechaHoraIngreso),
                UsuarioIngreso = "paridad",
            });

            foreach (var f in e.Filas ?? new List<VectorFila>())
            {
                db.BoletaValores.Add(new BoletaValorCampo
                {
                    BoletaId = Guid.Parse(boleta.Id),
                    CampoId = Guid.Parse(f.CampoId),
                    Ocurrencia = f.Ocurrencia,
                    SeccionId = Guid.Parse(f.SeccionId),
                    ValorTexto = f.ValorTexto,
                    ValorNumero = f.ValorNumero,
                    ValorFecha = f.ValorFecha is null ? null : Instante(f.ValorFecha),
                    ValorBooleano = f.ValorBooleano,
                    ValorMaestroId = f.ValorMaestroId is null ? null : Guid.Parse(f.ValorMaestroId),
                });
            }
        }

        await db.SaveChangesAsync(ct);
    }

    private static ValorCampoDto ADto(VectorValor v) => new(
        Guid.Parse(v.CampoId),
        v.Ocurrencia,
        v.ValorTexto,
        v.ValorNumero,
        v.ValorFecha is null ? null : Instante(v.ValorFecha),
        v.ValorBooleano,
        v.ValorMaestroId is null ? null : Guid.Parse(v.ValorMaestroId));

    private static DateTime Instante(string iso) => DateTime.Parse(
        iso,
        CultureInfo.InvariantCulture,
        DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal);
}

// ---------------------------------------------------------------------------
// Modelo de los vectores compartidos (tests/parity/motor-campos/*.json).
// ---------------------------------------------------------------------------

public sealed record ParityVector(string Nombre, string Fn, VectorEntrada Entrada, VectorEsperado Esperado)
{
    private static readonly JsonSerializerOptions Opciones = new() { PropertyNameCaseInsensitive = true };

    private static readonly Lazy<IReadOnlyDictionary<string, ParityVector>> Cache = new(() =>
    {
        var dir = Path.Combine(AppContext.BaseDirectory, "parity", "motor-campos");
        return Directory.EnumerateFiles(dir, "*.json")
            .Select(archivo => JsonSerializer.Deserialize<ParityVector>(File.ReadAllText(archivo), Opciones)
                               ?? throw new InvalidOperationException($"vector nulo: {archivo}"))
            .ToDictionary(v => v.Nombre);
    });

    public static IEnumerable<ParityVector> CargarTodos() =>
        Cache.Value.Values.OrderBy(v => v.Nombre, StringComparer.Ordinal);

    public static ParityVector Por(string nombre) => Cache.Value[nombre];
}

public sealed record VectorEntrada(
    string? TipoMovimientoId,
    string? AsOf,
    List<VectorSeccion>? Secciones,
    List<VectorCampo>? Campos,
    List<VectorAsignacion>? Asignaciones,
    List<VectorMaestro>? Maestros,
    List<VectorValor>? Valores,
    List<VectorFila>? Filas,
    VectorBoleta? Boleta);

public sealed record VectorEsperado(List<AplicableEsperado>? Aplicables, List<ErrorEsperado>? Errores);

public sealed record AplicableEsperado(
    string CampoId,
    string SeccionClave,
    string CampoClave,
    bool SeccionRequerida,
    string Cardinalidad);

public sealed record ErrorEsperado(string SeccionClave, string CampoClave, int Ocurrencia);

public sealed record VectorSeccion(
    string Id, string Clave, string? Nombre, string Cardinalidad, bool? Activa, int? Orden);

public sealed record VectorCampo(
    string Id, string SeccionId, string Clave, string? Etiqueta, string TipoCampo, string? TipoCatalogoRef,
    bool? Requerido, string? Configuracion, int? Orden, string VigenteDesde, string? VigenteHasta);

public sealed record VectorAsignacion(
    string TipoMovimientoId, string SeccionId, string VigenteDesde, string? VigenteHasta, bool? Requerida, int? Orden);

public sealed record VectorMaestro(string Id, string TipoCatalogo, string? Codigo, string? Nombre, bool? Activo);

public sealed record VectorValor(
    string CampoId, int Ocurrencia, string? ValorTexto, decimal? ValorNumero,
    string? ValorFecha, bool? ValorBooleano, string? ValorMaestroId);

public sealed record VectorFila(
    string CampoId, int Ocurrencia, string SeccionId, string? ValorTexto, decimal? ValorNumero,
    string? ValorFecha, bool? ValorBooleano, string? ValorMaestroId);

public sealed record VectorBoleta(string Id, string TipoMovimientoId, string FechaHoraIngreso);
