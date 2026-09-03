using Microsoft.EntityFrameworkCore;
using SmsBackend.Domain.Basculas;
using SmsBackend.Domain.Boletas;
using SmsBackend.Domain.Boletas.Valores;
using SmsBackend.Domain.Configuracion;
using SmsBackend.Domain.Maestros;
using SmsBackend.Domain.TiposMovimiento;

namespace SmsBackend.Data;

public class SmsDbContext(DbContextOptions<SmsDbContext> options) : DbContext(options)
{
    public DbSet<TipoMovimiento> TiposMovimiento => Set<TipoMovimiento>();

    public DbSet<Maestro> Maestros => Set<Maestro>();

    public DbSet<Bascula> Basculas => Set<Bascula>();

    public DbSet<Boleta> Boletas => Set<Boleta>();

    public DbSet<Seccion> Secciones => Set<Seccion>();

    public DbSet<Campo> Campos => Set<Campo>();

    public DbSet<TipoMovimientoSeccion> TipoMovimientoSecciones => Set<TipoMovimientoSeccion>();

    public DbSet<BoletaValorCampo> BoletaValores => Set<BoletaValorCampo>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(SmsDbContext).Assembly);
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
