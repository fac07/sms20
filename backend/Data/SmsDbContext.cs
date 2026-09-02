using Microsoft.EntityFrameworkCore;
using SmsBackend.Domain.Basculas;
using SmsBackend.Domain.Boletas;
using SmsBackend.Domain.Boletas.Extensiones;
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

    public DbSet<BoletaCalidad> BoletaCalidades => Set<BoletaCalidad>();

    public DbSet<BoletaDetalleFruta> BoletaDetalleFrutas => Set<BoletaDetalleFruta>();

    public DbSet<BoletaCaracteristica> BoletaCaracteristicas => Set<BoletaCaracteristica>();

    public DbSet<BoletaCompostera> BoletaComposteras => Set<BoletaCompostera>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(SmsDbContext).Assembly);
    }
}
