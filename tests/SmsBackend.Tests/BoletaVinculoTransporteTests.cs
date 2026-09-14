using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using SmsBackend.Domain.Boletas;
using SmsBackend.Domain.Boletas.Valores;
using SmsBackend.Domain.Maestros;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Slice B1b — <c>GuardiaVinculoTransporte</c> en Boleta (design D2/D3, spec
/// "Central-created boleta with an unlinked pair" y "Boleta sync ingest of an
/// unlinked pair is marked, not rejected"). La vía típada central
/// (<c>POST /api/boletas</c>) rechaza un par sin vínculo activo con 400 antes
/// de persistir; la ingesta de sync (<c>POST /api/boletas/sync</c>) NUNCA
/// rechaza por esto — persiste la boleta con
/// <see cref="MarcaVinculoTransporte.VinculoInvalido"/> y el resto de la
/// secuencia del terminal sigue procesando (evidencia outbox-dispatcher.ts,
/// design D3).
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class BoletaVinculoTransporteTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public BoletaVinculoTransporteTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<(Guid PilotoId, Guid TransportistaId)> ParSinVinculoAsync()
    {
        var piloto = await TestData.CrearMaestroAsync(_client, TipoCatalogo.Piloto);
        var transportista = await TestData.CrearMaestroAsync(_client, TipoCatalogo.Transportista);
        return (piloto.Id, transportista.Id);
    }

    private async Task<(Guid PilotoId, Guid TransportistaId)> ParConVinculoAsync()
    {
        var (pilotoId, transportistaId) = await ParSinVinculoAsync();
        await TestData.CrearVinculoAsync(_client, pilotoId, transportistaId);
        return (pilotoId, transportistaId);
    }

    private static ValorCampoDto[] ValoresTransporte(
        Guid pilotoCampoId, Guid transportistaCampoId, Guid pilotoId, Guid transportistaId) => new[]
    {
        TestData.Referencia(pilotoCampoId, pilotoId),
        TestData.Referencia(transportistaCampoId, transportistaId),
    };

    [Fact]
    public async Task Creacion_tipada_con_par_sin_vinculo_devuelve_400_y_no_persiste()
    {
        var (escenario, pilotoCampoId, transportistaCampoId) = await TestData.EscenarioTransporteAsync(_client);
        var (pilotoId, transportistaId) = await ParSinVinculoAsync();

        var (resp, _) = await TestData.CrearBoletaRawAsync(_client, escenario,
            ValoresTransporte(pilotoCampoId, transportistaCampoId, pilotoId, transportistaId));

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var lista = await _client.GetFromJsonAsync<List<BoletaDto>>("/api/boletas", TestData.Json);
        Assert.Empty(lista!);
    }

    [Fact]
    public async Task Creacion_tipada_con_par_vinculado_se_acepta_sin_marca()
    {
        var (escenario, pilotoCampoId, transportistaCampoId) = await TestData.EscenarioTransporteAsync(_client);
        var (pilotoId, transportistaId) = await ParConVinculoAsync();

        var dto = await TestData.CrearBoletaAsync(_client, escenario,
            ValoresTransporte(pilotoCampoId, transportistaCampoId, pilotoId, transportistaId));

        Assert.Null(dto.MarcaVinculoTransporte);
    }

    [Fact]
    public async Task Ingesta_sync_con_par_sin_vinculo_persiste_marcada_y_nunca_devuelve_4xx()
    {
        var (escenario, pilotoCampoId, transportistaCampoId) = await TestData.EscenarioTransporteAsync(_client);
        var (pilotoId, transportistaId) = await ParSinVinculoAsync();
        var boletaId = Guid.NewGuid();

        var (resp, body) = await TestData.SyncAsync(_client, TestData.SyncCrearPayload(
            boletaId, escenario, DateTime.UtcNow,
            ValoresTransporte(pilotoCampoId, transportistaCampoId, pilotoId, transportistaId)));

        Assert.True(resp.IsSuccessStatusCode, body);
        var dto = JsonSerializer.Deserialize<BoletaDto>(body, TestData.Json)!;
        Assert.Equal(MarcaVinculoTransporte.VinculoInvalido, dto.MarcaVinculoTransporte);

        var detalle = await TestData.GetBoletaAsync(_client, boletaId);
        Assert.Equal(MarcaVinculoTransporte.VinculoInvalido, detalle.MarcaVinculoTransporte);
    }

    [Fact]
    public async Task Ingesta_sync_con_par_vinculado_persiste_sin_marca()
    {
        var (escenario, pilotoCampoId, transportistaCampoId) = await TestData.EscenarioTransporteAsync(_client);
        var (pilotoId, transportistaId) = await ParConVinculoAsync();
        var boletaId = Guid.NewGuid();

        var (resp, body) = await TestData.SyncAsync(_client, TestData.SyncCrearPayload(
            boletaId, escenario, DateTime.UtcNow,
            ValoresTransporte(pilotoCampoId, transportistaCampoId, pilotoId, transportistaId)));

        Assert.True(resp.IsSuccessStatusCode, body);
        var dto = JsonSerializer.Deserialize<BoletaDto>(body, TestData.Json)!;
        Assert.Null(dto.MarcaVinculoTransporte);
    }

    /// <summary>
    /// Prueba el punto entero de D3: la marca NUNCA bloquea la secuencia del
    /// outbox. Un 'Cerrar' para la MISMA boleta marcada por sync-ingest se
    /// procesa normal — si el marcador hubiera devuelto 4xx en el 'Crear', el
    /// dispatcher real jamás habría llegado a enviar este evento.
    /// </summary>
    [Fact]
    public async Task Evento_posterior_del_mismo_terminal_sigue_procesando_tras_boleta_marcada()
    {
        var (escenario, pilotoCampoId, transportistaCampoId) = await TestData.EscenarioTransporteAsync(_client);
        var (pilotoId, transportistaId) = await ParSinVinculoAsync();
        var boletaId = Guid.NewGuid();

        // El cierre exige TODOS los campos requeridos de la sección con
        // ocurrencia (equipo/placa), no solo el par piloto+transportista —
        // sin relación con el guardia bajo prueba, solo hace falta para
        // llegar al 'Cerrar'.
        var formulario = await TestData.FormularioAsync(_client, escenario.TipoMovimientoId);
        var equipo = await TestData.CrearMaestroAsync(_client, TipoCatalogo.Equipo);
        var unidad = await TestData.CrearMaestroAsync(_client, TipoCatalogo.Unidad);
        var valores = ValoresTransporte(pilotoCampoId, transportistaCampoId, pilotoId, transportistaId)
            .Concat(new[]
            {
                TestData.Referencia(TestData.CampoId(formulario, "transporte", "equipo"), equipo.Id),
                TestData.Referencia(TestData.CampoId(formulario, "transporte", "placa"), unidad.Id),
            });

        var (respCrear, cuerpoCrear) = await TestData.SyncAsync(_client, TestData.SyncCrearPayload(
            boletaId, escenario, DateTime.UtcNow, valores));
        Assert.True(respCrear.IsSuccessStatusCode, cuerpoCrear);

        var (respCerrar, cuerpoCerrar) = await TestData.SyncAsync(_client, TestData.SyncCerrarPayload(
            boletaId, DateTime.UtcNow, escenario.BasculaCodigo));

        Assert.True(respCerrar.IsSuccessStatusCode, cuerpoCerrar);
        var detalle = await TestData.GetBoletaAsync(_client, boletaId);
        Assert.Equal(EstadoBoleta.Cerrada, detalle.Estado);
        Assert.Equal(MarcaVinculoTransporte.VinculoInvalido, detalle.MarcaVinculoTransporte);
    }
}
