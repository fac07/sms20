using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace SmsBackend.Domain.Boletas.Extensiones;

public class BoletaDetalleFrutaConfiguration : IEntityTypeConfiguration<BoletaDetalleFruta>
{
    public void Configure(EntityTypeBuilder<BoletaDetalleFruta> builder)
    {
        builder.ToTable("BoletaDetalleFruta");

        builder.HasKey(d => d.Id);

        builder.Property(d => d.Sacos).HasColumnType("decimal(10,2)");
        builder.Property(d => d.Jornales).HasColumnType("decimal(10,2)");
        builder.Property(d => d.Hectareas).HasColumnType("decimal(10,2)");

        // 1:N — sin índice único, una boleta puede traer varios envíos.
        builder.HasOne<Boleta>()
            .WithMany()
            .HasForeignKey(d => d.BoletaId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
