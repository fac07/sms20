using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using SmsBackend.Data;
using SmsBackend.Data.Seeding;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Host de prueba sobre una base descartable <c>Sms20_Test_{Guid:N}</c> en la
/// misma instancia SQL Server del docker-compose local (design "Testing
/// Strategy"): mismo motor que corre el dev, arm64-nativo, sin infra nueva.
///
/// <list type="bullet">
///   <item>Reemplaza el registro de <see cref="DbContextOptions{SmsDbContext}"/>
///   por una conexión a la base descartable, tomada de
///   <c>SMS20_TEST_CONNECTION</c> (default = credenciales del compose).</item>
///   <item><c>Environment = "Testing"</c> para que el bloque solo-Development de
///   <c>Program.cs</c> (MigrateAsync + seeder) NO corra dos veces.</item>
///   <item><see cref="IAsyncLifetime.InitializeAsync"/> crea la base con
///   <c>MigrateAsync()</c> y siembra las 8 secciones estándar.</item>
///   <item><see cref="IAsyncLifetime.DisposeAsync"/> la borra con
///   <c>EnsureDeletedAsync()</c>.</item>
/// </list>
/// </summary>
public sealed class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly string _connectionString;

    public ApiFactory()
    {
        var raw = Environment.GetEnvironmentVariable("SMS20_TEST_CONNECTION")
            ?? "Server=localhost,1433;User Id=sa;Password=Sms20-Dev!2026;TrustServerCertificate=True;Encrypt=False";

        _connectionString = new SqlConnectionStringBuilder(raw)
        {
            InitialCatalog = $"Sms20_Test_{Guid.NewGuid():N}",
        }.ConnectionString;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");

        builder.ConfigureServices(services =>
        {
            var descriptores = services
                .Where(d =>
                    d.ServiceType == typeof(DbContextOptions<SmsDbContext>)
                    || d.ServiceType == typeof(DbContextOptions)
                    || d.ServiceType == typeof(SmsDbContext))
                .ToList();

            foreach (var d in descriptores)
            {
                services.Remove(d);
            }

            services.AddDbContext<SmsDbContext>(options => options.UseSqlServer(_connectionString));
        });
    }

    /// <summary>Un scope nuevo — el llamador es responsable de disponerlo.</summary>
    public IServiceScope CreateScope() => Services.CreateScope();

    /// <summary>
    /// Limpia las filas transaccionales (<c>BoletaValorCampo</c> + <c>Boleta</c>)
    /// entre tests y deja intacto el seed de configuración.
    /// </summary>
    public async Task ResetAsync()
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SmsDbContext>();
        await db.BoletaValores.ExecuteDeleteAsync();
        await db.Boletas.ExecuteDeleteAsync();
    }

    async Task IAsyncLifetime.InitializeAsync()
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SmsDbContext>();
        await db.Database.MigrateAsync();
        await ConfiguracionSeeder.SeedAsync(db, NullLogger.Instance);
    }

    async Task IAsyncLifetime.DisposeAsync()
    {
        using (var scope = Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<SmsDbContext>();
            await db.Database.EnsureDeletedAsync();
        }

        await base.DisposeAsync();
    }
}

[CollectionDefinition(Name)]
public sealed class ApiCollection : ICollectionFixture<ApiFactory>
{
    public const string Name = "api";
}
