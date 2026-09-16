using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using SmsBackend.Domain.Seguridad;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Dominio de referencia elegido por el design para el primer endpoint gateado
/// (PR2 Phase 1): <c>ConfiguracionCentroEndpoints</c> ya existe (PR #64) y es
/// chico (2 rutas). Cubre el ciclo completo 401 (anónimo) → 403 (rol
/// insuficiente) → 200 (rol suficiente) que el resto de los 61 endpoints
/// replica en PRs posteriores (Phase 3).
/// </summary>
[Collection(ApiCollection.Name)]
[Trait("Category", "Seguridad")]
public sealed class ConfiguracionCentroAuthTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public ConfiguracionCentroAuthTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<string> LoginTokenAsync(string usuario, string clave)
    {
        var resp = await _client.PostAsJsonAsync(
            "/api/auth/login", new { nombreUsuario = usuario, clave }, TestData.Json);
        resp.EnsureSuccessStatusCode();
        var login = await resp.Content.ReadFromJsonAsync<ResultadoLogin>(TestData.Json);
        return login!.Token;
    }

    [Fact]
    public async Task GET_configuracion_sin_token_es_401()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);

        var resp = await _client.GetAsync($"/api/centros/{escenario.CentroId}/configuracion");

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task GET_configuracion_con_token_Operador_es_403_y_con_Administrador_es_200()
    {
        // Triangulación: mismo endpoint, mismo Centro, dos roles distintos —
        // Operador insuficiente contra la política Administrador (design D4),
        // Administrador siempre pasa. Si RequireAuthorization no discriminara
        // por rol, ambos darían el mismo status.
        var escenario = await TestData.NuevoEscenarioAsync(_client);

        var tokenOperador = await LoginTokenAsync("operador", "Operador123!");
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenOperador);
        var respOperador = await _client.GetAsync($"/api/centros/{escenario.CentroId}/configuracion");
        Assert.Equal(HttpStatusCode.Forbidden, respOperador.StatusCode);

        var tokenAdmin = await LoginTokenAsync("administrador", "Administrador123!");
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenAdmin);
        var respAdmin = await _client.GetAsync($"/api/centros/{escenario.CentroId}/configuracion");
        Assert.Equal(HttpStatusCode.OK, respAdmin.StatusCode);
    }

    [Fact]
    public async Task PUT_configuracion_con_token_Operador_es_403_y_con_Administrador_es_200()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);

        var tokenOperador = await LoginTokenAsync("operador", "Operador123!");
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenOperador);
        var respOperador = await _client.PutAsJsonAsync(
            $"/api/centros/{escenario.CentroId}/configuracion",
            new { sitioOrigenDefaultId = (Guid?)null },
            TestData.Json);
        Assert.Equal(HttpStatusCode.Forbidden, respOperador.StatusCode);

        var tokenAdmin = await LoginTokenAsync("administrador", "Administrador123!");
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenAdmin);
        var respAdmin = await _client.PutAsJsonAsync(
            $"/api/centros/{escenario.CentroId}/configuracion",
            new { sitioOrigenDefaultId = (Guid?)null },
            TestData.Json);
        Assert.Equal(HttpStatusCode.OK, respAdmin.StatusCode);
    }
}
