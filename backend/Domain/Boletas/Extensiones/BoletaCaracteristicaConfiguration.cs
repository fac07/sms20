using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SmsBackend.Domain.Maestros;

namespace SmsBackend.Domain.Boletas.Extensiones;

public class BoletaCaracteristicaConfiguration : IEntityTypeConfiguration<BoletaCaracteristica>
{
    public void Configure(EntityTypeBuilder<BoletaCaracteristica> builder)
    {
        builder.ToTable("BoletaCaracteristica");

        builder.HasKey(c => c.Id);

        builder.Property(c => c.Cantidad).HasColumnType("decimal(10,2)");

        // 1:N — sin índice único, una boleta puede tener varias características.
        builder.HasOne<Boleta>()
            .WithMany()
            .HasForeignKey(c => c.BoletaId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne<Maestro>()
            .WithMany()
            .HasForeignKey(c => c.CaracteristicaId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
