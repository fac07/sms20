using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using SmsBackend.Domain.Seguridad;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Vertical slice de autenticación (design D3, PR2 Phase 1): <c>login</c> es un
/// login mockeado REAL contra <see cref="Usuario"/> sembrado por
/// <c>SeguridadSeeder</c> (nunca un header fijo), <c>logout</c> revoca la
/// sesión (<see cref="SesionMock"/>), <c>yo</c> devuelve la identidad actual
/// para que el frontend (PR8/9) no tenga que decodificar el token.
/// </summary>
[Collection(ApiCollection.Name)]
[Trait("Category", "Seguridad")]
public sealed class AuthEndpointsTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public AuthEndpointsTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<HttpResponseMessage> LoginAsync(string usuario, string clave) =>
        _client.PostAsJsonAsync("/api/auth/login", new { nombreUsuario = usuario, clave }, TestData.Json);

    private async Task<ResultadoLogin> LoginOkAsync(string usuario, string clave)
    {
        var resp = await LoginAsync(usuario, clave);
        resp.EnsureSuccessStatusCode();
        return (await resp.Content.ReadFromJsonAsync<ResultadoLogin>(TestData.Json))!;
    }

    [Fact]
    public async Task Login_con_credenciales_validas_retorna_200_y_token()
    {
        var resp = await LoginAsync("operador", "Operador123!");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var dto = await resp.Content.ReadFromJsonAsync<ResultadoLogin>(TestData.Json);
        Assert.NotNull(dto);
        Assert.NotEmpty(dto!.Token);
        Assert.Equal(Rol.Operador, dto.Rol);
        Assert.Equal("operador", dto.NombreUsuario);
    }

    [Fact]
    public async Task Login_con_credenciales_invalidas_retorna_401()
    {
        var resp = await LoginAsync("operador", "clave-incorrecta");

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task Yo_con_token_valido_retorna_identidad_rol_y_centros()
    {
        // Supervisor (2 centros, alcance "asignado") en vez de Operador —
        // triangula contra el caso de un solo centro que ya cubre el test de
        // login de arriba.
        var login = await LoginOkAsync("supervisor", "Supervisor123!");
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.Token);

        var resp = await _client.GetAsync("/api/auth/yo");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var yo = await resp.Content.ReadFromJsonAsync<YoResponse>(TestData.Json);
        Assert.NotNull(yo);
        Assert.Equal(login.UsuarioId, yo!.UsuarioId);
        Assert.Equal("supervisor", yo.NombreUsuario);
        Assert.Equal(Rol.Supervisor, yo.Rol);
        Assert.Equal(2, yo.Centros.Count);
        Assert.Equal(ClaimsSms20.AlcanceAsignado, yo.Alcance);
    }

    [Fact]
    public async Task Yo_sin_token_retorna_401()
    {
        // ApiFactory (PR3) adjunta un token de Administrador por default a todo
        // cliente nuevo — este test prueba específicamente el caso SIN token.
        _client.DefaultRequestHeaders.Authorization = null;

        var resp = await _client.GetAsync("/api/auth/yo");

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task Logout_revoca_la_sesion_y_yo_deja_de_autenticar_con_ese_token()
    {
        var login = await LoginOkAsync("administrador", "Administrador123!");
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.Token);

        var yoAntes = await _client.GetAsync("/api/auth/yo");
        Assert.Equal(HttpStatusCode.OK, yoAntes.StatusCode);

        var logoutResp = await _client.PostAsync("/api/auth/logout", content: null);
        Assert.Equal(HttpStatusCode.OK, logoutResp.StatusCode);

        var yoDespues = await _client.GetAsync("/api/auth/yo");
        Assert.Equal(HttpStatusCode.Unauthorized, yoDespues.StatusCode);
    }

    [Fact]
    public async Task Logout_es_idempotente_sin_token_o_con_token_ya_revocado()
    {
        // Sin token: no debe fallar ni tirar 500 — RevocarAsync de la sesión
        // mock es idempotente ante "no existe" (design D3/IProveedorIdentidad).
        _client.DefaultRequestHeaders.Authorization = null;
        var sinToken = await _client.PostAsync("/api/auth/logout", content: null);
        Assert.Equal(HttpStatusCode.OK, sinToken.StatusCode);

        var login = await LoginOkAsync("operador", "Operador123!");
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.Token);
        (await _client.PostAsync("/api/auth/logout", content: null)).EnsureSuccessStatusCode();

        // Repetir logout sobre un token ya revocado sigue siendo 200.
        var segundo = await _client.PostAsync("/api/auth/logout", content: null);
        Assert.Equal(HttpStatusCode.OK, segundo.StatusCode);
    }
}
