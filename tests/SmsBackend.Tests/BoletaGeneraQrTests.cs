using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SmsBackend.Data;
using Xunit;

namespace SmsBackend.Tests;

[Collection(ApiCollection.Name)]
public sealed class BoletaGeneraQrTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public BoletaGeneraQrTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public Task InitializeAsync() => _factory.ResetAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Detalle_proyecta_GeneraQR_del_tipo_de_movimiento()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        using (var scope = _factory.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<SmsDbContext>();
            await db.TiposMovimiento
                .Where(tipo => tipo.Id == escenario.TipoMovimientoId)
                .ExecuteUpdateAsync(setters => setters.SetProperty(tipo => tipo.GeneraQR, true));
        }

        var creada = await TestData.CrearBoletaAsync(_client, escenario);
        var detalle = await TestData.GetBoletaAsync(_client, creada.Id);

        Assert.True(detalle.GeneraQR);
    }
}
