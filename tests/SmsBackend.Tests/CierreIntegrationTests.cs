using System.Net;
using SmsBackend.Domain.Boletas;
using SmsBackend.Domain.Configuracion;
using SmsBackend.Domain.TiposMovimiento;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Bloqueo duro de cierre por HTTP (spec "Close-time validation motor — hard
/// block"): sección <c>Requerida</c> con un campo <c>Requerido</c> sin valor →
/// 422 + <c>ErrorCampo[]</c>, la boleta se queda <c>EnTransito</c>; con el valor
/// → <c>Cerrada</c>; reintentar con <c>{"forzar":true}</c> sigue siendo 422
/// (no hay bypass).
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class CierreIntegrationTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public CierreIntegrationTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<(Escenario Escenario, Guid CampoId)> ConfigurarSeccionRequeridaAsync()
    {
        var s = TestData.Sufijo();
        var seccion = await TestData.CrearSeccionAsync(_client, $"cierre_{s}");
        var campo = await TestData.CrearCampoAsync(_client, seccion.Id, "referencia_qa", TipoCampo.Texto, requerido: true);

        var escenario = await TestData.NuevoEscenarioAsync(_client);
        await TestData.AsignarSeccionesAsync(
            _client, escenario.TipoMovimientoId, new AsignacionSeccionRequest(seccion.Id, Requerida: true, Orden: 1));

        return (escenario, campo.Id);
    }

    [Fact]
    public async Task Campo_requerido_faltante_bloquea_el_cierre_y_la_boleta_queda_en_transito()
    {
        var (escenario, _) = await ConfigurarSeccionRequeridaAsync();
        var boleta = await TestData.CrearBoletaAsync(_client, escenario);

        var resp = await TestData.CerrarAsync(_client, boleta.Id);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, resp.StatusCode);
        Assert.NotEmpty(await TestData.LeerErroresAsync(resp));

        var recargada = await TestData.GetBoletaAsync(_client, boleta.Id);
        Assert.Equal(EstadoBoleta.EnTransito, recargada.Estado);
    }

    [Fact]
    public async Task Reintentar_con_forzar_true_sigue_siendo_422()
    {
        var (escenario, _) = await ConfigurarSeccionRequeridaAsync();
        var boleta = await TestData.CrearBoletaAsync(_client, escenario);

        var resp = await TestData.CerrarRawAsync(
            _client, boleta.Id,
            "{\"forzar\":true,\"pesoSalida\":900,\"origenPesoSalida\":\"Bascula\",\"usuarioSalida\":\"tester\"}");

        Assert.Equal(HttpStatusCode.UnprocessableEntity, resp.StatusCode);

        var recargada = await TestData.GetBoletaAsync(_client, boleta.Id);
        Assert.Equal(EstadoBoleta.EnTransito, recargada.Estado);
    }

    [Fact]
    public async Task Con_el_valor_requerido_presente_la_boleta_cierra()
    {
        var (escenario, campoId) = await ConfigurarSeccionRequeridaAsync();
        var boleta = await TestData.CrearBoletaAsync(
            _client, escenario, new[] { TestData.Texto(campoId, "QA-123") });

        var resp = await TestData.CerrarAsync(_client, boleta.Id);

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var recargada = await TestData.GetBoletaAsync(_client, boleta.Id);
        Assert.Equal(EstadoBoleta.Cerrada, recargada.Estado);
    }
}
