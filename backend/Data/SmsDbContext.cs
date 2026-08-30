using Microsoft.EntityFrameworkCore;
using SmsBackend.Domain.Basculas;
using SmsBackend.Domain.Maestros;
using SmsBackend.Domain.TiposMovimiento;

namespace SmsBackend.Data;

public class SmsDbContext(DbContextOptions<SmsDbContext> options) : DbContext(options)
{
    public DbSet<TipoMovimiento> TiposMovimiento => Set<TipoMovimiento>();

    public DbSet<Maestro> Maestros => Set<Maestro>();

    public DbSet<Bascula> Basculas => Set<Bascula>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(SmsDbContext).Assembly);
    }
}
