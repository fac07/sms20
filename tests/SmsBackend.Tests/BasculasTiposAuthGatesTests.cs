using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using SmsBackend.Domain.Seguridad;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Gateo de Basculas (5 de 9 rutas) + TiposMovimiento (6 de 8) — PR5 del
/// change autenticacion-y-roles. Criterio idéntico a PR4, cruzando
/// app.routes.ts: GET → Operador siempre; escrituras de dominios cuya
/// pantalla es modo:'admin' (BasculasPage, TiposMovimientoPage) →
/// Administrador.
///
/// Sin gate por <em>identidad de dispositivo</em> (verificados uno a uno
/// contra config-sync.ts / maestros-sync.ts / preingreso-sync.ts — todo GET
/// cuyo path aparezca ahí corre sin token y queda afuera del gate, mismo
/// tratamiento que PR3 dio a las escrituras ping/aprovisionar):
/// <c>POST /{id}/ping</c> y <c>POST /aprovisionar</c> (resueltos en PR3),
/// <c>POST /{id}/generar-codigo</c> (sin gate por indicación expresa del
/// plan — anotado), <c>GET /api/basculas/{id}</c> (trío de ingreso manual +
/// backfill de centro, config-sync), <c>GET /api/tipos-movimiento</c> y
/// <c>GET /{id}/secciones</c> (fan-out de config-sync).
///
/// Como en PR4: bajo Operador no hay rol, así que ese nivel se defiende con
/// su 401 anónimo; el 403 solo existe contra Administrador.
/// </summary>
[Collection(ApiCollection.Name)]
[Trait("Category", "Seguridad")]
public sealed class BasculasTiposAuthGatesTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public BasculasTiposAuthGatesTests(ApiFactory factory)
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

    // ── Representante Operador: GET /api/basculas ──────────────────────────

    [Fact]
    public async Task GET_basculas_sin_token_es_401()
    {
        ComoAnonimo();
        var resp = await _client.GetAsync("/api/basculas");
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task GET_basculas_con_Operador_es_200()
    {
        Como(await LoginTokenAsync("operador", "Operador123!"));
        var resp = await _client.GetAsync("/api/basculas");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    // ── Representante Administrador: POST /api/basculas ────────────────────

    [Fact]
    public async Task POST_basculas_sin_token_es_401()
    {
        ComoAnonimo();
        var resp = await _client.PostAsJsonAsync(
            "/api/basculas", GuardarBascula("B-AUTH"), TestData.Json);
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task POST_basculas_con_Operador_es_403_y_con_Administrador_es_201()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);

        Como(await LoginTokenAsync("operador", "Operador123!"));
        var prohibido = await _client.PostAsJsonAsync(
            "/api/basculas", GuardarBascula("B-AUTH", escenario.CentroId), TestData.Json);
        Assert.Equal(HttpStatusCode.Forbidden, prohibido.StatusCode);

        Como(await LoginTokenAsync("administrador", "Administrador123!"));
        var permitido = await _client.PostAsJsonAsync(
            "/api/basculas", GuardarBascula("B-AUTH", escenario.CentroId), TestData.Json);
        Assert.Equal(HttpStatusCode.Created, permitido.StatusCode);
    }

    private object GuardarBascula(string codigo, Guid? centroId = null) => new
    {
        codigo,
        nombre = $"Bascula {codigo}",
        centroId = centroId ?? Guid.Empty,
        tipoConexion = "Serial",
        puerto = "COM1",
        ip = (string?)null,
        puertoTcp = (int?)null,
        velocidad = 9600,
        bitsDatos = 8,
        modoComunicacion = "STX",
    };

    // ── Smoke: resto de rutas por nivel ────────────────────────────────────

    [Fact]
    public async Task smoke_GETs_restantes_son_401_anonimos()
    {
        ComoAnonimo();
        var id = Guid.NewGuid();
        var rutas = new[]
        {
            $"/api/tipos-movimiento/{id}",
            $"/api/tipos-movimiento/{id}/formulario",
        };

        foreach (var ruta in rutas)
        {
            var resp = await _client.GetAsync(ruta);
            Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
        }
    }

    [Fact]
    public async Task smoke_escrituras_restantes_son_401_anonimas_y_403_operador()
    {
        var id = Guid.NewGuid();
        var llamadas = new (HttpMethod, string, object?)[]
        {
            (HttpMethod.Put, $"/api/basculas/{id}", GuardarBascula("B-X")),
            (HttpMethod.Delete, $"/api/basculas/{id}", null),
            (HttpMethod.Put, $"/api/basculas/{id}/ingreso-manual", new
            {
                permiteIngresoManual = true,
                pesoMinimoManual = (decimal?)null,
                pesoMaximoManual = (decimal?)null,
            }),
            (HttpMethod.Post, "/api/tipos-movimiento", new
            {
                codigo = "TMX",
                nombre = "Tipo X",
                prefijo = "TM",
                direccion = "Entrada",
                operacionD365 = (string?)null,
                generaQR = false,
                formatoBoletaId = (Guid?)null,
            }),
            (HttpMethod.Put, $"/api/tipos-movimiento/{id}", new
            {
                codigo = "TMX",
                nombre = "Tipo X",
                prefijo = "TM",
                direccion = "Entrada",
                operacionD365 = (string?)null,
                generaQR = false,
                formatoBoletaId = (Guid?)null,
            }),
            (HttpMethod.Delete, $"/api/tipos-movimiento/{id}", null),
            (HttpMethod.Put, $"/api/tipos-movimiento/{id}/secciones", Array.Empty<object>()),
        };

        ComoAnonimo();
        foreach (var (metodo, ruta, body) in llamadas)
        {
            var resp = await LlamarAsync(metodo, ruta, body);
            Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
        }

        Como(await LoginTokenAsync("operador", "Operador123!"));
        foreach (var (metodo, ruta, body) in llamadas)
        {
            var resp = await LlamarAsync(metodo, ruta, body);
            Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
        }
    }

    private async Task<HttpResponseMessage> LlamarAsync(HttpMethod metodo, string ruta, object? body)
    {
        if (metodo == HttpMethod.Delete) return await _client.DeleteAsync(ruta);
        if (body is null) return await _client.PostAsync(ruta, new StringContent("{}", null, "application/json"));
        return metodo == HttpMethod.Put
            ? await _client.PutAsJsonAsync(ruta, body, TestData.Json)
            : await _client.PostAsJsonAsync(ruta, body, TestData.Json);
    }

    // ── No-regresión de dispositivo: ping/aprovisionar/generar-codigo siguen abiertas ──

    [Fact]
    public async Task rutas_de_dispositivo_y_codigo_no_quedan_gateadas()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        ComoAnonimo();

        var ping = await _client.PostAsync($"/api/basculas/{escenario.BasculaId}/ping", content: null);
        Assert.Equal(HttpStatusCode.NoContent, ping.StatusCode);

        var aprovisionar = await _client.PostAsJsonAsync(
            "/api/basculas/aprovisionar", new { codigo = "INEXISTENTE" }, TestData.Json);
        Assert.Equal(HttpStatusCode.NotFound, aprovisionar.StatusCode); // 404 de negocio, no 401

        var generarCodigo = await _client.PostAsync(
            $"/api/basculas/{escenario.BasculaId}/generar-codigo", content: null);
        // No gate (indicación del plan). Llega 404 por el HasQueryFilter de
        // Centro de PR3 (caller anónimo no ve ninguna báscula), no por
        // autorización — se comprueba la ausencia de 401/403, no el 404.
        Assert.False(
            generarCodigo.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden,
            $"generar-codigo quedó gateada por error: {(int)generarCodigo.StatusCode}");
    }

    [Fact]
    public async Task GET_bascula_propia_sin_token_sigue_devolviendo_datos_pull_config_sync()
    {
        // config-sync.ts baja GET /api/basculas/{id} cada 60s sin token
        // (trío de ingreso manual + backfill de centro) — patrón
        // DeviceSyncRegressionTests: datos, no 401.
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        ComoAnonimo();

        var resp = await _client.GetAsync($"/api/basculas/{escenario.BasculaId}");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    [Fact]
    public async Task GET_tipos_movimiento_y_secciones_sin_token_siguen_devolviendo_datos_pull_config_sync()
    {
        // El fan-out de config-sync.ts:295-301 (GET /api/tipos-movimiento y
        // GET /{id}/secciones por tipo) corre anónimo cada ciclo.
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        ComoAnonimo();

        var tipos = await _client.GetAsync("/api/tipos-movimiento?incluirInactivos=true");
        Assert.Equal(HttpStatusCode.OK, tipos.StatusCode);

        var secciones = await _client.GetAsync(
            $"/api/tipos-movimiento/{escenario.TipoMovimientoId}/secciones");
        Assert.Equal(HttpStatusCode.OK, secciones.StatusCode);
    }
}
