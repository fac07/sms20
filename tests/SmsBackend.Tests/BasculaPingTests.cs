using System.Net;
using System.Net.Http.Json;
using SmsBackend.Domain.Basculas;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Ping de conectividad (<c>POST /api/basculas/{id}/ping</c>). La terminal
/// Electron ya llama a Central en cada ciclo de config-sync (~60s); este
/// endpoint dedicado es el punto donde Central registra ese "estuvo acá" como
/// <c>Bascula.UltimaConexion</c> (UTC) sin pisar la semántica de lectura del
/// GET que también consume el panel admin. Misma postura de identidad que
/// <c>/aprovisionar</c>: sin auth, la báscula se identifica por su id.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class BasculaPingTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public BasculaPingTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<HttpResponseMessage> PingAsync(Guid id) =>
        _client.PostAsync($"/api/basculas/{id}/ping", content: null);

    private Task<BasculaDto> GetBasculaAsync(Guid id) =>
        _client.GetFromJsonAsync<BasculaDto>($"/api/basculas/{id}", TestData.Json)!;

    [Fact]
    public async Task Bascula_nueva_expone_UltimaConexion_null()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);

        var bascula = await GetBasculaAsync(escenario.BasculaId);

        Assert.Null(bascula.UltimaConexion);
    }

    [Fact]
    public async Task Ping_setea_UltimaConexion_204()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var antes = DateTime.UtcNow;

        var resp = await PingAsync(escenario.BasculaId);

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var despues = DateTime.UtcNow;

        var bascula = await GetBasculaAsync(escenario.BasculaId);
        Assert.NotNull(bascula.UltimaConexion);
        Assert.InRange(bascula.UltimaConexion!.Value, antes.AddSeconds(-5), despues.AddSeconds(5));
    }

    [Fact]
    public async Task Ping_bascula_inexistente_es_404()
    {
        var resp = await PingAsync(Guid.NewGuid());
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task Ping_repetido_avanza_UltimaConexion_y_no_toca_el_resto()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        (await PingAsync(escenario.BasculaId)).EnsureSuccessStatusCode();
        var primera = (await GetBasculaAsync(escenario.BasculaId)).UltimaConexion;

        await Task.Delay(15);
        (await PingAsync(escenario.BasculaId)).EnsureSuccessStatusCode();
        var bascula = await GetBasculaAsync(escenario.BasculaId);

        Assert.NotNull(primera);
        Assert.True(bascula.UltimaConexion >= primera);
        // Solo se escribe el timestamp: la config de la báscula queda intacta.
        Assert.Equal(escenario.BasculaCodigo, bascula.Codigo);
        Assert.False(bascula.PermiteIngresoManual);
    }

    [Fact]
    public async Task Ping_bascula_inactiva_registra_igual()
    {
        // El ping es dato de conectividad, no una operación de negocio: una
        // báscula dada de baja que todavía llama deja su marca (el admin ve
        // "hace X min" incluso después de desactivarla).
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        (await _client.DeleteAsync($"/api/basculas/{escenario.BasculaId}")).EnsureSuccessStatusCode();

        var resp = await PingAsync(escenario.BasculaId);

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var bascula = await GetBasculaAsync(escenario.BasculaId);
        Assert.NotNull(bascula.UltimaConexion);
    }
}
