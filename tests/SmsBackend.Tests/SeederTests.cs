using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using SmsBackend.Data;
using SmsBackend.Data.Seeding;
using SmsBackend.Domain.Configuracion;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// <see cref="ConfiguracionSeeder"/> directo (spec "Seed is data, not code"):
/// correrlo dos veces es idempotente, deja exactamente 8 secciones
/// <c>Estandar = 1</c> con sus campos reservados, y NO pisa un
/// <c>Seccion.Nombre</c> editado por un admin.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class SeederTests
{
    private readonly ApiFactory _factory;

    public SeederTests(ApiFactory factory) => _factory = factory;

    private async Task ConScope(Func<SmsDbContext, Task> accion)
    {
        using var scope = _factory.CreateScope();
        await accion(scope.ServiceProvider.GetRequiredService<SmsDbContext>());
    }

    [Fact]
    public async Task Correr_el_seeder_de_nuevo_es_idempotente_y_deja_8_secciones_estandar_con_sus_campos()
    {
        async Task<(int Secciones, int Campos)> ContarAsync(SmsDbContext db)
        {
            var estandarIds = await db.Secciones.Where(s => s.Estandar).Select(s => s.Id).ToListAsync();
            var campos = await db.Campos.CountAsync(c => estandarIds.Contains(c.SeccionId));
            return (estandarIds.Count, campos);
        }

        (int Secciones, int Campos) antes = default;
        await ConScope(async db =>
        {
            await ConfiguracionSeeder.SeedAsync(db, NullLogger.Instance);
            antes = await ContarAsync(db);
        });

        await ConScope(db => ConfiguracionSeeder.SeedAsync(db, NullLogger.Instance));

        await ConScope(async db =>
        {
            var despues = await ContarAsync(db);
            Assert.Equal(8, despues.Secciones);
            Assert.Equal(antes, despues);

            foreach (var (claveSeccion, clavesCampo) in SeccionEstandar.ClavesReservadas)
            {
                var seccion = await db.Secciones.SingleAsync(s => s.Clave == claveSeccion);
                Assert.True(seccion.Estandar);

                var presentes = await db.Campos
                    .Where(c => c.SeccionId == seccion.Id)
                    .Select(c => c.Clave)
                    .ToListAsync();

                Assert.Equal(
                    clavesCampo.OrderBy(x => x),
                    presentes.OrderBy(x => x));
            }
        });
    }

    [Fact]
    public async Task El_seeder_no_pisa_un_nombre_de_seccion_editado()
    {
        const string clave = "caracteristicas";
        string original = string.Empty;

        await ConScope(async db =>
        {
            var seccion = await db.Secciones.SingleAsync(s => s.Clave == clave);
            original = seccion.Nombre;
            seccion.Nombre = "Nombre editado por el admin";
            await db.SaveChangesAsync();
        });

        try
        {
            await ConScope(db => ConfiguracionSeeder.SeedAsync(db, NullLogger.Instance));

            await ConScope(async db =>
            {
                var seccion = await db.Secciones.SingleAsync(s => s.Clave == clave);
                Assert.Equal("Nombre editado por el admin", seccion.Nombre);
            });
        }
        finally
        {
            await ConScope(async db =>
            {
                var seccion = await db.Secciones.SingleAsync(s => s.Clave == clave);
                seccion.Nombre = original;
                await db.SaveChangesAsync();
            });
        }
    }
}
