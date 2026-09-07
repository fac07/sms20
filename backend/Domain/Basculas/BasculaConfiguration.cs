using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SmsBackend.Domain.Maestros;

namespace SmsBackend.Domain.Basculas;

public class BasculaConfiguration : IEntityTypeConfiguration<Bascula>
{
    public void Configure(EntityTypeBuilder<Bascula> builder)
    {
        builder.ToTable("Bascula");

        builder.HasKey(b => b.Id);

        builder.Property(b => b.Codigo)
            .HasMaxLength(20)
            .IsRequired();

        builder.Property(b => b.Nombre)
            .HasMaxLength(100)
            .IsRequired();

        builder.Property(b => b.TipoConexion)
            .HasConversion<string>()
            .HasMaxLength(20)
            .IsRequired();

        builder.Property(b => b.Puerto).HasMaxLength(20);
        builder.Property(b => b.Ip).HasMaxLength(45);
        builder.Property(b => b.ModoComunicacion).HasMaxLength(50);
        builder.Property(b => b.CodigoAprovisionamiento).HasMaxLength(12);

        // Configuración central de ingreso manual de peso. El default en BD
        // mantiene a las básculas existentes sin cambios de comportamiento.
        builder.Property(b => b.PermiteIngresoManual).HasDefaultValue(false);
        builder.Property(b => b.PesoMinimoManual).HasColumnType("decimal(12,2)");
        builder.Property(b => b.PesoMaximoManual).HasColumnType("decimal(12,2)");

        // FK real hacia Maestro — Restrict, no tiene sentido borrar un
        // centro que todavía tiene básculas apuntándole.
        builder.HasOne<Maestro>()
            .WithMany()
            .HasForeignKey(b => b.CentroId)
            .OnDelete(DeleteBehavior.Restrict);

        // Único: es el namespace del correlativo de Boleta, dos básculas con
        // el mismo Codigo romperían la garantía anti-colisión offline.
        builder.HasIndex(b => b.Codigo).IsUnique();
    }
}
