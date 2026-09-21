using System.Security.Claims;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using SmsBackend.Data;
using SmsBackend.Domain.Boletas.Marchamos;
using SmsBackend.Domain.Boletas.Valores;
using SmsBackend.Domain.Configuracion;
using SmsBackend.Domain.Maestros;
using SmsBackend.Domain.Seguridad;

namespace SmsBackend.Domain.Boletas;

public static class BoletaMarchamosEndpoints
{
    private const string ClaveSeccion = "marchamos";

    public static RouteGroupBuilder MapBoletaMarchamos(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/boletas/{id:guid}/marchamos")
            .RequireAuthorization(Politicas.Supervisor);

        group.MapGet("/", async (Guid id, SmsDbContext db, CancellationToken ct) =>
        {
            var boleta = await db.Boletas.AsNoTracking().FirstOrDefaultAsync(b => b.Id == id, ct);
            return boleta is null
                ? Results.NotFound()
                : Results.Ok(await ProyectarAsync(db, boleta, ct));
        });

        group.MapPost("/", async (
            Guid id,
            AgregarBoletaMarchamoRequest request,
            HttpContext http,
            SmsDbContext db,
            CancellationToken ct) =>
        {
            var boleta = await db.Boletas.FirstOrDefaultAsync(b => b.Id == id, ct);
            var guard = ValidarEdicion(boleta, request.ObservacionCambio, request.RowVersion, out var rowVersion);
            if (guard is not null) return guard;

            var campos = await ResolverCamposAsync(db, boleta!, ct);
            if (campos is null)
            {
                return Results.BadRequest("La sección marchamos no aplica a esta boleta.");
            }

            var numero = Normalizar(request.Numero);
            var placa = NormalizarOpcional(request.Placa);
            var observaciones = NormalizarOpcional(request.Observaciones);
            var error = await ValidarDatosAsync(
                db, campos, numero, placa, request.EquipoId, observaciones, ct);
            if (error is not null) return Results.BadRequest(error);

            var existentes = await LeerMarchamosAsync(db, id, ct);
            if (request.Activo && ExisteDuplicado(existentes, numero, null))
            {
                return Results.Conflict("Ya existe un marchamo activo con ese número en la boleta.");
            }

            var ocurrencia = existentes.Count == 0 ? 0 : existentes.Max(m => m.Ocurrencia) + 1;
            AgregarValor(db, id, campos["numero"], ocurrencia, texto: numero);
            if (placa is not null) AgregarValor(db, id, campos["placa"], ocurrencia, texto: placa);
            if (request.EquipoId is Guid equipoId)
                AgregarValor(db, id, campos["equipo"], ocurrencia, maestroId: equipoId);
            AgregarValor(db, id, campos["activo"], ocurrencia, booleano: request.Activo);
            if (observaciones is not null)
                AgregarValor(db, id, campos["observaciones"], ocurrencia, texto: observaciones);

            var nuevo = new BoletaMarchamoDto(
                ocurrencia, numero, placa, request.EquipoId, request.Activo, observaciones);
            db.BoletaMarchamoCambios.Add(Cambio(
                id, nuevo, null, AccionMarchamo.Agregar, request.ObservacionCambio, Usuario(http)));

            return await GuardarAsync(db, boleta!, rowVersion!, ct);
        });

        group.MapPut("/{ocurrencia:int}", async (
            Guid id,
            int ocurrencia,
            RectificarBoletaMarchamoRequest request,
            HttpContext http,
            SmsDbContext db,
            CancellationToken ct) =>
        {
            var boleta = await db.Boletas.FirstOrDefaultAsync(b => b.Id == id, ct);
            var guard = ValidarEdicion(boleta, request.ObservacionCambio, request.RowVersion, out var rowVersion);
            if (guard is not null) return guard;

            var existentes = await LeerMarchamosAsync(db, id, ct);
            var anterior = existentes.SingleOrDefault(m => m.Ocurrencia == ocurrencia);
            if (anterior is null) return Results.NotFound("No existe esa ocurrencia de marchamo.");

            var filas = await FilasOcurrenciaAsync(db, id, ocurrencia, ct);
            var campos = filas.ToDictionary(x => x.Campo.Clave, x => x.Campo);
            var historicos = await ResolverCamposAsync(db, boleta!, ct);
            if (historicos is null) return Results.BadRequest("La sección marchamos no aplica a esta boleta.");
            foreach (var par in historicos) campos.TryAdd(par.Key, par.Value);

            var numero = Normalizar(request.Numero);
            var observaciones = NormalizarOpcional(request.Observaciones);
            var error = ValidarTexto(campos["numero"], numero)
                ?? ValidarTexto(campos["observaciones"], observaciones);
            if (error is not null) return Results.BadRequest(error);
            if (request.Activo && ExisteDuplicado(existentes, numero, ocurrencia))
                return Results.Conflict("Ya existe un marchamo activo con ese número en la boleta.");

            FijarTexto(db, filas, id, campos["numero"], ocurrencia, numero);
            FijarBooleano(db, filas, id, campos["activo"], ocurrencia, request.Activo);
            FijarTexto(db, filas, id, campos["observaciones"], ocurrencia, observaciones);

            var nuevo = anterior with
            {
                Numero = numero,
                Activo = request.Activo,
                Observaciones = observaciones,
            };
            var accion = anterior.Activo != nuevo.Activo
                ? nuevo.Activo ? AccionMarchamo.Reactivar : AccionMarchamo.Desactivar
                : AccionMarchamo.Rectificar;
            db.BoletaMarchamoCambios.Add(Cambio(
                id, nuevo, anterior, accion, request.ObservacionCambio, Usuario(http)));

            return await GuardarAsync(db, boleta!, rowVersion!, ct);
        });

        return group;
    }

