using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SmsBackend.Data;
using SmsBackend.Domain.Boletas;
using SmsBackend.Domain.Boletas.Valores;
using SmsBackend.Domain.Configuracion;
using SmsBackend.Domain.TiposMovimiento;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Re-emisión de boleta (<c>POST /api/boletas/{id}/reemitir</c>). Semántica
/// legacy (NAT_Basculas frmIngresosFruta modo "BoletaEmision") + manual: la
/// re-emisión es una COPIA CONGELADA de la boleta anulada — pesos, fechas y
/// usuarios no se tocan, solo cambian el correlativo y los datos que Auditoría
/// permite (valores). Solo aplica sobre boletas YA anuladas, es de una sola vez
/// y nunca borra la original: pasa de Anulada a Reemitida conservando su
/// historia de anulación y suma la huella de la re-emisión. El vínculo es
/// unidireccional — la original apunta a la nueva por <c>BoletaReemplazoId</c>.
/// Las transferencias no se re-emiten (el legacy usa "Trasiego").
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
            usuarioReemision = "auditor1",
        });

    private static async Task<BoletaDto> LeerCreadaAsync(HttpResponseMessage resp)
    {
        var body = await resp.Content.ReadAsStringAsync();
        Assert.True(resp.StatusCode == HttpStatusCode.Created, $"POST reemitir => {(int)resp.StatusCode}: {body}");
        return JsonSerializer.Deserialize<BoletaDto>(body, TestData.Json)!;
    }

    private async Task<BoletaDto> AnularYRecargarAsync(Guid boletaId)
    {
        var anular = await AnularAsync(boletaId);
        Assert.Equal(HttpStatusCode.OK, anular.StatusCode);
        return await TestData.GetBoletaAsync(_client, boletaId);
    }

    /// <summary>La re-emisión copia un pesaje completo: se cierra antes de anular.</summary>
    private async Task<BoletaDto> CrearCerrarYAnularAsync(
        Escenario escenario, IEnumerable<ValorCampoDto>? valores = null)
    {
        var boleta = await TestData.CrearBoletaAsync(_client, escenario, valores);
        Assert.Equal(HttpStatusCode.OK, (await TestData.CerrarAsync(_client, boleta.Id)).StatusCode);
        return await AnularYRecargarAsync(boleta.Id);
    }

    private async Task<int> ContarBoletasAsync()
    {
        var todas = await _client.GetFromJsonAsync<List<BoletaDto>>("/api/boletas/", TestData.Json);
        return todas!.Count;
    }

    [Fact]
    public async Task Reemitir_crea_copia_congelada_cerrada_y_la_original_pasa_a_reemitida()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var original = await CrearCerrarYAnularAsync(escenario);
        var numeroNuevo = TestData.NumeroBoleta();
        var antes = DateTime.UtcNow;

        var nueva = await LeerCreadaAsync(await ReemitirAsync(
            original.Id, new { numeroBoleta = numeroNuevo, usuarioReemision = "auditor1" }));

        // Nace completa (Cerrada) con el correlativo nuevo.
        Assert.Equal(EstadoBoleta.Cerrada, nueva.Estado);
        Assert.Equal(EstadoSyncBoleta.SincronizadoCentral, nueva.EstadoSync);
        Assert.Equal(numeroNuevo, nueva.NumeroBoleta);
        Assert.NotEqual(original.NumeroBoleta, nueva.NumeroBoleta);
        Assert.False(nueva.CreadaOffline);
        // Congelado: pesos, orígenes, fechas y usuarios idénticos a la original.
        Assert.Equal(original.BasculaId, nueva.BasculaId);
        Assert.Equal(original.TipoMovimientoId, nueva.TipoMovimientoId);
        Assert.Equal(1000m, nueva.PesoIngreso);
        Assert.Equal(900m, nueva.PesoSalida);
        Assert.Equal(100m, nueva.PesoNeto);
        Assert.Equal(original.OrigenPesoIngreso, nueva.OrigenPesoIngreso);
        Assert.Equal(original.OrigenPesoSalida, nueva.OrigenPesoSalida);
        Assert.Equal(original.FechaHoraIngreso, nueva.FechaHoraIngreso);
        Assert.Equal(original.FechaHoraSalida, nueva.FechaHoraSalida);
        Assert.Equal(original.UsuarioIngreso, nueva.UsuarioIngreso);
        Assert.Equal(original.UsuarioSalida, nueva.UsuarioSalida);
        Assert.Equal(original.BasculaSalidaId, nueva.BasculaSalidaId);
        // El vínculo es unidireccional y el pre-ingreso no se hereda.
        Assert.Null(nueva.BoletaOrigenId);
        Assert.Null(nueva.PreIngresoId);
        // La auditoría de re-emisión vive en la ORIGINAL, no en la nueva.
        Assert.Null(nueva.UsuarioReemision);
        Assert.Null(nueva.FechaHoraReemision);

        var recargada = await TestData.GetBoletaAsync(_client, original.Id);
        Assert.Equal(EstadoBoleta.Reemitida, recargada.Estado);
        Assert.Equal(nueva.Id, recargada.BoletaReemplazoId);
        Assert.Equal("auditor1", recargada.UsuarioReemision);
        Assert.InRange(recargada.FechaHoraReemision!.Value, antes.AddSeconds(-5), DateTime.UtcNow.AddSeconds(5));
        // Historial intacto: la anulación y sus pesos no se pisan.
        Assert.Equal("garita1", recargada.UsuarioAnula);
        Assert.Equal("supervisor1", recargada.UsuarioAutoriza);
        Assert.Equal("error de captura", recargada.MotivoAnulacion);
        Assert.NotNull(recargada.FechaHoraAnulacion);
        Assert.Equal(1000m, recargada.PesoIngreso);
        Assert.Equal(900m, recargada.PesoSalida);
    }

    [Fact]
    public async Task Reemitir_ignora_pesos_y_origen_enviados_en_el_body()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var original = await CrearCerrarYAnularAsync(escenario);

        var nueva = await LeerCreadaAsync(await ReemitirAsync(original.Id, new
        {
            numeroBoleta = TestData.NumeroBoleta(),
            usuarioReemision = "auditor1",
            usuarioIngreso = "intruso",
            pesoIngreso = 9999,
            pesoSalida = 1,
            origenPesoIngreso = "Manual",
            motivoPesoManual = "CorteEnergia",
            motivoPesoManualDetalle = "no debe aplicarse",
        }));

        Assert.Equal(1000m, nueva.PesoIngreso);
        Assert.Equal(900m, nueva.PesoSalida);
        Assert.Equal(100m, nueva.PesoNeto);
        Assert.Equal(original.OrigenPesoIngreso, nueva.OrigenPesoIngreso);
        Assert.Equal(original.UsuarioIngreso, nueva.UsuarioIngreso);
        Assert.Null(nueva.MotivoPesoManual);
        Assert.Null(nueva.MotivoPesoManualDetalle);
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
    public async Task Reemitir_boleta_anulada_sin_segundo_pesaje_es_409_y_no_crea_nada()
    {
        // Anulada en tránsito: no hay pesaje completo que congelar.
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var boleta = await TestData.CrearBoletaAsync(_client, escenario);
        var original = await AnularYRecargarAsync(boleta.Id);
        var totalAntes = await ContarBoletasAsync();

        var resp = await ReemitirAsync(original.Id);

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
        Assert.Equal(EstadoBoleta.Anulada, (await TestData.GetBoletaAsync(_client, original.Id)).Estado);
        Assert.Equal(totalAntes, await ContarBoletasAsync());
    }

    [Fact]
    public async Task Reemitir_dos_veces_la_segunda_es_409()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var original = await CrearCerrarYAnularAsync(escenario);

        Assert.Equal(HttpStatusCode.Created, (await ReemitirAsync(original.Id)).StatusCode);
        var segunda = await ReemitirAsync(original.Id);

        Assert.Equal(HttpStatusCode.Conflict, segunda.StatusCode);
    }

    [Fact]
    public async Task Reemitir_con_numero_de_boleta_duplicado_es_409_sin_efectos()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var original = await CrearCerrarYAnularAsync(escenario);
        var otra = await TestData.CrearBoletaAsync(_client, escenario);
        var totalAntes = await ContarBoletasAsync();

        var resp = await ReemitirAsync(original.Id, new
        {
            numeroBoleta = otra.NumeroBoleta,
            usuarioReemision = "auditor1",
        });

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
        var recargada = await TestData.GetBoletaAsync(_client, original.Id);
        Assert.Equal(EstadoBoleta.Anulada, recargada.Estado);
        Assert.Null(recargada.BoletaReemplazoId);
        Assert.Equal(totalAntes, await ContarBoletasAsync());
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Reemitir_sin_usuario_de_reemision_es_400_sin_efectos(string usuario)
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var original = await CrearCerrarYAnularAsync(escenario);

        var resp = await ReemitirAsync(original.Id, new
        {
            numeroBoleta = TestData.NumeroBoleta(),
            usuarioReemision = usuario,
        });

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var recargada = await TestData.GetBoletaAsync(_client, original.Id);
        Assert.Equal(EstadoBoleta.Anulada, recargada.Estado);
        Assert.Null(recargada.UsuarioReemision);
    }

    [Fact]
    public async Task Reemitir_una_transferencia_es_409_y_la_original_queda_intacta()
    {
        // El legado prohíbe re-emitir transferencias (usa Trasiego).
        var basicos = await TestData.NuevoEscenarioAsync(_client);
        var tipoTransferencia = await TestData.PostAsync<TipoMovimientoDto>(_client, "/api/tipos-movimiento",
            new GuardarTipoMovimientoRequest(
                $"TR-{TestData.Sufijo()}", "Transferencia", "TRF", DireccionMovimiento.Transferencia, null, false, null));
        var escenario = basicos with { TipoMovimientoId = tipoTransferencia.Id };
        var original = await CrearCerrarYAnularAsync(escenario);
        var totalAntes = await ContarBoletasAsync();

        var resp = await ReemitirAsync(original.Id);

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
        Assert.Contains("trasiego", await resp.Content.ReadAsStringAsync());
        var recargada = await TestData.GetBoletaAsync(_client, original.Id);
        Assert.Equal(EstadoBoleta.Anulada, recargada.Estado);
        Assert.Null(recargada.BoletaReemplazoId);
        Assert.Null(recargada.UsuarioReemision);
        Assert.Equal(totalAntes, await ContarBoletasAsync());
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

        var original = await CrearCerrarYAnularAsync(
            escenario, new[] { TestData.Texto(campo.Id, "LOTE-77") });

        var nueva = await LeerCreadaAsync(await ReemitirAsync(original.Id));

        var copiado = Assert.Single(nueva.Valores);
        Assert.Equal(campo.Id, copiado.CampoId);
        Assert.Equal("LOTE-77", copiado.ValorTexto);
    }

    [Fact]
    public async Task Reemitir_con_valores_explicitos_cambia_solo_los_valores()
    {
        var s = TestData.Sufijo();
        var seccion = await TestData.CrearSeccionAsync(_client, $"reemi_{s}");
        var campo = await TestData.CrearCampoAsync(_client, seccion.Id, "lote", TipoCampo.Texto);
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        await TestData.AsignarSeccionesAsync(
            _client, escenario.TipoMovimientoId, new AsignacionSeccionRequest(seccion.Id, Requerida: false, Orden: 1));

        var original = await CrearCerrarYAnularAsync(
            escenario, new[] { TestData.Texto(campo.Id, "LOTE-VIEJO") });

        var nueva = await LeerCreadaAsync(await ReemitirAsync(original.Id, new
        {
            numeroBoleta = TestData.NumeroBoleta(),
            usuarioReemision = "auditor1",
            valores = new[] { new { campoId = campo.Id, ocurrencia = 0, valorTexto = "LOTE-NUEVO" } },
        }));

        var valor = Assert.Single(nueva.Valores);
        Assert.Equal("LOTE-NUEVO", valor.ValorTexto);
        // Pesos y fechas siguen congelados.
        Assert.Equal(original.PesoIngreso, nueva.PesoIngreso);
        Assert.Equal(original.PesoSalida, nueva.PesoSalida);
        Assert.Equal(original.PesoNeto, nueva.PesoNeto);
        Assert.Equal(original.FechaHoraIngreso, nueva.FechaHoraIngreso);
        Assert.Equal(original.FechaHoraSalida, nueva.FechaHoraSalida);
        // La original conserva su valor histórico.
        var recargada = await TestData.GetBoletaAsync(_client, original.Id);
        Assert.Equal("LOTE-VIEJO", Assert.Single(recargada.Valores).ValorTexto);
    }

    [Fact]
    public async Task Reemitir_valor_con_campo_fuera_del_conjunto_es_400_sin_efectos()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var original = await CrearCerrarYAnularAsync(escenario);
        var totalAntes = await ContarBoletasAsync();

        var resp = await ReemitirAsync(original.Id, new
        {
            numeroBoleta = TestData.NumeroBoleta(),
            usuarioReemision = "auditor1",
            valores = new[]
            {
                new { campoId = Guid.NewGuid(), ocurrencia = 0, valorTexto = "x" },
            },
        });

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var recargada = await TestData.GetBoletaAsync(_client, original.Id);
        Assert.Equal(EstadoBoleta.Anulada, recargada.Estado);
        Assert.Equal(totalAntes, await ContarBoletasAsync());
    }

    [Fact]
    public async Task Reemitir_con_valores_explicitos_que_omiten_un_requerido_es_422_sin_efectos()
    {
        // La boleta cerrada exige su campo requerido; reemplazar el conjunto
        // por uno que lo omite dejaría una Cerrada inválida -> 422 y rollback.
        var s = TestData.Sufijo();
        var seccion = await TestData.CrearSeccionAsync(_client, $"reemi_{s}");
        var campo = await TestData.CrearCampoAsync(
            _client, seccion.Id, "referencia_qa", TipoCampo.Texto, requerido: true);
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        await TestData.AsignarSeccionesAsync(
            _client, escenario.TipoMovimientoId, new AsignacionSeccionRequest(seccion.Id, Requerida: true, Orden: 1));
        var original = await CrearCerrarYAnularAsync(
            escenario, new[] { TestData.Texto(campo.Id, "QA-1") });
        var totalAntes = await ContarBoletasAsync();

        var resp = await ReemitirAsync(original.Id, new
        {
            numeroBoleta = TestData.NumeroBoleta(),
            usuarioReemision = "auditor1",
            valores = Array.Empty<object>(),
        });

        Assert.Equal(HttpStatusCode.UnprocessableEntity, resp.StatusCode);
        var errores = await TestData.LeerErroresAsync(resp);
        Assert.Contains(errores, e => e.SeccionClave == seccion.Clave);
        var recargada = await TestData.GetBoletaAsync(_client, original.Id);
        Assert.Equal(EstadoBoleta.Anulada, recargada.Estado);
        Assert.Null(recargada.BoletaReemplazoId);
        Assert.Null(recargada.UsuarioReemision);
        Assert.Null(recargada.FechaHoraReemision);
        Assert.Equal(totalAntes, await ContarBoletasAsync());
    }

    [Fact]
    public async Task Anular_boleta_reemitida_es_409_y_no_pisa_la_historia_de_reemision()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var original = await CrearCerrarYAnularAsync(escenario);
        Assert.Equal(HttpStatusCode.Created, (await ReemitirAsync(original.Id)).StatusCode);

        var resp = await AnularAsync(original.Id, "re-anulacion indebida");

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
        var recargada = await TestData.GetBoletaAsync(_client, original.Id);
        Assert.Equal(EstadoBoleta.Reemitida, recargada.Estado);
        Assert.NotNull(recargada.BoletaReemplazoId);
        // La anulación original sigue intacta: motivo y timestamp de la primera.
        Assert.Equal("error de captura", recargada.MotivoAnulacion);
    }

    [Fact]
    public async Task Reporte_diario_cuenta_la_nueva_una_vez_en_el_dia_de_salida_original_y_no_la_reemitida()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var boleta = await TestData.CrearBoletaAsync(_client, escenario);
        Assert.Equal(HttpStatusCode.OK, (await TestData.CerrarAsync(_client, boleta.Id)).StatusCode);
        // Salida histórica: distinta del día en que se re-emite (hoy).
        var diaSalida = new DateTime(2026, 9, 10, 10, 0, 0, DateTimeKind.Utc);
        using (var scope = _factory.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<SmsDbContext>();
            var fila = await db.Boletas.IgnoreQueryFilters().SingleAsync(b => b.Id == boleta.Id);
            fila.FechaHoraSalida = diaSalida;
            await db.SaveChangesAsync();
        }
        await AnularYRecargarAsync(boleta.Id);

        var nueva = await LeerCreadaAsync(await ReemitirAsync(boleta.Id));
        Assert.Equal(diaSalida, nueva.FechaHoraSalida);

        var filas = await _client.GetFromJsonAsync<List<FilaReporte>>(
            $"/api/reportes/diario?tipoMovimientoId={escenario.TipoMovimientoId}&desde=2020-01-01&hasta=2099-12-31",
            TestData.Json);

        // Una sola fila (la nueva, en el día de la salida original): ni la
        // original Reemitida ni un día "de hoy" duplican el pesaje.
        var unica = Assert.Single(filas!);
        Assert.Equal("2026-09-10", unica.Fecha);
        Assert.Equal(1, unica.CantidadBoletas);
        Assert.Equal(100m, unica.PesoNetoTotal);
    }

    private sealed record FilaReporte(string Fecha, int CantidadBoletas, decimal PesoNetoTotal);
}
