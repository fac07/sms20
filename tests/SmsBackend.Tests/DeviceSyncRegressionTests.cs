using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SmsBackend.Data;
using SmsBackend.Domain.Basculas;
using SmsBackend.Domain.Boletas.Valores;
using SmsBackend.Domain.Maestros;
using SmsBackend.Domain.TiposMovimiento;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Regresión de identidad de dispositivo/terminal (design D6, "Two gaps" —
/// PR3, el riesgo más serio de todo el cambio): <c>POST /api/basculas/{id}/ping</c>,
/// <c>POST /api/basculas/aprovisionar</c>, <c>POST /api/boletas/sync</c> y
/// <c>POST /api/maestros/sync</c> corren SIN <see cref="System.Security.Claims.ClaimsPrincipal"/>
/// humano — son identidad de terminal/báscula, no de un usuario logueado. El
/// <c>HasQueryFilter</c> de Centro que este PR activa (<c>SmsDbContext.cs</c>)
/// falla cerrado por default: sin claims, <c>Permitidos</c> está vacío y
/// <c>EsGlobal</c> es falso, así que CUALQUIER endpoint que no bypasee el
/// filtro explícitamente ve CERO FILAS para un caller anónimo — no un error,
/// no un 403, datos vacíos en silencio. Cada test de abajo limpia el header
/// <c>Authorization</c> a mano (<c>ApiFactory</c>, PR3, adjunta un token de
/// Administrador por default a todo cliente nuevo — ver su comentario de
/// clase) para reproducir la identidad real de estos 4 endpoints: NINGUNA.
/// </summary>
[Collection(ApiCollection.Name)]
[Trait("Category", "Seguridad")]
public sealed class DeviceSyncRegressionTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public DeviceSyncRegressionTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Ping_sin_autenticacion_humana_sigue_marcando_la_bascula()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);

        // Identidad real de este endpoint: NINGUNA — no un usuario logueado
        // con un rol insuficiente, sino la ausencia total de ClaimsPrincipal.
        _client.DefaultRequestHeaders.Authorization = null;

        var resp = await _client.PostAsync($"/api/basculas/{escenario.BasculaId}/ping", content: null);

        // Antes de 2.8 (.IgnoreQueryFilters()), el HasQueryFilter de Centro
        // (design D6) filtra la báscula a cero filas para un caller sin
        // claims -> el handler la trata como inexistente -> 404. Con la
        // báscula bien encontrada, el ping responde 204.
        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);

        using var scope = _factory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SmsDbContext>();
        var bascula = await db.Basculas.IgnoreQueryFilters().SingleAsync(b => b.Id == escenario.BasculaId);
        Assert.NotNull(bascula.UltimaConexion);
    }

    [Fact]
    public async Task Aprovisionar_sin_autenticacion_humana_resuelve_identidad_completa()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var codigoResp = await _client.PostAsync($"/api/basculas/{escenario.BasculaId}/generar-codigo", content: null);
        codigoResp.EnsureSuccessStatusCode();
        var codigo = await codigoResp.Content.ReadFromJsonAsync<CodigoAprovisionamientoDto>(TestData.Json);

        _client.DefaultRequestHeaders.Authorization = null;

        var resp = await _client.PostAsJsonAsync(
            "/api/basculas/aprovisionar", new AprovisionarBasculaRequest(codigo!.Codigo), TestData.Json);

        // Antes de 2.8, el lookup por CodigoAprovisionamiento queda filtrado a
        // cero filas para el caller anónimo -> 404 "Código inválido" aunque
        // el código sea perfectamente válido. Con el fix, 200 y la
        // configuración COMPLETA de la báscula (identidad + comm settings),
        // que es justo lo que Electron necesita en su primer arranque.
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var dto = await resp.Content.ReadFromJsonAsync<AprovisionamientoDto>(TestData.Json);
        Assert.NotNull(dto);
        Assert.Equal(escenario.BasculaId, dto!.BasculaId);
        Assert.Equal(escenario.CentroId, dto.CentroId);
    }

    [Fact]
    public async Task BoletasSync_sin_autenticacion_humana_crea_la_boleta_completa()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);

        _client.DefaultRequestHeaders.Authorization = null;

        var boletaId = Guid.NewGuid();
        var payload = TestData.SyncCrearPayload(
            boletaId, escenario, DateTime.UtcNow, Array.Empty<ValorCampoDto>());

        var (resp, body) = await TestData.SyncAsync(_client, payload);

        // Antes de 2.8: el lookup de Bascula por Codigo (outbox dispatcher
        // solo conoce el Codigo, no el Guid) queda filtrado a cero filas para
        // el caller anónimo -> 400 "No existe la báscula", rompiendo la
        // sincronización offline de Electron para TODA báscula, siempre.
        Assert.True(resp.IsSuccessStatusCode, $"POST /api/boletas/sync => {(int)resp.StatusCode}: {body}");

        using var scope = _factory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SmsDbContext>();
        var boleta = await db.Boletas.IgnoreQueryFilters().SingleOrDefaultAsync(b => b.Id == boletaId);
        Assert.NotNull(boleta);
        Assert.Equal(escenario.BasculaId, boleta!.BasculaId);
    }

    [Fact]
    public async Task MaestrosSync_sin_autenticacion_humana_crea_el_provisional()
    {
        // Nota: Maestro es un catálogo global (design D6, "Global catalogs")
        // y NO implementa ICentroScoped — a diferencia de ping/aprovisionar/
        // boletas-sync, este endpoint NUNCA estuvo realmente roto por el
        // filtro de Centro (nada lo filtra). El .IgnoreQueryFilters() de 2.8
        // acá es puramente defensivo/future-proofing por como el design D6 lo
        // agrupa explícitamente con los otros 3 — este test es un guardia de
        // regresión, no una demostración de un bug real de hoy.
        _client.DefaultRequestHeaders.Authorization = null;

        var s = TestData.Sufijo();
        var maestroId = Guid.NewGuid();
        var payload = TestData.SyncMaestroPayload(
            maestroId, "B-cualquiera", TipoCatalogo.Piloto, $"P-{s}", $"Piloto {s}");

        var (resp, body) = await TestData.SyncMaestroAsync(_client, payload);

        Assert.True(resp.IsSuccessStatusCode, $"POST /api/maestros/sync => {(int)resp.StatusCode}: {body}");
        var dto = System.Text.Json.JsonSerializer.Deserialize<MaestroDto>(body, TestData.Json);
        Assert.NotNull(dto);
        Assert.Equal(EstadoMaestro.Provisional, dto!.Estado);
    }
}
