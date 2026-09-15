using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SmsBackend.Data;
using SmsBackend.Data.Seeding;
using SmsBackend.Domain.Configuracion;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// <c>detalle_fruta.rampa_descarga</c> — espejo del combo cerrado del legacy
/// (NAT_Basculas frmCalidadFruta: <c>cbxRampaDescarga</c>, opciones fijas
/// "01"/"02"). Lista con <c>Configuracion {"opciones":["01","02"]}</c>,
/// opcional, clave reservada (solo el seeder la administra). La creación de
/// campos nuevos en secciones ya pobladas pasa por la misma pasada del seeder
/// (<c>clavesExistentes</c> → alta), no por <c>ReconciliarCamposReservados</c>
/// (que solo re-versiona tipo de campos existentes).
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class RampaDescargaSeederTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;

    public RampaDescargaSeederTests(ApiFactory factory) => _factory = factory;

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task ConScope(Func<SmsDbContext, Task> accion)
    {
        using var scope = _factory.CreateScope();
        await accion(scope.ServiceProvider.GetRequiredService<SmsDbContext>());
    }

    private async Task<Campo> VigenteAsync(SmsDbContext db)
    {
        var seccion = await db.Secciones.SingleAsync(s => s.Clave == "detalle_fruta");
        return await db.Campos.SingleAsync(c =>
            c.SeccionId == seccion.Id && c.Clave == "rampa_descarga" && c.VigenteHasta == null);
    }

    [Fact]
    public async Task El_seeder_siembra_rampa_descarga_como_lista_con_opciones_fijas()
    {
        await ConScope(db => ConfiguracionSeeder.SeedAsync(db, NullLogger.Instance));

        await ConScope(async db =>
        {
            var campo = await VigenteAsync(db);

            Assert.Equal(TipoCampo.Lista, campo.TipoCampo);
            Assert.Null(campo.TipoCatalogoRef);
            Assert.False(campo.Requerido);
            Assert.Equal("Rampa de descarga", campo.Etiqueta);

            var cfg = ConfiguracionCampo.Parse(campo.Configuracion);
            Assert.NotNull(cfg);
            Assert.Equal(new[] { "01", "02" }, cfg!.Opciones);
        });
    }

    [Fact]
    public void rampa_descarga_es_clave_reservada_de_detalle_fruta()
    {
        Assert.True(SeccionEstandar.EsCampoReservado("detalle_fruta", "rampa_descarga"));
    }

    [Fact]
    public async Task ReSeed_no_duplica_la_rampa()
    {
        await ConScope(async db =>
        {
            await ConfiguracionSeeder.SeedAsync(db, NullLogger.Instance);
            await ConfiguracionSeeder.SeedAsync(db, NullLogger.Instance);
        });

        await ConScope(async db =>
        {
            var seccion = await db.Secciones.SingleAsync(s => s.Clave == "detalle_fruta");
            var rampas = await db.Campos
                .CountAsync(c => c.SeccionId == seccion.Id && c.Clave == "rampa_descarga");
            Assert.Equal(1, rampas);
        });
    }

    [Fact]
    public async Task Seccion_poblada_sin_la_rampa_la_recibe_en_el_proximo_seed()
    {
        await ConScope(db => ConfiguracionSeeder.SeedAsync(db, NullLogger.Instance));

        // Simula una base sembrada antes de este campo: borra la fila.
        await ConScope(async db =>
        {
            var seccion = await db.Secciones.SingleAsync(s => s.Clave == "detalle_fruta");
            db.Campos.RemoveRange(db.Campos.Where(c =>
                c.SeccionId == seccion.Id && c.Clave == "rampa_descarga"));
            await db.SaveChangesAsync();
        });

        await ConScope(db => ConfiguracionSeeder.SeedAsync(db, NullLogger.Instance));

        await ConScope(async db =>
        {
            var campo = await VigenteAsync(db);
            var cfg = ConfiguracionCampo.Parse(campo.Configuracion);
            Assert.Equal(new[] { "01", "02" }, cfg!.Opciones);
        });
    }
}
