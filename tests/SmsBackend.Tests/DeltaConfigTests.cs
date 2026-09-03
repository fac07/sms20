using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SmsBackend.Data;
using SmsBackend.Domain.Boletas.Valores;
using SmsBackend.Domain.Configuracion;
using SmsBackend.Domain.TiposMovimiento;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Canal de deltas de configuración (spec Layer E): <c>?modificadoDesde</c>
/// devuelve solo filas con <c>FechaModificacion &gt; watermark</c>, el parámetro
/// omitido devuelve el set completo, un timestamp malformado da 400, una
/// desactivación (<c>Activa=false</c> / <c>VigenteHasta</c>) se sella y aparece en
/// el siguiente pull, y <c>CampoAplicable.Etiqueta</c> viaja en el formulario.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class DeltaConfigTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public DeltaConfigTests(ApiFactory factory)
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

    private async Task<List<SeccionDto>> ListarSeccionesAsync(string query = "")
    {
        var dtos = await _client.GetFromJsonAsync<List<SeccionDto>>($"/api/secciones{query}", TestData.Json);
        return dtos!;
    }

    private async Task<List<CampoDto>> ListarCamposAsync(string query = "")
    {
        var dtos = await _client.GetFromJsonAsync<List<CampoDto>>($"/api/campos{query}", TestData.Json);
        return dtos!;
    }

    private static string Iso(DateTime utc) =>
        Uri.EscapeDataString(utc.ToString("yyyy-MM-ddTHH:mm:ss.fffffff") + "Z");

    [Fact]
    public async Task Delta_de_secciones_devuelve_solo_las_modificadas_despues_del_watermark()
    {
        var s = TestData.Sufijo();
        var vieja = await TestData.CrearSeccionAsync(_client, $"delta_a_{s}");

        // Watermark = instante de la sección vieja; el filtro es estrictamente mayor.
        var watermark = vieja.FechaModificacion;
        await Task.Delay(15);

        var nueva = await TestData.CrearSeccionAsync(_client, $"delta_b_{s}");

        var delta = await ListarSeccionesAsync($"?modificadoDesde={Iso(watermark)}");
        var ids = delta.Select(d => d.Id).ToHashSet();

        Assert.Contains(nueva.Id, ids);
        Assert.DoesNotContain(vieja.Id, ids);
    }

    [Fact]
    public async Task Parametro_omitido_devuelve_el_set_completo()
    {
        var s = TestData.Sufijo();
        var seccion = await TestData.CrearSeccionAsync(_client, $"full_{s}");

        var todas = await ListarSeccionesAsync();

        // El seed de 8 secciones estándar + la recién creada como mínimo.
        Assert.Contains(seccion.Id, todas.Select(d => d.Id));
        Assert.True(todas.Count >= 9);
    }

    [Fact]
    public async Task Timestamp_malformado_da_400()
    {
        var secciones = await _client.GetAsync("/api/secciones?modificadoDesde=not-a-date");
        Assert.Equal(HttpStatusCode.BadRequest, secciones.StatusCode);

        var campos = await _client.GetAsync("/api/campos?modificadoDesde=xyz");
        Assert.Equal(HttpStatusCode.BadRequest, campos.StatusCode);

        var s = TestData.Sufijo();
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var tms = await _client.GetAsync(
            $"/api/tipos-movimiento/{escenario.TipoMovimientoId}/secciones?modificadoDesde=nope");
        Assert.Equal(HttpStatusCode.BadRequest, tms.StatusCode);
    }

    [Fact]
    public async Task Desactivar_una_seccion_la_hace_aparecer_en_el_siguiente_pull()
    {
        var s = TestData.Sufijo();
        var seccion = await TestData.CrearSeccionAsync(_client, $"deact_{s}");
        var watermark = seccion.FechaModificacion;
        await Task.Delay(15);

        // PUT que la desactiva (no es estándar → el GuardiaEstandar la deja).
        var resp = await _client.PutAsJsonAsync(
            $"/api/secciones/{seccion.Id}",
            new ActualizarSeccionRequest(
                seccion.Clave, seccion.Nombre, seccion.Cardinalidad, seccion.Reportable, seccion.Orden, Activa: false),
            TestData.Json);
        Assert.True(resp.IsSuccessStatusCode, await resp.Content.ReadAsStringAsync());

        var delta = await ListarSeccionesAsync($"?modificadoDesde={Iso(watermark)}");
        var fila = delta.SingleOrDefault(d => d.Id == seccion.Id);

        Assert.NotNull(fila);
        Assert.False(fila!.Activa);
    }

    [Fact]
    public async Task Retirar_un_campo_versionandolo_lo_hace_aparecer_en_el_delta_con_VigenteHasta()
    {
        var s = TestData.Sufijo();
        var seccion = await TestData.CrearSeccionAsync(_client, $"retiro_delta_{s}");
        var campo = await TestData.CrearCampoAsync(_client, seccion.Id, "medida", TipoCampo.Decimal);
        var watermark = campo.FechaModificacion;
        await Task.Delay(15);

        await ConScope(async db =>
        {
            var fila = await db.Campos.SingleAsync(c => c.Id == campo.Id);
            fila.VigenteHasta = DateTime.UtcNow;
            await db.SaveChangesAsync();
        });

        var delta = await ListarCamposAsync($"?modificadoDesde={Iso(watermark)}");
        var retirado = delta.SingleOrDefault(c => c.Id == campo.Id);

        Assert.NotNull(retirado);
        Assert.NotNull(retirado!.VigenteHasta);
    }

    [Fact]
    public async Task FechaModificacion_avanza_en_cada_update_no_solo_en_el_insert()
    {
        var s = TestData.Sufijo();
        var seccion = await TestData.CrearSeccionAsync(_client, $"bump_{s}");
        var insertada = seccion.FechaModificacion;
        await Task.Delay(15);

        var resp = await _client.PutAsJsonAsync(
            $"/api/secciones/{seccion.Id}",
            new ActualizarSeccionRequest(
                seccion.Clave, "Renombrada", seccion.Cardinalidad, seccion.Reportable, seccion.Orden, Activa: true),
            TestData.Json);
        Assert.True(resp.IsSuccessStatusCode, await resp.Content.ReadAsStringAsync());

        var recargada = (await ListarSeccionesAsync()).Single(d => d.Id == seccion.Id);
        Assert.True(
            recargada.FechaModificacion > insertada,
            $"esperaba {recargada.FechaModificacion:o} > {insertada:o}");
    }

    [Fact]
    public async Task El_delta_de_secciones_asignadas_filtra_por_FechaModificacion()
    {
        var s = TestData.Sufijo();
        var seccion = await TestData.CrearSeccionAsync(_client, $"tms_delta_{s}");
        var escenario = await TestData.NuevoEscenarioAsync(_client);

        var antes = DateTime.UtcNow;
        await Task.Delay(15);
        await TestData.AsignarSeccionesAsync(
            _client, escenario.TipoMovimientoId, new AsignacionSeccionRequest(seccion.Id, Requerida: true, Orden: 1));

        var delta = await _client.GetFromJsonAsync<List<TipoMovimientoSeccionDto>>(
            $"/api/tipos-movimiento/{escenario.TipoMovimientoId}/secciones?modificadoDesde={Iso(antes)}",
            TestData.Json);

        Assert.Contains(delta!, d => d.SeccionId == seccion.Id);

        var futuro = await _client.GetFromJsonAsync<List<TipoMovimientoSeccionDto>>(
            $"/api/tipos-movimiento/{escenario.TipoMovimientoId}/secciones?modificadoDesde={Iso(DateTime.UtcNow.AddMinutes(1))}",
            TestData.Json);
        Assert.Empty(futuro!);
    }

    [Fact]
    public async Task El_formulario_trae_la_Etiqueta_vigente_de_cada_campo()
    {
        var s = TestData.Sufijo();
        var seccion = await TestData.CrearSeccionAsync(_client, $"etq_{s}");
        await TestData.PostAsync<CampoDto>(_client, "/api/campos",
            new CrearCampoRequest(
                seccion.Id, "acidez", "Acidez del lote (%)", TipoCampo.Decimal, null, false, null, 1));

        var escenario = await TestData.NuevoEscenarioAsync(_client);
        await TestData.AsignarSeccionesAsync(
            _client, escenario.TipoMovimientoId, new AsignacionSeccionRequest(seccion.Id, Requerida: false, Orden: 1));

        var formulario = await TestData.FormularioAsync(_client, escenario.TipoMovimientoId);
        var campo = Assert.Single(formulario, c => c.CampoClave == "acidez");

        Assert.Equal("Acidez del lote (%)", campo.Etiqueta);
    }
}
