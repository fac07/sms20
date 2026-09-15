using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace SmsBackend.Domain.Seguridad;

public class UsuarioConfiguration : IEntityTypeConfiguration<Usuario>
{
    public void Configure(EntityTypeBuilder<Usuario> builder)
    {
        builder.ToTable("Usuario");

        builder.HasKey(u => u.Id);

        builder.Property(u => u.NombreUsuario)
            .HasMaxLength(50)
            .IsRequired();

        builder.Property(u => u.NombreCompleto)
            .HasMaxLength(150)
            .IsRequired();

        // SHA-256 hex = 64 caracteres.
        builder.Property(u => u.ClaveHash)
            .HasMaxLength(64)
            .IsRequired();

        builder.Property(u => u.Rol)
            .HasConversion<string>()
            .HasMaxLength(20)
            .IsRequired();

        // Login único — dos usuarios no pueden compartir NombreUsuario.
        builder.HasIndex(u => u.NombreUsuario).IsUnique();
    }
}
