using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using SmsBackend.Data;
using SmsBackend.Domain.Maestros;

namespace SmsBackend.Domain.Basculas;

public static class BasculaEndpoints
{
    // Sin 0/O/1/I — se lee en voz alta o se tipea en un teclado de báscula
    // sin ambigüedad. 8 caracteres es corto de escribir y suficientemente
    // improbable de adivinar para un código de un solo uso con vencimiento.
    private const string AlfabetoCodigo = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static readonly TimeSpan VigenciaCodigo = TimeSpan.FromDays(7);

    public static RouteGroupBuilder MapBasculas(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/basculas").WithTags("Basculas");

        group.MapGet("/", async (SmsDbContext db, bool incluirInactivas = false) =>
        {
            var query = db.Basculas.AsNoTracking();
            if (!incluirInactivas)
            {
                query = query.Where(b => b.Activa);
            }

            // El OrderBy va antes de proyectar a BasculaDto — EF Core no
            // puede traducir un OrderBy aplicado sobre el resultado de un
            // Select que ya construyó el record.
            var basculas = await ProyectarConCentro(query.OrderBy(b => b.Codigo), db).ToListAsync();
            return Results.Ok(basculas);
        });

        group.MapGet("/{id:guid}", async (Guid id, SmsDbContext db) =>
        {
            var bascula = await ProyectarConCentro(db.Basculas.AsNoTracking().Where(b => b.Id == id), db)
                .FirstOrDefaultAsync();
            return bascula is null ? Results.NotFound() : Results.Ok(bascula);
        });

        group.MapPost("/", async (GuardarBasculaRequest request, SmsDbContext db) =>
        {
            var error = await ValidarRequest(request, db);
            if (error is not null) return error;

            var bascula = new Bascula
            {
                Id = Guid.NewGuid(),
                Codigo = request.Codigo,
                Nombre = request.Nombre,
                CentroId = request.CentroId,
                TipoConexion = request.TipoConexion,
                Puerto = request.Puerto,
                Ip = request.Ip,
                PuertoTcp = request.PuertoTcp,
                Velocidad = request.Velocidad,
                BitsDatos = request.BitsDatos,
                ModoComunicacion = request.ModoComunicacion,
                Activa = true,
                Aprovisionada = false,
            };

            db.Basculas.Add(bascula);
            await db.SaveChangesAsync();

            var dto = await ProyectarConCentro(db.Basculas.AsNoTracking().Where(b => b.Id == bascula.Id), db)
                .FirstAsync();
            return Results.Created($"/api/basculas/{bascula.Id}", dto);
        });

        group.MapPut("/{id:guid}", async (Guid id, GuardarBasculaRequest request, SmsDbContext db) =>
        {
            var bascula = await db.Basculas.FirstOrDefaultAsync(b => b.Id == id);
            if (bascula is null) return Results.NotFound();

            var error = await ValidarRequest(request, db, id);
            if (error is not null) return error;

            bascula.Codigo = request.Codigo;
            bascula.Nombre = request.Nombre;
            bascula.CentroId = request.CentroId;
            bascula.TipoConexion = request.TipoConexion;
            bascula.Puerto = request.Puerto;
            bascula.Ip = request.Ip;
            bascula.PuertoTcp = request.PuertoTcp;
            bascula.Velocidad = request.Velocidad;
            bascula.BitsDatos = request.BitsDatos;
            bascula.ModoComunicacion = request.ModoComunicacion;

            await db.SaveChangesAsync();

            var dto = await ProyectarConCentro(db.Basculas.AsNoTracking().Where(b => b.Id == id), db)
                .FirstAsync();
            return Results.Ok(dto);
        });

        // Soft-delete — mismo criterio que TipoMovimiento y Maestro.
        group.MapDelete("/{id:guid}", async (Guid id, SmsDbContext db) =>
        {
            var bascula = await db.Basculas.FirstOrDefaultAsync(b => b.Id == id);
            if (bascula is null) return Results.NotFound();

            bascula.Activa = false;
            await db.SaveChangesAsync();

            return Results.NoContent();
        });

        // Genera el código corto de un solo uso para el primer arranque de
        // Electron. Reemplaza cualquier código anterior sin usar.
        group.MapPost("/{id:guid}/generar-codigo", async (Guid id, SmsDbContext db) =>
        {
            var bascula = await db.Basculas.FirstOrDefaultAsync(b => b.Id == id);
            if (bascula is null) return Results.NotFound();
            if (bascula.Aprovisionada)
            {
                return Results.Conflict("Esta báscula ya fue aprovisionada — no hace falta un código nuevo.");
            }

            bascula.CodigoAprovisionamiento = GenerarCodigo();
            bascula.CodigoAprovisionamientoExpira = DateTime.UtcNow.Add(VigenciaCodigo);
            await db.SaveChangesAsync();

            return Results.Ok(new CodigoAprovisionamientoDto(
                bascula.CodigoAprovisionamiento, bascula.CodigoAprovisionamientoExpira.Value));
        });

        return group;
    }

    private static async Task<IResult?> ValidarRequest(
        GuardarBasculaRequest request, SmsDbContext db, Guid? idActual = null)
    {
        var codigoEnUso = await db.Basculas
            .AnyAsync(b => b.Codigo == request.Codigo && b.Id != idActual);
        if (codigoEnUso)
        {
            return Results.Conflict($"Ya existe una báscula con Codigo '{request.Codigo}'.");
        }

        var centro = await db.Maestros.AsNoTracking()
            .FirstOrDefaultAsync(m => m.Id == request.CentroId && m.Activo);
        if (centro is null)
        {
            return Results.BadRequest($"No existe el centro {request.CentroId}, o está inactivo.");
        }
        if (centro.TipoCatalogo != TipoCatalogo.Centro)
        {
            return Results.BadRequest($"El maestro {request.CentroId} no es de TipoCatalogo=Centro.");
        }

        return null;
    }

    private static IQueryable<BasculaDto> ProyectarConCentro(IQueryable<Bascula> basculas, SmsDbContext db) =>
        from b in basculas
        join m in db.Maestros.AsNoTracking() on b.CentroId equals m.Id into centros
        from centro in centros.DefaultIfEmpty()
        select new BasculaDto(
            b.Id, b.Codigo, b.Nombre, b.CentroId, centro != null ? centro.Nombre : null,
            b.TipoConexion, b.Puerto, b.Ip, b.PuertoTcp, b.Velocidad, b.BitsDatos, b.ModoComunicacion,
            b.Activa, b.Aprovisionada,
            b.CodigoAprovisionamiento != null && !b.Aprovisionada
                && b.CodigoAprovisionamientoExpira > DateTime.UtcNow);

    private static string GenerarCodigo()
    {
        Span<char> codigo = stackalloc char[8];
        for (var i = 0; i < codigo.Length; i++)
        {
            codigo[i] = AlfabetoCodigo[RandomNumberGenerator.GetInt32(AlfabetoCodigo.Length)];
        }
        return new string(codigo);
    }
}
