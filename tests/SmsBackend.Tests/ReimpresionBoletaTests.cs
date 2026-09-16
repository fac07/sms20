using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SmsBackend.Data;
using SmsBackend.Domain.Boletas;
using SmsBackend.Domain.Seguridad;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Registro de reimpresión (<c>POST /api/boletas/{id}/reimprimir</c>). En el
/// legacy (Informes/frmBoletas.cs) reimprimir era reabrir el preview sin
/// restricción ni huella; acá es la misma acción libre PERIODIC-AUDITED:
/// contador + último usuario/fecha sobre la propia Boleta (mismo patrón de
/// string plano que <see cref="Boleta.UsuarioAnula"/>, sin tabla nueva).
/// Solo boletas <c>Cerrada</c> o <c>Reemitida</c> — las demás (EnTransito sin
/// segundo pesaje, Anulada que no debe volver a circular) responden 409.
/// Gate <c>Politicas.Operador</c> a diferencia de las otras escrituras del
/// dominio (Administrador): es una acción operativa del mostrador — el chofer
/// perdió el papel y hay que entregarle otro, sin historial ni side effects
/// de negocio.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class ReimpresionBoletaTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public ReimpresionBoletaTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<HttpResponseMessage> ReimprimirAsync(Guid id, string usuario = "operador1") =>
        _client.PostAsJsonAsync($"/api/boletas/{id}/reimprimir", new { usuario }, TestData.Json);

    private async Task<BoletaDto> BoletaCerradaAsync(Escenario escenario)
    {
        var boleta = await TestData.CrearBoletaAsync(_client, escenario);
        (await TestData.CerrarAsync(_client, boleta.Id)).EnsureSuccessStatusCode();
        return await TestData.GetBoletaAsync(_client, boleta.Id);
    }

    [Fact]
    public async Task Reimprimir_boleta_cerrada_incrementa_contador_y_registra_usuario_fecha()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var cerrada = await BoletaCerradaAsync(escenario);
        var antes = DateTime.UtcNow;

        var resp = await ReimprimirAsync(cerrada.Id);
        resp.EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var leida = await TestData.GetBoletaAsync(_client, cerrada.Id);
        Assert.Equal(1, leida.CantidadReimpresiones);
        Assert.Equal("operador1", leida.UltimaReimpresionUsuario);
        Assert.NotNull(leida.UltimaReimpresionFecha);
        Assert.InRange(
            leida.UltimaReimpresionFecha!.Value,
            antes.AddSeconds(-5),
            DateTime.UtcNow.AddSeconds(5));
    }

    [Fact]
    public async Task Reimprimir_varias_veces_acumula_sin_tocar_el_resto()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var cerrada = await BoletaCerradaAsync(escenario);

        (await ReimprimirAsync(cerrada.Id, "operador1")).EnsureSuccessStatusCode();
        (await ReimprimirAsync(cerrada.Id, "operador2")).EnsureSuccessStatusCode();

        var leida = await TestData.GetBoletaAsync(_client, cerrada.Id);
        Assert.Equal(2, leida.CantidadReimpresiones);
        // Solo se pisa el USUARIO/FECHA de la última — el contador es el rastro
        // total; el estado y los pesos quedan intactos (no es una transición).
        Assert.Equal("operador2", leida.UltimaReimpresionUsuario);
        Assert.Equal(EstadoBoleta.Cerrada, leida.Estado);
        Assert.Equal(100m, leida.PesoNeto);
    }

    [Fact]
    public async Task Reimprimir_boleta_reemitida_tambien_es_valido()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var original = await BoletaCerradaAsync(escenario);
        (await _client.PostAsJsonAsync(
            $"/api/boletas/{original.Id}/anular",
            new AnularBoletaRequest("g", "s", "prueba"), TestData.Json)).EnsureSuccessStatusCode();
        var respRe = await _client.PostAsync($"/api/boletas/{original.Id}/reemitir",
            new StringContent(System.Text.Json.JsonSerializer.Serialize(new
            {
                numeroBoleta = TestData.NumeroBoleta(),
                pesoIngreso = 900,
                origenPesoIngreso = "Bascula",
                usuarioIngreso = "tester",
            }, TestData.Json), System.Text.Encoding.UTF8, "application/json"));
        respRe.EnsureSuccessStatusCode();

        var resp = await ReimprimirAsync(original.Id);

        resp.EnsureSuccessStatusCode();
        var leida = await TestData.GetBoletaAsync(_client, original.Id);
        Assert.Equal(EstadoBoleta.Reemitida, leida.Estado);
        Assert.Equal(1, leida.CantidadReimpresiones);
    }

    [Fact]
    public async Task Reimprimir_boleta_en_transito_es_409()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var enTransito = await TestData.CrearBoletaAsync(_client, escenario);

        var resp = await ReimprimirAsync(enTransito.Id);

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
    }

    [Fact]
    public async Task Reimprimir_boleta_anulada_es_409()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var cerrada = await BoletaCerradaAsync(escenario);
        (await _client.PostAsJsonAsync(
            $"/api/boletas/{cerrada.Id}/anular",
            new AnularBoletaRequest("g", "s", "prueba"), TestData.Json)).EnsureSuccessStatusCode();

        var resp = await ReimprimirAsync(cerrada.Id);

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
    }

    [Fact]
    public async Task Reimprimir_inexistente_es_404()
    {
        var resp = await ReimprimirAsync(Guid.NewGuid());
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task Reimprimir_sin_usuario_es_400()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var cerrada = await BoletaCerradaAsync(escenario);

        var resp = await ReimprimirAsync(cerrada.Id, "");

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var leida = await TestData.GetBoletaAsync(_client, cerrada.Id);
        Assert.Equal(0, leida.CantidadReimpresiones);
    }

    [Fact]
    public async Task Gate_es_Operador_anonimo_401_y_rol_Operador_200()
    {
        // El gate pedido para este endpoint es más laxo que las demás
        // escrituras del dominio (Administrador): nivel Operador lo prueba el
        // token de operador, que NO pasaría en cerrar/anular/reemitir.
        // El operador sembrado solo ve CentroA (SeguridadSeeder) y las boletas
        // están Centro-scoped por PR3, así que la báscula se mueve a CentroA
        // antes de crear/cerrar (misma técnica de CentroScopingTests).
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        await MoverBasculaACentroAAsync(escenario.BasculaId);
        var cerrada = await BoletaCerradaAsync(escenario);

        _client.DefaultRequestHeaders.Authorization = null;
        var anonimo = await ReimprimirAsync(cerrada.Id);
        Assert.Equal(HttpStatusCode.Unauthorized, anonimo.StatusCode);

        var login = await _client.PostAsJsonAsync(
            "/api/auth/login", new { nombreUsuario = "operador", clave = "Operador123!" }, TestData.Json);
        var resultado = await login.Content.ReadFromJsonAsync<ResultadoLogin>(TestData.Json);
        _client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", resultado!.Token);

        var operador = await ReimprimirAsync(cerrada.Id);
        Assert.Equal(HttpStatusCode.OK, operador.StatusCode);
    }

    private static readonly Guid CentroA = new("11111111-1111-1111-1111-111111111111");

    private async Task MoverBasculaACentroAAsync(Guid basculaId)
    {
        using var scope = _factory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SmsDbContext>();
        if (!await db.Maestros.AnyAsync(m => m.Id == CentroA))
        {
            db.Maestros.Add(new SmsBackend.Domain.Maestros.Maestro
            {
                Id = CentroA,
                TipoCatalogo = SmsBackend.Domain.Maestros.TipoCatalogo.Centro,
                Codigo = $"C-{TestData.Sufijo()}",
                Nombre = $"Centro {TestData.Sufijo()}",
                Activo = true,
            });
            await db.SaveChangesAsync();
        }

        // IgnoreQueryFilters: el scope del test no trae HttpContext y el
        // HasQueryFilter de Centro (PR3) filtraría la báscula a cero.
        var bascula = await db.Basculas.IgnoreQueryFilters().SingleAsync(b => b.Id == basculaId);
        bascula.CentroId = CentroA;
        await db.SaveChangesAsync();
    }
}
