using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace SmsBackend.Domain.Seguridad;

public class SesionMockConfiguration : IEntityTypeConfiguration<SesionMock>
{
    public void Configure(EntityTypeBuilder<SesionMock> builder)
    {
        builder.ToTable("SesionMock");

        builder.HasKey(s => s.Id);

        // 256 bits en hex = 64 caracteres.
        builder.Property(s => s.Token)
            .HasMaxLength(64)
            .IsRequired();

        builder.HasIndex(s => s.Token).IsUnique();

        // FK real hacia Usuario — Cascade: una sesión huérfana no tiene sentido.
        builder.HasOne<Usuario>()
            .WithMany()
            .HasForeignKey(s => s.UsuarioId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
