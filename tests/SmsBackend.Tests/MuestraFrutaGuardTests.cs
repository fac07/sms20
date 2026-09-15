using System.Net;
using System.Net.Http.Json;
using SmsBackend.Domain.Boletas;
using SmsBackend.Domain.Boletas.Valores;
using SmsBackend.Domain.Configuracion;
using SmsBackend.Domain.Maestros;
using SmsBackend.Domain.TiposMovimiento;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Guard de muestra de racimos al cierre (espejo del legacy NAT_Basculas
/// frmCalidadFruta: guarda la calidad SOLO si 0 &lt; verdes+maduros+
/// sobremaduros+pasados &lt;= 30 — frmCalidadFruta.cs:117-128). Vive AFUERA de
/// <c>MotorCampos</c> (congelado por paridad) como <c>GuardiaMuestraFruta</c>,
/// mismo estilo que <c>GuardiaVinculoTransporte</c>: estático, devuelve
/// <c>IResult?</c> y el endpoint lo devuelve tal cual antes de mutar.
///
/// <c>racimos_pedunculo_largo</c> NO entra en la suma (tampoco en el legacy).
/// Si la boleta no capturó ninguno de los cuatro contadores, el guard no
/// aplica — no toda báscula pesa fruta con muestra de calidad. La ingesta de
/// sync NO re-valida (design D3/D8): la decisión ya se tomó al cerrar.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class MuestraFrutaGuardTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public MuestraFrutaGuardTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private sealed record Muestra(
        Escenario Escenario,
        Guid Finca,
        Guid Verde,
        Guid Maduro,
        Guid Sobre,
        Guid Pasado,
        Guid Pedunculo);

    private async Task<Muestra> NuevoEscenarioConDetalleFrutaAsync()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var secciones = await _client.GetFromJsonAsync<List<SeccionDto>>("/api/secciones", TestData.Json);
        var detalle = secciones!.Single(s => s.Clave == "detalle_fruta");
        await TestData.AsignarSeccionesAsync(
            _client, escenario.TipoMovimientoId,
            new AsignacionSeccionRequest(detalle.Id, Requerida: false, Orden: 1));
        var formulario = await TestData.FormularioAsync(_client, escenario.TipoMovimientoId);
        Guid Id(string clave) => TestData.CampoId(formulario, "detalle_fruta", clave);
        return new Muestra(escenario, Id("finca"), Id("racimos_verdes"), Id("racimos_maduros"),
            Id("racimos_sobremaduros"), Id("racimos_pasados"), Id("racimos_pedunculo_largo"));
    }

    /// <summary>
    /// Una ocurrencia de detalle_fruta siempre arrastra su <c>finca</c>
    /// (regla 2 del motor: campo requerido dentro de cada ocurrencia
    /// capturada). Los contadores son opcionales.
    /// </summary>
    private static List<ValorCampoDto> Valores(
        Muestra m, Guid maestroFinca, params (int Ocurrencia, Guid Campo, decimal Valor)[] contadores)
    {
        var ocurrencias = contadores.Select(c => c.Ocurrencia).Distinct();
        var valores = ocurrencias
            .Select(o => TestData.Referencia(m.Finca, maestroFinca, o))
            .ToList();
        valores.AddRange(contadores.Select(c => TestData.Numero(c.Campo, c.Valor, c.Ocurrencia)));
        return valores;
    }

    private async Task<(Guid BoletaId, Guid FincaMaestroId)> CrearConValoresAsync(
        Muestra m, params (int Ocurrencia, Guid Campo, decimal Valor)[] contadores)
    {
        var finca = await TestData.CrearMaestroAsync(_client, TipoCatalogo.Finca);
        var boleta = await TestData.CrearBoletaAsync(
            _client, m.Escenario, Valores(m, finca.Id, contadores));
        return (boleta.Id, finca.Id);
    }

    [Fact]
    public async Task Cerrar_muestra_de_exactamente_30_es_valida()
    {
        var m = await NuevoEscenarioConDetalleFrutaAsync();
        var (boletaId, _) = await CrearConValoresAsync(
            m, (0, m.Verde, 10), (0, m.Maduro, 20));

        var resp = await TestData.CerrarAsync(_client, boletaId);

        resp.EnsureSuccessStatusCode();
        var boleta = await TestData.GetBoletaAsync(_client, boletaId);
        Assert.Equal(EstadoBoleta.Cerrada, boleta.Estado);
    }

    [Fact]
    public async Task Cerrar_muestra_de_31_es_400_y_la_boleta_sigue_EnTransito()
    {
        var m = await NuevoEscenarioConDetalleFrutaAsync();
        var (boletaId, _) = await CrearConValoresAsync(
            m, (0, m.Verde, 10), (0, m.Sobre, 21));

        var resp = await TestData.CerrarAsync(_client, boletaId);

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var boleta = await TestData.GetBoletaAsync(_client, boletaId);
        Assert.Equal(EstadoBoleta.EnTransito, boleta.Estado);
    }

    [Fact]
    public async Task Cerrar_muestra_todos_los_contadores_en_cero_es_400()
    {
        var m = await NuevoEscenarioConDetalleFrutaAsync();
        var (boletaId, _) = await CrearConValoresAsync(
            m, (0, m.Verde, 0), (0, m.Maduro, 0), (0, m.Sobre, 0), (0, m.Pasado, 0));

        var resp = await TestData.CerrarAsync(_client, boletaId);

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Cerrar_sin_ningun_contador_capturado_no_aplica_el_guard()
    {
        var m = await NuevoEscenarioConDetalleFrutaAsync();
        var (boletaId, _) = await CrearConValoresAsync(m);

        var resp = await TestData.CerrarAsync(_client, boletaId);

        resp.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task La_suma_cruza_ocurrencias_de_la_seccion_repetible()
    {
        var m = await NuevoEscenarioConDetalleFrutaAsync();
        var (boletaId, _) = await CrearConValoresAsync(
            m, (0, m.Verde, 20), (1, m.Maduro, 15));

        var resp = await TestData.CerrarAsync(_client, boletaId);

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Pedunculo_largo_no_suma_para_el_guard()
    {
        var m = await NuevoEscenarioConDetalleFrutaAsync();
        var (boletaId, _) = await CrearConValoresAsync(
            m, (0, m.Verde, 30), (0, m.Pedunculo, 50));

        var resp = await TestData.CerrarAsync(_client, boletaId);

        resp.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Pasados_y_sobremaduros_suman()
    {
        var m = await NuevoEscenarioConDetalleFrutaAsync();
        var (boletaId, _) = await CrearConValoresAsync(
            m, (0, m.Pasado, 2), (0, m.Sobre, 29));

        var resp = await TestData.CerrarAsync(_client, boletaId);

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Cerrar_muestra_con_suma_negativa_es_400()
    {
        var m = await NuevoEscenarioConDetalleFrutaAsync();
        var (boletaId, _) = await CrearConValoresAsync(
            m, (0, m.Verde, -5), (0, m.Maduro, 3));

        var resp = await TestData.CerrarAsync(_client, boletaId);

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }
}