    private static IResult? ValidarEdicion(
        Boleta? boleta, string observacion, string token, out byte[]? rowVersion)
    {
        rowVersion = null;
        if (boleta is null) return Results.NotFound();
        if (boleta.Estado != EstadoBoleta.Cerrada)
            return Results.Conflict($"Solo se pueden editar marchamos de una boleta Cerrada — estado actual: {boleta.Estado}.");
        if (string.IsNullOrWhiteSpace(observacion))
            return Results.BadRequest("La observación del cambio es obligatoria.");
        if (observacion.Trim().Length > 500)
            return Results.BadRequest("La observación del cambio no puede exceder 500 caracteres.");
        try
        {
            rowVersion = Convert.FromBase64String(token);
        }
        catch (FormatException)
        {
            return Results.BadRequest("RowVersion no es válido.");
        }

        return rowVersion.Length == 0 ? Results.BadRequest("RowVersion es obligatorio.") : null;
    }

    private static async Task<Dictionary<string, Campo>?> ResolverCamposAsync(
        SmsDbContext db, Boleta boleta, CancellationToken ct)
    {
        var seccion = await db.Secciones.AsNoTracking().SingleAsync(s => s.Clave == ClaveSeccion, ct);
        var aplica = await db.TipoMovimientoSecciones.AsNoTracking().AnyAsync(x =>
            x.TipoMovimientoId == boleta.TipoMovimientoId
            && x.SeccionId == seccion.Id
            && x.VigenteDesde <= boleta.FechaHoraIngreso
            && (x.VigenteHasta == null || x.VigenteHasta > boleta.FechaHoraIngreso), ct);
        if (!aplica) return null;

        var campos = await db.Campos.AsNoTracking().Where(c =>
                c.SeccionId == seccion.Id
                && c.VigenteDesde <= boleta.FechaHoraIngreso
                && (c.VigenteHasta == null || c.VigenteHasta > boleta.FechaHoraIngreso))
            .ToDictionaryAsync(c => c.Clave, ct);
        return SeccionEstandar.ClavesReservadas[ClaveSeccion].All(campos.ContainsKey) ? campos : null;
    }

