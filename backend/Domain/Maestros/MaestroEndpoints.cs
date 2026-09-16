using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using SmsBackend.Data;
using SmsBackend.Domain.Seguridad;

namespace SmsBackend.Domain.Maestros;

public static class MaestroEndpoints
{
    public static RouteGroupBuilder MapMaestros(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/maestros").WithTags("Maestros");

        group.MapGet("/", async (
            SmsDbContext db,
            TipoCatalogo? tipoCatalogo = null,
            EstadoMaestro? estado = null,
            bool incluirInactivos = false,
            DateTime? modificadoDesde = null,
            string? codigoPrefijo = null,
            string? rol = null) =>
        {
            // D7: DatosAdicionales no es queryable por EF (nvarchar(max) sin
            // índice), así que ?rol= solo tiene sentido junto a Tercero — de lo
            // contrario estaría escaneando y parseando JSON de todo catálogo.
            if (rol is not null && tipoCatalogo != TipoCatalogo.Tercero)
            {
                return Results.BadRequest("El filtro '?rol=' solo aplica junto con '?tipoCatalogo=Tercero'.");
            }

            var query = db.Maestros.AsNoTracking();

            if (tipoCatalogo is not null)
            {
                query = query.Where(m => m.TipoCatalogo == tipoCatalogo);
            }
            if (estado is not null)
            {
                query = query.Where(m => m.Estado == estado);
            }
            if (!string.IsNullOrEmpty(codigoPrefijo))
            {
                // D5: StartsWith se traduce a LIKE parametrizado por EF Core
                // (nunca interpolación de string), y es SARGable contra el
                // índice único (TipoCatalogo, Codigo) — filtra Lote por Finca
                // gratis.
                query = query.Where(m => m.Codigo.StartsWith(codigoPrefijo));
            }

            if (modificadoDesde is not null)
            {
                // Delta-sync (ver frontend/electron/maestros-sync.ts): el watermark
                // ya es el último valor visto, así que el filtro es estrictamente
                // mayor — no re-descargamos la fila que marcó el watermark.
                //
                // Acá SIEMPRE se incluyen inactivos, sin importar incluirInactivos:
                // una fila que se desactivó (Activo=false) después del watermark
                // tiene que llegar igual al caché local, o el combo offline la
                // seguiría mostrando para siempre. Una llamada de listado normal
                // (admin) no tiene ese problema — ahí sí importa el filtro.
                query = query.Where(m => m.FechaModificacion > modificadoDesde);
            }
            else if (!incluirInactivos)
            {
                query = query.Where(m => m.Activo);
            }

            var maestros = await query
                .OrderBy(m => m.TipoCatalogo)
                .ThenBy(m => m.Nombre)
                .Select(m => MaestroDto.FromEntity(m))
                .ToListAsync();

            if (rol is not null)
            {
                // Materializado en memoria: DatosAdicionales.roles es un array
                // JSON dentro de una columna sin tipar (D1/D7), no hay forma de
                // filtrarlo en SQL sin una columna calculada nueva.
                maestros = maestros.Where(m => TieneRol(m.DatosAdicionales, rol)).ToList();
            }

            return Results.Ok(maestros);
        })
            .RequireAuthorization(Politicas.Operador);

        group.MapGet("/{id:guid}", async (Guid id, SmsDbContext db) =>
        {
            var maestro = await db.Maestros.AsNoTracking().FirstOrDefaultAsync(m => m.Id == id);
            return maestro is null ? Results.NotFound() : Results.Ok(MaestroDto.FromEntity(maestro));
        })
            .RequireAuthorization(Politicas.Operador);

        // El admin crea directo como Oficial — el flujo de Provisional nace
        // en la báscula offline (todavía no implementado), no acá.
        group.MapPost("/", async (GuardarMaestroRequest request, SmsDbContext db) =>
        {
            var errorLongitud = ValidarLongitudCodigoLote(request.TipoCatalogo, request.Codigo);
            if (errorLongitud is not null)
            {
                return errorLongitud;
            }

            var codigoEnUso = await db.Maestros
                .AnyAsync(m => m.TipoCatalogo == request.TipoCatalogo && m.Codigo == request.Codigo);
            if (codigoEnUso)
            {
                return Results.Conflict(
                    $"Ya existe un {request.TipoCatalogo} con Codigo '{request.Codigo}'.");
            }

            var maestro = new Maestro
            {
                Id = Guid.NewGuid(),
                TipoCatalogo = request.TipoCatalogo,
                Codigo = request.Codigo,
                Nombre = request.Nombre,
                DatosAdicionales = request.DatosAdicionales,
                Estado = EstadoMaestro.Oficial,
                FechaModificacion = DateTime.UtcNow,
                Activo = true,
            };

            db.Maestros.Add(maestro);
            await db.SaveChangesAsync();

            return Results.Created($"/api/maestros/{maestro.Id}", MaestroDto.FromEntity(maestro));
        })
            .RequireAuthorization(Politicas.Administrador);

        // Ingesta del Outbox local (Electron/SQLite) — el dispatcher reenvía acá
        // el evento MaestroProvisional/Crear coinado offline en una báscula.
        // Igual que /api/boletas/sync:
        //   1. Sin enforcement de flujo — la decisión ya se tomó localmente.
        //   2. Idempotente por el Guid generado por el cliente: reenviar el
        //      mismo evento (respuesta perdida) es un no-op exitoso.
        // Estado y Activo se fuerzan server-side: una báscula nunca puede
        // acuñar un Oficial ni reactivar un provisional ya fusionado.
        group.MapPost("/sync", async (SincronizarMaestroRequest request, SmsDbContext db, CancellationToken ct) =>
        {
            if (request.Operacion != "Crear")
            {
                return Results.BadRequest($"Operación de sync de maestro desconocida: '{request.Operacion}'.");
            }

            var payload = request.Payload;

            // IgnoreQueryFilters (design D6, PR3): identidad de terminal, sin
            // ClaimsPrincipal humano — igual que ping/aprovisionar/boletas-sync.
            // Defensivo hoy: Maestro es un catálogo global sin CentroId propio
            // (no implementa ICentroScoped, design D6 "Global catalogs"), así
            // que ningún HasQueryFilter lo afecta todavía — pero el design
            // agrupa los 4 endpoints de dispositivo/sync explícitamente, y
            // esto evita una fuga silenciosa si Maestro alguna vez pasara a
            // ser Centro-scoped.
            var existente = await db.Maestros.IgnoreQueryFilters().FirstOrDefaultAsync(m => m.Id == payload.Id, ct);
            if (existente is not null)
            {
                // Ya fusionado: resolver hasta el oficial vigente y devolverlo,
                // sin tocar el provisional (nunca se reactiva).
                if (existente.FusionadoConId is not null)
                {
                    var oficialId = await ResolucionFusion.ResolverMaestroFusionadoAsync(db, existente.Id, ct);
                    var oficial = await db.Maestros.AsNoTracking().FirstAsync(m => m.Id == oficialId, ct);
                    return Results.Ok(MaestroDto.FromEntity(oficial));
                }

                // Reintento del mismo evento — no-op, se devuelve tal cual está.
                return Results.Ok(MaestroDto.FromEntity(existente));
            }

            // Colisión (TipoCatalogo, Codigo) con OTRA fila (distinto Guid): el
            // índice único tiraría un 500 crudo en SaveChanges — se ataja con un
            // 409 claro. La resolución del choque (código central, reintento) es
            // una decisión de operación, no de este endpoint.
            var codigoEnUso = await db.Maestros
                .AnyAsync(m => m.TipoCatalogo == payload.TipoCatalogo && m.Codigo == payload.Codigo, ct);
            if (codigoEnUso)
            {
                return Results.Conflict(
                    $"Ya existe un {payload.TipoCatalogo} con Codigo '{payload.Codigo}'.");
            }

            var maestro = new Maestro
            {
                Id = payload.Id,
                TipoCatalogo = payload.TipoCatalogo,
                Codigo = payload.Codigo,
                Nombre = payload.Nombre,
                DatosAdicionales = payload.DatosAdicionales,
                Estado = EstadoMaestro.Provisional,
                FechaModificacion = DateTime.UtcNow,
                Activo = true,
            };

            db.Maestros.Add(maestro);
            await db.SaveChangesAsync(ct);

            return Results.Ok(MaestroDto.FromEntity(maestro));
        });

        group.MapPut("/{id:guid}", async (Guid id, GuardarMaestroRequest request, SmsDbContext db) =>
        {
            var errorLongitud = ValidarLongitudCodigoLote(request.TipoCatalogo, request.Codigo);
            if (errorLongitud is not null)
            {
                return errorLongitud;
            }

            var maestro = await db.Maestros.FirstOrDefaultAsync(m => m.Id == id);
            if (maestro is null)
            {
                return Results.NotFound();
            }

            var codigoEnUso = await db.Maestros.AnyAsync(m =>
                m.TipoCatalogo == request.TipoCatalogo && m.Codigo == request.Codigo && m.Id != id);
            if (codigoEnUso)
            {
                return Results.Conflict(
                    $"Ya existe otro {request.TipoCatalogo} con Codigo '{request.Codigo}'.");
            }

            maestro.TipoCatalogo = request.TipoCatalogo;
            maestro.Codigo = request.Codigo;
            maestro.Nombre = request.Nombre;
            maestro.DatosAdicionales = request.DatosAdicionales;
            maestro.FechaModificacion = DateTime.UtcNow;

            await db.SaveChangesAsync();

            return Results.Ok(MaestroDto.FromEntity(maestro));
        })
            .RequireAuthorization(Politicas.Administrador);

        // Soft-delete — mismo criterio que TipoMovimiento: nunca se borra, se desactiva.
        group.MapDelete("/{id:guid}", async (Guid id, SmsDbContext db) =>
        {
            var maestro = await db.Maestros.FirstOrDefaultAsync(m => m.Id == id);
            if (maestro is null)
            {
                return Results.NotFound();
            }

            maestro.Activo = false;
            maestro.FechaModificacion = DateTime.UtcNow;
            await db.SaveChangesAsync();

            return Results.NoContent();
        })
            .RequireAuthorization(Politicas.Administrador);

        // Sugerencia de código oficial para aprobar un provisional del tipo dado.
        // Regex-extrae el run de dígitos final de los códigos Oficial activos,
        // devuelve max+1 zero-padded al ancho más grande observado. Es solo
        // orientativo (M-D4): no se persiste nada, la unicidad la garantiza el
        // índice único (TipoCatalogo, Codigo) más el 409 de /aprobar.
        group.MapGet("/siguiente-codigo", async (TipoCatalogo tipoCatalogo, SmsDbContext db, string? codigoPrefijo = null) =>
        {
            // G2: Codigo de Lote es compuesto ({FincaCodigo}-{LoteCodigo}, D5).
            // Sugerir sobre TODOS los códigos del tipo mezclaría el run de
            // dígitos de fincas distintas — sin el prefijo de Finca no hay
            // sugerencia posible.
            if (tipoCatalogo == TipoCatalogo.Lote && string.IsNullOrWhiteSpace(codigoPrefijo))
            {
                return Results.BadRequest(
                    "El tipo 'Lote' requiere '?codigoPrefijo=' (código de Finca) para sugerir el siguiente código.");
            }

            var query = db.Maestros
                .AsNoTracking()
                .Where(m => m.TipoCatalogo == tipoCatalogo
                    && m.Estado == EstadoMaestro.Oficial
                    && m.Activo);

            if (!string.IsNullOrWhiteSpace(codigoPrefijo))
            {
                query = query.Where(m => m.Codigo.StartsWith(codigoPrefijo));
            }

            var codigos = await query.Select(m => m.Codigo).ToListAsync();

            var sugerido = SugerirSiguienteCodigo(codigos);
            return Results.Ok(new SiguienteCodigoResponse(sugerido));
        })
            .RequireAuthorization(Politicas.Operador);

        // Aprobar: un provisional pasa a Oficial sin fusionarse con nada. El
        // cuerpo es obligatorio — el admin confirma el código oficial (y puede
        // corregir el nombre). El PROV-… coinado offline se reemplaza acá por el
        // código real. Se distribuye a las básculas en el próximo sync.
        group.MapPost("/{id:guid}/aprobar", async (Guid id, AprobarMaestroRequest request, SmsDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(request.Codigo))
            {
                return Results.BadRequest("El código es obligatorio para aprobar un provisional.");
            }

            var maestro = await db.Maestros.FirstOrDefaultAsync(m => m.Id == id);
            if (maestro is null)
            {
                return Results.NotFound();
            }
            if (maestro.Estado != EstadoMaestro.Provisional)
            {
                return Results.Conflict("Solo se pueden aprobar ítems en estado Provisional.");
            }

            var codigo = request.Codigo.Trim();

            // Colisión con otra fila del mismo tipo (activa o no): el índice único
            // (TipoCatalogo, Codigo) tiraría un 500 crudo en SaveChanges — 409 claro.
            var codigoEnUso = await db.Maestros
                .AnyAsync(m => m.TipoCatalogo == maestro.TipoCatalogo && m.Codigo == codigo && m.Id != id);
            if (codigoEnUso)
            {
                return Results.Conflict(
                    $"Ya existe un {maestro.TipoCatalogo} con Codigo '{codigo}'.");
            }

            maestro.Codigo = codigo;
            if (!string.IsNullOrWhiteSpace(request.Nombre))
            {
                maestro.Nombre = request.Nombre.Trim();
            }
            maestro.Estado = EstadoMaestro.Oficial;
            maestro.Activo = true;
            maestro.FechaModificacion = DateTime.UtcNow;
            await db.SaveChangesAsync();

            return Results.Ok(MaestroDto.FromEntity(maestro));
        })
            .RequireAuthorization(Politicas.Administrador);

