using System.Net;
using System.Net.Http.Json;
using SmsBackend.Domain.Centros;
using SmsBackend.Domain.Maestros;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Config de rutas de transferencia por Centro (Frente 6 pto 7) — espejo de
/// <c>NAT_BSC_Configuraciones</c> del legacy (clsConfiguracionCentro.cs:1421),
/// que precargaba Sitio/Almacén por pantalla de traspaso para ahorrar tipeo.
/// En SMS 2.0 esos campos ya son la sección EAV <c>ubicacion</c>; esta tarea
/// agrega SOLO el default por Centro: 4 FKs lógicas nullable a Maestro con
/// el mismo TipoCatalogo que exige el seeder (sitio_*→Centro, almacen_*→
/// Almacen, ConfiguracionSeeder.cs:60-65). CRUD simple GET/PUT sin historial
/// (es config administrativa, no transaccional) y validación de FKs replicando
/// <c>BasculaEndpoints.ValidarRequest</c>: maestro activo + TipoCatalogo
/// correcto, 400 con mensaje explicativo. GET siempre 200: sin fila = cuatro
/// nulls — así config-sync distingue "sin default" de "error de red" sin
/// codes pifones, y un borrado del admin (PUT nulls) se propaga igual.
/// Las variantes BE del legacy (<c>Sitio_Destino_Envios_BE</c>, etc.) quedan
/// fuera: <c>ubicacion</c> hoy modela un único par origen/destino.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class ConfiguracionCentroTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public ConfiguracionCentroTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<HttpResponseMessage> GetAsync(Guid centroId) =>
        _client.GetAsync($"/api/centros/{centroId}/configuracion");

    private Task<HttpResponseMessage> PutAsync(Guid centroId, object body) =>
        _client.PutAsJsonAsync(
            $"/api/centros/{centroId}/configuracion",
            body,
            TestData.Json);

    private async Task<ConfiguracionCentroDto> LeerAsync(Guid centroId)
    {
        var resp = await GetAsync(centroId);
        resp.EnsureSuccessStatusCode();
        return (await resp.Content.ReadFromJsonAsync<ConfiguracionCentroDto>(TestData.Json))!;
    }

    private Task<MaestroDto> CentroPropioAsync() =>
        TestData.CrearMaestroAsync(_client, TipoCatalogo.Centro);

    private Task<MaestroDto> OtroCentroAsync() =>
        TestData.CrearMaestroAsync(_client, TipoCatalogo.Centro);

    private Task<MaestroDto> AlmacenAsync() =>
        TestData.CrearMaestroAsync(_client, TipoCatalogo.Almacen);

    [Fact]
    public async Task GET_sin_configuracion_previa_es_200_con_cuatro_nulls()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);

        var dto = await LeerAsync(escenario.CentroId);

        Assert.Equal(escenario.CentroId, dto.CentroId);
        Assert.Null(dto.SitioOrigenDefaultId);
        Assert.Null(dto.SitioDestinoDefaultId);
        Assert.Null(dto.AlmacenOrigenDefaultId);
        Assert.Null(dto.AlmacenDestinoDefaultId);
    }

    [Fact]
    public async Task PUT_guarda_los_cuatro_defaults_y_GET_los_lee()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var sitioOrigen = await CentroPropioAsync();
        var sitioDestino = await OtroCentroAsync();
        var almacenOrigen = await AlmacenAsync();
        var almacenDestino = await AlmacenAsync();

        var resp = await PutAsync(escenario.CentroId, new
        {
            sitioOrigenDefaultId = sitioOrigen.Id,
            sitioDestinoDefaultId = sitioDestino.Id,
            almacenOrigenDefaultId = almacenOrigen.Id,
            almacenDestinoDefaultId = almacenDestino.Id,
        });

        resp.EnsureSuccessStatusCode();
        var dto = await LeerAsync(escenario.CentroId);
        Assert.Equal(sitioOrigen.Id, dto.SitioOrigenDefaultId);
        Assert.Equal(sitioDestino.Id, dto.SitioDestinoDefaultId);
        Assert.Equal(almacenOrigen.Id, dto.AlmacenOrigenDefaultId);
        Assert.Equal(almacenDestino.Id, dto.AlmacenDestinoDefaultId);
    }

    [Fact]
    public async Task PUT_repetido_actualiza_en_lugar_de_duplicar()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var primero = await CentroPropioAsync();
        var segundo = await OtroCentroAsync();

        (await PutAsync(escenario.CentroId, new { sitioOrigenDefaultId = primero.Id }))
            .EnsureSuccessStatusCode();
        (await PutAsync(escenario.CentroId, new { sitioOrigenDefaultId = segundo.Id }))
            .EnsureSuccessStatusCode();

        var dto = await LeerAsync(escenario.CentroId);
        Assert.Equal(segundo.Id, dto.SitioOrigenDefaultId);
    }

    [Fact]
    public async Task PUT_con_nulls_limpien_los_defaults_previos()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var sitio = await CentroPropioAsync();
        var almacen = await AlmacenAsync();
        (await PutAsync(escenario.CentroId, new
        {
            sitioOrigenDefaultId = sitio.Id,
            almacenDestinoDefaultId = almacen.Id,
        })).EnsureSuccessStatusCode();

        (await PutAsync(escenario.CentroId, new
        {
            sitioOrigenDefaultId = (Guid?)null,
            sitioDestinoDefaultId = (Guid?)null,
            almacenOrigenDefaultId = (Guid?)null,
            almacenDestinoDefaultId = (Guid?)null,
        })).EnsureSuccessStatusCode();

        var dto = await LeerAsync(escenario.CentroId);
        Assert.Null(dto.SitioOrigenDefaultId);
        Assert.Null(dto.AlmacenDestinoDefaultId);
    }

    [Fact]
    public async Task PUT_centro_inexistente_es_400()
    {
        var resp = await PutAsync(Guid.NewGuid(), new { sitioOrigenDefaultId = (Guid?)null });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task PUT_sitio_que_no_es_TipoCatalogo_Centro_es_400()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var piloto = await TestData.CrearMaestroAsync(_client, TipoCatalogo.Piloto);

        var resp = await PutAsync(escenario.CentroId, new
        {
            sitioDestinoDefaultId = piloto.Id,
        });

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var dto = await LeerAsync(escenario.CentroId);
        Assert.Null(dto.SitioDestinoDefaultId);
    }

    [Fact]
    public async Task PUT_almacen_inactivo_es_400()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var almacen = await AlmacenAsync();
        (await _client.DeleteAsync($"/api/maestros/{almacen.Id}")).EnsureSuccessStatusCode();

        var resp = await PutAsync(escenario.CentroId, new
        {
            almacenOrigenDefaultId = almacen.Id,
        });

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task PUT_almacen_en_campo_de_sitio_es_400_por_catalogo_invertido()
    {
        // El catalogo esperado depende del ROL del default, no de que "sea un
        // maestro cualquiera": almacen_* exige Almacen, sitio_* exige Centro.
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var almacen = await AlmacenAsync();

        var resp = await PutAsync(escenario.CentroId, new
        {
            sitioOrigenDefaultId = almacen.Id,
        });

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task GET_centro_inexistente_es_404()
    {
        // GET no inventa estado: la ruta solo existe para centros reales. El
        // 200-con-nulls del test de arriba aplica a un Centro válido sin fila
        // de configuración, no a cualquier Guid.
        var resp = await GetAsync(Guid.NewGuid());
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }
}
