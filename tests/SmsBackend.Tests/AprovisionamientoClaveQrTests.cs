using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using SmsBackend.Domain.Basculas;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Distribución de la clave HMAC del QR de transferencia: viaja SOLO en la
/// respuesta del aprovisionamiento (código de un solo uso, con vencimiento) y
/// sale de la configuración del servidor (<c>Qr:ClaveHmac</c>), nunca de la DB
/// ni de un archivo versionado. El endpoint de configuración del centro es
/// anónimo (identidad de terminal) y NO debe exponerla.
/// </summary>
[Collection(ApiCollection.Name)]
[Trait("Category", "Seguridad")]
public sealed class AprovisionamientoClaveQrTests : IAsyncLifetime
{
    // Base64 de 32 bytes (0x00..0x1F) — el mínimo aceptado.
    private static readonly string ClaveValida = Convert.ToBase64String(Enumerable.Range(0, 32).Select(i => (byte)i).ToArray());

    private readonly ApiFactory _factory;
    private readonly HttpClient _admin;

    public AprovisionamientoClaveQrTests(ApiFactory factory)
    {
        _factory = factory;
        _admin = factory.CreateClient();
    }

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    // Mismo host y misma base descartable que la fixture, pero con la clave
    // (o su ausencia explícita: null pisa cualquier Qr__ClaveHmac del entorno
    // del dev) inyectada como configuración.
    private WebApplicationFactory<Program> ConClave(string? clave) =>
        _factory.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, cfg) =>
            cfg.AddInMemoryCollection(new Dictionary<string, string?> { ["Qr:ClaveHmac"] = clave })));

    private async Task<(Escenario Escenario, string Codigo)> NuevoCodigoAsync()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_admin);
        var resp = await _admin.PostAsync($"/api/basculas/{escenario.BasculaId}/generar-codigo", content: null);
        resp.EnsureSuccessStatusCode();
        var codigo = await resp.Content.ReadFromJsonAsync<CodigoAprovisionamientoDto>(TestData.Json);
        return (escenario, codigo!.Codigo);
    }

    private static Task<HttpResponseMessage> AprovisionarAsync(HttpClient anonimo, string codigo) =>
        anonimo.PostAsJsonAsync("/api/basculas/aprovisionar", new AprovisionarBasculaRequest(codigo), TestData.Json);

    [Fact]
    public async Task Aprovisionar_con_clave_configurada_devuelve_ClaveQr()
    {
        var (_, codigo) = await NuevoCodigoAsync();
        using var host = ConClave(ClaveValida);
        using var anonimo = host.CreateClient();

        var resp = await AprovisionarAsync(anonimo, codigo);

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var dto = await resp.Content.ReadFromJsonAsync<AprovisionamientoDto>(TestData.Json);
        Assert.Equal(ClaveValida, dto!.ClaveQr);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("no-es-base64!!")]
    // Base64 válido pero de solo 16 bytes: clave demasiado corta.
    [InlineData("AAECAwQFBgcICQoLDA0ODw==")]
    public async Task Aprovisionar_sin_clave_o_con_clave_malformada_devuelve_null_y_aprovisiona(string? clave)
    {
        var (escenario, codigo) = await NuevoCodigoAsync();
        using var host = ConClave(clave);
        using var anonimo = host.CreateClient();

        var resp = await AprovisionarAsync(anonimo, codigo);

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var dto = await resp.Content.ReadFromJsonAsync<AprovisionamientoDto>(TestData.Json);
        Assert.Null(dto!.ClaveQr);
        Assert.Equal(escenario.BasculaId, dto.BasculaId);
    }

    [Fact]
    public async Task Configuracion_del_centro_anonima_nunca_expone_la_clave()
    {
        var (escenario, _) = await NuevoCodigoAsync();
        using var host = ConClave(ClaveValida);
        using var anonimo = host.CreateClient();

        var resp = await anonimo.GetAsync($"/api/centros/{escenario.CentroId}/configuracion");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var cuerpo = await resp.Content.ReadAsStringAsync();
        Assert.DoesNotContain(ClaveValida, cuerpo);
        Assert.DoesNotContain("claveQr", cuerpo, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    // El código se anula al consumirse, así que la reutilización responde 404
    // (el 409 "ya aprovisionada" de la rama defensiva no es alcanzable con el
    // mismo código). Este cambio no altera ese comportamiento.
    public async Task Reutilizar_el_codigo_sigue_rechazado_y_no_entrega_la_clave()
    {
        var (_, codigo) = await NuevoCodigoAsync();
        using var host = ConClave(ClaveValida);
        using var anonimo = host.CreateClient();

        (await AprovisionarAsync(anonimo, codigo)).EnsureSuccessStatusCode();
        var segundo = await AprovisionarAsync(anonimo, codigo);

        Assert.Equal(HttpStatusCode.NotFound, segundo.StatusCode);
        Assert.DoesNotContain(ClaveValida, await segundo.Content.ReadAsStringAsync());
    }
}