        // Fusionar: el provisional se descarta (Activo=false) y queda apuntando
        // al oficial vía FusionadoConId. En la MISMA transacción se reescribe
        // toda referencia central que apuntaba al provisional para que apunte al
        // oficial (decisión de producto 7 / spec "Merge rewrites every central
        // reference in one transaction").
        group.MapPost("/{id:guid}/fusionar/{oficialId:guid}", async (Guid id, Guid oficialId, SmsDbContext db, CancellationToken ct) =>
        {
            if (id == oficialId)
            {
                return Results.BadRequest("Un ítem no se puede fusionar consigo mismo.");
            }

            var provisional = await db.Maestros.FirstOrDefaultAsync(m => m.Id == id, ct);
            if (provisional is null)
            {
                return Results.NotFound($"No existe el provisional {id}.");
            }
            if (provisional.Estado != EstadoMaestro.Provisional)
            {
                return Results.Conflict("Solo se pueden fusionar ítems en estado Provisional.");
            }

            var oficial = await db.Maestros.FirstOrDefaultAsync(m => m.Id == oficialId, ct);
            if (oficial is null)
            {
                return Results.NotFound($"No existe el ítem oficial {oficialId}.");
            }
            if (oficial.TipoCatalogo != provisional.TipoCatalogo)
            {
                return Results.Conflict("El provisional y el oficial deben ser del mismo TipoCatalogo.");
            }

            // Decisión de producto 6 / spec "Merge target must be an active
            // Oficial": el destino tiene que ser un Oficial activo. Con este
            // guard no se pueden crear cadenas nuevas de FusionadoConId, así que
            // la resolución de lectura (Proyectar) queda en un solo salto (M-D6).
            if (oficial.Estado != EstadoMaestro.Oficial || !oficial.Activo)
            {
                return Results.Conflict("El destino de la fusión debe ser un maestro Oficial activo.");
            }

            // Rewrite retroactivo: cada BoletaValorCampo que apunta al provisional
            // pasa a apuntar al oficial. EF envuelve un único SaveChangesAsync en
            // una transacción, así que el rewrite y el flag-flip comitean o se
            // revierten juntos. La FK BoletaValorCampo.ValorMaestroId → Maestro.Id
            // (Restrict) queda satisfecha porque el oficial ya existe.
            var referencias = await db.BoletaValores
                .Where(v => v.ValorMaestroId == provisional.Id)
                .ToListAsync(ct);
            foreach (var referencia in referencias)
            {
                referencia.ValorMaestroId = oficial.Id;
            }

            provisional.FusionadoConId = oficial.Id;
            provisional.Activo = false;
            provisional.FechaModificacion = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);

            return Results.Ok(MaestroDto.FromEntity(provisional));
        })
            .RequireAuthorization(Politicas.Administrador);

        // Incidencias de sync (M-D3): el dispatcher del Outbox de una báscula
        // reporta acá un evento MaestroProvisional trabado a 5+ intentos. Store
        // en memoria, TTL 1h, sin tabla — volátil a propósito (el terminal
        // re-reporta cada ciclo). Idempotente por (basculaCodigo, entidadId).
        // POST de incidencias SIN gate: lo dispara el outbox-dispatcher de la
        // terminal (identidad de dispositivo, sin token) — mismo espíritu de
        // bypass que PR3 resolvió para ping/aprovisionar/boletas-sync/maestros-sync.
        group.MapPost("/incidencias-sync", (ReportarIncidenciaSyncRequest request, IncidenciasSyncStore store) =>
        {
            if (string.IsNullOrWhiteSpace(request.BasculaCodigo) || request.EntidadId == Guid.Empty)
            {
                return Results.BadRequest("basculaCodigo y entidadId son obligatorios.");
            }

            store.Reportar(request);
            return Results.NoContent();
        });

        // Lista de incidencias de sync vigentes — la consume el panel del admin
        // (M5b). `ultimoError` va verbatim (decisión de producto 9).
        group.MapGet("/incidencias-sync", (IncidenciasSyncStore store) => Results.Ok(store.Listar()))
            .RequireAuthorization(Politicas.Operador);

        return group;
    }

    /// <summary>
    /// G7: <c>Maestro.Codigo</c> tiene <c>HasMaxLength(30)</c> (MaestroConfiguration.cs:20).
    /// El código de <see cref="TipoCatalogo.Lote"/> es compuesto
    /// (<c>{FincaCodigo}-{LoteCodigo}</c>, diseño D5) y, sin datos de anchos legados
    /// confirmados, se rechaza explícito en vez de truncar en silencio o reventar
    /// contra el índice/columna de SQL Server.
    /// </summary>
    internal static IResult? ValidarLongitudCodigoLote(TipoCatalogo tipoCatalogo, string codigo) =>
        tipoCatalogo == TipoCatalogo.Lote && codigo.Length > 30
            ? Results.BadRequest("El código combinado de finca y lote excede el límite de 30 caracteres.")
            : null;

    /// <summary>
    /// D7: <c>DatosAdicionales</c> de un Tercero convención
    /// <c>{"roles":["Cliente"|"Proveedor"]}</c> — un Tercero puede tener ambos
    /// roles a la vez. Parseo defensivo: JSON ausente/inválido o sin
    /// <c>roles</c> como array simplemente no matchea ningún rol.
    /// </summary>
    internal static bool TieneRol(string? datosAdicionales, string rol)
    {
        if (string.IsNullOrWhiteSpace(datosAdicionales))
        {
            return false;
        }

        try
        {
            using var documento = JsonDocument.Parse(datosAdicionales);
            if (!documento.RootElement.TryGetProperty("roles", out var roles) || roles.ValueKind != JsonValueKind.Array)
            {
                return false;
            }

            foreach (var item in roles.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.String
                    && string.Equals(item.GetString(), rol, StringComparison.Ordinal))
                {
                    return true;
                }
            }

            return false;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static readonly Regex RunDeDigitosFinal = new(@"(\d+)$", RegexOptions.Compiled);

    /// <summary>
    /// Sugiere el siguiente código a partir del run de dígitos final de los
    /// <paramref name="codigos"/> existentes: <c>max+1</c> zero-padded al ancho
    /// más grande observado. Si ningún código termina en dígitos, devuelve el
    /// fallback <c>"0001"</c>.
    /// </summary>
    internal static string SugerirSiguienteCodigo(IEnumerable<string> codigos)
    {
        long maximo = -1;
        var ancho = 0;

        foreach (var codigo in codigos)
        {
            if (string.IsNullOrEmpty(codigo))
            {
                continue;
            }

            var match = RunDeDigitosFinal.Match(codigo);
            if (!match.Success)
            {
                continue;
            }

            var run = match.Groups[1].Value;
            ancho = Math.Max(ancho, run.Length);
            if (long.TryParse(run, out var valor) && valor > maximo)
            {
                maximo = valor;
            }
        }

        if (maximo < 0)
        {
            return "0001";
        }

        var siguiente = (maximo + 1).ToString();
        return siguiente.Length >= ancho ? siguiente : siguiente.PadLeft(ancho, '0');
    }
}
