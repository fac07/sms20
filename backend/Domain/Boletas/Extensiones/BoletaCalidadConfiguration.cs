using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace SmsBackend.Domain.Boletas.Extensiones;

public class BoletaCalidadConfiguration : IEntityTypeConfiguration<BoletaCalidad>
{
    public void Configure(EntityTypeBuilder<BoletaCalidad> builder)
    {
        builder.ToTable("BoletaCalidad");

        builder.HasKey(c => c.Id);

        // Lecturas/porcentajes, no pesos — decimal(8,2), no decimal(12,2).
        builder.Property(c => c.Acidez).HasColumnType("decimal(8,2)");
        builder.Property(c => c.DOBI).HasColumnType("decimal(8,2)");
        builder.Property(c => c.Humedad).HasColumnType("decimal(8,2)");
        builder.Property(c => c.Temperatura).HasColumnType("decimal(8,2)");

        builder.Property(c => c.NumeroRevisionQA).HasMaxLength(50);

        // 1:1 — a lo sumo una fila de calidad por boleta, enforced en la BD.
        builder.HasIndex(c => c.BoletaId).IsUnique();

        // Restrict — una fila de extensión nunca sobrevive al borrado de su
        // boleta, aunque las boletas en este sistema nunca se borran duro de
        // todas formas; Restrict es solo consistente con el resto del esquema.
        builder.HasOne<Boleta>()
            .WithMany()
            .HasForeignKey(c => c.BoletaId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
