using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SmsBackend.Domain.Maestros;

namespace SmsBackend.Domain.Configuracion;

public class CampoConfiguration : IEntityTypeConfiguration<Campo>
{
    public void Configure(EntityTypeBuilder<Campo> builder)
    {
        builder.ToTable("Campo");

        builder.HasKey(c => c.Id);

        builder.Property(c => c.Clave)
            .HasMaxLength(50)
            .IsRequired();

        builder.Property(c => c.Etiqueta)
            .HasMaxLength(100)
            .IsRequired();

        builder.Property(c => c.TipoCampo)
            .HasConversion<string>()
            .HasMaxLength(20)
            .IsRequired();

        builder.Property(c => c.TipoCatalogoRef)
            .HasConversion<string>()
            .HasMaxLength(20);

        // Config de UI libre: JSON crudo sin tipar en el modelo, mismo criterio
        // que Maestro.DatosAdicionales.
        builder.Property(c => c.Configuracion)
            .HasColumnType("nvarchar(max)");

        builder.Property(c => c.VigenteDesde)
            .HasColumnType("datetime2")
            .IsRequired();

        // FK a Seccion sin navigation property — Restrict, no se borra una
        // sección que tiene campos definidos.
        builder.HasOne<Seccion>()
            .WithMany()
            .HasForeignKey(c => c.SeccionId)
            .OnDelete(DeleteBehavior.Restrict);

        // Único por (sección, clave) SOLO entre versiones vigentes: el versionado
        // reutiliza la clave a propósito, así que las filas cerradas
        // (VigenteHasta != null) quedan fuera del índice.
        builder.HasIndex(c => new { c.SeccionId, c.Clave })
            .IsUnique()
            .HasFilter("[VigenteHasta] IS NULL");

        builder.HasIndex(c => new { c.SeccionId, c.Orden });

        // Marca de agua del sync incremental (ver SeccionConfiguration).
        builder.Property(c => c.FechaModificacion)
            .HasColumnType("datetime2")
            .HasDefaultValueSql("SYSUTCDATETIME()")
            .IsRequired();
    }
}
