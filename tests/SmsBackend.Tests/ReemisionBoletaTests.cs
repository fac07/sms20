using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using SmsBackend.Domain.Boletas;
using SmsBackend.Domain.Configuracion;
using SmsBackend.Domain.TiposMovimiento;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Re-emisión de boleta (<c>POST /api/boletas/{id}/reemitir</c>). Precedente
/// legacy (NAT_Basculas frmBoletas/clsBoleta): la re-emisión solo aplica sobre
/// boletas YA anuladas (-2/-3), es de una sola vez (guard
/// <c>ID_Boleta_Nueva_X_Anulacion is null</c>) y nunca anula ni borra la
/// original. El vínculo es unidireccional — la original apunta a la nueva por
/// <c>BoletaReemplazoId</c>; <c>BoletaOrigenId</c> queda reservado para
/// recepción de transferencia (esquema v7). La original pasa de Anulada a
/// Reemitida conservando toda la metadata de anulación como historia.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class ReemisionBoletaTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public ReemisionBoletaTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<HttpResponseMessage> AnularAsync(Guid boletaId, string motivo = "error de captura") =>
        _client.PostAsJsonAsync(
            $"/api/boletas/{boletaId}/anular",
            new AnularBoletaRequest("garita1", "supervisor1", motivo),
            TestData.Json);

    /// <summary>
    /// Body crudo a propósito: fija el contrato on-wire (camelCase, enums como
    /// string) sin depender del record tipado del backend.
    /// </summary>
    private Task<HttpResponseMessage> ReemitirAsync(Guid boletaId, object body) =>
        _client.PostAsync(
            $"/api/boletas/{boletaId}/reemitir",
            new StringContent(JsonSerializer.Serialize(body, TestData.Json), Encoding.UTF8, "application/json"));

    private Task<HttpResponseMessage> ReemitirAsync(Guid boletaId) =>
        ReemitirAsync(boletaId, new
        {
            numeroBoleta = TestData.NumeroBoleta(),
            pesoIngreso = 1234.50,
            origenPesoIngreso = "Bascula",
            usuarioIngreso = "tester",
        });

    private async Task<BoletaDto> AnularYRecargarAsync(Guid boletaId)
    {
        var anular = await AnularAsync(boletaId);
        Assert.Equal(HttpStatusCode.OK, anular.StatusCode);
        return await TestData.GetBoletaAsync(_client, boletaId);
    }

    private async Task<BoletaDto> CrearYAnularAsync(Escenario escenario)
    {
        var boleta = await TestData.CrearBoletaAsync(_client, escenario);
        return await AnularYRecargarAsync(boleta.Id);
    }

    [Fact]
    public async Task Reemitir_boleta_anulada_crea_nueva_vinculada_y_la_original_pasa_a_reemitida()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var original = await CrearYAnularAsync(escenario);

        var resp = await ReemitirAsync(original.Id);

        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        var nueva = JsonSerializer.Deserialize<BoletaDto>(
            await resp.Content.ReadAsStringAsync(), TestData.Json)!;

        Assert.Equal(EstadoBoleta.EnTransito, nueva.Estado);
        Assert.Equal(1234.50m, nueva.PesoIngreso);
        // Mismo contexto operativo que la reemplazada.
        Assert.Equal(escenario.BasculaId, nueva.BasculaId);
        Assert.Equal(escenario.TipoMovimientoId, nueva.TipoMovimientoId);
        // Vínculo unidireccional: solo la original apunta a la nueva.
        Assert.Null(nueva.BoletaOrigenId);

        var recargada = await TestData.GetBoletaAsync(_client, original.Id);
        Assert.Equal(EstadoBoleta.Reemitida, recargada.Estado);
        Assert.Equal(nueva.Id, recargada.BoletaReemplazoId);
        // Historial intacto: la anulación y sus pesos no se pisan.
        Assert.Equal("garita1", recargada.UsuarioAnula);
        Assert.Equal("supervisor1", recargada.UsuarioAutoriza);
        Assert.Equal("error de captura", recargada.MotivoAnulacion);
        Assert.NotNull(recargada.FechaHoraAnulacion);
        Assert.Equal(1000m, recargada.PesoIngreso);
    }

    [Fact]
    public async Task Reemitir_boleta_inexistente_es_404()
    {
        var resp = await ReemitirAsync(Guid.NewGuid());
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task Reemitir_boleta_en_transito_es_409_sin_anularla()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var boleta = await TestData.CrearBoletaAsync(_client, escenario);

        var resp = await ReemitirAsync(boleta.Id);

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
        var recargada = await TestData.GetBoletaAsync(_client, boleta.Id);
        Assert.Equal(EstadoBoleta.EnTransito, recargada.Estado);
        Assert.Null(recargada.BoletaReemplazoId);
    }

    [Fact]
    public async Task Reemitir_boleta_cerrada_es_409_no_se_anula_automaticamente()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var boleta = await TestData.CrearBoletaAsync(_client, escenario);
        Assert.Equal(HttpStatusCode.OK, (await TestData.CerrarAsync(_client, boleta.Id)).StatusCode);

        var resp = await ReemitirAsync(boleta.Id);

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
        var recargada = await TestData.GetBoletaAsync(_client, boleta.Id);
        Assert.Equal(EstadoBoleta.Cerrada, recargada.Estado);
    }

    [Fact]
    public async Task Reemitir_dos_veces_la_segunda_es_409()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var original = await CrearYAnularAsync(escenario);

        Assert.Equal(HttpStatusCode.Created, (await ReemitirAsync(original.Id)).StatusCode);
        var segunda = await ReemitirAsync(original.Id);

        Assert.Equal(HttpStatusCode.Conflict, segunda.StatusCode);
    }

    [Fact]
    public async Task Reemitir_con_numero_de_boleta_duplicado_es_409()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var original = await CrearYAnularAsync(escenario);
        var otra = await TestData.CrearBoletaAsync(_client, escenario);

        var resp = await ReemitirAsync(original.Id, new
        {
            numeroBoleta = otra.NumeroBoleta,
            pesoIngreso = 1000,
            origenPesoIngreso = "Bascula",
            usuarioIngreso = "tester",
        });

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
    }

    [Fact]
    public async Task Reemitir_sin_valores_copia_los_de_la_original()
    {
        var s = TestData.Sufijo();
        var seccion = await TestData.CrearSeccionAsync(_client, $"reemi_{s}");
        var campo = await TestData.CrearCampoAsync(_client, seccion.Id, "lote", TipoCampo.Texto);
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        await TestData.AsignarSeccionesAsync(
            _client, escenario.TipoMovimientoId, new AsignacionSeccionRequest(seccion.Id, Requerida: false, Orden: 1));

        var boleta = await TestData.CrearBoletaAsync(
            _client, escenario, new[] { TestData.Texto(campo.Id, "LOTE-77") });
        var original = await AnularYRecargarAsync(boleta.Id);

        var resp = await ReemitirAsync(original.Id);
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        var nueva = JsonSerializer.Deserialize<BoletaDto>(
            await resp.Content.ReadAsStringAsync(), TestData.Json)!;

        var copiado = Assert.Single(nueva.Valores);
        Assert.Equal(campo.Id, copiado.CampoId);
        Assert.Equal("LOTE-77", copiado.ValorTexto);
    }

    [Fact]
    public async Task Reemitir_con_valores_explicitos_usa_los_del_pedido()
    {
        var s = TestData.Sufijo();
        var seccion = await TestData.CrearSeccionAsync(_client, $"reemi_{s}");
        var campo = await TestData.CrearCampoAsync(_client, seccion.Id, "lote", TipoCampo.Texto);
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        await TestData.AsignarSeccionesAsync(
            _client, escenario.TipoMovimientoId, new AsignacionSeccionRequest(seccion.Id, Requerida: false, Orden: 1));

        var boleta = await TestData.CrearBoletaAsync(
            _client, escenario, new[] { TestData.Texto(campo.Id, "LOTE-VIEJO") });
        var original = await AnularYRecargarAsync(boleta.Id);

        var resp = await ReemitirAsync(original.Id, new
        {
            numeroBoleta = TestData.NumeroBoleta(),
            pesoIngreso = 1234.50,
            origenPesoIngreso = "Bascula",
            usuarioIngreso = "tester",
            valores = new[] { new { campoId = campo.Id, ocurrencia = 0, valorTexto = "LOTE-NUEVO" } },
        });
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        var nueva = JsonSerializer.Deserialize<BoletaDto>(
            await resp.Content.ReadAsStringAsync(), TestData.Json)!;

        var valor = Assert.Single(nueva.Valores);
        Assert.Equal("LOTE-NUEVO", valor.ValorTexto);
    }

    [Fact]
    public async Task Reemitir_valor_con_campo_fuera_del_conjunto_es_400()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var original = await CrearYAnularAsync(escenario);

        var resp = await ReemitirAsync(original.Id, new
        {
            numeroBoleta = TestData.NumeroBoleta(),
            pesoIngreso = 1234.50,
            origenPesoIngreso = "Bascula",
            usuarioIngreso = "tester",
            valores = new[]
            {
                new { campoId = Guid.NewGuid(), ocurrencia = 0, valorTexto = "x" },
            },
        });

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Reemitir_peso_manual_en_bascula_sin_habilitar_es_422_y_no_vincula()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var original = await CrearYAnularAsync(escenario);

        var resp = await ReemitirAsync(original.Id, new
        {
            numeroBoleta = TestData.NumeroBoleta(),
            pesoIngreso = 1234.50,
            origenPesoIngreso = "Manual",
            usuarioIngreso = "tester",
            motivoPesoManual = "CorteEnergia",
        });

        Assert.Equal(HttpStatusCode.UnprocessableEntity, resp.StatusCode);
        var recargada = await TestData.GetBoletaAsync(_client, original.Id);
        Assert.Equal(EstadoBoleta.Anulada, recargada.Estado);
        Assert.Null(recargada.BoletaReemplazoId);
    }
}
