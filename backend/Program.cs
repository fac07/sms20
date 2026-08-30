using Microsoft.EntityFrameworkCore;
using SmsBackend.Data;
using SmsBackend.Domain.TiposMovimiento;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

builder.Services.AddDbContext<SmsDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("SmsCentral")));

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

app.MapGet("/health", () => Results.Ok(new { status = "ok" }))
    .WithName("Health");

app.MapTiposMovimiento();

app.Run();
