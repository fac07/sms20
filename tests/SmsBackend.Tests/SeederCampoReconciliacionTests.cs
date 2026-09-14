using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using SmsBackend.Data;
using SmsBackend.Data.Seeding;
using SmsBackend.Domain.Boletas.Valores;
using SmsBackend.Domain.Configuracion;
using SmsBackend.Domain.Maestros;
using SmsBackend.Domain.TiposMovimiento;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Slice A2 (maestros-catalogos-faltantes, diseño D6) — reconciliación de las 3
/// claves reservadas (<c>ubicacion.bodega_externa</c>, <c>detalle_fruta.lote</c>,
/// <c>transporte.placa</c>) de <see cref="TipoCampo.Texto"/> a
/// <see cref="TipoCampo.ReferenciaMaestro"/>, más los 3 campos nuevos
/// (<c>ubicacion.tanque</c>, <c>detalle_fruta.ciclo</c>,
/// <c>detalle_fruta.seccion_finca</c>). Confirma también que
/// <c>nueva-version</c> sigue 409-ando estas claves (G1) y que
/// <c>compostera.ciclo</c>/<c>CicloCompostera</c> quedan intactos.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class SeederCampoReconciliacionTests
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public SeederCampoReconciliacionTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    private async Task ConScope(Func<SmsDbContext, Task> accion)
    {
        using var scope = _factory.CreateScope();
        await accion(scope.ServiceProvider.GetRequiredService<SmsDbContext>());
    }

    private async Task<T> ConScope<T>(Func<SmsDbContext, Task<T>> accion)
    {
        using var scope = _factory.CreateScope();
        return await accion(scope.ServiceProvider.GetRequiredService<SmsDbContext>());
    }

    private static async Task<Campo> VigenteAsync(SmsDbContext db, string seccionClave, string campoClave)
    {
        var seccion = await db.Secciones.SingleAsync(s => s.Clave == seccionClave);
        return await db.Campos.SingleAsync(c =>
            c.SeccionId == seccion.Id && c.Clave == campoClave && c.VigenteHasta == null);
    }

    [Fact]
    public async Task Seed_fresco_ya_siembra_las_tres_claves_reservadas_como_referencia_maestro()
    {
        await ConScope(async db =>
        {
            var bodegaExterna = await VigenteAsync(db, "ubicacion", "bodega_externa");
            Assert.Equal(TipoCampo.ReferenciaMaestro, bodegaExterna.TipoCampo);
            Assert.Equal(TipoCatalogo.BodegaExterna, bodegaExterna.TipoCatalogoRef);

            var lote = await VigenteAsync(db, "detalle_fruta", "lote");
            Assert.Equal(TipoCampo.ReferenciaMaestro, lote.TipoCampo);
            Assert.Equal(TipoCatalogo.Lote, lote.TipoCatalogoRef);

            var placa = await VigenteAsync(db, "transporte", "placa");
            Assert.Equal(TipoCampo.ReferenciaMaestro, placa.TipoCampo);
            Assert.Equal(TipoCatalogo.Unidad, placa.TipoCatalogoRef);
        });
    }

    [Fact]
    public async Task Reconciliacion_versiona_un_campo_texto_legado_a_referencia_maestro()
    {
        Guid seccionId = default;
        Guid idAnterior = default;

        await ConScope(async db =>
        {
            // Simula el estado legado (pre-swap): la fila vigente todavía es Texto.
            var vigente = await VigenteAsync(db, "ubicacion", "bodega_externa");
            seccionId = vigente.SeccionId;
            idAnterior = vigente.Id;
            vigente.TipoCampo = TipoCampo.Texto;
            vigente.TipoCatalogoRef = null;
            await db.SaveChangesAsync();
        });

        await ConScope(db => ConfiguracionSeeder.SeedAsync(db, NullLogger.Instance));

        await ConScope(async db =>
        {
            var anterior = await db.Campos.SingleAsync(c => c.Id == idAnterior);
            Assert.NotNull(anterior.VigenteHasta);
            Assert.Equal(TipoCampo.Texto, anterior.TipoCampo);

            var nueva = await VigenteAsync(db, "ubicacion", "bodega_externa");
            Assert.NotEqual(idAnterior, nueva.Id);
            Assert.Equal("bodega_externa", nueva.Clave);
            Assert.Equal(seccionId, nueva.SeccionId);
            Assert.Equal(TipoCampo.ReferenciaMaestro, nueva.TipoCampo);
            Assert.Equal(TipoCatalogo.BodegaExterna, nueva.TipoCatalogoRef);
        });
    }

    [Fact]
    public async Task Reconciliacion_reejecutada_sobre_una_base_ya_swapeada_es_no_op()
    {
        Guid seccionId = default;

        await ConScope(async db =>
        {
            // Simula el estado legado, igual que en el test de swap.
            var vigente = await VigenteAsync(db, "detalle_fruta", "lote");
            seccionId = vigente.SeccionId;
            vigente.TipoCampo = TipoCampo.Texto;
            vigente.TipoCatalogoRef = null;
            await db.SaveChangesAsync();
        });

        // Primera corrida: reconcilia (swap real, Texto -> ReferenciaMaestro).
        await ConScope(db => ConfiguracionSeeder.SeedAsync(db, NullLogger.Instance));

        var (idTrasPrimeraCorrida, conteoTrasPrimeraCorrida) = await ConScope(async db =>
        {
            var vigente = await VigenteAsync(db, "detalle_fruta", "lote");
            Assert.Equal(TipoCampo.ReferenciaMaestro, vigente.TipoCampo);
            var conteo = await db.Campos.CountAsync(c => c.SeccionId == seccionId && c.Clave == "lote");
            return (vigente.Id, conteo);
        });

        // Segunda corrida: ya está reconciliado -> no-op, ni nueva versión ni fila extra.
        await ConScope(db => ConfiguracionSeeder.SeedAsync(db, NullLogger.Instance));

        await ConScope(async db =>
        {
            var vigente = await VigenteAsync(db, "detalle_fruta", "lote");
            var conteoFinal = await db.Campos.CountAsync(c => c.SeccionId == seccionId && c.Clave == "lote");

            Assert.Equal(idTrasPrimeraCorrida, vigente.Id);
            Assert.Equal(conteoTrasPrimeraCorrida, conteoFinal);
        });
    }

    [Fact]
    public async Task Reconciliacion_preserva_etiqueta_orden_y_requerido_editados_por_admin()
    {
        Guid idAnterior = default;

        await ConScope(async db =>
        {
            var vigente = await VigenteAsync(db, "detalle_fruta", "lote");
            idAnterior = vigente.Id;
            // Admin edita Etiqueta/Orden/Requerido y luego la fila vuelve a
            // estado Texto (simula que esta edición ocurrió sobre la forma legada,
            // antes de que la reconciliación corriera).
            vigente.Etiqueta = "Lote (editado por admin)";
            vigente.Orden = 42;
            vigente.Requerido = true;
            vigente.TipoCampo = TipoCampo.Texto;
            vigente.TipoCatalogoRef = null;
            await db.SaveChangesAsync();
        });

        await ConScope(db => ConfiguracionSeeder.SeedAsync(db, NullLogger.Instance));

        await ConScope(async db =>
        {
            var nueva = await VigenteAsync(db, "detalle_fruta", "lote");
            Assert.NotEqual(idAnterior, nueva.Id);
            Assert.Equal(TipoCampo.ReferenciaMaestro, nueva.TipoCampo);
            Assert.Equal(TipoCatalogo.Lote, nueva.TipoCatalogoRef);
            Assert.Equal("Lote (editado por admin)", nueva.Etiqueta);
            Assert.Equal(42, nueva.Orden);
            Assert.True(nueva.Requerido);
        });
    }

    [Fact]
    public async Task Boleta_historica_previa_al_swap_resuelve_el_campo_texto_superado_asOf()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);

        var seccionId = await ConScope(db => db.Secciones.Where(s => s.Clave == "ubicacion").Select(s => s.Id).SingleAsync());
        await TestData.AsignarSeccionesAsync(_client, escenario.TipoMovimientoId,
            new AsignacionSeccionRequest(seccionId, false, 1));

        var tAssign = DateTime.UtcNow;
        var tSplit = tAssign.AddSeconds(30);
        var asOfHistorico = tAssign.AddSeconds(10);
        var asOfNuevo = tAssign.AddSeconds(60);

        Guid idAnterior = default, idNueva = default;

        await ConScope(async db =>
        {
            var vigente = await VigenteAsync(db, "ubicacion", "bodega_externa");
            idAnterior = vigente.Id;
            vigente.TipoCampo = TipoCampo.Texto;
            vigente.TipoCatalogoRef = null;
            vigente.VigenteHasta = tSplit;

            var nueva = new Campo
            {
                Id = Guid.NewGuid(),
                SeccionId = vigente.SeccionId,
                Clave = "bodega_externa",
                Etiqueta = vigente.Etiqueta,
                TipoCampo = TipoCampo.ReferenciaMaestro,
                TipoCatalogoRef = TipoCatalogo.BodegaExterna,
                Requerido = vigente.Requerido,
                Orden = vigente.Orden,
                VigenteDesde = tSplit,
                VigenteHasta = null,
            };
            db.Campos.Add(nueva);

            await db.SaveChangesAsync();
            idNueva = nueva.Id;
        });

        using var scope = _factory.CreateScope();
        var motor = scope.ServiceProvider.GetRequiredService<MotorCampos>();

        var resueltoHistorico = await motor.ResolverCamposAsync(escenario.TipoMovimientoId, asOfHistorico, CancellationToken.None);
        var campoHistorico = resueltoHistorico.Single(c => c.SeccionClave == "ubicacion" && c.CampoClave == "bodega_externa");
        Assert.Equal(idAnterior, campoHistorico.CampoId);
        Assert.Equal(TipoCampo.Texto, campoHistorico.TipoCampo);

        var resueltoNuevo = await motor.ResolverCamposAsync(escenario.TipoMovimientoId, asOfNuevo, CancellationToken.None);
        var campoNuevo = resueltoNuevo.Single(c => c.SeccionClave == "ubicacion" && c.CampoClave == "bodega_externa");
        Assert.Equal(idNueva, campoNuevo.CampoId);
        Assert.Equal(TipoCampo.ReferenciaMaestro, campoNuevo.TipoCampo);
    }

    [Fact]
    public async Task Nueva_version_sigue_bloqueada_para_las_tres_claves_reservadas_G1()
    {
        foreach (var (seccionClave, campoClave) in new[]
        {
            ("ubicacion", "bodega_externa"),
            ("detalle_fruta", "lote"),
            ("transporte", "placa"),
        })
        {
            var id = (await ConScope(db => VigenteAsync(db, seccionClave, campoClave))).Id;

            var resp = await _client.PostAsJsonAsync($"/api/campos/{id}/nueva-version",
                new NuevaVersionCampoRequest("Otra etiqueta", TipoCampo.Texto, null, false, null, 1), TestData.Json);

            Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
        }
    }

    [Fact]
    public async Task Ciclo_compostera_y_su_campo_quedan_sin_cambios_por_la_reconciliacion()
    {
        await ConScope(async db =>
        {
            var cicloCompostera = await VigenteAsync(db, "compostera", "ciclo");
            Assert.Equal(TipoCampo.ReferenciaMaestro, cicloCompostera.TipoCampo);
            Assert.Equal(TipoCatalogo.CicloCompostera, cicloCompostera.TipoCatalogoRef);

            var conteo = await db.Campos.CountAsync(c => c.SeccionId == cicloCompostera.SeccionId && c.Clave == "ciclo");
            Assert.Equal(1, conteo);
        });
    }

    [Fact]
    public async Task Seed_agrega_tanque_ciclo_cosecha_y_seccion_finca_como_referencia_maestro_reservados()
    {
        await ConScope(async db =>
        {
            var tanque = await VigenteAsync(db, "ubicacion", "tanque");
            Assert.Equal(TipoCampo.ReferenciaMaestro, tanque.TipoCampo);
            Assert.Equal(TipoCatalogo.Tanque, tanque.TipoCatalogoRef);
            Assert.True(SeccionEstandar.EsCampoReservado("ubicacion", "tanque"));

            var ciclo = await VigenteAsync(db, "detalle_fruta", "ciclo");
            Assert.Equal(TipoCampo.ReferenciaMaestro, ciclo.TipoCampo);
            Assert.Equal(TipoCatalogo.CicloCosecha, ciclo.TipoCatalogoRef);
            Assert.True(SeccionEstandar.EsCampoReservado("detalle_fruta", "ciclo"));

            var seccionFinca = await VigenteAsync(db, "detalle_fruta", "seccion_finca");
            Assert.Equal(TipoCampo.ReferenciaMaestro, seccionFinca.TipoCampo);
            Assert.Equal(TipoCatalogo.SeccionFinca, seccionFinca.TipoCatalogoRef);
            Assert.True(SeccionEstandar.EsCampoReservado("detalle_fruta", "seccion_finca"));
        });
    }
}
