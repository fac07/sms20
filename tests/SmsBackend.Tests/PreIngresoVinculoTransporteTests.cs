using System.Net;
using System.Net.Http.Json;
using SmsBackend.Domain.Maestros;
using SmsBackend.Domain.PreIngresos;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Slice B1b — <c>GuardiaVinculoTransporte</c> en la vía síncrona de PreIngreso
/// (design D2, spec "PreIngreso and Boleta synchronous creation reject an
/// unlinked piloto+transportista pair"). Alta y edición (mientras
/// <c>Pendiente</c>) exigen un <c>VinculoPilotoTransportista</c> activo entre el
/// par; sin él, 400 y nada persiste/cambia.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class PreIngresoVinculoTransporteTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public PreIngresoVinculoTransporteTests(ApiFactory factory)
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

    [Fact]
    public async Task Alta_con_par_sin_vinculo_devuelve_400_y_no_persiste()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var (pilotoId, transportistaId) = await ParSinVinculoAsync();

        var resp = await _client.PostAsJsonAsync("/api/preingresos",
            new CrearPreIngresoRequest(
                escenario.CentroId, $"ENV-{TestData.Sufijo()}", 20000m,
                PilotoId: pilotoId, TransportistaId: transportistaId, UsuarioCreacion: "logistica"),
            TestData.Json);

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var lista = await _client.GetFromJsonAsync<List<PreIngresoDto>>(
            $"/api/preingresos?centroId={escenario.CentroId}", TestData.Json);
        Assert.Empty(lista!);
    }

    [Fact]
    public async Task Alta_con_par_vinculado_se_acepta_sin_marca()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var (pilotoId, transportistaId) = await ParConVinculoAsync();

        var dto = await TestData.PostAsync<PreIngresoDto>(_client, "/api/preingresos",
            new CrearPreIngresoRequest(
                escenario.CentroId, $"ENV-{TestData.Sufijo()}", 20000m,
                PilotoId: pilotoId, TransportistaId: transportistaId, UsuarioCreacion: "logistica"));

        Assert.Equal(pilotoId, dto.PilotoId);
        Assert.Equal(transportistaId, dto.TransportistaId);
        Assert.Equal(EstadoPreIngreso.Pendiente, dto.Estado);
    }

    [Fact]
    public async Task Edicion_de_pendiente_introduciendo_par_sin_vinculo_devuelve_400_y_no_modifica()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var previo = await TestData.PostAsync<PreIngresoDto>(_client, "/api/preingresos",
            new CrearPreIngresoRequest(escenario.CentroId, $"ENV-{TestData.Sufijo()}", 20000m, UsuarioCreacion: "logistica"));
        var (pilotoId, transportistaId) = await ParSinVinculoAsync();

        var resp = await _client.PutAsJsonAsync($"/api/preingresos/{previo.Id}",
            new EditarPreIngresoRequest(
                escenario.CentroId, previo.NumeroEnvio, previo.PesoEnviado,
                PilotoId: pilotoId, TransportistaId: transportistaId),
            TestData.Json);

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var recargado = await _client.GetFromJsonAsync<PreIngresoDto>($"/api/preingresos/{previo.Id}", TestData.Json);
        Assert.Null(recargado!.PilotoId);
        Assert.Null(recargado.TransportistaId);
    }
}
