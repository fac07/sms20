using System.Net;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SmsBackend.Data;
using SmsBackend.Domain.Configuracion;
using SmsBackend.Domain.Maestros;
using SmsBackend.Domain.TiposMovimiento;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Slice M4b — <c>POST /api/maestros/{id}/fusionar/{oficialId}</c> guard +
/// rewrite retroactivo (spec "Merge target must be an active Oficial" y "Merge
/// rewrites every central reference in one transaction", decisiones de producto
/// 6 y 7). El destino debe ser un Oficial activo; al fusionar, toda fila
/// <c>BoletaValorCampo</c> que apuntaba al provisional pasa a apuntar al oficial
/// en la misma transacción que el flag-flip, y <c>Proyectar</c> resuelve directo
/// (sin salto) una vez reescrita la fila.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class FusionarMaestroTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public FusionarMaestroTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<(Escenario Escenario, Guid CampoId)> ConfigurarReferenciaEquipoAsync()
    {
        var s = TestData.Sufijo();
        var seccion = await TestData.CrearSeccionAsync(_client, $"fus_{s}");
        var campo = await TestData.CrearCampoAsync(
            _client, seccion.Id, "equipo", TipoCampo.ReferenciaMaestro, catalogoRef: TipoCatalogo.Equipo, orden: 1);

        var escenario = await TestData.NuevoEscenarioAsync(_client);
        await TestData.AsignarSeccionesAsync(
            _client, escenario.TipoMovimientoId, new AsignacionSeccionRequest(seccion.Id, false, 1));

        return (escenario, campo.Id);
    }

    private Task<MaestroDto> CrearOficialEquipoAsync(string sufijo) =>
        TestData.PostAsync<MaestroDto>(_client, "/api/maestros",
            new GuardarMaestroRequest(TipoCatalogo.Equipo, $"EQO-{sufijo}", $"Equipo oficial {sufijo}", null));

    private async Task<MaestroDto> CrearProvisionalEquipoAsync(Escenario escenario, Guid id, string sufijo)
    {
        var (resp, body) = await TestData.SyncMaestroAsync(_client,
            TestData.SyncMaestroPayload(id, escenario.BasculaCodigo, TipoCatalogo.Equipo, $"EQP-{sufijo}", $"Equipo prov {sufijo}"));
        Assert.True(resp.IsSuccessStatusCode, body);
        return await TestData.GetMaestroAsync(_client, id);
    }

    private async Task<List<Guid?>> ValoresMaestroPersistidosAsync(Guid boletaId)
    {
        using var scope = _factory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SmsDbContext>();
        return await db.BoletaValores.AsNoTracking()
            .Where(v => v.BoletaId == boletaId)
            .Select(v => v.ValorMaestroId)
            .ToListAsync();
    }

    [Fact]
    public async Task Fusionar_reescribe_toda_referencia_central_y_flags_en_una_transaccion()
    {
        var (escenario, campoId) = await ConfigurarReferenciaEquipoAsync();
        var s = TestData.Sufijo();
        var oficial = await CrearOficialEquipoAsync(s);

        var provisionalId = Guid.NewGuid();
        await CrearProvisionalEquipoAsync(escenario, provisionalId, s);

        // Dos boletas ya en central apuntando al provisional (sincronizaron antes de la fusión).
        var boletaA = Guid.NewGuid();
        var boletaB = Guid.NewGuid();
        foreach (var boletaId in new[] { boletaA, boletaB })
        {
            var (resp, body) = await TestData.SyncAsync(_client, TestData.SyncCrearPayload(
                boletaId, escenario, DateTime.UtcNow, new[] { TestData.Referencia(campoId, provisionalId) }));
            Assert.True(resp.IsSuccessStatusCode, body);
        }

        var (fusion, cuerpoFusion) = await TestData.FusionarMaestroAsync(_client, provisionalId, oficial.Id);
        Assert.True(fusion.IsSuccessStatusCode, cuerpoFusion);

        // Referencias reescritas P -> O.
        Assert.All(await ValoresMaestroPersistidosAsync(boletaA), v => Assert.Equal(oficial.Id, v));
        Assert.All(await ValoresMaestroPersistidosAsync(boletaB), v => Assert.Equal(oficial.Id, v));

        // Flags del provisional en el mismo commit.
        var provisional = await TestData.GetMaestroAsync(_client, provisionalId);
        Assert.False(provisional.Activo);
        Assert.Equal(oficial.Id, provisional.FusionadoConId);
    }

    [Fact]
    public async Task Fusionar_deja_Proyectar_resolviendo_directo_sin_salto()
    {
        var (escenario, campoId) = await ConfigurarReferenciaEquipoAsync();
        var s = TestData.Sufijo();
        var oficial = await CrearOficialEquipoAsync(s);

        var provisionalId = Guid.NewGuid();
        await CrearProvisionalEquipoAsync(escenario, provisionalId, s);

        var boletaId = Guid.NewGuid();
        var (resp, body) = await TestData.SyncAsync(_client, TestData.SyncCrearPayload(
            boletaId, escenario, DateTime.UtcNow, new[] { TestData.Referencia(campoId, provisionalId) }));
        Assert.True(resp.IsSuccessStatusCode, body);

        var (fusion, cuerpoFusion) = await TestData.FusionarMaestroAsync(_client, provisionalId, oficial.Id);
        Assert.True(fusion.IsSuccessStatusCode, cuerpoFusion);

        var recargada = await TestData.GetBoletaAsync(_client, boletaId);
        var valor = Assert.Single(recargada.Valores);
        Assert.Equal(oficial.Id, valor.ValorMaestroId);
        Assert.Equal(oficial.Codigo, valor.ValorMaestroCodigo);
        Assert.Equal(oficial.Nombre, valor.ValorMaestroNombre);
    }

    [Fact]
    public async Task Fusionar_contra_un_target_provisional_es_409()
    {
        var s = TestData.Sufijo();
        var escenario = await TestData.NuevoEscenarioAsync(_client);

        var provisionalId = Guid.NewGuid();
        await CrearProvisionalEquipoAsync(escenario, provisionalId, s);

        var targetProvisionalId = Guid.NewGuid();
        await CrearProvisionalEquipoAsync(escenario, targetProvisionalId, $"{s}b");

        var (resp, _) = await TestData.FusionarMaestroAsync(_client, provisionalId, targetProvisionalId);
        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);

        var provisional = await TestData.GetMaestroAsync(_client, provisionalId);
        Assert.True(provisional.Activo);
        Assert.Null(provisional.FusionadoConId);
    }

    [Fact]
    public async Task Fusionar_contra_un_oficial_inactivo_es_409()
    {
        var s = TestData.Sufijo();
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var oficial = await CrearOficialEquipoAsync(s);

        var borrar = await _client.DeleteAsync($"/api/maestros/{oficial.Id}");
        Assert.True(borrar.IsSuccessStatusCode);

        var provisionalId = Guid.NewGuid();
        await CrearProvisionalEquipoAsync(escenario, provisionalId, s);

        var (resp, _) = await TestData.FusionarMaestroAsync(_client, provisionalId, oficial.Id);
        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);

        var provisional = await TestData.GetMaestroAsync(_client, provisionalId);
        Assert.True(provisional.Activo);
        Assert.Null(provisional.FusionadoConId);
    }

    [Fact]
    public async Task Fusionar_mantiene_los_guards_previos_self_merge_y_tipo_distinto()
    {
        var s = TestData.Sufijo();
        var escenario = await TestData.NuevoEscenarioAsync(_client);

        var provisionalId = Guid.NewGuid();
        await CrearProvisionalEquipoAsync(escenario, provisionalId, s);

        var (self, _) = await TestData.FusionarMaestroAsync(_client, provisionalId, provisionalId);
        Assert.Equal(HttpStatusCode.BadRequest, self.StatusCode);

        var oficialOtroTipo = await TestData.PostAsync<MaestroDto>(_client, "/api/maestros",
            new GuardarMaestroRequest(TipoCatalogo.Piloto, $"PIL-{s}", $"Piloto {s}", null));
        var (tipo, _) = await TestData.FusionarMaestroAsync(_client, provisionalId, oficialOtroTipo.Id);
        Assert.Equal(HttpStatusCode.Conflict, tipo.StatusCode);
    }
}
