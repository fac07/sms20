using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using SmsBackend.Domain.Boletas;
using SmsBackend.Domain.Boletas.Valores;
using Xunit;

namespace SmsBackend.Tests;

[Collection(ApiCollection.Name)]
public sealed class BoletaSyncOrigenTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public BoletaSyncOrigenTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<(HttpResponseMessage Response, JsonElement Body)> SyncCrearAsync(
        Escenario escenario, Guid boletaId, Guid? boletaOrigenId)
    {
        var (response, body) = await TestData.SyncAsync(_client, TestData.SyncCrearPayload(
            boletaId,
            escenario,
            DateTime.UtcNow,
            Array.Empty<ValorCampoDto>(),
            boletaOrigenId: boletaOrigenId));
        return (response, JsonDocument.Parse(body).RootElement.Clone());
    }

    private static string? Marca(JsonElement body) =>
        body.TryGetProperty("marcaBoletaOrigen", out var marca) && marca.ValueKind != JsonValueKind.Null
            ? marca.GetString()
            : null;

    [Fact]
    public async Task Origen_existente_conserva_el_vinculo_sin_marca()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var origen = await TestData.CrearBoletaAsync(_client, escenario);
        var recepcionId = Guid.NewGuid();

        var (response, body) = await SyncCrearAsync(escenario, recepcionId, origen.Id);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(origen.Id, body.GetProperty("boletaOrigenId").GetGuid());
        Assert.Null(Marca(body));
    }

    [Fact]
    public async Task Origen_inexistente_crea_la_boleta_y_la_marca_para_revision()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var origenId = Guid.NewGuid();
        var recepcionId = Guid.NewGuid();

        var (response, body) = await SyncCrearAsync(escenario, recepcionId, origenId);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(origenId, body.GetProperty("boletaOrigenId").GetGuid());
        Assert.Equal("OrigenNoResuelto", Marca(body));

        var detalle = await _client.GetFromJsonAsync<JsonElement>($"/api/boletas/{recepcionId}", TestData.Json);
        Assert.Equal("OrigenNoResuelto", Marca(detalle));
    }

    [Fact]
    public async Task Segunda_recepcion_del_mismo_origen_es_duplicada_y_la_primera_queda_intacta()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var origen = await TestData.CrearBoletaAsync(_client, escenario);
        var primeraId = Guid.NewGuid();
        var segundaId = Guid.NewGuid();

        var (primeraResponse, _) = await SyncCrearAsync(escenario, primeraId, origen.Id);
        var (segundaResponse, segunda) = await SyncCrearAsync(escenario, segundaId, origen.Id);

        Assert.Equal(HttpStatusCode.OK, primeraResponse.StatusCode);
        Assert.Equal(HttpStatusCode.OK, segundaResponse.StatusCode);
        Assert.Equal(origen.Id, segunda.GetProperty("boletaOrigenId").GetGuid());
        Assert.Equal("RecepcionDuplicada", Marca(segunda));
        var primera = await _client.GetFromJsonAsync<JsonElement>($"/api/boletas/{primeraId}", TestData.Json);
        Assert.Null(Marca(primera));
    }

    [Fact]
    public async Task Recepcion_anulada_no_cuenta_como_duplicada()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var origen = await TestData.CrearBoletaAsync(_client, escenario);
        var primeraId = Guid.NewGuid();
        var (primeraResponse, _) = await SyncCrearAsync(escenario, primeraId, origen.Id);
        Assert.Equal(HttpStatusCode.OK, primeraResponse.StatusCode);
        var anulada = await _client.PostAsJsonAsync(
            $"/api/boletas/{primeraId}/anular",
            new AnularBoletaRequest("auditor", "supervisor", "recepción descartada"),
            TestData.Json);
        anulada.EnsureSuccessStatusCode();

        var (segundaResponse, segunda) = await SyncCrearAsync(escenario, Guid.NewGuid(), origen.Id);

        Assert.Equal(HttpStatusCode.OK, segundaResponse.StatusCode);
        Assert.Equal(origen.Id, segunda.GetProperty("boletaOrigenId").GetGuid());
        Assert.Null(Marca(segunda));
    }

    [Fact]
    public async Task Replay_del_mismo_evento_no_marca_la_boleta_contra_si_misma()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var origen = await TestData.CrearBoletaAsync(_client, escenario);
        var recepcionId = Guid.NewGuid();
        var payload = TestData.SyncCrearPayload(
            recepcionId,
            escenario,
            DateTime.UtcNow,
            Array.Empty<ValorCampoDto>(),
            boletaOrigenId: origen.Id);
        var (primeraResponse, primeraBody) = await TestData.SyncAsync(_client, payload);
        Assert.Equal(HttpStatusCode.OK, primeraResponse.StatusCode);

        var (replayResponse, replayBody) = await TestData.SyncAsync(_client, payload);
        var replay = JsonDocument.Parse(replayBody).RootElement;

        Assert.Equal(HttpStatusCode.OK, replayResponse.StatusCode);
        Assert.Equal(origen.Id, replay.GetProperty("boletaOrigenId").GetGuid());
        Assert.Null(Marca(replay));
        Assert.Equal(
            JsonDocument.Parse(primeraBody).RootElement.GetProperty("numeroBoleta").GetString(),
            replay.GetProperty("numeroBoleta").GetString());
    }

    [Fact]
    public async Task Origen_de_otro_centro_se_resuelve_sin_marca()
    {
        var centroOrigen = await TestData.NuevoEscenarioAsync(_client);
        var centroRecepcion = await TestData.NuevoEscenarioAsync(_client);
        var origen = await TestData.CrearBoletaAsync(_client, centroOrigen);

        var (response, body) = await SyncCrearAsync(centroRecepcion, Guid.NewGuid(), origen.Id);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(origen.Id, body.GetProperty("boletaOrigenId").GetGuid());
        Assert.Null(Marca(body));
    }
}
