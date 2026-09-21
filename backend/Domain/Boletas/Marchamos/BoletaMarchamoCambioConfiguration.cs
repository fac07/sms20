using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace SmsBackend.Domain.Boletas.Marchamos;

public sealed class BoletaMarchamoCambioConfiguration : IEntityTypeConfiguration<BoletaMarchamoCambio>
{
    public void Configure(EntityTypeBuilder<BoletaMarchamoCambio> builder)
    {
        builder.ToTable("BoletaMarchamoCambio");
        builder.HasKey(c => c.Id);
        builder.Property(c => c.Accion).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(c => c.ValorAnterior).HasColumnType("nvarchar(max)");
        builder.Property(c => c.ValorNuevo).HasColumnType("nvarchar(max)").IsRequired();
        builder.Property(c => c.Observacion).HasMaxLength(500).IsRequired();
        builder.Property(c => c.Usuario).HasMaxLength(150).IsRequired();
        builder.Property(c => c.Fecha)
            .HasColumnType("datetime2")
            .HasConversion(v => v, v => DateTime.SpecifyKind(v, DateTimeKind.Utc))
            .IsRequired();

        builder.HasOne<Boleta>()
            .WithMany()
            .HasForeignKey(c => c.BoletaId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(c => new { c.BoletaId, c.Ocurrencia, c.Fecha });
    }
}
