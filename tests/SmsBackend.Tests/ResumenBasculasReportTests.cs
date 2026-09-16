using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SmsBackend.Data;
using SmsBackend.Domain.Boletas;
using SmsBackend.Domain.Reportes;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Resumen diario por báscula (<c>GET /api/reportes/resumen-basculas</c>) —
/// consolidado fecha+día de lo PESADO por báscula, espejo del criterio de
/// filtro del legacy (frmResumenDiarioBasculas.cs:237:
/// <c>Boleta.Fecha_Hora_Registro_Salida_Bascula</c>). Un "peso neto" recién
/// existe al cerrar, así que la ventana agrupa SOLO boletas <c>Cerrada</c>
/// por día UTC de <c>FechaHoraSalida</c>: Anulada (exclusión explícita de la
/// spec), EnTransito (sin neto todavía) y Reemitida (su neto ya fue
/// re-emplazado por otra boleta — contarlo duplicaría el pesaje) quedan
/// fuera. Los pivots de "reportes guardados" del legacy quedan fuera de esta
/// tarea por diseño.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class ResumenBasculasReportTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public ResumenBasculasReportTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    /// <summary>Corre una acción directo sobre el DbContext compartido por la API.</summary>
    private async Task ConScopeAsync(Func<SmsDbContext, Task> accion)
    {
        using var scope = _factory.CreateScope();
        await accion(scope.ServiceProvider.GetRequiredService<SmsDbContext>());
    }

    /// <summary>Boleta cerrada con salida reubicada a un día/hora UTC concretos.</summary>
    private async Task<Guid> BoletaCerradaEnAsync(
        Escenario escenario, DateTime salidaUtc, decimal neto)
    {
        var boleta = await TestData.CrearBoletaAsync(_client, escenario);
        (await TestData.CerrarAsync(_client, boleta.Id)).EnsureSuccessStatusCode();
        await ConScopeAsync(async db =>
        {
            // IgnoreQueryFilters (PR3): este scope no cuelga de un
            // HttpContext/ClaimsPrincipal (ver ConScopeAsync), así que el
            // HasQueryFilter de Centro de Boleta (design D6) lo filtraría a
            // cero filas — mismo motivo que ApiFactory.ResetAsync.
            var fila = await db.Boletas.IgnoreQueryFilters().SingleAsync(b => b.Id == boleta.Id);
            fila.FechaHoraSalida = salidaUtc;
            fila.PesoNeto = neto;
            await db.SaveChangesAsync();
        });
        return boleta.Id;
    }

    private async Task<List<ResumenBasculaDiaDto>> ConsultarAsync(string desde, string hasta)
    {
        var resp = await _client.GetAsync($"/api/reportes/resumen-basculas?desde={desde}&hasta={hasta}");
        resp.EnsureSuccessStatusCode();
        return (await resp.Content.ReadFromJsonAsync<List<ResumenBasculaDiaDto>>(TestData.Json))!;
    }

    [Fact]
    public async Task Agrupa_por_bascula_y_dia_de_cierre_sumando_netos_y_contando_boletas()
    {
        var a = await TestData.NuevoEscenarioAsync(_client);
        var b = await TestData.NuevoEscenarioAsync(_client);

        await BoletaCerradaEnAsync(a, new DateTime(2026, 9, 10, 8, 0, 0, DateTimeKind.Utc), 500m);
        await BoletaCerradaEnAsync(a, new DateTime(2026, 9, 10, 23, 59, 59, DateTimeKind.Utc), 300m);
        await BoletaCerradaEnAsync(a, new DateTime(2026, 9, 11, 2, 0, 0, DateTimeKind.Utc), 100m);
        await BoletaCerradaEnAsync(b, new DateTime(2026, 9, 10, 12, 0, 0, DateTimeKind.Utc), 900m);

        var filas = await ConsultarAsync("2026-09-10", "2026-09-11");

        var b10 = Assert.Single(filas.Where(f => f.Fecha == new DateOnly(2026, 9, 10) && f.BasculaId == a.BasculaId));
        Assert.Equal(2, b10.CantidadBoletas);
        Assert.Equal(800m, b10.PesoNetoTotal);
        Assert.False(string.IsNullOrWhiteSpace(b10.BasculaNombre));

        var a11 = Assert.Single(filas.Where(f => f.Fecha == new DateOnly(2026, 9, 11) && f.BasculaId == a.BasculaId));
        Assert.Equal(1, a11.CantidadBoletas);
        Assert.Equal(100m, a11.PesoNetoTotal);

        var b1 = Assert.Single(filas.Where(f => f.BasculaId == b.BasculaId));
        Assert.Equal(900m, b1.PesoNetoTotal);
    }

    [Fact]
    public async Task La_ventana_incluye_ambos_extremos_y_excluye_dias_vecinos()
    {
        var e = await TestData.NuevoEscenarioAsync(_client);
        await BoletaCerradaEnAsync(e, new DateTime(2026, 9, 9, 15, 0, 0, DateTimeKind.Utc), 10m);
        await BoletaCerradaEnAsync(e, new DateTime(2026, 9, 10, 0, 0, 0, DateTimeKind.Utc), 20m);
        await BoletaCerradaEnAsync(e, new DateTime(2026, 9, 11, 23, 59, 59, DateTimeKind.Utc), 30m);
        await BoletaCerradaEnAsync(e, new DateTime(2026, 9, 12, 0, 0, 0, DateTimeKind.Utc), 40m);

        var filas = await ConsultarAsync("2026-09-10", "2026-09-11");

        Assert.Equal(new decimal[] { 20m, 30m }, filas.Select(f => f.PesoNetoTotal).OrderBy(x => x).ToArray());
    }

    [Fact]
    public async Task Excluye_Anuladas_EnTransito_y_Reemitidas()
    {
        var e = await TestData.NuevoEscenarioAsync(_client);
        var dia = new DateTime(2026, 9, 10, 10, 0, 0, DateTimeKind.Utc);

        var valida = await BoletaCerradaEnAsync(e, dia, 111m);

        // EnTransito: creada pero nunca cerrada.
        await TestData.CrearBoletaAsync(_client, e);

        // Anulada: cerrada y luego anulada.
        var anulada = await TestData.CrearBoletaAsync(_client, e);
        (await TestData.CerrarAsync(_client, anulada.Id)).EnsureSuccessStatusCode();
        await ConScopeAsync(async db =>
        {
            // IgnoreQueryFilters (PR3): ConScopeAsync no cuelga de un
            // HttpContext — ver comentario de ApiFactory.ResetAsync.
            var fila = await db.Boletas.IgnoreQueryFilters().SingleAsync(b => b.Id == anulada.Id);
            fila.FechaHoraSalida = dia;
            fila.PesoNeto = 222m;
            await db.SaveChangesAsync();
        });
        (await _client.PostAsJsonAsync(
            $"/api/boletas/{anulada.Id}/anular",
            new SmsBackend.Domain.Boletas.AnularBoletaRequest("g", "s", "prueba"),
            TestData.Json)).EnsureSuccessStatusCode();

        // Reemitida: cerrada, anulada y re-emitida (el original conserva
        // salida+neto del cierre previo; la nueva está EnTransito).
        var reemitidaId = await BoletaCerradaEnAsync(e, dia, 333m);
        (await _client.PostAsJsonAsync(
            $"/api/boletas/{reemitidaId}/anular",
            new SmsBackend.Domain.Boletas.AnularBoletaRequest("g", "s", "prueba"),
            TestData.Json)).EnsureSuccessStatusCode();
        var respRe = await _client.PostAsync($"/api/boletas/{reemitidaId}/reemitir",
            new StringContent(System.Text.Json.JsonSerializer.Serialize(new
            {
                numeroBoleta = TestData.NumeroBoleta(),
                pesoIngreso = 900,
                origenPesoIngreso = "Bascula",
                usuarioIngreso = "tester",
            }, TestData.Json), System.Text.Encoding.UTF8, "application/json"));
        respRe.EnsureSuccessStatusCode();

        var filas = await ConsultarAsync("2026-09-10", "2026-09-10");

        var fila = Assert.Single(filas);
        Assert.Equal(e.BasculaId, fila.BasculaId);
        Assert.Equal(1, fila.CantidadBoletas);
        Assert.Equal(111m, fila.PesoNetoTotal);
        Assert.NotNull(valida);
    }

    [Fact]
    public async Task Bascula_sin_boletas_en_el_periodo_no_aparece()
    {
        var conDatos = await TestData.NuevoEscenarioAsync(_client);
        var vacia = await TestData.NuevoEscenarioAsync(_client);
        await BoletaCerradaEnAsync(conDatos, new DateTime(2026, 9, 10, 9, 0, 0, DateTimeKind.Utc), 50m);

        var filas = await ConsultarAsync("2026-09-01", "2026-09-30");

        Assert.All(filas, f => Assert.NotEqual(vacia.BasculaId, f.BasculaId));
        Assert.Contains(filas, f => f.BasculaId == conDatos.BasculaId);
    }

    [Fact]
    public async Task Rango_invertido_es_400_y_parametros_invalidos_no_rompen()
    {
        var invertido = await _client.GetAsync("/api/reportes/resumen-basculas?desde=2026-09-11&hasta=2026-09-10");
        Assert.Equal(HttpStatusCode.BadRequest, invertido.StatusCode);

        var feo = await _client.GetAsync("/api/reportes/resumen-basculas?desde=ayer&hasta=hoy");
        Assert.True(feo.StatusCode is HttpStatusCode.BadRequest, $"esperaba 400, llegó {(int)feo.StatusCode}");
    }

    [Fact]
    public async Task Orden_estable_por_nombre_de_bascula_y_fecha()
    {
        var z = await TestData.NuevoEscenarioAsync(_client);
        var a = await TestData.NuevoEscenarioAsync(_client);
        await ConScopeAsync(async db =>
        {
            // IgnoreQueryFilters (PR3): ConScopeAsync no cuelga de un
            // HttpContext — ver comentario de ApiFactory.ResetAsync.
            var basZ = await db.Basculas.IgnoreQueryFilters().SingleAsync(x => x.Id == z.BasculaId);
            var basA = await db.Basculas.IgnoreQueryFilters().SingleAsync(x => x.Id == a.BasculaId);
            basA.Nombre = "AAAA";
            basZ.Nombre = "ZZZZ";
            await db.SaveChangesAsync();
        });

        await BoletaCerradaEnAsync(z, new DateTime(2026, 9, 11, 9, 0, 0, DateTimeKind.Utc), 1m);
        await BoletaCerradaEnAsync(z, new DateTime(2026, 9, 10, 9, 0, 0, DateTimeKind.Utc), 1m);
        await BoletaCerradaEnAsync(a, new DateTime(2026, 9, 10, 9, 0, 0, DateTimeKind.Utc), 1m);

        var filas = await ConsultarAsync("2026-09-10", "2026-09-11");

        Assert.Equal(3, filas.Count);
        Assert.Equal(
            new[] { a.BasculaId, z.BasculaId, z.BasculaId },
            filas.Select(f => f.BasculaId).ToArray());
        Assert.Equal(new DateOnly(2026, 9, 10), filas[0].Fecha);
    }
}
