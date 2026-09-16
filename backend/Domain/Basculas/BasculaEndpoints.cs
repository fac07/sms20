using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using SmsBackend.Data;
using SmsBackend.Domain.Maestros;
using SmsBackend.Domain.Seguridad;

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
        })
            .RequireAuthorization(Politicas.Operador);

        group.MapGet("/{id:guid}", async (Guid id, SmsDbContext db) =>
        {
            // IgnoreQueryFilters + sin gate (corrección PR5): este GET es el
            // pull de config-sync.ts cada 60s — identidad de dispositivo sin
            // claims. Solo sacar el RequireAuthorization no alcanzaba: el
            // HasQueryFilter de Centro (PR3, Bascula es ICentroScoped) filtraba
            // la fila a cero y devolvía 404 al terminal igual que a un
            // anonimo. Mismo tratamiento completo que recibieron
            // ping/aprovisionar en PR3.
            var bascula = await ProyectarConCentro(
                db.Basculas.IgnoreQueryFilters().AsNoTracking().Where(b => b.Id == id), db)
                .FirstOrDefaultAsync();
            return bascula is null ? Results.NotFound() : Results.Ok(bascula);
        });
        // GET /{id} SIN gate (corrección PR5): config-sync.ts lo baja cada 60s
        // sin token (trío de ingreso manual + backfill de centro) — identidad
        // de dispositivo, mismo tratamiento que ping/aprovisionar.

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
        })
            .RequireAuthorization(Politicas.Administrador);

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
        })
            .RequireAuthorization(Politicas.Administrador);

        // Configuración central de ingreso manual de peso — la ajusta el
        // administrador por báscula, junto al toggle. Es config, no un pesaje,
        // así que un rango inválido devuelve 400 (no 422).
        group.MapPut("/{id:guid}/ingreso-manual", async (
            Guid id, ConfigurarIngresoManualRequest request, SmsDbContext db) =>
        {
            var bascula = await db.Basculas.FirstOrDefaultAsync(b => b.Id == id);
            if (bascula is null) return Results.NotFound();

            if (request.PesoMinimoManual is { } min && request.PesoMaximoManual is { } max && min > max)
            {
                return Results.BadRequest("PesoMinimoManual no puede ser mayor que PesoMaximoManual.");
            }

            bascula.PermiteIngresoManual = request.PermiteIngresoManual;
            bascula.PesoMinimoManual = request.PesoMinimoManual;
            bascula.PesoMaximoManual = request.PesoMaximoManual;
            await db.SaveChangesAsync();

            var dto = await ProyectarConCentro(db.Basculas.AsNoTracking().Where(b => b.Id == id), db)
                .FirstAsync();
            return Results.Ok(dto);
        })
            .RequireAuthorization(Politicas.Administrador);

        // Soft-delete — mismo criterio que TipoMovimiento y Maestro.
        group.MapDelete("/{id:guid}", async (Guid id, SmsDbContext db) =>
        {
            var bascula = await db.Basculas.FirstOrDefaultAsync(b => b.Id == id);
            if (bascula is null) return Results.NotFound();

            bascula.Activa = false;
            await db.SaveChangesAsync();

            return Results.NoContent();
        })
            .RequireAuthorization(Politicas.Administrador);

        // Genera el código corto de un solo uso para el primer arranque de
        // Electron. Reemplaza cualquier código anterior sin usar.
        // SIN gate por indicacion expresa del plan PR5 (queda anotado:
        // su caller real es el boton de BasculasPage, modo:'admin'). Hoy un
        // caller anonimo ya no la alcanza: 404 por el HasQueryFilter de Centro
        // de PR3, no por autorizacion.
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

        // Consume el código corto generado por /generar-codigo — lo llama la
        // báscula Electron en su primer arranque (frontend/electron/local-server.ts,
        // POST /aprovisionamiento) para resolver su identidad y configuración
        // completas contra Central.
        group.MapPost("/aprovisionar", async (AprovisionarBasculaRequest request, SmsDbContext db) =>
        {
            // IgnoreQueryFilters (design D6, PR3): identidad de terminal, sin
            // ClaimsPrincipal humano — el HasQueryFilter de Centro (2.4)
            // filtraría esta báscula a cero filas para cualquier caller sin
            // claims, devolviendo "código inválido" para un código
            // perfectamente válido y rompiendo el primer arranque de Electron.
            var bascula = await db.Basculas.IgnoreQueryFilters()
                .FirstOrDefaultAsync(b => b.CodigoAprovisionamiento == request.Codigo);
            if (bascula is null)
            {
                return Results.NotFound("Código de aprovisionamiento inválido.");
            }
            if (bascula.Aprovisionada)
            {
                return Results.Conflict("Esta báscula ya fue aprovisionada.");
            }
            if (bascula.CodigoAprovisionamientoExpira is null || bascula.CodigoAprovisionamientoExpira <= DateTime.UtcNow)
            {
                return Results.BadRequest("Este código venció, generá uno nuevo desde el panel.");
            }

            // Un solo uso — mismo espíritu que el comentario de generar-codigo:
            // el código deja de servir apenas se consume, no solo cuando vence.
            bascula.Aprovisionada = true;
            bascula.CodigoAprovisionamiento = null;
            bascula.CodigoAprovisionamientoExpira = null;
            await db.SaveChangesAsync();

            return Results.Ok(new AprovisionamientoDto(
                bascula.Id, bascula.Codigo, bascula.Nombre, bascula.CentroId, bascula.TipoConexion,
                bascula.Puerto, bascula.Ip, bascula.PuertoTcp, bascula.Velocidad, bascula.BitsDatos,
                bascula.ModoComunicacion,
                bascula.PermiteIngresoManual, bascula.PesoMinimoManual, bascula.PesoMaximoManual));
        });

        // Ping de conectividad — lo dispara la terminal Electron en cada ciclo
        // de config-sync (~60s). Endpoint DEDICADO a propósito: stampar desde
        // el GET /{id} haría que un admin que abre la ficha de la báscula
        // "la conecte" (falso positivo). Mismo posture que /aprovisionar:
        // identidad = conoce el id de la báscula, sin auth. Best-effort: si
        // Central no responde, el próximo tick lo reintenta. No exige
        // Activa=true — una báscula dada de baja que aún llama también deja
        // su marca (historial de conectividad, no permiso operativo).
        group.MapPost("/{id:guid}/ping", async (Guid id, SmsDbContext db) =>
        {
            // IgnoreQueryFilters (design D6, PR3): mismo motivo que
            // /aprovisionar — identidad de terminal, sin ClaimsPrincipal
            // humano. Sin esto, el ping de conectividad de CUALQUIER báscula
            // devolvería 404 en silencio para el caller anónimo real de este
            // endpoint, y Central perdería el historial de conectividad de
            // toda la planta.
            var bascula = await db.Basculas.IgnoreQueryFilters().FirstOrDefaultAsync(b => b.Id == id);
            if (bascula is null) return Results.NotFound();

            bascula.UltimaConexion = DateTime.UtcNow;
            await db.SaveChangesAsync();

            return Results.NoContent();
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
                && b.CodigoAprovisionamientoExpira > DateTime.UtcNow,
            b.PermiteIngresoManual, b.PesoMinimoManual, b.PesoMaximoManual,
            b.UltimaConexion);

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
