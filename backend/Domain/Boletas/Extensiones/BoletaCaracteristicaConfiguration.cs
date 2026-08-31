using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace SmsBackend.Domain.Boletas.Extensiones;

public class BoletaCaracteristicaConfiguration : IEntityTypeConfiguration<BoletaCaracteristica>
{
    public void Configure(EntityTypeBuilder<BoletaCaracteristica> builder)
    {
        builder.ToTable("BoletaCaracteristica");

        builder.HasKey(c => c.Id);

        builder.Property(c => c.Clave).HasMaxLength(100).IsRequired();
        builder.Property(c => c.Valor).HasMaxLength(500).IsRequired();
        builder.Property(c => c.TipoDato).HasMaxLength(20).IsRequired();

        // 1:N — sin índice único, una boleta puede tener varias características.
        builder.HasOne<Boleta>()
            .WithMany()
            .HasForeignKey(c => c.BoletaId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