    private static async Task<string?> ValidarDatosAsync(
        SmsDbContext db,
        IReadOnlyDictionary<string, Campo> campos,
        string numero,
        string? placa,
        Guid? equipoId,
        string? observaciones,
        CancellationToken ct)
    {
        var error = ValidarTexto(campos["numero"], numero)
            ?? ValidarTexto(campos["placa"], placa)
            ?? ValidarTexto(campos["observaciones"], observaciones);
        if (error is not null) return error;
        if (equipoId is null) return null;

        var equipo = await db.Maestros.AsNoTracking().FirstOrDefaultAsync(m => m.Id == equipoId, ct);
        return equipo is null || !equipo.Activo || equipo.TipoCatalogo != TipoCatalogo.Equipo
            ? "Equipo debe referenciar un maestro Equipo activo."
            : null;
    }

    private static string? ValidarTexto(Campo campo, string? valor)
    {
        if (campo.Requerido && string.IsNullOrWhiteSpace(valor))
            return $"{campo.Etiqueta} es obligatorio.";
        if (valor is null) return null;
        if (valor.Length > 500) return $"{campo.Etiqueta} no puede exceder 500 caracteres.";
        if (!ConfiguracionCampo.TryParse(campo.Configuracion, out var config))
            return $"La configuración de {campo.Etiqueta} no es válida.";
        if (config?.MaxLength is int max && valor.Length > max)
            return $"{campo.Etiqueta} no puede exceder {max} caracteres.";
        if (config?.Regex is { Length: > 0 } patron)
        {
            try
            {
                if (!Regex.IsMatch(valor, patron)) return $"{campo.Etiqueta} no cumple el patrón configurado.";
            }
            catch (ArgumentException)
            {
                return $"El patrón configurado para {campo.Etiqueta} no es válido.";
            }
        }
        return null;
    }

    private static async Task<IResult> GuardarAsync(
        SmsDbContext db, Boleta boleta, byte[] rowVersion, CancellationToken ct)
    {
        db.Entry(boleta).Property(b => b.RowVersion).OriginalValue = rowVersion;
        // Los valores EAV son dependientes: sin este UPDATE del padre SQL Server
        // no comprobaría ni renovaría el RowVersion de la boleta.
        db.Entry(boleta).Property(b => b.Estado).IsModified = true;
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Results.Conflict("La boleta fue modificada por otro usuario; recargá los marchamos.");
        }

