using Microsoft.Extensions.DependencyInjection;
using SmsBackend.Domain.Boletas.Valores;
using SmsBackend.Domain.Configuracion;
using SmsBackend.Domain.Maestros;
using SmsBackend.Domain.TiposMovimiento;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// <see cref="MotorCampos"/> resuelto del contenedor, contra la base de la
/// fixture. Verifica el acuerdo columna-tipada por <c>TipoCampo</c> más las
/// restricciones de <see cref="ConfiguracionCampo"/> (min/max/decimales/regex/
/// opciones) y la referencia a maestro (activo + <c>TipoCatalogo</c>). Al menos
/// un caso que pasa y uno que falla por rama que importa.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class MotorCamposTests : IAsyncLifetime
{
    private static DateTime AsOf => DateTime.UtcNow.AddHours(1);

    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public MotorCamposTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<(Guid TmId, Dictionary<string, Guid> Campos)> ConfigurarAsync(
        params (string Clave, TipoCampo Tipo, string? Cfg, TipoCatalogo? Ref)[] campos)
    {
        var s = TestData.Sufijo();
        var seccion = await TestData.CrearSeccionAsync(_client, $"motor_{s}");
        var mapa = new Dictionary<string, Guid>();

        var orden = 1;
        foreach (var (clave, tipo, cfg, refCat) in campos)
        {
            var campo = await TestData.CrearCampoAsync(
                _client, seccion.Id, clave, tipo, requerido: false, configuracion: cfg, catalogoRef: refCat, orden: orden++);
            mapa[clave] = campo.Id;
        }

        var escenario = await TestData.NuevoEscenarioAsync(_client);
        await TestData.AsignarSeccionesAsync(
            _client, escenario.TipoMovimientoId, new AsignacionSeccionRequest(seccion.Id, false, 1));

        return (escenario.TipoMovimientoId, mapa);
    }

    private async Task<IReadOnlyList<ErrorCampo>> ValidarAsync(Guid tmId, params ValorCampoDto[] valores)
    {
        using var scope = _factory.CreateScope();
        var motor = scope.ServiceProvider.GetRequiredService<MotorCampos>();
        return await motor.ValidarValoresAsync(tmId, AsOf, valores, CancellationToken.None);
    }

    [Fact]
    public async Task Decimal_respeta_columna_max_y_decimales()
    {
        var (tm, campos) = await ConfigurarAsync(
            ("acidez", TipoCampo.Decimal, "{\"max\":100,\"decimales\":2}", null));
        var id = campos["acidez"];

        Assert.Empty(await ValidarAsync(tm, TestData.Numero(id, 50.25m)));
        Assert.NotEmpty(await ValidarAsync(tm, TestData.Numero(id, 250m)));
        Assert.NotEmpty(await ValidarAsync(tm, TestData.Numero(id, 1.234m)));
        Assert.NotEmpty(await ValidarAsync(tm, TestData.Texto(id, "no-es-numero")));
    }

    [Fact]
    public async Task Entero_rechaza_parte_decimal_y_fuera_de_rango()
    {
        var (tm, campos) = await ConfigurarAsync(
            ("racimos", TipoCampo.Entero, "{\"min\":0,\"max\":10}", null));
        var id = campos["racimos"];

        Assert.Empty(await ValidarAsync(tm, TestData.Numero(id, 5m)));
        Assert.NotEmpty(await ValidarAsync(tm, TestData.Numero(id, 5.5m)));
        Assert.NotEmpty(await ValidarAsync(tm, TestData.Numero(id, 20m)));
    }

    [Fact]
    public async Task Texto_respeta_maxlength_y_regex()
    {
        var (tm, campos) = await ConfigurarAsync(
            ("codigo", TipoCampo.Texto, "{\"maxLength\":5,\"regex\":\"^[A-Z]+$\"}", null));
        var id = campos["codigo"];

        Assert.Empty(await ValidarAsync(tm, TestData.Texto(id, "ABC")));
        Assert.NotEmpty(await ValidarAsync(tm, TestData.Texto(id, "ABCDEF")));
        Assert.NotEmpty(await ValidarAsync(tm, TestData.Texto(id, "abc")));
    }

    [Fact]
    public async Task Lista_solo_admite_una_opcion_configurada()
    {
        var (tm, campos) = await ConfigurarAsync(
            ("color", TipoCampo.Lista, "{\"opciones\":[\"rojo\",\"verde\"]}", null));
        var id = campos["color"];

        Assert.Empty(await ValidarAsync(tm, TestData.Texto(id, "rojo")));
        Assert.NotEmpty(await ValidarAsync(tm, TestData.Texto(id, "azul")));
    }

    [Fact]
    public async Task Booleano_acepta_columna_booleana()
    {
        var (tm, campos) = await ConfigurarAsync(("activo", TipoCampo.Booleano, null, null));
        var id = campos["activo"];

        Assert.Empty(await ValidarAsync(tm, TestData.Booleano(id, true)));
        Assert.NotEmpty(await ValidarAsync(tm, TestData.Texto(id, "true")));
    }

    [Fact]
    public async Task ReferenciaMaestro_exige_maestro_activo_del_catalogo_esperado()
    {
        var (tm, campos) = await ConfigurarAsync(
            ("equipo", TipoCampo.ReferenciaMaestro, null, TipoCatalogo.Equipo));
        var id = campos["equipo"];
        var s = TestData.Sufijo();

        var equipo = await TestData.PostAsync<MaestroDto>(_client, "/api/maestros",
            new GuardarMaestroRequest(TipoCatalogo.Equipo, $"EQ-{s}", $"Equipo {s}", null));
        var producto = await TestData.PostAsync<MaestroDto>(_client, "/api/maestros",
            new GuardarMaestroRequest(TipoCatalogo.Producto, $"PR-{s}", $"Producto {s}", null));
        var equipoInactivo = await TestData.PostAsync<MaestroDto>(_client, "/api/maestros",
            new GuardarMaestroRequest(TipoCatalogo.Equipo, $"EQX-{s}", $"Equipo inactivo {s}", null));
        (await _client.DeleteAsync($"/api/maestros/{equipoInactivo.Id}")).EnsureSuccessStatusCode();

        Assert.Empty(await ValidarAsync(tm, TestData.Referencia(id, equipo.Id)));
        Assert.NotEmpty(await ValidarAsync(tm, TestData.Referencia(id, producto.Id)));
        Assert.NotEmpty(await ValidarAsync(tm, TestData.Referencia(id, equipoInactivo.Id)));
    }

    [Fact]
    public async Task Rechaza_un_campoid_fuera_del_conjunto_vigente()
    {
        var (tm, _) = await ConfigurarAsync(("acidez", TipoCampo.Decimal, null, null));

        var errores = await ValidarAsync(tm, TestData.Numero(Guid.NewGuid(), 1m));

        Assert.NotEmpty(errores);
    }
}
