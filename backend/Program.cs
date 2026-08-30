using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using SmsBackend.Data;
using SmsBackend.Domain.TiposMovimiento;

var builder = WebApplication.CreateBuilder(args);

// Enums como string en JSON (request y response) — coherente con cómo ya
// los persistimos en SQL Server (HasConversion<string>()). Sin esto, System.Text.Json
// espera/devuelve el número del enum por default, que nadie en el equipo
// va a poder leer sin abrir el código.
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

builder.Services.AddDbContext<SmsDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("SmsCentral")));

// /health hace un SELECT 1 real contra SmsCentral — así sirve para probar
// conectividad de verdad, no solo "el proceso está vivo".
builder.Services.AddHealthChecks().AddDbContextCheck<SmsDbContext>("database");

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
    await scope.ServiceProvider.GetRequiredService<SmsDbContext>().Database.MigrateAsync();
}

app.UseHttpsRedirection();

app.MapHealthChecks("/health");

app.MapTiposMovimiento();

app.Run();
