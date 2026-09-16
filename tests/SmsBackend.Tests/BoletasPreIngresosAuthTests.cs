using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using SmsBackend.Domain.PreIngresos;
using SmsBackend.Domain.Seguridad;
using Xunit;

namespace SmsBackend.Tests;

[Collection(ApiCollection.Name)]
[Trait("Category", "Seguridad")]
public sealed class BoletasPreIngresosAuthTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public BoletasPreIngresosAuthTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task AutenticarAsync(string usuario, string clave)
    {
        _client.DefaultRequestHeaders.Authorization = null;
        var resp = await _client.PostAsJsonAsync(
            "/api/auth/login", new { nombreUsuario = usuario, clave }, TestData.Json);
        resp.EnsureSuccessStatusCode();
        var login = await resp.Content.ReadFromJsonAsync<ResultadoLogin>(TestData.Json);
        _client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", login!.Token);
    }

    private static HttpRequestMessage Request(HttpMethod method, string path) =>
        new(method, path)
        {
            Content = method == HttpMethod.Get
                ? null
                : JsonContent.Create(new { }, options: TestData.Json),
        };

    public static TheoryData<HttpMethod, string> RutasHumanas => new()
    {
        { HttpMethod.Get, "/api/boletas/" },
        { HttpMethod.Get, $"/api/boletas/{Guid.NewGuid()}" },
        { HttpMethod.Post, "/api/boletas/" },
        { HttpMethod.Post, $"/api/boletas/{Guid.NewGuid()}/cerrar" },
        { HttpMethod.Post, $"/api/boletas/{Guid.NewGuid()}/anular" },
        { HttpMethod.Post, $"/api/boletas/{Guid.NewGuid()}/reemitir" },
        { HttpMethod.Get, $"/api/preingresos/{Guid.NewGuid()}" },
        { HttpMethod.Post, "/api/preingresos/" },
        { HttpMethod.Put, $"/api/preingresos/{Guid.NewGuid()}" },
        { HttpMethod.Put, $"/api/preingresos/{Guid.NewGuid()}/observaciones" },
        { HttpMethod.Post, $"/api/preingresos/{Guid.NewGuid()}/cancelar" },
    };

    [Theory]
    [MemberData(nameof(RutasHumanas))]
    public async Task Cada_ruta_humana_rechaza_al_anonimo(HttpMethod method, string path)
    {
        _client.DefaultRequestHeaders.Authorization = null;

        var resp = await _client.SendAsync(Request(method, path));

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task GET_boletas_con_Operador_es_200()
    {
        await AutenticarAsync("operador", "Operador123!");

        var resp = await _client.GetAsync("/api/boletas/");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    [Fact]
    public async Task GET_preingresos_root_sin_autenticacion_humana_es_200()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var alta = await _client.PostAsJsonAsync(
            "/api/preingresos/",
            new CrearPreIngresoRequest(
                escenario.CentroId, $"SYNC-{TestData.Sufijo()}", 15000m,
                UsuarioCreacion: "terminal-sync-test"),
            TestData.Json);
        alta.EnsureSuccessStatusCode();
        var creado = await alta.Content.ReadFromJsonAsync<PreIngresoDto>(TestData.Json);

        _client.DefaultRequestHeaders.Authorization = null;

        var resp = await _client.GetAsync($"/api/preingresos?centroId={escenario.CentroId}");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var listado = await resp.Content.ReadFromJsonAsync<PreIngresoDto[]>(TestData.Json);
        Assert.Contains(listado!, p => p.Id == creado!.Id);
    }

    [Fact]
    public async Task PUT_observaciones_con_Operador_es_403_y_con_Administrador_es_200()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var request = new CrearPreIngresoRequest(
            escenario.CentroId, $"AUTH-{TestData.Sufijo()}", 12000m,
            UsuarioCreacion: "auth-test");
        var creado = await _client.PostAsJsonAsync("/api/preingresos/", request, TestData.Json);
        creado.EnsureSuccessStatusCode();
        var preingreso = await creado.Content.ReadFromJsonAsync<PreIngresoDto>(TestData.Json);

        await AutenticarAsync("operador", "Operador123!");
        var operador = await _client.PutAsJsonAsync(
            $"/api/preingresos/{preingreso!.Id}/observaciones",
            new EditarObservacionesPreIngresoRequest("operador"), TestData.Json);
        Assert.Equal(HttpStatusCode.Forbidden, operador.StatusCode);

        await AutenticarAsync("administrador", "Administrador123!");
        var administrador = await _client.PutAsJsonAsync(
            $"/api/preingresos/{preingreso.Id}/observaciones",
            new EditarObservacionesPreIngresoRequest("administrador"), TestData.Json);
        Assert.Equal(HttpStatusCode.OK, administrador.StatusCode);
    }

    [Fact]
    public async Task Resto_de_rutas_pasa_autorizacion_con_el_rol_correcto()
    {
        await AutenticarAsync("operador", "Operador123!");
        foreach (var path in new[]
                 {
                     $"/api/boletas/{Guid.NewGuid()}",
                     "/api/preingresos/",
                     $"/api/preingresos/{Guid.NewGuid()}",
                 })
        {
            var resp = await _client.GetAsync(path);
            Assert.DoesNotContain(resp.StatusCode, new[] { HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden });
        }

        await AutenticarAsync("administrador", "Administrador123!");
        foreach (var (method, path) in RutasHumanas
                     .Where(r => r[0] is HttpMethod method && method != HttpMethod.Get)
                     .Select(r => ((HttpMethod)r[0], (string)r[1])))
        {
            var resp = await _client.SendAsync(Request(method, path));
            Assert.DoesNotContain(resp.StatusCode, new[] { HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden });
        }
    }

    [Fact]
    public async Task POST_boletas_sync_sigue_sin_autorizacion_humana()
    {
        _client.DefaultRequestHeaders.Authorization = null;

        var resp = await _client.PostAsJsonAsync(
            "/api/boletas/sync",
            new { basculaCodigo = "inexistente", operacion = "Crear", payload = new { } },
            TestData.Json);

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }
}
