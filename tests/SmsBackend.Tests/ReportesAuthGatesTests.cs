using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using SmsBackend.Domain.Seguridad;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Gateo de Reportes (resumen-basculas + diario) — hallazgo de sdd-verify
/// posterior a PR9: estos dos endpoints (Frente 2, PR #66/#67) se
/// construyeron antes de arrancar el change autenticacion-y-roles, así que
/// el sdd-explore original nunca los contó entre los 61 endpoints y
/// quedaron sin ningún <c>.RequireAuthorization()</c>.
///
/// Nivel Supervisor, no Operador ni Administrador: son reportes de
/// oversight/coordinación de producción (no un catálogo que el operador
/// necesite para pesar, ni configuración pura de sistema) — primer uso real
/// de ese rol intermedio en el backend.
/// </summary>
[Collection(ApiCollection.Name)]
[Trait("Category", "Seguridad")]
public sealed class ReportesAuthGatesTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public ReportesAuthGatesTests(ApiFactory factory)
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

    private void ComoAnonimo() => _client.DefaultRequestHeaders.Authorization = null;

    private void Como(string token) =>
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

    [Fact]
    public async Task GET_resumen_basculas_es_401_anonimo_403_Operador_y_200_Supervisor()
    {
        ComoAnonimo();
        var anonimo = await _client.GetAsync("/api/reportes/resumen-basculas?desde=2026-01-01&hasta=2026-01-01");
        Assert.Equal(HttpStatusCode.Unauthorized, anonimo.StatusCode);

        Como(await LoginTokenAsync("operador", "Operador123!"));
        var operador = await _client.GetAsync("/api/reportes/resumen-basculas?desde=2026-01-01&hasta=2026-01-01");
        Assert.Equal(HttpStatusCode.Forbidden, operador.StatusCode);

        Como(await LoginTokenAsync("supervisor", "Supervisor123!"));
        var supervisor = await _client.GetAsync("/api/reportes/resumen-basculas?desde=2026-01-01&hasta=2026-01-01");
        Assert.Equal(HttpStatusCode.OK, supervisor.StatusCode);
    }

    [Fact]
    public async Task GET_diario_es_401_anonimo_403_Operador_y_200_Supervisor()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var ruta = $"/api/reportes/diario?tipoMovimientoId={escenario.TipoMovimientoId}"
            + "&desde=2026-01-01&hasta=2026-01-01";

        ComoAnonimo();
        var anonimo = await _client.GetAsync(ruta);
        Assert.Equal(HttpStatusCode.Unauthorized, anonimo.StatusCode);

        Como(await LoginTokenAsync("operador", "Operador123!"));
        var operador = await _client.GetAsync(ruta);
        Assert.Equal(HttpStatusCode.Forbidden, operador.StatusCode);

        Como(await LoginTokenAsync("supervisor", "Supervisor123!"));
        var supervisor = await _client.GetAsync(ruta);
        Assert.Equal(HttpStatusCode.OK, supervisor.StatusCode);
    }
}
