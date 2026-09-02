using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace SmsBackend.Domain.TiposMovimiento;

public class TipoMovimientoConfiguration : IEntityTypeConfiguration<TipoMovimiento>
{
    public void Configure(EntityTypeBuilder<TipoMovimiento> builder)
    {
        builder.ToTable("TipoMovimiento");

        builder.HasKey(t => t.Id);

        builder.Property(t => t.Codigo)
            .HasMaxLength(20)
            .IsRequired();

        builder.Property(t => t.Nombre)
            .HasMaxLength(100)
            .IsRequired();

        builder.Property(t => t.Prefijo)
            .HasMaxLength(10)
            .IsRequired();

        // Persistido como string (no int) para que la fila en SQL Server sea
        // legible sin tener que recordar qué número es cada dirección.
        builder.Property(t => t.Direccion)
            .HasConversion<string>()
            .HasMaxLength(20)
            .IsRequired();

        // Persistido como string, igual que Direccion. MaxLength(30) y no el
        // 20 estándar del resto del esquema: el miembro más largo,
        // TransferenciaRecepcion, mide 23 caracteres.
        builder.Property(t => t.OperacionD365)
            .HasConversion<string>()
            .HasMaxLength(30);

        builder.HasIndex(t => t.Codigo).IsUnique();
    }
}
