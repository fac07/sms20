using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using SmsBackend.Data;
using SmsBackend.Domain.PreIngresos;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Slice 1 — cola de transporte central (<c>preingreso-queue</c>). Cubre el
/// alta que fuerza <c>Estado=Pendiente</c>, el rechazo sin <c>CentroId</c> sin
/// persistir, la edición y la cancelación permitidas solo mientras
/// <c>Pendiente</c> (409 en cualquier otro estado), el rechazo de una transición
/// desde <c>Cancelado</c>, el scope por <c>?centroId=</c> del listado y la regla
/// D5 del delta: con <c>?modificadoDesde=</c> presente el filtro <c>estado</c> se
/// ignora y el predicado es estrictamente mayor al watermark.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class PreIngresoEndpointsTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public PreIngresoEndpointsTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task ConScope(Func<SmsDbContext, Task> accion)
    {
        using var scope = _factory.CreateScope();
        await accion(scope.ServiceProvider.GetRequiredService<SmsDbContext>());
    }

    private static string Iso(DateTime utc) =>
        Uri.EscapeDataString(utc.ToString("yyyy-MM-ddTHH:mm:ss.fffffff") + "Z");

    private CrearPreIngresoRequest NuevaRequest(Guid centroId, string? numeroEnvio = null) => new(
        CentroId: centroId,
        NumeroEnvio: numeroEnvio ?? $"ENV-{Guid.NewGuid():N}"[..12],
        PesoEnviado: 20000m,
        UsuarioCreacion: "admin");

    private async Task<PreIngresoDto> CrearAsync(Guid centroId, string? numeroEnvio = null)
    {
        var resp = await _client.PostAsJsonAsync("/api/preingresos", NuevaRequest(centroId, numeroEnvio), TestData.Json);
        var body = await resp.Content.ReadAsStringAsync();
        Assert.True(resp.IsSuccessStatusCode, $"POST /api/preingresos => {(int)resp.StatusCode}: {body}");
        return System.Text.Json.JsonSerializer.Deserialize<PreIngresoDto>(body, TestData.Json)!;
    }

    /// <summary>
    /// Inserta un pre-ingreso directo en un estado que el flujo de slice 1 no
    /// alcanza todavía (<c>Vinculado</c> nace en la ingesta de boletas de slice
    /// 2). El sellador de <c>SmsDbContext</c> fija <c>FechaModificacion</c>.
    /// </summary>
    private async Task<Guid> SembrarAsync(Guid centroId, EstadoPreIngreso estado, string? numeroEnvio = null)
    {
        var id = Guid.NewGuid();
        await ConScope(async db =>
        {
            db.PreIngresos.Add(new PreIngreso
            {
                Id = id,
                CentroId = centroId,
                NumeroEnvio = numeroEnvio ?? $"ENV-{id:N}"[..12],
                PesoEnviado = 20000m,
                Estado = estado,
                UsuarioCreacion = "seed",
                FechaCreacion = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        });
        return id;
    }

    private Task<List<PreIngresoDto>?> ListarAsync(string query = "") =>
        _client.GetFromJsonAsync<List<PreIngresoDto>>($"/api/preingresos{query}", TestData.Json);

    private async Task<PreIngresoDto> GetAsync(Guid id) =>
        (await _client.GetFromJsonAsync<PreIngresoDto>($"/api/preingresos/{id}", TestData.Json))!;

    [Fact]
    public async Task Alta_fuerza_Estado_Pendiente_y_sella_fechas()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);

        var dto = await CrearAsync(escenario.CentroId);

        Assert.Equal(EstadoPreIngreso.Pendiente, dto.Estado);
        Assert.NotEqual(default, dto.FechaCreacion);
        Assert.NotEqual(default, dto.FechaModificacion);
        Assert.Null(dto.BoletaId);
    }

    [Fact]
    public async Task Alta_sin_CentroId_devuelve_400_y_no_persiste()
    {
        var req = NuevaRequest(Guid.Empty);

        var resp = await _client.PostAsJsonAsync("/api/preingresos", req, TestData.Json);

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        Assert.Empty((await ListarAsync())!);
    }

    [Fact]
    public async Task Edicion_de_pendiente_persiste_y_avanza_FechaModificacion()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var dto = await CrearAsync(escenario.CentroId);
        var fincaId = Guid.NewGuid();
        await Task.Delay(15);

        var resp = await _client.PutAsJsonAsync(
            $"/api/preingresos/{dto.Id}",
            new EditarPreIngresoRequest(
                CentroId: escenario.CentroId,
                NumeroEnvio: dto.NumeroEnvio,
                PesoEnviado: 17500m,
                FincaId: fincaId),
            TestData.Json);
        Assert.True(resp.IsSuccessStatusCode, await resp.Content.ReadAsStringAsync());

        var recargado = await GetAsync(dto.Id);
        Assert.Equal(17500m, recargado.PesoEnviado);
        Assert.Equal(fincaId, recargado.FincaId);
        Assert.True(
            recargado.FechaModificacion > dto.FechaModificacion,
            $"esperaba {recargado.FechaModificacion:o} > {dto.FechaModificacion:o}");
    }

    [Fact]
    public async Task Edicion_de_un_vinculado_devuelve_409_y_no_cambia_nada()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var id = await SembrarAsync(escenario.CentroId, EstadoPreIngreso.Vinculado);

        var resp = await _client.PutAsJsonAsync(
            $"/api/preingresos/{id}",
            new EditarPreIngresoRequest(escenario.CentroId, "ENV-CAMBIADO", 111m),
            TestData.Json);

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
        var recargado = await GetAsync(id);
        Assert.Equal(EstadoPreIngreso.Vinculado, recargado.Estado);
        Assert.Equal(20000m, recargado.PesoEnviado);
    }

    [Fact]
    public async Task Edicion_de_un_cancelado_devuelve_409()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var id = await SembrarAsync(escenario.CentroId, EstadoPreIngreso.Cancelado);

        var resp = await _client.PutAsJsonAsync(
            $"/api/preingresos/{id}",
            new EditarPreIngresoRequest(escenario.CentroId, "ENV-CAMBIADO", 111m),
            TestData.Json);

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
    }

    [Fact]
    public async Task Cancelar_un_pendiente_lo_pasa_a_Cancelado_y_avanza_watermark()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var dto = await CrearAsync(escenario.CentroId);
        await Task.Delay(15);

        var resp = await _client.PostAsJsonAsync(
            $"/api/preingresos/{dto.Id}/cancelar",
            new CancelarPreIngresoRequest("supervisor", "la unidad no llegó"),
            TestData.Json);
        Assert.True(resp.IsSuccessStatusCode, await resp.Content.ReadAsStringAsync());

        var recargado = await GetAsync(dto.Id);
        Assert.Equal(EstadoPreIngreso.Cancelado, recargado.Estado);
        Assert.Equal("supervisor", recargado.UsuarioCancela);
        Assert.Equal("la unidad no llegó", recargado.MotivoCancelacion);
        Assert.True(recargado.FechaModificacion > dto.FechaModificacion);
    }

    [Fact]
    public async Task Cancelar_un_vinculado_devuelve_409()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var id = await SembrarAsync(escenario.CentroId, EstadoPreIngreso.Vinculado);

        var resp = await _client.PostAsJsonAsync(
            $"/api/preingresos/{id}/cancelar",
            new CancelarPreIngresoRequest("supervisor", null),
            TestData.Json);

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
        Assert.Equal(EstadoPreIngreso.Vinculado, (await GetAsync(id)).Estado);
    }

    [Fact]
    public async Task Cancelar_un_cancelado_es_una_transicion_ilegal_y_devuelve_409()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var id = await SembrarAsync(escenario.CentroId, EstadoPreIngreso.Cancelado);

        var resp = await _client.PostAsJsonAsync(
            $"/api/preingresos/{id}/cancelar",
            new CancelarPreIngresoRequest("supervisor", null),
            TestData.Json);

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
    }

    [Fact]
    public async Task El_listado_se_scopea_por_centroId()
    {
        var centroA = await TestData.NuevoEscenarioAsync(_client);
        var centroB = await TestData.NuevoEscenarioAsync(_client);
        var enA = await CrearAsync(centroA.CentroId);
        var enB = await CrearAsync(centroB.CentroId);

        var soloA = (await ListarAsync($"?centroId={centroA.CentroId}"))!;

        Assert.Contains(soloA, p => p.Id == enA.Id);
        Assert.DoesNotContain(soloA, p => p.Id == enB.Id);
    }

    [Fact]
    public async Task El_listado_filtra_por_estado_cuando_no_hay_watermark()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var pendiente = await CrearAsync(escenario.CentroId);
        var cancelado = await SembrarAsync(escenario.CentroId, EstadoPreIngreso.Cancelado);

        var soloPendientes = (await ListarAsync($"?centroId={escenario.CentroId}&estado=Pendiente"))!;

        Assert.Contains(soloPendientes, p => p.Id == pendiente.Id);
        Assert.DoesNotContain(soloPendientes, p => p.Id == cancelado);
    }

    [Fact]
    public async Task El_delta_ignora_el_filtro_estado_para_arrastrar_vinculados_y_cancelados()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var watermark = DateTime.UtcNow;
        await Task.Delay(15);

        var pendiente = await CrearAsync(escenario.CentroId);
        var vinculado = await SembrarAsync(escenario.CentroId, EstadoPreIngreso.Vinculado);
        var cancelado = await SembrarAsync(escenario.CentroId, EstadoPreIngreso.Cancelado);

        var delta = (await ListarAsync(
            $"?centroId={escenario.CentroId}&estado=Pendiente&modificadoDesde={Iso(watermark)}"))!;
        var ids = delta.Select(p => p.Id).ToHashSet();

        Assert.Contains(pendiente.Id, ids);
        Assert.Contains(vinculado, ids);
        Assert.Contains(cancelado, ids);
    }

    [Fact]
    public async Task El_delta_es_estrictamente_mayor_al_watermark()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var primero = await CrearAsync(escenario.CentroId);
        var watermark = primero.FechaModificacion;
        await Task.Delay(15);
        var segundo = await CrearAsync(escenario.CentroId);

        var delta = (await ListarAsync(
            $"?centroId={escenario.CentroId}&modificadoDesde={Iso(watermark)}"))!;
        var ids = delta.Select(p => p.Id).ToHashSet();

        Assert.Contains(segundo.Id, ids);
        Assert.DoesNotContain(primero.Id, ids);
    }

    [Fact]
    public async Task Get_por_id_inexistente_devuelve_404()
    {
        var resp = await _client.GetAsync($"/api/preingresos/{Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }
}
