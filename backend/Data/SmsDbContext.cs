using Microsoft.EntityFrameworkCore;
using SmsBackend.Domain.Basculas;
using SmsBackend.Domain.Boletas;
using SmsBackend.Domain.Boletas.Valores;
using SmsBackend.Domain.Centros;
using SmsBackend.Domain.Configuracion;
using SmsBackend.Domain.Maestros;
using SmsBackend.Domain.PreIngresos;
using SmsBackend.Domain.Seguridad;
using SmsBackend.Domain.TiposMovimiento;
using SmsBackend.Domain.Transporte;

namespace SmsBackend.Data;

public class SmsDbContext(DbContextOptions<SmsDbContext> options, ICentroContext centroContext) : DbContext(options)
{
    public DbSet<TipoMovimiento> TiposMovimiento => Set<TipoMovimiento>();

    public DbSet<Maestro> Maestros => Set<Maestro>();

    public DbSet<Bascula> Basculas => Set<Bascula>();

    public DbSet<Boleta> Boletas => Set<Boleta>();

    public DbSet<PreIngreso> PreIngresos => Set<PreIngreso>();

    public DbSet<Seccion> Secciones => Set<Seccion>();

    public DbSet<Campo> Campos => Set<Campo>();

    public DbSet<TipoMovimientoSeccion> TipoMovimientoSecciones => Set<TipoMovimientoSeccion>();

    public DbSet<BoletaValorCampo> BoletaValores => Set<BoletaValorCampo>();

    public DbSet<VinculoPilotoTransportista> VinculosPilotoTransportista => Set<VinculoPilotoTransportista>();

    public DbSet<AsignacionUnidadTransportista> AsignacionesUnidadTransportista => Set<AsignacionUnidadTransportista>();

    /// <summary>Config de rutas de transferencia por Centro — 1:1 con Maestro/Centro.</summary>
    public DbSet<ConfiguracionCentro> ConfiguracionesCentro => Set<ConfiguracionCentro>();

    /// <summary>Identidad humana mock (design D1/D3) — reemplazable por el proveedor real.</summary>
    public DbSet<Usuario> Usuarios => Set<Usuario>();

    /// <summary>Asociación Usuario-Centro; cardinalidad depende del Rol (design D1).</summary>
    public DbSet<UsuarioCentro> UsuariosCentro => Set<UsuarioCentro>();

    /// <summary>Sesiones mock emitidas por el login (design D3) — token opaco, expira, revocable.</summary>
    public DbSet<SesionMock> SesionesMock => Set<SesionMock>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(SmsDbContext).Assembly);

        // Alcance de Centro (design D6, PR3): un filtro global por
        // implementor de ICentroScoped en vez de un Where manual repetido en
        // cada endpoint — ese es exactamente el modo de falla legacy que
        // este mecanismo reemplaza. Falla cerrado: sin claims (anónimo) o
        // sin alcance global, Permitidos vacío no matchea ningún CentroId.
        //
        // Los 4 endpoints de dispositivo/sync (sin ClaimsPrincipal humano)
        // bypasean esto con `.IgnoreQueryFilters()` explícito en su propio
        // *Endpoints.cs — NUNCA relajando este filtro por default.
        modelBuilder.Entity<Bascula>()
            .HasQueryFilter(b => centroContext.EsGlobal || centroContext.Permitidos.Contains(b.CentroId));
        modelBuilder.Entity<PreIngreso>()
            .HasQueryFilter(p => centroContext.EsGlobal || centroContext.Permitidos.Contains(p.CentroId));
        modelBuilder.Entity<ConfiguracionCentro>()
            .HasQueryFilter(c => centroContext.EsGlobal || centroContext.Permitidos.Contains(c.CentroId));

        // Boleta NO implementa ICentroScoped (design D6, "verificado: solo
        // BasculaId") — su alcance se resuelve con un subquery correlacionado
        // a través de Bascula.CentroId. Sin índice dedicado hoy: si el
        // listado de boletas regresiona en latencia, denormalizar
        // Boleta.CentroId queda anotado como follow-up (design "Open
        // Questions"), fuera de alcance de este PR.
        modelBuilder.Entity<Boleta>()
            .HasQueryFilter(bo => centroContext.EsGlobal
                || Set<Bascula>().IgnoreQueryFilters().Any(b => b.Id == bo.BasculaId && centroContext.Permitidos.Contains(b.CentroId)));
    }

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        SellarFechaModificacion();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(
        bool acceptAllChangesOnSuccess,
        CancellationToken cancellationToken = default)
    {
        SellarFechaModificacion();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    /// <summary>
    /// Sella <see cref="IFechaModificable.FechaModificacion"/> con
    /// <c>DateTime.UtcNow</c> en toda entrada <c>Added</c> o <c>Modified</c>.
    /// Cubre las ~6 vías de escritura de <c>Seccion</c>/<c>Campo</c>/
    /// <c>TipoMovimientoSeccion</c> (incluido el loop multi-fila del PUT de
    /// asignaciones) sin repetir <c>= DateTime.UtcNow</c> en cada handler —
    /// más robusto que el sellado inline de <c>Maestro</c>, que queda como está
    /// por estar fuera de alcance.
    /// </summary>
    private void SellarFechaModificacion()
    {
        var ahora = DateTime.UtcNow;
        foreach (var entry in ChangeTracker.Entries<IFechaModificable>())
        {
            if (entry.State is EntityState.Added or EntityState.Modified)
            {
                entry.Entity.FechaModificacion = ahora;
            }
        }
    }
}
