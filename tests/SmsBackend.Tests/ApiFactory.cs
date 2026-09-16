using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using SmsBackend.Data;
using SmsBackend.Data.Seeding;
using SmsBackend.Domain.Seguridad;
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

    /// <summary>
    /// Token de "administrador" (alcance global, design D2) cacheado una sola
    /// vez en <see cref="IAsyncLifetime.InitializeAsync"/> y adjuntado por
    /// default a TODO cliente que <see cref="CreateClient()"/> arme (PR3,
    /// ver <see cref="ConfigureClient"/>). Necesario porque el
    /// <c>HasQueryFilter</c> de Centro (design D6) ahora falla cerrado para
    /// cualquier caller sin claims: sin esto, los ~250 tests que la suite ya
    /// tenía ANTES de este PR —escritos cuando la autenticación no
    /// existía— empezarían a ver listados vacíos de Bascula/PreIngreso/Boleta,
    /// no porque el fixture esté roto sino porque "anónimo" ahora es
    /// exactamente eso. Adjuntar Administrador por default reproduce el "ve
    /// todo" que la suite ya tenía. Cada test que necesita probar el límite
    /// real anónimo/rol (401, 403, o los 4 endpoints de dispositivo/sync)
    /// limpia este header a mano (<c>Authorization = null</c>) antes de esa
    /// llamada puntual — exactamente lo que <c>AuthEndpointsTests</c> y
    /// <c>ConfiguracionCentroAuthTests</c> ya hacían para sus propios casos
    /// anónimos.
    /// </summary>
    private string? _tokenAdministrador;

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

    /// <summary>Adjunta el token de Administrador cacheado (ver comentario del campo) a todo cliente nuevo.</summary>
    protected override void ConfigureClient(HttpClient client)
    {
        base.ConfigureClient(client);
        if (_tokenAdministrador is not null)
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", _tokenAdministrador);
        }
    }

    /// <summary>Un scope nuevo — el llamador es responsable de disponerlo.</summary>
    public IServiceScope CreateScope() => Services.CreateScope();

    /// <summary>
    /// Limpia las filas transaccionales (<c>AsignacionUnidadTransportista</c> +
    /// <c>VinculoPilotoTransportista</c> + <c>PreIngreso</c> +
    /// <c>BoletaValorCampo</c> + <c>Boleta</c>) entre tests y deja intacto el
    /// seed de configuración. <c>PreIngreso</c> va antes que <c>Boleta</c>: su
    /// FK real hacia <c>Boleta</c> es <c>Restrict</c>.
    /// <c>AsignacionUnidadTransportista</c> y <c>VinculoPilotoTransportista</c>
    /// no tienen FK real hacia nada (design D1/D4 — referencias lógicas a
    /// Maestro), así que su posición en el orden no importa; van primero por
    /// prolijidad.
    /// </summary>
    public async Task ResetAsync()
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SmsDbContext>();
        await db.AsignacionesUnidadTransportista.ExecuteDeleteAsync();
        await db.VinculosPilotoTransportista.ExecuteDeleteAsync();
        // IgnoreQueryFilters (PR3): este scope no cuelga de un HttpContext/
        // ClaimsPrincipal, así que ICentroContext resuelve "sin claims" acá —
        // sin esto, el HasQueryFilter de Centro (design D6) haría que estos
        // ExecuteDeleteAsync borren CERO filas en vez de todas, y la limpieza
        // entre tests dejaría de funcionar en silencio.
        await db.PreIngresos.IgnoreQueryFilters().ExecuteDeleteAsync();
        await db.BoletaValores.ExecuteDeleteAsync();
        await db.Boletas.IgnoreQueryFilters().ExecuteDeleteAsync();
    }

    async Task IAsyncLifetime.InitializeAsync()
    {
        using (var scope = Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<SmsDbContext>();
            await db.Database.MigrateAsync();
            await ConfiguracionSeeder.SeedAsync(db, NullLogger.Instance);
            await SeguridadSeeder.SeedAsync(db, NullLogger.Instance);
        }

        // Cachea el token de Administrador (ver comentario del campo) ANTES
        // de que cualquier test class llame a CreateClient() — el fixture de
        // colección corre este InitializeAsync una sola vez, antes del
        // primer test. El cliente de bootstrap en sí mismo no lleva el
        // header todavía (_tokenAdministrador es null en ese momento), lo
        // cual es correcto: login es anónimo por naturaleza.
        using var bootstrap = CreateClient();
        var login = await bootstrap.PostAsJsonAsync(
            "/api/auth/login", new { nombreUsuario = "administrador", clave = "Administrador123!" }, TestData.Json);
        login.EnsureSuccessStatusCode();
        var resultado = await login.Content.ReadFromJsonAsync<ResultadoLogin>(TestData.Json);
        _tokenAdministrador = resultado!.Token;
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
