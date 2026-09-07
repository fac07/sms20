using System.Net;
using System.Net.Http.Json;
using SmsBackend.Domain.Maestros;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Slice M4b — store en memoria de incidencias de sync
/// (<c>POST|GET /api/maestros/incidencias-sync</c>, spec "Central stuck-sync
/// alert surface" + M-D3). Upsert idempotente por <c>(basculaCodigo, entidadId)</c>
/// y <c>ultimoError</c> verbatim (decisión de producto 9).
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class IncidenciasSyncHttpTests
{
    private readonly HttpClient _client;

    public IncidenciasSyncHttpTests(ApiFactory factory) => _client = factory.CreateClient();

    [Fact]
    public async Task Reportar_luego_listar_devuelve_la_incidencia_con_el_error_verbatim()
    {
        var entidadId = Guid.NewGuid();
        var basculaCodigo = $"B-{TestData.Sufijo()}";
        const string errorCrudo = "HTTP 422: {\"detalle\":\"Codigo 'PROV-01-3' ya usado\"}";

        var post = await _client.PostAsJsonAsync("/api/maestros/incidencias-sync", new ReportarIncidenciaSyncRequest(
            basculaCodigo, entidadId, "Transportista", "Juan Perez", 5, errorCrudo), TestData.Json);
        Assert.Equal(HttpStatusCode.NoContent, post.StatusCode);

        var lista = await _client.GetFromJsonAsync<List<IncidenciaSync>>(
            "/api/maestros/incidencias-sync", TestData.Json);

        var incidencia = Assert.Single(lista!, i => i.EntidadId == entidadId);
        Assert.Equal(basculaCodigo, incidencia.BasculaCodigo);
        Assert.Equal("Transportista", incidencia.TipoCatalogo);
        Assert.Equal("Juan Perez", incidencia.Nombre);
        Assert.Equal(5, incidencia.Intentos);
        Assert.Equal(errorCrudo, incidencia.UltimoError);
    }

    [Fact]
    public async Task Reportar_dos_veces_la_misma_entidad_es_upsert_no_duplica()
    {
        var entidadId = Guid.NewGuid();
        var basculaCodigo = $"B-{TestData.Sufijo()}";

        await _client.PostAsJsonAsync("/api/maestros/incidencias-sync", new ReportarIncidenciaSyncRequest(
            basculaCodigo, entidadId, "Finca", "Finca X", 5, "primer error"), TestData.Json);
        await _client.PostAsJsonAsync("/api/maestros/incidencias-sync", new ReportarIncidenciaSyncRequest(
            basculaCodigo, entidadId, "Finca", "Finca X", 8, "error mas nuevo"), TestData.Json);

        var lista = await _client.GetFromJsonAsync<List<IncidenciaSync>>(
            "/api/maestros/incidencias-sync", TestData.Json);

        var incidencia = Assert.Single(lista!.Where(i => i.EntidadId == entidadId));
        Assert.Equal(8, incidencia.Intentos);
        Assert.Equal("error mas nuevo", incidencia.UltimoError);
    }

    [Fact]
    public async Task Reportar_sin_bascula_o_sin_entidad_es_400()
    {
        var sinBascula = await _client.PostAsJsonAsync("/api/maestros/incidencias-sync",
            new ReportarIncidenciaSyncRequest("", Guid.NewGuid(), null, null, 5, null), TestData.Json);
        Assert.Equal(HttpStatusCode.BadRequest, sinBascula.StatusCode);

        var sinEntidad = await _client.PostAsJsonAsync("/api/maestros/incidencias-sync",
            new ReportarIncidenciaSyncRequest("B-1", Guid.Empty, null, null, 5, null), TestData.Json);
        Assert.Equal(HttpStatusCode.BadRequest, sinEntidad.StatusCode);
    }
}

/// <summary>
/// Slice M4b — poda por TTL de 1h del <see cref="IncidenciasSyncStore"/>
/// (M-D3: volátil por diseño). Se testea la clase directa con un reloj falso.
/// </summary>
public sealed class IncidenciasSyncStoreTests
{
    [Fact]
    public void Una_entrada_se_poda_pasado_el_TTL_de_una_hora()
    {
        var ahora = new DateTimeOffset(2026, 9, 6, 12, 0, 0, TimeSpan.Zero);
        var store = new IncidenciasSyncStore(() => ahora);

        store.Reportar(new ReportarIncidenciaSyncRequest("B1", Guid.NewGuid(), "Piloto", "P", 5, "err"));
        Assert.Single(store.Listar());

        ahora = ahora.AddMinutes(59);
        Assert.Single(store.Listar());

        ahora = ahora.AddMinutes(2); // 61 min desde el reporte -> expirada
        Assert.Empty(store.Listar());
    }

    [Fact]
    public void Reportar_de_nuevo_renueva_el_TTL_de_la_entrada()
    {
        var ahora = new DateTimeOffset(2026, 9, 6, 12, 0, 0, TimeSpan.Zero);
        var store = new IncidenciasSyncStore(() => ahora);
        var entidadId = Guid.NewGuid();

        store.Reportar(new ReportarIncidenciaSyncRequest("B1", entidadId, "Piloto", "P", 5, "err"));

        ahora = ahora.AddMinutes(50);
        store.Reportar(new ReportarIncidenciaSyncRequest("B1", entidadId, "Piloto", "P", 6, "err2"));

        ahora = ahora.AddMinutes(50); // 100 min desde el 1er reporte, 50 desde el 2do
        Assert.Single(store.Listar());
    }
}
