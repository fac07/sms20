using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SmsBackend.Data;
using SmsBackend.Domain.Maestros;
using SmsBackend.Domain.Transporte;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Slice B2a (design D4, PR7) — asignación temporal de transportista a una
/// Unidad. La fila abierta (<c>VigenteHasta == null</c>) ES el transportista
/// actual (G6); las filas cerradas son el historial. Reasignar cierra
/// exactamente la fila abierta e inserta una nueva en el mismo
/// <c>SaveChanges</c>, igual que el versionado de <c>Campo</c>
/// (CampoEndpoints.cs:176). El índice único filtrado
/// <c>UQ(UnidadId) WHERE [VigenteHasta] IS NULL</c> hace imposible, a nivel de
/// base de datos, que dos filas queden abiertas a la vez para la misma
/// unidad. No hay PUT ni DELETE: el diseño es explícito en que ninguna fila
/// se reescribe — la única escritura post-inserción es sellar
/// <c>VigenteHasta</c> en la fila superada.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class AsignacionUnidadTransportistaEndpointsTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public AsignacionUnidadTransportistaEndpointsTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<MaestroDto> CrearUnidadAsync() => TestData.CrearMaestroAsync(_client, TipoCatalogo.Unidad);

    private Task<MaestroDto> CrearTransportistaAsync() => TestData.CrearMaestroAsync(_client, TipoCatalogo.Transportista);

    private Task<AsignacionUnidadTransportistaDto> AsignarAsync(
        Guid unidadId, Guid transportistaId, string usuarioAsigna = "admin", string? motivoCambio = null) =>
        TestData.PostAsync<AsignacionUnidadTransportistaDto>(
            _client, $"/api/transporte/unidades/{unidadId}/asignaciones",
            new CrearAsignacionUnidadTransportistaRequest(transportistaId, usuarioAsigna, motivoCambio));

    private async Task<HttpResponseMessage> AsignarRawAsync(Guid unidadId, Guid transportistaId, string usuarioAsigna = "admin") =>
        await _client.PostAsJsonAsync($"/api/transporte/unidades/{unidadId}/asignaciones",
            new CrearAsignacionUnidadTransportistaRequest(transportistaId, usuarioAsigna, null), TestData.Json);

    private Task<List<AsignacionUnidadTransportistaDto>?> HistorialAsync(Guid unidadId) =>
        _client.GetFromJsonAsync<List<AsignacionUnidadTransportistaDto>>(
            $"/api/transporte/unidades/{unidadId}/asignaciones", TestData.Json);

    [Fact]
    public async Task Primera_asignacion_de_una_unidad_nueva_solo_inserta()
    {
        var unidad = await CrearUnidadAsync();
        var transportista = await CrearTransportistaAsync();

        var dto = await AsignarAsync(unidad.Id, transportista.Id, "admin", "Alta inicial");

        Assert.Equal(unidad.Id, dto.UnidadId);
        Assert.Equal(transportista.Id, dto.TransportistaId);
        Assert.Null(dto.VigenteHasta);
        Assert.Equal("admin", dto.UsuarioAsigna);
        Assert.Equal("Alta inicial", dto.MotivoCambio);
        Assert.NotEqual(default, dto.VigenteDesde);

        var historial = (await HistorialAsync(unidad.Id))!;
        Assert.Single(historial);
    }

    [Fact]
    public async Task Reasignar_cierra_exactamente_la_fila_abierta_e_inserta_una_nueva()
    {
        var unidad = await CrearUnidadAsync();
        var t1 = await CrearTransportistaAsync();
        var t2 = await CrearTransportistaAsync();
        var primera = await AsignarAsync(unidad.Id, t1.Id);

        await Task.Delay(15);
        var segunda = await AsignarAsync(unidad.Id, t2.Id, "admin", "Cambio de ruta");

        Assert.Equal(t2.Id, segunda.TransportistaId);
        Assert.Null(segunda.VigenteHasta);

        var historial = (await HistorialAsync(unidad.Id))!;
        Assert.Equal(2, historial.Count);

        var cerrada = historial.Single(a => a.Id == primera.Id);
        Assert.NotNull(cerrada.VigenteHasta);
        Assert.Equal(t1.Id, cerrada.TransportistaId);

        var abierta = historial.Single(a => a.Id == segunda.Id);
        Assert.Null(abierta.VigenteHasta);
        Assert.Equal(t2.Id, abierta.TransportistaId);

        // Exactamente UNA fila queda abierta tras la reasignación.
        Assert.Single(historial, a => a.VigenteHasta == null);
    }

    [Fact]
    public async Task Reasignar_dos_veces_solo_dos_filas_abiertas_a_la_vez_nunca()
    {
        var unidad = await CrearUnidadAsync();
        var t1 = await CrearTransportistaAsync();
        var t2 = await CrearTransportistaAsync();
        var t3 = await CrearTransportistaAsync();

        await AsignarAsync(unidad.Id, t1.Id);
        await Task.Delay(15);
        await AsignarAsync(unidad.Id, t2.Id);
        await Task.Delay(15);
        await AsignarAsync(unidad.Id, t3.Id);

        var historial = (await HistorialAsync(unidad.Id))!;
        Assert.Equal(3, historial.Count);
        Assert.Single(historial, a => a.VigenteHasta == null);
        Assert.Equal(2, historial.Count(a => a.VigenteHasta != null));
    }

    [Fact]
    public async Task El_indice_filtrado_impide_dos_filas_abiertas_para_la_misma_unidad()
    {
        var unidad = await CrearUnidadAsync();
        var transportista = await CrearTransportistaAsync();
        await AsignarAsync(unidad.Id, transportista.Id);

        // Intento directo a nivel de base de datos, sin pasar por el endpoint
        // (que siempre cierra la fila abierta antes de insertar): una segunda
        // fila con VigenteHasta=null para la MISMA unidad tiene que violar el
        // índice único filtrado UQ(UnidadId) WHERE [VigenteHasta] IS NULL,
        // probando la garantía a nivel de esquema, no solo de lógica de app.
        using var scope = _factory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SmsDbContext>();
        db.Set<AsignacionUnidadTransportista>().Add(new AsignacionUnidadTransportista
        {
            Id = Guid.NewGuid(),
            UnidadId = unidad.Id,
            TransportistaId = transportista.Id,
            VigenteDesde = DateTime.UtcNow,
            VigenteHasta = null,
            UsuarioAsigna = "race-condition",
        });

        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task Historial_se_lista_mas_reciente_primero()
    {
        var unidad = await CrearUnidadAsync();
        var t1 = await CrearTransportistaAsync();
        var t2 = await CrearTransportistaAsync();
        var t3 = await CrearTransportistaAsync();

        var primera = await AsignarAsync(unidad.Id, t1.Id);
        await Task.Delay(15);
        var segunda = await AsignarAsync(unidad.Id, t2.Id);
        await Task.Delay(15);
        var tercera = await AsignarAsync(unidad.Id, t3.Id);

        var historial = (await HistorialAsync(unidad.Id))!;

        Assert.Equal(
            new[] { tercera.Id, segunda.Id, primera.Id },
            historial.Select(a => a.Id));
    }

    [Fact]
    public async Task El_historial_de_una_unidad_no_incluye_asignaciones_de_otra()
    {
        var unidadA = await CrearUnidadAsync();
        var unidadB = await CrearUnidadAsync();
        var transportista = await CrearTransportistaAsync();
        var enA = await AsignarAsync(unidadA.Id, transportista.Id);
        var enB = await AsignarAsync(unidadB.Id, transportista.Id);

        var historialA = (await HistorialAsync(unidadA.Id))!;

        Assert.Contains(historialA, a => a.Id == enA.Id);
        Assert.DoesNotContain(historialA, a => a.Id == enB.Id);
    }

    [Fact]
    public async Task Asignar_sin_TransportistaId_devuelve_400_y_no_persiste()
    {
        var unidad = await CrearUnidadAsync();

        var resp = await AsignarRawAsync(unidad.Id, Guid.Empty);

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        Assert.Empty((await HistorialAsync(unidad.Id))!);
    }

    [Fact]
    public async Task No_existe_PUT_para_asignaciones()
    {
        var unidad = await CrearUnidadAsync();
        var transportista = await CrearTransportistaAsync();
        var dto = await AsignarAsync(unidad.Id, transportista.Id);

        var resp = await _client.PutAsJsonAsync(
            $"/api/transporte/unidades/{unidad.Id}/asignaciones/{dto.Id}",
            new { transportistaId = transportista.Id }, TestData.Json);

        // No hay ninguna fila reescrita jamás (diseño D4): el endpoint PUT no
        // existe, así que el enrutador debe rechazar la petición.
        Assert.False(resp.IsSuccessStatusCode);
        Assert.True(
            resp.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.MethodNotAllowed,
            $"esperaba 404 o 405, fue {(int)resp.StatusCode}");
    }

    [Fact]
    public async Task No_existe_DELETE_para_asignaciones()
    {
        var unidad = await CrearUnidadAsync();
        var transportista = await CrearTransportistaAsync();
        var dto = await AsignarAsync(unidad.Id, transportista.Id);

        var resp = await _client.DeleteAsync(
            $"/api/transporte/unidades/{unidad.Id}/asignaciones/{dto.Id}");

        Assert.False(resp.IsSuccessStatusCode);
        Assert.True(
            resp.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.MethodNotAllowed,
            $"esperaba 404 o 405, fue {(int)resp.StatusCode}");
    }
}
