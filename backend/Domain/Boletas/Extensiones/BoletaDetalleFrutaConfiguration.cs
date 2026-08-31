using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace SmsBackend.Domain.Boletas.Extensiones;

public class BoletaDetalleFrutaConfiguration : IEntityTypeConfiguration<BoletaDetalleFruta>
{
    public void Configure(EntityTypeBuilder<BoletaDetalleFruta> builder)
    {
        builder.ToTable("BoletaDetalleFruta");

        builder.HasKey(d => d.Id);

        // 1:1 — a lo sumo una fila de detalle de fruta por boleta, enforced en la BD.
        builder.HasIndex(d => d.BoletaId).IsUnique();

        // Restrict — una fila de extensión nunca sobrevive al borrado de su
        // boleta, aunque las boletas en este sistema nunca se borran duro de
        // todas formas; Restrict es solo consistente con el resto del esquema.
        builder.HasOne<Boleta>()
            .WithMany()
            .HasForeignKey(d => d.BoletaId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
