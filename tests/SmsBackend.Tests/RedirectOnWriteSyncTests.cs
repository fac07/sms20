using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SmsBackend.Data;
using SmsBackend.Domain.Configuracion;
using SmsBackend.Domain.Maestros;
using SmsBackend.Domain.TiposMovimiento;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Slice M2 — redirect-on-write en la rama "Crear" de <c>/api/boletas/sync</c>
/// (spec "Boleta ingest redirects ValorMaestroId through FusionadoConId" y "Read
/// projection follows FusionadoConId"). El motor no se toca: cada
/// <c>ValorMaestroId</c> se resuelve al oficial vigente ANTES de validar y
/// persistir; <c>Proyectar</c> hace un único salto de lectura para la ventana de
/// lag previa al rewrite físico (que es M3).
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class RedirectOnWriteSyncTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public RedirectOnWriteSyncTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<(Escenario Escenario, Guid CampoId)> ConfigurarReferenciaEquipoAsync()
    {
        var s = TestData.Sufijo();
        var seccion = await TestData.CrearSeccionAsync(_client, $"prov_{s}");
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

    private async Task<Guid?> ValorMaestroPersistidoAsync(Guid boletaId)
    {
        using var scope = _factory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SmsDbContext>();
        return await db.BoletaValores.AsNoTracking()
            .Where(v => v.BoletaId == boletaId)
            .Select(v => v.ValorMaestroId)
            .FirstOrDefaultAsync();
    }

    [Fact]
    public async Task Sync_de_boleta_con_provisional_vivo_es_aceptada_y_persiste_el_provisional()
    {
        var (escenario, campoId) = await ConfigurarReferenciaEquipoAsync();
        var s = TestData.Sufijo();

        var provisionalId = Guid.NewGuid();
        var (ingesta, cuerpoIngesta) = await TestData.SyncMaestroAsync(_client,
            TestData.SyncMaestroPayload(provisionalId, escenario.BasculaCodigo, TipoCatalogo.Equipo, $"EQP-{s}", $"Equipo {s}"));
        Assert.True(ingesta.IsSuccessStatusCode, cuerpoIngesta);

        var boletaId = Guid.NewGuid();
        var (resp, body) = await TestData.SyncAsync(_client, TestData.SyncCrearPayload(
            boletaId, escenario, DateTime.UtcNow, new[] { TestData.Referencia(campoId, provisionalId) }));

        Assert.True(resp.IsSuccessStatusCode, body);
        Assert.Equal(provisionalId, await ValorMaestroPersistidoAsync(boletaId));
    }

    [Fact]
    public async Task Sync_de_boleta_cuyo_provisional_fue_fusionado_aterriza_sobre_el_oficial()
    {
        var (escenario, campoId) = await ConfigurarReferenciaEquipoAsync();
        var s = TestData.Sufijo();
        var oficial = await CrearOficialEquipoAsync(s);

        var provisionalId = Guid.NewGuid();
        var (ingesta, cuerpoIngesta) = await TestData.SyncMaestroAsync(_client,
            TestData.SyncMaestroPayload(provisionalId, escenario.BasculaCodigo, TipoCatalogo.Equipo, $"EQP-{s}", $"Equipo prov {s}"));
        Assert.True(ingesta.IsSuccessStatusCode, cuerpoIngesta);

        var (fusion, cuerpoFusion) = await TestData.FusionarMaestroAsync(_client, provisionalId, oficial.Id);
        Assert.True(fusion.IsSuccessStatusCode, cuerpoFusion);

        var boletaId = Guid.NewGuid();
        var (resp, body) = await TestData.SyncAsync(_client, TestData.SyncCrearPayload(
            boletaId, escenario, DateTime.UtcNow, new[] { TestData.Referencia(campoId, provisionalId) }));

        Assert.True(resp.IsSuccessStatusCode, body);
        Assert.Equal(oficial.Id, await ValorMaestroPersistidoAsync(boletaId));
    }

    [Fact]
    public async Task Proyectar_muestra_el_codigo_y_nombre_del_oficial_aunque_la_fila_apunte_al_provisional()
    {
        var (escenario, campoId) = await ConfigurarReferenciaEquipoAsync();
        var s = TestData.Sufijo();
        var oficial = await CrearOficialEquipoAsync(s);

        var provisionalId = Guid.NewGuid();
        var (ingesta, cuerpoIngesta) = await TestData.SyncMaestroAsync(_client,
            TestData.SyncMaestroPayload(provisionalId, escenario.BasculaCodigo, TipoCatalogo.Equipo, $"EQP-{s}", $"Equipo prov {s}"));
        Assert.True(ingesta.IsSuccessStatusCode, cuerpoIngesta);

        var boletaId = Guid.NewGuid();
        var (resp, body) = await TestData.SyncAsync(_client, TestData.SyncCrearPayload(
            boletaId, escenario, DateTime.UtcNow, new[] { TestData.Referencia(campoId, provisionalId) }));
        Assert.True(resp.IsSuccessStatusCode, body);
        Assert.Equal(provisionalId, await ValorMaestroPersistidoAsync(boletaId));

        // Ventana de lag: el provisional queda marcado como fusionado pero SIN
        // reescribir todavía la fila BoletaValorCampo (el rewrite retroactivo de
        // /fusionar es M4b). Se simula acá tocando el maestro directo para probar
        // el salto de lectura de Proyectar de forma aislada del endpoint.
        using (var scope = _factory.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<SmsDbContext>();
            var provisional = await db.Maestros.FirstAsync(m => m.Id == provisionalId);
            provisional.FusionadoConId = oficial.Id;
            provisional.Activo = false;
            await db.SaveChangesAsync();
        }

        var recargada = await TestData.GetBoletaAsync(_client, boletaId);
        var valor = Assert.Single(recargada.Valores);
        Assert.Equal(provisionalId, valor.ValorMaestroId);
        Assert.Equal(oficial.Codigo, valor.ValorMaestroCodigo);
        Assert.Equal(oficial.Nombre, valor.ValorMaestroNombre);
    }
}
