using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using SmsBackend.Data;
using SmsBackend.Data.Seeding;
using SmsBackend.Domain.Basculas;
using SmsBackend.Domain.Boletas;
using SmsBackend.Domain.Boletas.Valores;
using SmsBackend.Domain.Centros;
using SmsBackend.Domain.Configuracion;
using SmsBackend.Domain.Maestros;
using SmsBackend.Domain.PreIngresos;
using SmsBackend.Domain.Reportes;
using SmsBackend.Domain.Seguridad;
using SmsBackend.Domain.TiposMovimiento;
using SmsBackend.Domain.Transporte;

var builder = WebApplication.CreateBuilder(args);

// Enums como string en JSON (request y response) — coherente con cómo ya
// los persistimos en SQL Server (HasConversion<string>()). Sin esto, System.Text.Json
// espera/devuelve el número del enum por default, que nadie en el equipo
// va a poder leer sin abrir el código.
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// El renderer de Electron en dev carga desde el dev server de Angular
// (http://localhost:4200), un origen distinto al del backend — sin esto el
// browser bloquea el fetch por CORS aunque el backend responda bien.
// TODO: en producción el renderer carga por file:// (Origin nulo) — revisar
// esta política cuando se arme el build de escritorio real.
const string DevFrontendPolicy = "DevFrontend";
builder.Services.AddCors(options =>
    options.AddPolicy(DevFrontendPolicy, policy =>
        policy.WithOrigins("http://localhost:4200").AllowAnyHeader().AllowAnyMethod()));

builder.Services.AddDbContext<SmsDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("SmsCentral")));

// Motor de campos configurables: único resolver/validador del conjunto EAV,
// compartido por el crear tipado, el cierre y la rama de sync. Scoped porque
// depende del SmsDbContext (scoped). Nadie lo consume todavía — los endpoints
// llegan en un WU posterior.
builder.Services.AddScoped<MotorCampos>();

// Store en memoria de incidencias de sync reportadas por las básculas (evento
// MaestroProvisional trabado a 5+ intentos). Singleton y volátil por diseño
// (M-D3): sin tabla, TTL 1h, el terminal re-reporta cada ciclo.
builder.Services.AddSingleton<IncidenciasSyncStore>();

// /health hace un SELECT 1 real contra SmsCentral — así sirve para probar
// conectividad de verdad, no solo "el proceso está vivo".
builder.Services.AddHealthChecks().AddDbContextCheck<SmsDbContext>("database");

// Puerto de identidad (design "Technical Approach"): scoped porque depende
// del SmsDbContext (scoped). Ningún consumidor referencia MockProveedorIdentidad
// directamente — el swap a Entra ID cambia SOLO esta línea.
builder.Services.AddScoped<IProveedorIdentidad, MockProveedorIdentidad>();

// Registra el scheme mock que traduce "Authorization: Bearer <token>" en un
// ClaimsPrincipal (0.8). Sin UseAuthentication()/UseAuthorization() todavía
// en el pipeline — eso y el primer endpoint gateado llegan en PR2.
builder.Services
    .AddAuthentication(MockAuthenticationOptions.SchemeName)
    .AddScheme<MockAuthenticationOptions, MockAuthenticationHandler>(MockAuthenticationOptions.SchemeName, options => { });

// Tres políticas de rol jerárquico (design D4). Sin RequireAuthorization() en
// ningún endpoint todavía, y sin UseAuthentication()/UseAuthorization() en el
// pipeline HTTP — el primer endpoint gateado llega en PR2 (Phase 1).
builder.Services.AddAuthorizationBuilder()
    .AddPolicy(Politicas.Operador, p => p.RequireAssertion(ctx => Politicas.CumpleRolMinimo(ctx, Rol.Operador)))
    .AddPolicy(Politicas.Supervisor, p => p.RequireAssertion(ctx => Politicas.CumpleRolMinimo(ctx, Rol.Supervisor)))
    .AddPolicy(Politicas.Administrador, p => p.RequireAssertion(ctx => Politicas.CumpleRolMinimo(ctx, Rol.Administrador)));

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();

    // Solo en dev: aplica migraciones pendientes al arrancar contra el
    // contenedor Docker local, para no depender de correr `dotnet ef
    // database update` a mano cada vez. Contra el SQL Server central real
    // esto se saca — las migraciones ahí van por un paso de deploy explícito.
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<SmsDbContext>();
    await db.Database.MigrateAsync();

    // Siembra las 8 secciones estándar (design D4). Idempotente e inofensivo si
    // ya están: inserta si falta, nunca actualiza. Corre justo después de migrar
    // para que el esquema ya exista.
    var seederLogger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>()
        .CreateLogger("SmsBackend.Data.Seeding.ConfiguracionSeeder");
    await ConfiguracionSeeder.SeedAsync(db, seederLogger);

    // Usuarios mock fijos por rol (design "Mock data source"). Idempotente,
    // mismo patrón que ConfiguracionSeeder — sin esto, el login mock (PR2) no
    // tendría credenciales contra las que autenticar en dev.
    var seguridadSeederLogger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>()
        .CreateLogger("SmsBackend.Data.Seeding.SeguridadSeeder");
    await SeguridadSeeder.SeedAsync(db, seguridadSeederLogger);
}

app.UseHttpsRedirection();

if (app.Environment.IsDevelopment())
{
    app.UseCors(DevFrontendPolicy);
}

// Autenticación/autorización del pipeline HTTP (design "Technical Approach",
// PR2 Phase 1): traduce el bearer token en ClaimsPrincipal
// (MockAuthenticationHandler, 0.8) y evalúa las políticas que cada endpoint
// declare vía .RequireAuthorization(). Va después de CORS/routing (implícito
// en el hosting mínimo) y antes de mapear los endpoints — si corriera después
// de los Map*, los endpoints ya habrían ejecutado sin que el pipeline
// evaluara ninguna política.
app.UseAuthentication();
app.UseAuthorization();

app.MapHealthChecks("/health");

app.MapAuth();
app.MapTiposMovimiento();
app.MapMaestros();
app.MapBasculas();
app.MapCentros();
app.MapBoletas();
app.MapPreIngresos();
app.MapResumenBasculas();
app.MapVinculosPilotoTransportista();
app.MapAsignacionesUnidadTransportista();
app.MapSecciones();
app.MapCampos();
app.MapReporteDiario();

app.Run();

// Marcador para que WebApplicationFactory<Program> (SmsBackend.Tests) pueda
// referenciar el host de la app. Los top-level statements generan una clase
// Program interna; esta parte parcial la hace pública sin cambiar nada más.
public partial class Program { }
