using System.Net;
using System.Net.Http.Json;
using SmsBackend.Domain.Basculas;
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
}
