using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace SmsBackend.Domain.Seguridad;

public class UsuarioCentroConfiguration : IEntityTypeConfiguration<UsuarioCentro>
{
    public void Configure(EntityTypeBuilder<UsuarioCentro> builder)
    {
        builder.ToTable("UsuarioCentro");

        // Compuesta: un usuario no puede repetirse dos veces para el mismo Centro.
        builder.HasKey(uc => new { uc.UsuarioId, uc.CentroId });

        // FK real hacia Usuario — Cascade: si se borra el usuario, sus
        // asignaciones de Centro no tienen sentido por separado (mismo patrón
        // que BoletaValorCampo → Boleta).
        builder.HasOne<Usuario>()
            .WithMany()
            .HasForeignKey(uc => uc.UsuarioId)
            .OnDelete(DeleteBehavior.Cascade);

        // CentroId es FK lógica hacia Maestro — sin relación EF, igual que
        // Bascula/PreIngreso.CentroId.
    }
}
