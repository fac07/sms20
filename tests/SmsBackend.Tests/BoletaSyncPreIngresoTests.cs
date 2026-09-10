using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SmsBackend.Data;
using SmsBackend.Domain.Boletas;
using SmsBackend.Domain.Boletas.Valores;
using SmsBackend.Domain.PreIngresos;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Slice 2 — resolución central de la carrera boleta↔pre-ingreso en la rama
/// "Crear" de <c>/api/boletas/sync</c> (spec "Same-centro double-link resolved
/// centrally" y "Offline cancellation after link leaves a non-reverting review
/// marker"; design D4). El SET condicional es atómico: de dos terminales que
/// declararon el mismo <c>preIngresoId</c> offline, central ata exactamente uno.
/// Los cinco desenlaces:
/// <list type="bullet">
///   <item>ganó → <c>PreIngresoId=P</c>, sin marca;</item>
///   <item>replay del ganador → no-op, todo igual;</item>
///   <item>perdedor del doble-enlace → <c>PreIngresoId=null</c> + <c>VinculoRechazado</c>;</item>
///   <item>pre-ingreso <c>Cancelado</c> → se CONSERVA <c>PreIngresoId</c> + <c>PreIngresoCancelado</c>;</item>
///   <item>pre-ingreso inexistente → <c>null</c> + <c>VinculoRechazado</c>.</item>
/// </list>
/// En ningún caso la ingesta responde 4xx: un problema de enlace no invalida
/// una boleta ya pesada.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class BoletaSyncPreIngresoTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public BoletaSyncPreIngresoTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<PreIngresoDto> CrearPreIngresoAsync(Guid centroId, string? numeroEnvio = null)
    {
        var req = new CrearPreIngresoRequest(
            CentroId: centroId,
            NumeroEnvio: numeroEnvio ?? $"ENV-{Guid.NewGuid():N}"[..12],
            PesoEnviado: 20000m,
            UsuarioCreacion: "logistica");
        return await TestData.PostAsync<PreIngresoDto>(_client, "/api/preingresos", req);
    }

    private async Task<(HttpResponseMessage Response, BoletaDto? Dto, string Body)> SyncCrearConEnlaceAsync(
        Escenario escenario, Guid boletaId, Guid? preIngresoId)
    {
        var (resp, body) = await TestData.SyncAsync(_client, TestData.SyncCrearPayload(
            boletaId, escenario, DateTime.UtcNow, Array.Empty<ValorCampoDto>(), preIngresoId: preIngresoId));
        var dto = resp.IsSuccessStatusCode
            ? JsonSerializer.Deserialize<BoletaDto>(body, TestData.Json)
            : null;
        return (resp, dto, body);
    }

    private async Task<PreIngreso> RecargarPreIngresoAsync(Guid id)
    {
        using var scope = _factory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SmsDbContext>();
        return await db.PreIngresos.AsNoTracking().FirstAsync(p => p.Id == id);
    }

    [Fact]
    public async Task Ganador_de_la_carrera_queda_enlazado_sin_marca_y_pasa_el_preingreso_a_Vinculado()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var pre = await CrearPreIngresoAsync(escenario.CentroId);
        var boletaId = Guid.NewGuid();

        var (resp, dto, body) = await SyncCrearConEnlaceAsync(escenario, boletaId, pre.Id);

        Assert.True(resp.IsSuccessStatusCode, body);
        Assert.Equal(pre.Id, dto!.PreIngresoId);
        Assert.Null(dto.MarcaPreIngreso);
        Assert.Equal(EstadoPreIngreso.Vinculado, dto.PreIngresoEstado);
        Assert.Equal(pre.NumeroEnvio, dto.PreIngresoNumeroEnvio);

        var recargado = await RecargarPreIngresoAsync(pre.Id);
        Assert.Equal(EstadoPreIngreso.Vinculado, recargado.Estado);
        Assert.Equal(boletaId, recargado.BoletaId);
        Assert.True(recargado.FechaModificacion > pre.FechaModificacion);
    }

    [Fact]
    public async Task Replay_del_evento_ganador_es_no_op_y_deja_todo_igual()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var pre = await CrearPreIngresoAsync(escenario.CentroId);
        var boletaId = Guid.NewGuid();
        var payload = TestData.SyncCrearPayload(
            boletaId, escenario, DateTime.UtcNow, Array.Empty<ValorCampoDto>(), preIngresoId: pre.Id);

        var (primera, cuerpoPrimera) = await TestData.SyncAsync(_client, payload);
        Assert.True(primera.IsSuccessStatusCode, cuerpoPrimera);
        var trasPrimera = await RecargarPreIngresoAsync(pre.Id);

        var (replay, cuerpoReplay) = await TestData.SyncAsync(_client, payload);

        Assert.True(replay.IsSuccessStatusCode, cuerpoReplay);
        var dto = JsonSerializer.Deserialize<BoletaDto>(cuerpoReplay, TestData.Json)!;
        Assert.Equal(pre.Id, dto.PreIngresoId);
        Assert.Null(dto.MarcaPreIngreso);

        var trasReplay = await RecargarPreIngresoAsync(pre.Id);
        Assert.Equal(EstadoPreIngreso.Vinculado, trasReplay.Estado);
        Assert.Equal(boletaId, trasReplay.BoletaId);
        Assert.Equal(trasPrimera.FechaModificacion, trasReplay.FechaModificacion);
    }

    [Fact]
    public async Task Perdedor_del_doble_enlace_queda_sin_enlace_con_marca_VinculoRechazado()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var pre = await CrearPreIngresoAsync(escenario.CentroId);
        var ganadora = Guid.NewGuid();
        var perdedora = Guid.NewGuid();

        var (respGanadora, _, cuerpoGanadora) = await SyncCrearConEnlaceAsync(escenario, ganadora, pre.Id);
        Assert.True(respGanadora.IsSuccessStatusCode, cuerpoGanadora);

        var (resp, dto, body) = await SyncCrearConEnlaceAsync(escenario, perdedora, pre.Id);

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        Assert.Null(dto!.PreIngresoId);
        Assert.Equal(MarcaPreIngreso.VinculoRechazado, dto.MarcaPreIngreso);

        // El pre-ingreso sigue atado a la ganadora — la identidad del perdedor
        // sobrevive en su SQLite local, no en central (design D4).
        var recargado = await RecargarPreIngresoAsync(pre.Id);
        Assert.Equal(ganadora, recargado.BoletaId);
    }

    [Fact]
    public async Task Enlace_a_un_preingreso_cancelado_conserva_el_puntero_con_marca_PreIngresoCancelado()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var pre = await CrearPreIngresoAsync(escenario.CentroId);
        var cancelar = await _client.PostAsJsonAsync(
            $"/api/preingresos/{pre.Id}/cancelar",
            new CancelarPreIngresoRequest("supervisor", "la unidad no llegó"),
            TestData.Json);
        Assert.True(cancelar.IsSuccessStatusCode, await cancelar.Content.ReadAsStringAsync());

        var boletaId = Guid.NewGuid();
        var (resp, dto, body) = await SyncCrearConEnlaceAsync(escenario, boletaId, pre.Id);

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        Assert.Equal(pre.Id, dto!.PreIngresoId);
        Assert.Equal(MarcaPreIngreso.PreIngresoCancelado, dto.MarcaPreIngreso);
        Assert.Equal(EstadoPreIngreso.Cancelado, dto.PreIngresoEstado);

        var recargado = await RecargarPreIngresoAsync(pre.Id);
        Assert.Equal(EstadoPreIngreso.Cancelado, recargado.Estado);
    }

    [Fact]
    public async Task Enlace_a_un_preingreso_inexistente_queda_sin_enlace_con_marca_VinculoRechazado()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var boletaId = Guid.NewGuid();

        var (resp, dto, body) = await SyncCrearConEnlaceAsync(escenario, boletaId, Guid.NewGuid());

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        Assert.Null(dto!.PreIngresoId);
        Assert.Equal(MarcaPreIngreso.VinculoRechazado, dto.MarcaPreIngreso);
        Assert.Null(dto.PreIngresoEstado);
        Assert.Null(dto.PreIngresoNumeroEnvio);
    }

    [Fact]
    public async Task Boleta_sin_preIngresoId_sincroniza_normal_sin_enlace_ni_marca()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var boletaId = Guid.NewGuid();

        var (resp, dto, body) = await SyncCrearConEnlaceAsync(escenario, boletaId, preIngresoId: null);

        Assert.True(resp.IsSuccessStatusCode, body);
        Assert.Null(dto!.PreIngresoId);
        Assert.Null(dto.MarcaPreIngreso);
        Assert.Null(dto.PreIngresoEstado);
    }

    [Fact]
    public async Task El_detalle_proyecta_numero_de_envio_estado_y_marca_del_preingreso()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);

        // Enlace limpio: el detalle muestra número de envío + estado Vinculado.
        var preOk = await CrearPreIngresoAsync(escenario.CentroId, "ENV-DETALLE-1");
        var boletaOk = Guid.NewGuid();
        var (respOk, _, cuerpoOk) = await SyncCrearConEnlaceAsync(escenario, boletaOk, preOk.Id);
        Assert.True(respOk.IsSuccessStatusCode, cuerpoOk);

        var detalleOk = await TestData.GetBoletaAsync(_client, boletaOk);
        Assert.Equal("ENV-DETALLE-1", detalleOk.PreIngresoNumeroEnvio);
        Assert.Equal(EstadoPreIngreso.Vinculado, detalleOk.PreIngresoEstado);
        Assert.Null(detalleOk.MarcaPreIngreso);

        // Enlace a un cancelado: el detalle expone la marca para revisión admin.
        var preCancelado = await CrearPreIngresoAsync(escenario.CentroId, "ENV-DETALLE-2");
        (await _client.PostAsJsonAsync(
            $"/api/preingresos/{preCancelado.Id}/cancelar",
            new CancelarPreIngresoRequest("supervisor", null),
            TestData.Json)).EnsureSuccessStatusCode();
        var boletaMarcada = Guid.NewGuid();
        var (respMarcada, _, cuerpoMarcada) = await SyncCrearConEnlaceAsync(escenario, boletaMarcada, preCancelado.Id);
        Assert.True(respMarcada.IsSuccessStatusCode, cuerpoMarcada);

        var detalleMarcada = await TestData.GetBoletaAsync(_client, boletaMarcada);
        Assert.Equal("ENV-DETALLE-2", detalleMarcada.PreIngresoNumeroEnvio);
        Assert.Equal(EstadoPreIngreso.Cancelado, detalleMarcada.PreIngresoEstado);
        Assert.Equal(MarcaPreIngreso.PreIngresoCancelado, detalleMarcada.MarcaPreIngreso);
    }
}
