using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SmsBackend.Data;
using SmsBackend.Domain.Boletas;
using SmsBackend.Domain.Boletas.Valores;
using SmsBackend.Domain.Configuracion;
using SmsBackend.Domain.Seguridad;
using SmsBackend.Domain.TiposMovimiento;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Trasiego de boleta (<c>POST /api/boletas/{id}/trasegar</c>) — sibling de
/// re-emisión, pero convierte los datos hacia un TIPO DE MOVIMIENTO DISTINTO.
/// Evidencia: manual ("Convertir los datos de una transacción o boleta a una
/// nueva, por ejemplo, de Transferencia a Salida de Materia Prima y Graneles
/// ... los pesos no son modificables, solo los datos permitidos por
/// Auditoría") + legacy NAT_Basculas (clsBoletaTrasiego.Boleta_Trasiego() es
/// código muerto; lo que corre de verdad es el mismo mecanismo
/// "BoletaEmision" de re-emisión, apuntando a un tipo distinto). Solo aplica
/// sobre transferencias anuladas ("/reemitir" las rechaza con "use
/// trasiego"). Copia congelada: pesos, fechas y usuarios idénticos a la
/// original; el correlativo, el tipo destino y los valores son lo editable.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class TrasiegoBoletaTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public TrasiegoBoletaTests(ApiFactory factory)
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

    /// <summary>Body crudo a propósito: fija el contrato on-wire sin depender del record tipado.</summary>
    private Task<HttpResponseMessage> TrasegarAsync(Guid boletaId, object body) =>
        _client.PostAsync(
            $"/api/boletas/{boletaId}/trasegar",
            new StringContent(JsonSerializer.Serialize(body, TestData.Json), Encoding.UTF8, "application/json"));

    private Task<HttpResponseMessage> TrasegarAsync(Guid boletaId, Guid tipoDestinoId) =>
        TrasegarAsync(boletaId, new
        {
            tipoMovimientoDestinoId = tipoDestinoId,
            numeroBoleta = TestData.NumeroBoleta(),
            usuarioAutoriza = "auditor1",
            motivoTrasiego = "cambio de destino comercial",
        });

    private static async Task<BoletaDto> LeerCreadaAsync(HttpResponseMessage resp)
    {
        var body = await resp.Content.ReadAsStringAsync();
        Assert.True(resp.StatusCode == HttpStatusCode.Created, $"POST trasegar => {(int)resp.StatusCode}: {body}");
        return JsonSerializer.Deserialize<BoletaDto>(body, TestData.Json)!;
    }

    private async Task<BoletaDto> AnularYRecargarAsync(Guid boletaId)
    {
        var anular = await AnularAsync(boletaId);
        Assert.Equal(HttpStatusCode.OK, anular.StatusCode);
        return await TestData.GetBoletaAsync(_client, boletaId);
    }

    /// <summary>Escenario de origen: una Transferencia cerrada y anulada.</summary>
    private async Task<(Escenario Escenario, BoletaDto Original)> EscenarioTransferenciaAnuladaAsync(
        IEnumerable<ValorCampoDto>? valores = null)
    {
        var basicos = await TestData.NuevoEscenarioAsync(_client);
        var tipoTransferencia = await TestData.PostAsync<TipoMovimientoDto>(_client, "/api/tipos-movimiento",
            new GuardarTipoMovimientoRequest(
                $"TR-{TestData.Sufijo()}", "Transferencia", "TRF", DireccionMovimiento.Transferencia, null, false, null));
        var escenario = basicos with { TipoMovimientoId = tipoTransferencia.Id };
        var boleta = await TestData.CrearBoletaAsync(_client, escenario, valores);
        Assert.Equal(HttpStatusCode.OK, (await TestData.CerrarAsync(_client, boleta.Id)).StatusCode);
        var original = await AnularYRecargarAsync(boleta.Id);
        return (escenario, original);
    }

    private async Task<TipoMovimientoDto> CrearTipoDestinoAsync(bool activo = true)
    {
        var tipo = await TestData.PostAsync<TipoMovimientoDto>(_client, "/api/tipos-movimiento",
            new GuardarTipoMovimientoRequest(
                $"SAL-{TestData.Sufijo()}", "Salida Materia Prima y Graneles", "SAL", DireccionMovimiento.Salida, null, false, null));
        if (!activo)
        {
            // Soft-delete: la creación siempre nace Activo=true, la
            // desactivación es un endpoint aparte (mismo criterio que Maestro).
            Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/api/tipos-movimiento/{tipo.Id}")).StatusCode);
            tipo = tipo with { Activo = false };
        }

        return tipo;
    }

    private async Task<int> ContarBoletasAsync()
    {
        var todas = await _client.GetFromJsonAsync<List<BoletaDto>>("/api/boletas/", TestData.Json);
        return todas!.Count;
    }

    [Fact]
    public async Task Trasegar_crea_copia_congelada_en_el_tipo_destino_y_la_original_pasa_a_trasegada()
    {
        var (_, original) = await EscenarioTransferenciaAnuladaAsync();
        var destino = await CrearTipoDestinoAsync();
        var numeroNuevo = TestData.NumeroBoleta();
        var antes = DateTime.UtcNow;

        var nueva = await LeerCreadaAsync(await TrasegarAsync(original.Id, new
        {
            tipoMovimientoDestinoId = destino.Id,
            numeroBoleta = numeroNuevo,
            usuarioAutoriza = "auditor1",
            motivoTrasiego = "cambio de destino comercial",
        }));

        Assert.Equal(EstadoBoleta.Cerrada, nueva.Estado);
        Assert.Equal(destino.Id, nueva.TipoMovimientoId);
        Assert.NotEqual(original.TipoMovimientoId, nueva.TipoMovimientoId);
        Assert.Equal(numeroNuevo, nueva.NumeroBoleta);
        Assert.False(nueva.CreadaOffline);
        // Congelado: pesos, fechas y usuarios idénticos a la original.
        Assert.Equal(original.BasculaId, nueva.BasculaId);
        Assert.Equal(1000m, nueva.PesoIngreso);
        Assert.Equal(900m, nueva.PesoSalida);
        Assert.Equal(100m, nueva.PesoNeto);
        Assert.Equal(original.FechaHoraIngreso, nueva.FechaHoraIngreso);
        Assert.Equal(original.FechaHoraSalida, nueva.FechaHoraSalida);
        Assert.Equal(original.UsuarioIngreso, nueva.UsuarioIngreso);
        Assert.Equal(original.UsuarioSalida, nueva.UsuarioSalida);
        Assert.Null(nueva.UsuarioTrasiego);
        Assert.Null(nueva.FechaHoraTrasiego);

        var recargada = await TestData.GetBoletaAsync(_client, original.Id);
        Assert.Equal(EstadoBoleta.Trasegada, recargada.Estado);
        Assert.Equal(nueva.Id, recargada.BoletaReemplazoId);
        Assert.Equal("auditor1", recargada.UsuarioTrasiego);
        Assert.InRange(recargada.FechaHoraTrasiego!.Value, antes.AddSeconds(-5), DateTime.UtcNow.AddSeconds(5));
        Assert.Equal("cambio de destino comercial", recargada.MotivoTrasiego);
    }

    [Fact]
    public async Task Trasegar_sin_valores_auto_mapea_por_clave_comun_y_descarta_lo_sin_match()
    {
        var s = TestData.Sufijo();
        var seccionComun = await TestData.CrearSeccionAsync(_client, $"trs_comun_{s}");
        var campoComunOrigen = await TestData.CrearCampoAsync(_client, seccionComun.Id, "lote", TipoCampo.Texto);

        // El destino se arma y asigna ANTES de crear la original: el motor
        // resuelve el conjunto destino as-of la fecha CONGELADA de la
        // original (FechaHoraIngreso), así que la asignación de sección debe
        // ser vigente para esa fecha — no alcanza con que exista "ahora".
        var destino = await CrearTipoDestinoAsync();
        // El destino comparte la MISMA (sección, clave, tipo) -> debe mapear.
        await TestData.AsignarSeccionesAsync(
            _client, destino.Id, new AsignacionSeccionRequest(seccionComun.Id, Requerida: false, Orden: 1));

        var (_, original) = await EscenarioTransferenciaAnuladaWithSectionAsync(seccionComun.Id, campoComunOrigen.Id);

        var nueva = await LeerCreadaAsync(await TrasegarAsync(original.Id, destino.Id));

        var copiado = Assert.Single(nueva.Valores);
        Assert.Equal(campoComunOrigen.Id, copiado.CampoId);
        Assert.Equal("LOTE-77", copiado.ValorTexto);
    }

    [Fact]
    public async Task Trasegar_sin_valores_descarta_los_del_origen_sin_equivalente_en_el_destino()
    {
        var s = TestData.Sufijo();
        var seccionSoloOrigen = await TestData.CrearSeccionAsync(_client, $"trs_solo_origen_{s}");
        var campoSoloOrigen = await TestData.CrearCampoAsync(_client, seccionSoloOrigen.Id, "lote", TipoCampo.Texto);

        var (_, original) = await EscenarioTransferenciaAnuladaWithSectionAsync(seccionSoloOrigen.Id, campoSoloOrigen.Id);

        // El destino NO tiene la sección asignada -> ningún campo coincide.
        var destino = await CrearTipoDestinoAsync();

        var nueva = await LeerCreadaAsync(await TrasegarAsync(original.Id, destino.Id));

        Assert.Empty(nueva.Valores);
    }

    private async Task<(Escenario Escenario, BoletaDto Original)> EscenarioTransferenciaAnuladaWithSectionAsync(
        Guid seccionId, Guid campoId)
    {
        var basicos = await TestData.NuevoEscenarioAsync(_client);
        var tipoTransferencia = await TestData.PostAsync<TipoMovimientoDto>(_client, "/api/tipos-movimiento",
            new GuardarTipoMovimientoRequest(
                $"TR-{TestData.Sufijo()}", "Transferencia", "TRF", DireccionMovimiento.Transferencia, null, false, null));
        var escenario = basicos with { TipoMovimientoId = tipoTransferencia.Id };
        await TestData.AsignarSeccionesAsync(
            _client, escenario.TipoMovimientoId, new AsignacionSeccionRequest(seccionId, Requerida: false, Orden: 1));
        var boleta = await TestData.CrearBoletaAsync(_client, escenario, new[] { TestData.Texto(campoId, "LOTE-77") });
        Assert.Equal(HttpStatusCode.OK, (await TestData.CerrarAsync(_client, boleta.Id)).StatusCode);
        var original = await AnularYRecargarAsync(boleta.Id);
        return (escenario, original);
    }

    [Fact]
    public async Task Trasegar_con_valores_explicitos_ignora_el_auto_mapeo()
    {
        var s = TestData.Sufijo();
        var seccion = await TestData.CrearSeccionAsync(_client, $"trs_expl_{s}");
        var campo = await TestData.CrearCampoAsync(_client, seccion.Id, "referencia", TipoCampo.Texto);

        // Destino armado y asignado ANTES de la original — ver comentario en
        // Trasegar_sin_valores_auto_mapea_por_clave_comun_y_descarta_lo_sin_match.
        var destino = await CrearTipoDestinoAsync();
        await TestData.AsignarSeccionesAsync(
            _client, destino.Id, new AsignacionSeccionRequest(seccion.Id, Requerida: false, Orden: 1));

        var (_, original) = await EscenarioTransferenciaAnuladaWithSectionAsync(seccion.Id, campo.Id);

        var nueva = await LeerCreadaAsync(await TrasegarAsync(original.Id, new
        {
            tipoMovimientoDestinoId = destino.Id,
            numeroBoleta = TestData.NumeroBoleta(),
            usuarioAutoriza = "auditor1",
            motivoTrasiego = "corrección manual",
            valores = new[] { new { campoId = campo.Id, ocurrencia = 0, valorTexto = "REF-NUEVA" } },
        }));

        var valor = Assert.Single(nueva.Valores);
        Assert.Equal("REF-NUEVA", valor.ValorTexto);
    }

    [Fact]
    public async Task Trasegar_boleta_no_anulada_es_409_sin_efectos()
    {
        var basicos = await TestData.NuevoEscenarioAsync(_client);
        var tipoTransferencia = await TestData.PostAsync<TipoMovimientoDto>(_client, "/api/tipos-movimiento",
            new GuardarTipoMovimientoRequest(
                $"TR-{TestData.Sufijo()}", "Transferencia", "TRF", DireccionMovimiento.Transferencia, null, false, null));
        var escenario = basicos with { TipoMovimientoId = tipoTransferencia.Id };
        var boleta = await TestData.CrearBoletaAsync(_client, escenario);
        Assert.Equal(HttpStatusCode.OK, (await TestData.CerrarAsync(_client, boleta.Id)).StatusCode);
        var destino = await CrearTipoDestinoAsync();
        var totalAntes = await ContarBoletasAsync();

        var resp = await TrasegarAsync(boleta.Id, destino.Id);

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
        var recargada = await TestData.GetBoletaAsync(_client, boleta.Id);
        Assert.Equal(EstadoBoleta.Cerrada, recargada.Estado);
        Assert.Null(recargada.BoletaReemplazoId);
        Assert.Equal(totalAntes, await ContarBoletasAsync());
    }

    [Fact]
    public async Task Trasegar_una_boleta_que_no_es_transferencia_es_409_con_mensaje_de_reemision()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client); // Entrada, no Transferencia
        var boleta = await TestData.CrearBoletaAsync(_client, escenario);
        Assert.Equal(HttpStatusCode.OK, (await TestData.CerrarAsync(_client, boleta.Id)).StatusCode);
        var original = await AnularYRecargarAsync(boleta.Id);
        var destino = await CrearTipoDestinoAsync();
        var totalAntes = await ContarBoletasAsync();

        var resp = await TrasegarAsync(original.Id, destino.Id);

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
        Assert.Contains("reemisión", await resp.Content.ReadAsStringAsync());
        var recargada = await TestData.GetBoletaAsync(_client, original.Id);
        Assert.Equal(EstadoBoleta.Anulada, recargada.Estado);
        Assert.Null(recargada.BoletaReemplazoId);
        Assert.Equal(totalAntes, await ContarBoletasAsync());
    }

    [Fact]
    public async Task Trasegar_hacia_otra_transferencia_es_409_sin_efectos()
    {
        var (_, original) = await EscenarioTransferenciaAnuladaAsync();
        var otraTransferencia = await TestData.PostAsync<TipoMovimientoDto>(_client, "/api/tipos-movimiento",
            new GuardarTipoMovimientoRequest(
                $"TR2-{TestData.Sufijo()}", "Otra Transferencia", "TR2", DireccionMovimiento.Transferencia, null, false, null));
        var totalAntes = await ContarBoletasAsync();

        var resp = await TrasegarAsync(original.Id, otraTransferencia.Id);

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
        var recargada = await TestData.GetBoletaAsync(_client, original.Id);
        Assert.Equal(EstadoBoleta.Anulada, recargada.Estado);
        Assert.Equal(totalAntes, await ContarBoletasAsync());
    }

    [Fact]
    public async Task Trasegar_hacia_un_tipo_inactivo_es_409()
    {
        var (_, original) = await EscenarioTransferenciaAnuladaAsync();
        var destinoInactivo = await CrearTipoDestinoAsync(activo: false);

        var resp = await TrasegarAsync(original.Id, destinoInactivo.Id);

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
        var recargada = await TestData.GetBoletaAsync(_client, original.Id);
        Assert.Equal(EstadoBoleta.Anulada, recargada.Estado);
    }

    [Fact]
    public async Task Trasegar_hacia_un_tipo_inexistente_es_404()
    {
        var (_, original) = await EscenarioTransferenciaAnuladaAsync();

        var resp = await TrasegarAsync(original.Id, Guid.NewGuid());

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task Trasegar_boleta_ya_reemplazada_la_segunda_vez_es_409()
    {
        var (_, original) = await EscenarioTransferenciaAnuladaAsync();
        var destino = await CrearTipoDestinoAsync();

        Assert.Equal(HttpStatusCode.Created, (await TrasegarAsync(original.Id, destino.Id)).StatusCode);
        var segunda = await TrasegarAsync(original.Id, destino.Id);

        Assert.Equal(HttpStatusCode.Conflict, segunda.StatusCode);
    }

    [Fact]
    public async Task Trasegar_con_campo_requerido_del_destino_sin_equivalente_es_422_sin_efectos()
    {
        // Destino armado y asignado ANTES de la original — el motor resuelve
        // el conjunto destino as-of la fecha CONGELADA de la original
        // (FechaHoraIngreso), así que la asignación debe ser vigente para esa
        // fecha (ver mismo comentario en el test de auto-mapeo).
        var s = TestData.Sufijo();
        var seccionRequerida = await TestData.CrearSeccionAsync(_client, $"trs_req_{s}");
        await TestData.CrearCampoAsync(_client, seccionRequerida.Id, "obligatorio", TipoCampo.Texto, requerido: true);
        var destino = await CrearTipoDestinoAsync();
        await TestData.AsignarSeccionesAsync(
            _client, destino.Id, new AsignacionSeccionRequest(seccionRequerida.Id, Requerida: true, Orden: 1));

        var (_, original) = await EscenarioTransferenciaAnuladaAsync();
        var totalAntes = await ContarBoletasAsync();

        var resp = await TrasegarAsync(original.Id, destino.Id);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, resp.StatusCode);
        var errores = await TestData.LeerErroresAsync(resp);
        Assert.Contains(errores, e => e.SeccionClave == seccionRequerida.Clave);
        var recargada = await TestData.GetBoletaAsync(_client, original.Id);
        Assert.Equal(EstadoBoleta.Anulada, recargada.Estado);
        Assert.Null(recargada.BoletaReemplazoId);
        Assert.Null(recargada.UsuarioTrasiego);
        Assert.Equal(totalAntes, await ContarBoletasAsync());
    }

    [Fact]
    public async Task Trasegar_con_numero_de_boleta_duplicado_es_409()
    {
        var (escenario, original) = await EscenarioTransferenciaAnuladaAsync();
        var otra = await TestData.CrearBoletaAsync(_client, escenario);
        var destino = await CrearTipoDestinoAsync();
        var totalAntes = await ContarBoletasAsync();

        var resp = await TrasegarAsync(original.Id, new
        {
            tipoMovimientoDestinoId = destino.Id,
            numeroBoleta = otra.NumeroBoleta,
            usuarioAutoriza = "auditor1",
            motivoTrasiego = "cambio de destino",
        });

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
        Assert.Equal(totalAntes, await ContarBoletasAsync());
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Trasegar_sin_usuario_autoriza_es_400_sin_efectos(string usuario)
    {
        var (_, original) = await EscenarioTransferenciaAnuladaAsync();
        var destino = await CrearTipoDestinoAsync();

        var resp = await TrasegarAsync(original.Id, new
        {
            tipoMovimientoDestinoId = destino.Id,
            numeroBoleta = TestData.NumeroBoleta(),
            usuarioAutoriza = usuario,
            motivoTrasiego = "cambio de destino",
        });

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var recargada = await TestData.GetBoletaAsync(_client, original.Id);
        Assert.Equal(EstadoBoleta.Anulada, recargada.Estado);
        Assert.Null(recargada.UsuarioTrasiego);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Trasegar_sin_motivo_es_400_sin_efectos(string motivo)
    {
        var (_, original) = await EscenarioTransferenciaAnuladaAsync();
        var destino = await CrearTipoDestinoAsync();

        var resp = await TrasegarAsync(original.Id, new
        {
            tipoMovimientoDestinoId = destino.Id,
            numeroBoleta = TestData.NumeroBoleta(),
            usuarioAutoriza = "auditor1",
            motivoTrasiego = motivo,
        });

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var recargada = await TestData.GetBoletaAsync(_client, original.Id);
        Assert.Equal(EstadoBoleta.Anulada, recargada.Estado);
        Assert.Null(recargada.MotivoTrasiego);
    }

    [Fact]
    public async Task Reporte_diario_cuenta_la_trasegada_una_vez_en_el_dia_de_salida_original_y_no_la_original()
    {
        var (escenario, original) = await EscenarioTransferenciaAnuladaAsync();
        var diaSalida = new DateTime(2026, 9, 11, 10, 0, 0, DateTimeKind.Utc);
        using (var scope = _factory.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<SmsDbContext>();
            var fila = await db.Boletas.IgnoreQueryFilters().SingleAsync(b => b.Id == original.Id);
            fila.FechaHoraSalida = diaSalida;
            await db.SaveChangesAsync();
        }
        var destino = await CrearTipoDestinoAsync();

        var nueva = await LeerCreadaAsync(await TrasegarAsync(original.Id, destino.Id));
        Assert.Equal(diaSalida, nueva.FechaHoraSalida);

        var filas = await _client.GetFromJsonAsync<List<FilaReporte>>(
            $"/api/reportes/diario?tipoMovimientoId={destino.Id}&desde=2020-01-01&hasta=2099-12-31",
            TestData.Json);

        var unica = Assert.Single(filas!);
        Assert.Equal("2026-09-11", unica.Fecha);
        Assert.Equal(1, unica.CantidadBoletas);
        Assert.Equal(100m, unica.PesoNetoTotal);

        // La ORIGINAL (ahora Trasegada, del tipo Transferencia) no cuenta en
        // el reporte de ningún tipo: solo Cerrada cuenta.
        var filasOrigen = await _client.GetFromJsonAsync<List<FilaReporte>>(
            $"/api/reportes/diario?tipoMovimientoId={escenario.TipoMovimientoId}&desde=2020-01-01&hasta=2099-12-31",
            TestData.Json);
        Assert.Empty(filasOrigen!);
    }

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

    [Fact]
    public async Task Trasegar_anonimo_es_401()
    {
        _client.DefaultRequestHeaders.Authorization = null;

        var resp = await TrasegarAsync(Guid.NewGuid(), Guid.NewGuid());

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task Trasegar_con_rol_Operador_es_403()
    {
        var (_, original) = await EscenarioTransferenciaAnuladaAsync();
        var destino = await CrearTipoDestinoAsync();
        await AutenticarAsync("operador", "Operador123!");

        var resp = await TrasegarAsync(original.Id, destino.Id);

        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    private sealed record FilaReporte(string Fecha, int CantidadBoletas, decimal PesoNetoTotal);
}
