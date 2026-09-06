using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SmsBackend.Data;
using SmsBackend.Domain.Maestros;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Slice M2 — ingesta central de maestros provisionales
/// (<c>POST /api/maestros/sync</c>), spec "Provisional-ingest endpoint (upsert)".
/// Idempotente por el Guid del cliente; <c>Estado</c>/<c>Activo</c> forzados
/// server-side; un id ya fusionado resuelve al oficial sin reactivar el
/// provisional; una colisión <c>(TipoCatalogo, Codigo)</c> es 409, nunca 500.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class MaestrosProvisionalesIngestTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public MaestrosProvisionalesIngestTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<MaestroDto> CrearOficialEquipoAsync(string sufijo) =>
        TestData.PostAsync<MaestroDto>(_client, "/api/maestros",
            new GuardarMaestroRequest(TipoCatalogo.Equipo, $"EQO-{sufijo}", $"Equipo oficial {sufijo}", null));

    [Fact]
    public async Task Ingesta_crea_el_provisional_forzando_estado_provisional_y_activo()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var id = Guid.NewGuid();
        var s = TestData.Sufijo();

        var (resp, body) = await TestData.SyncMaestroAsync(_client,
            TestData.SyncMaestroPayload(id, escenario.BasculaCodigo, TipoCatalogo.Equipo, $"EQP-{s}", $"Equipo {s}"));

        Assert.True(resp.IsSuccessStatusCode, body);
        var dto = JsonSerializer.Deserialize<MaestroDto>(body, TestData.Json)!;
        Assert.Equal(id, dto.Id);
        Assert.Equal(EstadoMaestro.Provisional, dto.Estado);
        Assert.True(dto.Activo);

        var recargado = await TestData.GetMaestroAsync(_client, id);
        Assert.Equal(EstadoMaestro.Provisional, recargado.Estado);
        Assert.True(recargado.Activo);
    }

    [Fact]
    public async Task Ingesta_repetida_del_mismo_guid_es_no_op_exitoso()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var id = Guid.NewGuid();
        var s = TestData.Sufijo();
        var payload = TestData.SyncMaestroPayload(
            id, escenario.BasculaCodigo, TipoCatalogo.Equipo, $"EQP-{s}", $"Equipo {s}");

        var (primera, cuerpo1) = await TestData.SyncMaestroAsync(_client, payload);
        Assert.True(primera.IsSuccessStatusCode, cuerpo1);
        var (segunda, cuerpo2) = await TestData.SyncMaestroAsync(_client, payload);
        Assert.True(segunda.IsSuccessStatusCode, cuerpo2);

        using var scope = _factory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SmsDbContext>();
        Assert.Equal(1, await db.Maestros.CountAsync(m => m.Id == id));
    }

    [Fact]
    public async Task Ingesta_de_un_id_ya_fusionado_redirige_al_oficial_y_no_reactiva_el_provisional()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var s = TestData.Sufijo();
        var oficial = await CrearOficialEquipoAsync(s);

        var provisionalId = Guid.NewGuid();
        var payload = TestData.SyncMaestroPayload(
            provisionalId, escenario.BasculaCodigo, TipoCatalogo.Equipo, $"EQP-{s}", $"Equipo prov {s}");
        var (ingesta, cuerpoIngesta) = await TestData.SyncMaestroAsync(_client, payload);
        Assert.True(ingesta.IsSuccessStatusCode, cuerpoIngesta);

        var (fusion, cuerpoFusion) = await TestData.FusionarMaestroAsync(_client, provisionalId, oficial.Id);
        Assert.True(fusion.IsSuccessStatusCode, cuerpoFusion);

        var (reingesta, cuerpoReingesta) = await TestData.SyncMaestroAsync(_client, payload);
        Assert.True(reingesta.IsSuccessStatusCode, cuerpoReingesta);
        var dto = JsonSerializer.Deserialize<MaestroDto>(cuerpoReingesta, TestData.Json)!;
        Assert.Equal(oficial.Id, dto.Id);
        Assert.Equal(EstadoMaestro.Oficial, dto.Estado);

        var provisional = await TestData.GetMaestroAsync(_client, provisionalId);
        Assert.False(provisional.Activo);
        Assert.Equal(oficial.Id, provisional.FusionadoConId);
    }

    [Fact]
    public async Task Ingesta_con_codigo_en_colision_y_distinto_guid_es_409_no_500()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var s = TestData.Sufijo();
        var codigo = $"EQP-{s}";

        var (primera, cuerpo1) = await TestData.SyncMaestroAsync(_client,
            TestData.SyncMaestroPayload(Guid.NewGuid(), escenario.BasculaCodigo, TipoCatalogo.Equipo, codigo, $"Equipo {s}"));
        Assert.True(primera.IsSuccessStatusCode, cuerpo1);

        var (colision, _) = await TestData.SyncMaestroAsync(_client,
            TestData.SyncMaestroPayload(Guid.NewGuid(), escenario.BasculaCodigo, TipoCatalogo.Equipo, codigo, $"Otro equipo {s}"));

        Assert.Equal(HttpStatusCode.Conflict, colision.StatusCode);
    }
}
