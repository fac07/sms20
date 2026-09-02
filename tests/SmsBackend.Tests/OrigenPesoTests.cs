using SmsBackend.Domain.Boletas;
using SmsBackend.Domain.Boletas.Valores;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// <c>OrigenPesoIngreso</c>/<c>OrigenPesoSalida</c> siguen siendo columnas del
/// Encabezado (design D10): hacen round-trip como string a través de crear,
/// cerrar y sync, sin pasar por el EAV.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class OrigenPesoTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public OrigenPesoTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Round_trip_por_crear_y_cerrar_tipados()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);

        var boleta = await TestData.CrearBoletaAsync(
            _client, escenario, valores: null, origenPesoIngreso: OrigenPeso.Manual);
        Assert.Equal(OrigenPeso.Manual, (await TestData.GetBoletaAsync(_client, boleta.Id)).OrigenPesoIngreso);

        var cierre = await TestData.CerrarAsync(_client, boleta.Id, pesoSalida: 800m, origen: OrigenPeso.Manual);
        cierre.EnsureSuccessStatusCode();

        var recargada = await TestData.GetBoletaAsync(_client, boleta.Id);
        Assert.Equal(OrigenPeso.Manual, recargada.OrigenPesoIngreso);
        Assert.Equal(OrigenPeso.Manual, recargada.OrigenPesoSalida);
    }

    [Fact]
    public async Task Round_trip_por_sync_crear_y_sync_cerrar()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var id = Guid.NewGuid();

        var (respCrear, bodyCrear) = await TestData.SyncAsync(
            _client,
            TestData.SyncCrearPayload(
                id, escenario, DateTime.UtcNow, Array.Empty<ValorCampoDto>(), OrigenPeso.Manual));
        Assert.True(respCrear.IsSuccessStatusCode, bodyCrear);
        Assert.Equal(OrigenPeso.Manual, (await TestData.GetBoletaAsync(_client, id)).OrigenPesoIngreso);

        var (respCerrar, bodyCerrar) = await TestData.SyncAsync(
            _client,
            TestData.SyncCerrarPayload(id, DateTime.UtcNow, escenario.BasculaCodigo, origenPesoSalida: OrigenPeso.Bascula));
        Assert.True(respCerrar.IsSuccessStatusCode, bodyCerrar);

        var recargada = await TestData.GetBoletaAsync(_client, id);
        Assert.Equal(OrigenPeso.Manual, recargada.OrigenPesoIngreso);
        Assert.Equal(OrigenPeso.Bascula, recargada.OrigenPesoSalida);
    }
}
