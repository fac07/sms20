using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace SmsBackend.Domain.Maestros;

public class MaestroConfiguration : IEntityTypeConfiguration<Maestro>
{
    public void Configure(EntityTypeBuilder<Maestro> builder)
    {
        builder.ToTable("Maestro");

        builder.HasKey(m => m.Id);

        builder.Property(m => m.TipoCatalogo)
            .HasConversion<string>()
            .HasMaxLength(20)
            .IsRequired();

        builder.Property(m => m.Codigo)
            .HasMaxLength(30)
            .IsRequired();

        builder.Property(m => m.Nombre)
            .HasMaxLength(150)
            .IsRequired();

        builder.Property(m => m.DatosAdicionales)
            .HasColumnType("nvarchar(max)");

        builder.Property(m => m.Estado)
            .HasConversion<string>()
            .HasMaxLength(20)
            .IsRequired();

        // Self-FK, sin navigation property en la entidad para no complicar el
        // modelo — Restrict porque no tiene sentido cascadear el borrado de
        // un ítem oficial que tiene provisionales fusionados apuntándole.
        builder.HasOne<Maestro>()
            .WithMany()
            .HasForeignKey(m => m.FusionadoConId)
            .OnDelete(DeleteBehavior.Restrict);

        // Único por tipo de catálogo, no global — un piloto y un producto
        // pueden compartir "Codigo" sin chocar.
        builder.HasIndex(m => new { m.TipoCatalogo, m.Codigo }).IsUnique();
    }
}
