using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using SmsBackend.Data;
using SmsBackend.Domain.Maestros;
using SmsBackend.Domain.Transporte;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Slice B1a (design D1, PR3) — CRUD central del vínculo piloto↔transportista.
/// Cubre el alta contra un par de Maestro pre-existentes, el rechazo 409 de un
/// par duplicado (esté activo o no, sin importar el orden de desactivación),
/// la desactivación como soft-delete (nunca se borra la fila), la
/// reactivación explícita de un par previamente desactivado sin duplicar
/// fila, y la semántica de delta (?transportistaId=&amp;modificadoDesde=):
/// estrictamente mayor al watermark y SIEMPRE incluye inactivos (design D3,
/// mismo criterio que MaestroEndpoints/PreIngresoEndpoints).
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class VinculoPilotoTransportistaEndpointsTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public VinculoPilotoTransportistaEndpointsTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private static string Iso(DateTime utc) =>
        Uri.EscapeDataString(utc.ToString("yyyy-MM-ddTHH:mm:ss.fffffff") + "Z");

    private async Task<Guid> CrearMaestroAsync(TipoCatalogo tipo)
    {
        var s = TestData.Sufijo();
        var dto = await TestData.PostAsync<MaestroDto>(_client, "/api/maestros",
            new GuardarMaestroRequest(tipo, $"{tipo}-{s}", $"{tipo} {s}", null));
        return dto.Id;
    }

    private Task<VinculoPilotoTransportistaDto> CrearVinculoAsync(Guid pilotoId, Guid transportistaId) =>
        TestData.PostAsync<VinculoPilotoTransportistaDto>(_client, "/api/vinculos-piloto-transportista",
            new CrearVinculoPilotoTransportistaRequest(pilotoId, transportistaId, "admin"));

    private async Task<HttpResponseMessage> CrearVinculoRawAsync(Guid pilotoId, Guid transportistaId) =>
        await _client.PostAsJsonAsync("/api/vinculos-piloto-transportista",
            new CrearVinculoPilotoTransportistaRequest(pilotoId, transportistaId, "admin"), TestData.Json);

    private Task<List<VinculoPilotoTransportistaDto>?> ListarAsync(string query = "") =>
        _client.GetFromJsonAsync<List<VinculoPilotoTransportistaDto>>(
            $"/api/vinculos-piloto-transportista{query}", TestData.Json);

    private async Task<VinculoPilotoTransportistaDto> GetAsync(Guid id) =>
        (await _client.GetFromJsonAsync<VinculoPilotoTransportistaDto>(
            $"/api/vinculos-piloto-transportista/{id}", TestData.Json))!;

    [Fact]
    public async Task Alta_persiste_activo_y_sella_fechas()
    {
        var pilotoId = await CrearMaestroAsync(TipoCatalogo.Piloto);
        var transportistaId = await CrearMaestroAsync(TipoCatalogo.Transportista);

        var dto = await CrearVinculoAsync(pilotoId, transportistaId);

        Assert.Equal(pilotoId, dto.PilotoId);
        Assert.Equal(transportistaId, dto.TransportistaId);
        Assert.True(dto.Activo);
        Assert.Equal("admin", dto.UsuarioCreacion);
        Assert.NotEqual(default, dto.FechaCreacion);
        Assert.NotEqual(default, dto.FechaModificacion);
    }

    [Fact]
    public async Task Alta_sin_PilotoId_devuelve_400_y_no_persiste()
    {
        var transportistaId = await CrearMaestroAsync(TipoCatalogo.Transportista);

        var resp = await CrearVinculoRawAsync(Guid.Empty, transportistaId);

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        Assert.Empty((await ListarAsync())!);
    }

    [Fact]
    public async Task Alta_de_par_duplicado_activo_devuelve_409_y_no_crea_fila_nueva()
    {
        var pilotoId = await CrearMaestroAsync(TipoCatalogo.Piloto);
        var transportistaId = await CrearMaestroAsync(TipoCatalogo.Transportista);
        await CrearVinculoAsync(pilotoId, transportistaId);

        var resp = await CrearVinculoRawAsync(pilotoId, transportistaId);

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
        var todos = (await ListarAsync())!;
        Assert.Single(todos, v => v.PilotoId == pilotoId && v.TransportistaId == transportistaId);
    }

    [Fact]
    public async Task Alta_de_par_duplicado_inactivo_tambien_devuelve_409()
    {
        var pilotoId = await CrearMaestroAsync(TipoCatalogo.Piloto);
        var transportistaId = await CrearMaestroAsync(TipoCatalogo.Transportista);
        var original = await CrearVinculoAsync(pilotoId, transportistaId);
        await _client.PostAsync($"/api/vinculos-piloto-transportista/{original.Id}/desactivar", null);

        var resp = await CrearVinculoRawAsync(pilotoId, transportistaId);

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
        var recargado = await GetAsync(original.Id);
        Assert.False(recargado.Activo);
    }

    [Fact]
    public async Task Desactivar_mantiene_la_fila_con_Activo_false()
    {
        var pilotoId = await CrearMaestroAsync(TipoCatalogo.Piloto);
        var transportistaId = await CrearMaestroAsync(TipoCatalogo.Transportista);
        var dto = await CrearVinculoAsync(pilotoId, transportistaId);

        var resp = await _client.PostAsync($"/api/vinculos-piloto-transportista/{dto.Id}/desactivar", null);
        Assert.True(resp.IsSuccessStatusCode, await resp.Content.ReadAsStringAsync());

        var recargado = await GetAsync(dto.Id);
        Assert.False(recargado.Activo);
        // La fila sigue existiendo — nunca se borra en duro.
        var todos = (await ListarAsync("?modificadoDesde=" + Iso(dto.FechaCreacion.AddSeconds(-1))))!;
        Assert.Contains(todos, v => v.Id == dto.Id);
    }

    [Fact]
    public async Task Reactivar_un_par_desactivado_pone_Activo_true_sin_duplicar_fila()
    {
        var pilotoId = await CrearMaestroAsync(TipoCatalogo.Piloto);
        var transportistaId = await CrearMaestroAsync(TipoCatalogo.Transportista);
        var dto = await CrearVinculoAsync(pilotoId, transportistaId);
        await _client.PostAsync($"/api/vinculos-piloto-transportista/{dto.Id}/desactivar", null);

        var resp = await _client.PostAsync($"/api/vinculos-piloto-transportista/{dto.Id}/reactivar", null);
        Assert.True(resp.IsSuccessStatusCode, await resp.Content.ReadAsStringAsync());

        var recargado = await GetAsync(dto.Id);
        Assert.True(recargado.Activo);
        var todos = (await ListarAsync())!;
        Assert.Single(todos, v => v.PilotoId == pilotoId && v.TransportistaId == transportistaId);
    }

    [Fact]
    public async Task Reactivar_inexistente_devuelve_404()
    {
        var resp = await _client.PostAsync($"/api/vinculos-piloto-transportista/{Guid.NewGuid()}/reactivar", null);
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task El_listado_se_scopea_por_transportistaId()
    {
        var pilotoId = await CrearMaestroAsync(TipoCatalogo.Piloto);
        var transportistaA = await CrearMaestroAsync(TipoCatalogo.Transportista);
        var transportistaB = await CrearMaestroAsync(TipoCatalogo.Transportista);
        var enA = await CrearVinculoAsync(pilotoId, transportistaA);
        var enB = await CrearVinculoAsync(pilotoId, transportistaB);

        var soloA = (await ListarAsync($"?transportistaId={transportistaA}"))!;

        Assert.Contains(soloA, v => v.Id == enA.Id);
        Assert.DoesNotContain(soloA, v => v.Id == enB.Id);
    }

    [Fact]
    public async Task El_listado_normal_sin_watermark_excluye_inactivos()
    {
        var pilotoId = await CrearMaestroAsync(TipoCatalogo.Piloto);
        var transportistaId = await CrearMaestroAsync(TipoCatalogo.Transportista);
        var dto = await CrearVinculoAsync(pilotoId, transportistaId);
        await _client.PostAsync($"/api/vinculos-piloto-transportista/{dto.Id}/desactivar", null);

        var todos = (await ListarAsync())!;

        Assert.DoesNotContain(todos, v => v.Id == dto.Id);
    }

    [Fact]
    public async Task El_delta_es_estrictamente_mayor_al_watermark()
    {
        var pilotoId = await CrearMaestroAsync(TipoCatalogo.Piloto);
        var transportistaId = await CrearMaestroAsync(TipoCatalogo.Transportista);
        var primero = await CrearVinculoAsync(pilotoId, await CrearMaestroAsync(TipoCatalogo.Transportista));
        var watermark = primero.FechaModificacion;
        await Task.Delay(15);
        var segundo = await CrearVinculoAsync(pilotoId, transportistaId);

        var delta = (await ListarAsync($"?modificadoDesde={Iso(watermark)}"))!;
        var ids = delta.Select(v => v.Id).ToHashSet();

        Assert.Contains(segundo.Id, ids);
        Assert.DoesNotContain(primero.Id, ids);
    }

    [Fact]
    public async Task El_delta_incluye_inactivos_para_que_el_terminal_pueda_descartar_el_par()
    {
        var pilotoId = await CrearMaestroAsync(TipoCatalogo.Piloto);
        var transportistaId = await CrearMaestroAsync(TipoCatalogo.Transportista);
        var watermark = DateTime.UtcNow;
        await Task.Delay(15);
        var dto = await CrearVinculoAsync(pilotoId, transportistaId);
        await _client.PostAsync($"/api/vinculos-piloto-transportista/{dto.Id}/desactivar", null);

        var delta = (await ListarAsync($"?transportistaId={transportistaId}&modificadoDesde={Iso(watermark)}"))!;

        Assert.Contains(delta, v => v.Id == dto.Id && !v.Activo);
    }

    [Fact]
    public async Task Get_por_id_inexistente_devuelve_404()
    {
        var resp = await _client.GetAsync($"/api/vinculos-piloto-transportista/{Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }
}