        return Results.Ok(await ProyectarAsync(db, boleta, ct));
    }

    private static async Task<BoletaMarchamosResponse> ProyectarAsync(
        SmsDbContext db, Boleta boleta, CancellationToken ct) =>
        new(Convert.ToBase64String(boleta.RowVersion ?? Array.Empty<byte>()), await LeerMarchamosAsync(db, boleta.Id, ct));

    private static async Task<List<BoletaMarchamoDto>> LeerMarchamosAsync(
        SmsDbContext db, Guid boletaId, CancellationToken ct)
    {
        var filas = await FilasOcurrenciaAsync(db, boletaId, null, ct);
        return filas.GroupBy(x => x.Valor.Ocurrencia).OrderBy(g => g.Key).Select(g =>
        {
            BoletaValorCampo? Valor(string clave) => g.FirstOrDefault(x => x.Campo.Clave == clave)?.Valor;
            return new BoletaMarchamoDto(
                g.Key,
                Valor("numero")?.ValorTexto ?? string.Empty,
                Valor("placa")?.ValorTexto,
                Valor("equipo")?.ValorMaestroId,
                Valor("activo")?.ValorBooleano ?? true,
                Valor("observaciones")?.ValorTexto);
        }).Where(m => m.Numero.Length > 0).ToList();
    }

    private static async Task<List<FilaMarchamo>> FilasOcurrenciaAsync(
        SmsDbContext db, Guid boletaId, int? ocurrencia, CancellationToken ct) =>
        await (from valor in db.BoletaValores
               join campo in db.Campos.AsNoTracking() on valor.CampoId equals campo.Id
               join seccion in db.Secciones.AsNoTracking() on campo.SeccionId equals seccion.Id
               where valor.BoletaId == boletaId
                     && seccion.Clave == ClaveSeccion
                     && (ocurrencia == null || valor.Ocurrencia == ocurrencia)
               select new FilaMarchamo(valor, campo)).ToListAsync(ct);

    private static void AgregarValor(
        SmsDbContext db,
        Guid boletaId,
        Campo campo,
        int ocurrencia,
        string? texto = null,
        bool? booleano = null,
        Guid? maestroId = null) =>
        db.BoletaValores.Add(new BoletaValorCampo
        {
            BoletaId = boletaId,
            CampoId = campo.Id,
            SeccionId = campo.SeccionId,
            Ocurrencia = ocurrencia,
            ValorTexto = texto,
            ValorBooleano = booleano,
            ValorMaestroId = maestroId,
        });

    private static void FijarTexto(
        SmsDbContext db,
        IReadOnlyList<FilaMarchamo> filas,
        Guid boletaId,
        Campo campo,
        int ocurrencia,
        string? valor)
    {
        var fila = filas.FirstOrDefault(x => x.Campo.Clave == campo.Clave)?.Valor;
        if (fila is not null && valor is null) db.BoletaValores.Remove(fila);
        else if (fila is not null)
        {
            fila.ValorTexto = valor;
            db.Entry(fila).Property(v => v.ValorTexto).IsModified = true;
        }
        else if (valor is not null) AgregarValor(db, boletaId, campo, ocurrencia, texto: valor);
    }

    private static void FijarBooleano(
        SmsDbContext db,
        IReadOnlyList<FilaMarchamo> filas,
        Guid boletaId,
        Campo campo,
        int ocurrencia,
        bool valor)
    {
        var fila = filas.FirstOrDefault(x => x.Campo.Clave == campo.Clave)?.Valor;
        if (fila is not null)
        {
            fila.ValorBooleano = valor;
            db.Entry(fila).Property(v => v.ValorBooleano).IsModified = true;
        }
        else AgregarValor(db, boletaId, campo, ocurrencia, booleano: valor);
    }

    private static bool ExisteDuplicado(
        IEnumerable<BoletaMarchamoDto> existentes, string numero, int? excluir) =>
        existentes.Any(m => m.Activo && m.Ocurrencia != excluir
            && string.Equals(m.Numero.Trim(), numero, StringComparison.OrdinalIgnoreCase));

    private static BoletaMarchamoCambio Cambio(
        Guid boletaId,
        BoletaMarchamoDto nuevo,
        BoletaMarchamoDto? anterior,
        AccionMarchamo accion,
        string observacion,
        string usuario) => new()
        {
            Id = Guid.NewGuid(),
            BoletaId = boletaId,
            Ocurrencia = nuevo.Ocurrencia,
            Accion = accion,
            ValorAnterior = anterior is null ? null : JsonSerializer.Serialize(anterior),
            ValorNuevo = JsonSerializer.Serialize(nuevo),
            Observacion = observacion.Trim(),
            Usuario = usuario,
            Fecha = DateTime.UtcNow,
        };

    private static string Usuario(HttpContext http) =>
        http.User.FindFirstValue(ClaimTypes.NameIdentifier)
        ?? throw new InvalidOperationException("La identidad autenticada no tiene usuario.");

    private static string Normalizar(string? valor) => valor?.Trim() ?? string.Empty;
    private static string? NormalizarOpcional(string? valor) =>
        string.IsNullOrWhiteSpace(valor) ? null : valor.Trim();

    private sealed record FilaMarchamo(BoletaValorCampo Valor, Campo Campo);
}
