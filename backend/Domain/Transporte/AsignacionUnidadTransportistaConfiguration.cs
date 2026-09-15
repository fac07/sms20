using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace SmsBackend.Domain.Transporte;

public class AsignacionUnidadTransportistaConfiguration : IEntityTypeConfiguration<AsignacionUnidadTransportista>
{
    public void Configure(EntityTypeBuilder<AsignacionUnidadTransportista> builder)
    {
        builder.ToTable("AsignacionUnidadTransportista");

        builder.HasKey(a => a.Id);

        builder.Property(a => a.VigenteDesde)
            .HasColumnType("datetime2")
            .IsRequired();

        builder.Property(a => a.VigenteHasta)
            .HasColumnType("datetime2");

        builder.Property(a => a.UsuarioAsigna).HasMaxLength(150).IsRequired();

        builder.Property(a => a.MotivoCambio).HasMaxLength(500);

        // UnidadId y TransportistaId son FKs lógicas hacia Maestro — sin
        // relación EF, mismo criterio que VinculoPilotoTransportista (D1).

        // El corazón de design D4: a lo sumo una fila abierta por unidad. El
        // índice único filtrado hace que "dos transportistas actuales para la
        // misma unidad" sea imposible a nivel de esquema, algo que un log de
        // eventos puro no puede garantizar.
        builder.HasIndex(a => a.UnidadId)
            .IsUnique()
            .HasFilter("[VigenteHasta] IS NULL");

        // Lookup del historial ordenado (GET .../asignaciones, más reciente
        // primero).
        builder.HasIndex(a => new { a.UnidadId, a.VigenteDesde });
    }
}
