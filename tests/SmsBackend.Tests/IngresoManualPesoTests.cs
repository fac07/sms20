using System.Net;
using System.Net.Http.Json;
using SmsBackend.Domain.Basculas;
using SmsBackend.Domain.Boletas;
using SmsBackend.Domain.Boletas.Valores;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Slice S1a — configuración central de ingreso manual de peso. El toggle por
/// báscula (<c>PUT /api/basculas/{id}/ingreso-manual</c>) fija/limpia el flag y
/// las cotas en kg, rechaza un rango invertido con 400, y las 3 columnas nuevas
/// viajan en <see cref="BasculaDto"/>. La validación de motivo/rango en la
/// boleta es de una fase posterior.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class IngresoManualPesoTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public IngresoManualPesoTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<BasculaDto> GetBasculaAsync(Guid id) =>
        (await _client.GetFromJsonAsync<BasculaDto>($"/api/basculas/{id}", TestData.Json))!;

    private Task<HttpResponseMessage> ConfigurarAsync(
        Guid id, bool permite, decimal? min, decimal? max) =>
        _client.PutAsJsonAsync(
            $"/api/basculas/{id}/ingreso-manual",
            new ConfigurarIngresoManualRequest(permite, min, max),
            TestData.Json);

    [Fact]
    public async Task Bascula_nueva_tiene_ingreso_manual_deshabilitado_por_default()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);

        var bascula = await GetBasculaAsync(escenario.BasculaId);

        Assert.False(bascula.PermiteIngresoManual);
        Assert.Null(bascula.PesoMinimoManual);
        Assert.Null(bascula.PesoMaximoManual);
    }

    [Fact]
    public async Task Admin_habilita_una_bascula_sin_afectar_a_las_demas()
    {
        var a = await TestData.NuevoEscenarioAsync(_client);
        var b = await TestData.NuevoEscenarioAsync(_client);

        var resp = await ConfigurarAsync(a.BasculaId, permite: true, min: 100m, max: 45000m);
        resp.EnsureSuccessStatusCode();

        var basculaA = await GetBasculaAsync(a.BasculaId);
        Assert.True(basculaA.PermiteIngresoManual);
        Assert.Equal(100m, basculaA.PesoMinimoManual);
        Assert.Equal(45000m, basculaA.PesoMaximoManual);

        var basculaB = await GetBasculaAsync(b.BasculaId);
        Assert.False(basculaB.PermiteIngresoManual);
        Assert.Null(basculaB.PesoMinimoManual);
        Assert.Null(basculaB.PesoMaximoManual);
    }

    [Fact]
    public async Task Toggle_puede_limpiar_el_flag_y_las_cotas()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);

        (await ConfigurarAsync(escenario.BasculaId, permite: true, min: 50m, max: 900m))
            .EnsureSuccessStatusCode();
        (await ConfigurarAsync(escenario.BasculaId, permite: false, min: null, max: null))
            .EnsureSuccessStatusCode();

        var bascula = await GetBasculaAsync(escenario.BasculaId);
        Assert.False(bascula.PermiteIngresoManual);
        Assert.Null(bascula.PesoMinimoManual);
        Assert.Null(bascula.PesoMaximoManual);
    }

    [Fact]
    public async Task Rango_invertido_devuelve_400_y_no_persiste()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);

        var resp = await ConfigurarAsync(escenario.BasculaId, permite: true, min: 1000m, max: 100m);

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);

        var bascula = await GetBasculaAsync(escenario.BasculaId);
        Assert.False(bascula.PermiteIngresoManual);
        Assert.Null(bascula.PesoMinimoManual);
        Assert.Null(bascula.PesoMaximoManual);
    }

    [Fact]
    public async Task Una_sola_cota_definida_es_valida()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);

        (await ConfigurarAsync(escenario.BasculaId, permite: true, min: null, max: 30000m))
            .EnsureSuccessStatusCode();

        var bascula = await GetBasculaAsync(escenario.BasculaId);
        Assert.True(bascula.PermiteIngresoManual);
        Assert.Null(bascula.PesoMinimoManual);
        Assert.Equal(30000m, bascula.PesoMaximoManual);
    }

    [Fact]
    public async Task Toggle_sobre_bascula_inexistente_devuelve_404()
    {
        var resp = await ConfigurarAsync(Guid.NewGuid(), permite: true, min: null, max: null);

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task BasculaDto_expone_los_campos_nuevos_en_el_listado()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        (await ConfigurarAsync(escenario.BasculaId, permite: true, min: 10m, max: 20m))
            .EnsureSuccessStatusCode();

        var listado = await _client.GetFromJsonAsync<List<BasculaDto>>("/api/basculas", TestData.Json);

        var bascula = Assert.Single(listado!, b => b.Id == escenario.BasculaId);
        Assert.True(bascula.PermiteIngresoManual);
        Assert.Equal(10m, bascula.PesoMinimoManual);
        Assert.Equal(20m, bascula.PesoMaximoManual);
    }

    // ---- Slice S1b — validación central de motivo/rango en la boleta ----

    private const string Motivo = nameof(MotivoPesoManual.CorteEnergia);

    private async Task<Escenario> EscenarioManualAsync(decimal? min = null, decimal? max = null)
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        (await TestData.HabilitarIngresoManualAsync(_client, escenario.BasculaId, min, max))
            .EnsureSuccessStatusCode();
        return escenario;
    }

    private Task<List<BoletaDto>?> ListarAsync(string query = "") =>
        _client.GetFromJsonAsync<List<BoletaDto>>($"/api/boletas{query}", TestData.Json);

    [Fact]
    public async Task Creacion_manual_sin_motivo_devuelve_422_y_no_persiste()
    {
        var escenario = await EscenarioManualAsync();

        var (resp, _) = await TestData.CrearBoletaRawAsync(
            _client, escenario, origenPesoIngreso: OrigenPeso.Manual, motivoPesoManual: null);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, resp.StatusCode);
        Assert.Empty((await ListarAsync("?origenPeso=Manual"))!);
    }

    [Fact]
    public async Task Cierre_manual_sin_motivo_devuelve_422()
    {
        var escenario = await EscenarioManualAsync();
        var boleta = await TestData.CrearBoletaAsync(_client, escenario);

        var resp = await TestData.CerrarAsync(
            _client, boleta.Id, pesoSalida: 800m, origen: OrigenPeso.Manual, motivoPesoManual: null);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, resp.StatusCode);
    }

    [Fact]
    public async Task Creacion_manual_con_motivo_fuera_de_catalogo_devuelve_422()
    {
        var escenario = await EscenarioManualAsync();

        var (resp, _) = await TestData.CrearBoletaRawAsync(
            _client, escenario, origenPesoIngreso: OrigenPeso.Manual, motivoPesoManual: "PorqueSi");

        Assert.Equal(HttpStatusCode.UnprocessableEntity, resp.StatusCode);
    }

    [Fact]
    public async Task Creacion_manual_con_flag_deshabilitado_devuelve_422()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);

        var (resp, _) = await TestData.CrearBoletaRawAsync(
            _client, escenario, origenPesoIngreso: OrigenPeso.Manual, motivoPesoManual: Motivo);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, resp.StatusCode);
    }

    [Fact]
    public async Task Motivo_otro_sin_detalle_devuelve_422()
    {
        var escenario = await EscenarioManualAsync();

        var (resp, _) = await TestData.CrearBoletaRawAsync(
            _client, escenario, origenPesoIngreso: OrigenPeso.Manual,
            motivoPesoManual: nameof(MotivoPesoManual.Otro), motivoPesoManualDetalle: null);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, resp.StatusCode);
    }

    [Fact]
    public async Task Sync_crear_manual_sin_motivo_devuelve_422_no_500()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);

        var (resp, body) = await TestData.SyncAsync(
            _client,
            TestData.SyncCrearPayload(
                Guid.NewGuid(), escenario, DateTime.UtcNow, Array.Empty<ValorCampoDto>(),
                OrigenPeso.Manual, motivoPesoManual: null));

        Assert.Equal(HttpStatusCode.UnprocessableEntity, resp.StatusCode);
        Assert.DoesNotContain("500", body);
    }

    [Fact]
    public async Task Sync_crear_manual_con_motivo_fuera_de_catalogo_devuelve_422_no_500()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);

        var (resp, _) = await TestData.SyncAsync(
            _client,
            TestData.SyncCrearPayload(
                Guid.NewGuid(), escenario, DateTime.UtcNow, Array.Empty<ValorCampoDto>(),
                OrigenPeso.Manual, motivoPesoManual: "no-existe"));

        Assert.Equal(HttpStatusCode.UnprocessableEntity, resp.StatusCode);
    }

    [Fact]
    public async Task Peso_manual_bajo_la_cota_inferior_devuelve_422()
    {
        var escenario = await EscenarioManualAsync(min: 500m, max: 40000m);

        var (resp, _) = await TestData.CrearBoletaRawAsync(
            _client, escenario, origenPesoIngreso: OrigenPeso.Manual,
            pesoIngreso: 100m, motivoPesoManual: Motivo);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, resp.StatusCode);
    }

    [Fact]
    public async Task Peso_manual_sobre_la_cota_superior_devuelve_422()
    {
        var escenario = await EscenarioManualAsync(min: 500m, max: 2000m);

        var (resp, _) = await TestData.CrearBoletaRawAsync(
            _client, escenario, origenPesoIngreso: OrigenPeso.Manual,
            pesoIngreso: 5000m, motivoPesoManual: Motivo);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, resp.StatusCode);
    }

    [Fact]
    public async Task Peso_manual_sin_cotas_no_positivo_devuelve_422()
    {
        var escenario = await EscenarioManualAsync();

        var (resp, _) = await TestData.CrearBoletaRawAsync(
            _client, escenario, origenPesoIngreso: OrigenPeso.Manual,
            pesoIngreso: 0m, motivoPesoManual: Motivo);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, resp.StatusCode);
    }

    [Fact]
    public async Task Peso_manual_en_rango_se_acepta()
    {
        var escenario = await EscenarioManualAsync(min: 500m, max: 2000m);

        var boleta = await TestData.CrearBoletaAsync(
            _client, escenario, origenPesoIngreso: OrigenPeso.Manual,
            pesoIngreso: 1500m, motivoPesoManual: Motivo);

        Assert.Equal(OrigenPeso.Manual, boleta.OrigenPesoIngreso);
        Assert.Equal(MotivoPesoManual.CorteEnergia, boleta.MotivoPesoManual);
    }

    [Fact]
    public async Task Sync_ingesta_no_revalida_el_rango()
    {
        // Cotas estrechas en central, pero un evento offline con peso fuera de
        // rango debe entrar igual — el rango es guardia de input, no invariante
        // (design D8).
        var escenario = await EscenarioManualAsync(min: 500m, max: 800m);
        var id = Guid.NewGuid();

        var (resp, body) = await TestData.SyncAsync(
            _client,
            TestData.SyncCrearPayload(
                id, escenario, DateTime.UtcNow, Array.Empty<ValorCampoDto>(),
                OrigenPeso.Manual, pesoIngreso: 5000m,
                motivoPesoManual: nameof(MotivoPesoManual.IndicadorSinSenal)));

        Assert.True(resp.IsSuccessStatusCode, body);
        var recargada = await TestData.GetBoletaAsync(_client, id);
        Assert.Equal(5000m, recargada.PesoIngreso);
        Assert.Equal(MotivoPesoManual.IndicadorSinSenal, recargada.MotivoPesoManual);
    }

    [Fact]
    public async Task Filtro_origenPeso_Manual_devuelve_solo_manuales()
    {
        var escenario = await EscenarioManualAsync();
        var manual = await TestData.CrearBoletaAsync(
            _client, escenario, origenPesoIngreso: OrigenPeso.Manual, motivoPesoManual: Motivo);
        var automatica = await TestData.CrearBoletaAsync(_client, escenario);

        var soloManuales = (await ListarAsync("?origenPeso=Manual"))!;

        Assert.Contains(soloManuales, b => b.Id == manual.Id);
        Assert.DoesNotContain(soloManuales, b => b.Id == automatica.Id);
    }

    [Fact]
    public async Task Filtro_origenPeso_omitido_no_cambia_el_resultado()
    {
        var escenario = await EscenarioManualAsync();
        var manual = await TestData.CrearBoletaAsync(
            _client, escenario, origenPesoIngreso: OrigenPeso.Manual, motivoPesoManual: Motivo);
        var automatica = await TestData.CrearBoletaAsync(_client, escenario);

        var todo = (await ListarAsync())!;

        Assert.Contains(todo, b => b.Id == manual.Id);
        Assert.Contains(todo, b => b.Id == automatica.Id);
    }

    [Fact]
    public async Task Filtro_origenPeso_malformado_devuelve_400()
    {
        var resp = await _client.GetAsync("/api/boletas?origenPeso=xyz");

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Manual_hace_round_trip_de_motivo_y_detalle_por_creacion_tipada()
    {
        var escenario = await EscenarioManualAsync();

        var boleta = await TestData.CrearBoletaAsync(
            _client, escenario, origenPesoIngreso: OrigenPeso.Manual,
            motivoPesoManual: nameof(MotivoPesoManual.Otro), motivoPesoManualDetalle: "balanza en mantenimiento");

        var recargada = await TestData.GetBoletaAsync(_client, boleta.Id);
        Assert.Equal(MotivoPesoManual.Otro, recargada.MotivoPesoManual);
        Assert.Equal("balanza en mantenimiento", recargada.MotivoPesoManualDetalle);
    }

    [Fact]
    public async Task Manual_hace_round_trip_de_motivo_por_sync()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var id = Guid.NewGuid();

        var (resp, body) = await TestData.SyncAsync(
            _client,
            TestData.SyncCrearPayload(
                id, escenario, DateTime.UtcNow, Array.Empty<ValorCampoDto>(),
                OrigenPeso.Manual, motivoPesoManual: Motivo));
        Assert.True(resp.IsSuccessStatusCode, body);

        var recargada = await TestData.GetBoletaAsync(_client, id);
        Assert.Equal(MotivoPesoManual.CorteEnergia, recargada.MotivoPesoManual);
    }

    [Fact]
    public async Task Boleta_de_bascula_mantiene_motivo_null_y_se_proyecta()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);

        var boleta = await TestData.CrearBoletaAsync(_client, escenario);

        var recargada = await TestData.GetBoletaAsync(_client, boleta.Id);
        Assert.Null(recargada.MotivoPesoManual);
        Assert.Null(recargada.MotivoPesoManualDetalle);
    }
}
