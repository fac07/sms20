using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Gateo del dominio Maestros (PR4 — autenticacion-y-roles). Criterio del
/// design (cruzado con app.routes.ts): GETs → <c>Politicas.Operador</c>
/// (leer catálogos es universal); escrituras de un dominio cuya pantalla es
/// <c>modo:'admin'</c> (MaestrosPage y ProvisionalesPage) →
/// <c>Politicas.Administrador</c>. <c>POST /sync</c> NO se toca: es uno de
/// los 4 endpoints de dispositivo/sync que PR3 declaró resueltos (corre sin
/// claims humanos). <c>POST /incidencias-sync</c> queda sin gate por el
/// mismo espíritu (lo dispara el outbox-dispatcher de la terminal, sin
/// token) — anotado para confirmación en el reporte del PR.
///
/// Nota de nivel Operador: no existe rol por debajo de Operador, así que el
/// "403 rol insuficiente" de este nivel es estructuralmente imposible — su
/// defensa es el 401 anónimo. El 403 real solo aplica a políticas
/// Administrador (lo prueba el Operador contra las escrituras).
/// </summary>
[Collection(ApiCollection.Name)]
[Trait("Category", "Seguridad")]
public sealed class MaestrosAuthGatesTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public MaestrosAuthGatesTests(ApiFactory factory)
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
        var login = await resp.Content.ReadFromJsonAsync<SmsBackend.Domain.Seguridad.ResultadoLogin>(TestData.Json);
        return login!.Token;
    }

    private void ComoAnonimo() => _client.DefaultRequestHeaders.Authorization = null;

    private void Como(string token) =>
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

    // ── Nivel Operador (representante: GET /) ─────────────────────────────

    [Fact]
    public async Task GET_maestros_sin_token_es_401()
    {
        ComoAnonimo();

        var resp = await _client.GetAsync("/api/maestros");

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task GET_maestros_con_Operador_es_200()
    {
        Como(await LoginTokenAsync("operador", "Operador123!"));

        var resp = await _client.GetAsync("/api/maestros");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    // ── Nivel Administrador (representante: POST /) ───────────────────────

    [Fact]
    public async Task POST_maestros_sin_token_es_401()
    {
        ComoAnonimo();

        var resp = await _client.PostAsJsonAsync(
            "/api/maestros",
            new SmsBackend.Domain.Maestros.GuardarMaestroRequest(
                SmsBackend.Domain.Maestros.TipoCatalogo.Piloto, "P-AUTH", "Piloto Auth", null),
            TestData.Json);

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task POST_maestros_con_Operador_es_403_y_con_Administrador_es_201()
    {
        Como(await LoginTokenAsync("operador", "Operador123!"));
        var body = new SmsBackend.Domain.Maestros.GuardarMaestroRequest(
            SmsBackend.Domain.Maestros.TipoCatalogo.Piloto, "P-AUTH", "Piloto Auth", null);

        var prohibido = await _client.PostAsJsonAsync("/api/maestros", body, TestData.Json);
        Assert.Equal(HttpStatusCode.Forbidden, prohibido.StatusCode);

        Como(await LoginTokenAsync("administrador", "Administrador123!"));
        var permitido = await _client.PostAsJsonAsync("/api/maestros", body, TestData.Json);
        Assert.Equal(HttpStatusCode.Created, permitido.StatusCode);
    }

    // ── Smoke: todas las demás rutas del mismo nivel quedaron gateadas ────

    [Fact]
    public async Task smoke_GETs_del_dominio_son_401_anonimos()
    {
        ComoAnonimo();
        var id = Guid.NewGuid();

        var rutas = new[]
        {
            "/api/maestros/" + id,
            "/api/maestros/siguiente-codigo?tipoCatalogo=Piloto",
            "/api/maestros/incidencias-sync",
        };

        foreach (var ruta in rutas)
        {
            var resp = await _client.GetAsync(ruta);
            Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
        }
    }

    [Fact]
    public async Task smoke_escrituras_del_dominio_son_401_anonimos_y_403_operador()
    {
        var id = Guid.NewGuid();
        var rutas = new (string, object?)[]
        {
            ($"/api/maestros/{id}", new SmsBackend.Domain.Maestros.GuardarMaestroRequest(
                SmsBackend.Domain.Maestros.TipoCatalogo.Piloto, "P-X", "X", null)),
            ($"/api/maestros/{id}", null), // DELETE
            ($"/api/maestros/{id}/aprobar", new SmsBackend.Domain.Maestros.AprobarMaestroRequest("P-9", null)),
            ($"/api/maestros/{id}/fusionar/{Guid.NewGuid()}", null),
        };

        ComoAnonimo();
        foreach (var (ruta, body) in rutas)
        {
            var (_, resp) = await LlamarAsync(ruta, body);
            Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
        }

        Como(await LoginTokenAsync("operador", "Operador123!"));
        foreach (var (ruta, body) in rutas)
        {
            var (_, resp) = await LlamarAsync(ruta, body);
            Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
        }
    }

    private async Task<(HttpMethod, HttpResponseMessage)> LlamarAsync(string ruta, object? body)
    {
        if (ruta.EndsWith("/aprobar") || ruta.Contains("/fusionar/"))
        {
            return (HttpMethod.Post, await _client.PostAsJsonAsync(ruta, body ?? new { }, TestData.Json));
        }
        if (body is SmsBackend.Domain.Maestros.GuardarMaestroRequest guardar)
        {
            return (HttpMethod.Put, await _client.PutAsJsonAsync(ruta, guardar, TestData.Json));
        }
        return (HttpMethod.Delete, await _client.DeleteAsync(ruta));
    }

    // ── No-regresión de dispositivo: /sync sigue anónimo (PR3) ────────────

    [Fact]
    public async Task POST_sync_sin_token_sigue_funcionando_dispositivo_no_claims()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        ComoAnonimo();
        var payload = TestData.SyncMaestroPayload(
            Guid.NewGuid(), escenario.BasculaCodigo,
            SmsBackend.Domain.Maestros.TipoCatalogo.Piloto, "P-AUTH-1", "Piloto Auth");

        var (resp, _) = await TestData.SyncMaestroAsync(_client, payload);

        Assert.False(
            resp.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden,
            $"el sync de dispositivo quedó gateado: {(int)resp.StatusCode}");
    }
}
