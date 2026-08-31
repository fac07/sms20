using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SmsBackend.Domain.Maestros;

namespace SmsBackend.Domain.Boletas.Extensiones;

public class BoletaComposteraConfiguration : IEntityTypeConfiguration<BoletaCompostera>
{
    public void Configure(EntityTypeBuilder<BoletaCompostera> builder)
    {
        builder.ToTable("BoletaCompostera");

        builder.HasKey(c => c.Id);

        builder.Property(c => c.CUI).HasMaxLength(50).IsRequired();

        // 1:1 — a lo sumo una fila de compostera por boleta, enforced en la BD.
        builder.HasIndex(c => c.BoletaId).IsUnique();

        builder.HasOne<Boleta>()
            .WithMany()
            .HasForeignKey(c => c.BoletaId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne<Maestro>()
            .WithMany()
            .HasForeignKey(c => c.CamaId)
            .OnDelete(DeleteBehavior.Restrict);

        // SeccionId: FK -> Maestro (TipoCatalogo=SeccionCompostera) — igual
        // que CamaId/CicloId. Provisorio, ver comentario en
        // BoletaCompostera.SeccionId.
        builder.HasOne<Maestro>()
            .WithMany()
            .HasForeignKey(c => c.SeccionId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne<Maestro>()
            .WithMany()
            .HasForeignKey(c => c.CicloId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
