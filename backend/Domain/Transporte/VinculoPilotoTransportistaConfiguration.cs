using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace SmsBackend.Domain.Transporte;

public class VinculoPilotoTransportistaConfiguration : IEntityTypeConfiguration<VinculoPilotoTransportista>
{
    public void Configure(EntityTypeBuilder<VinculoPilotoTransportista> builder)
    {
        builder.ToTable("VinculoPilotoTransportista");

        builder.HasKey(v => v.Id);

        builder.Property(v => v.UsuarioCreacion).HasMaxLength(150).IsRequired();

        // PilotoId y TransportistaId son FKs lógicas hacia Maestro — sin
        // relación EF, igual que Bascula.CentroId y las referencias de
        // PreIngreso (design D1).

        // Un par piloto+transportista tiene, como mucho, una fila para
        // siempre — reactivar un par desactivado actualiza esa misma fila
        // (Activo=true), nunca inserta una segunda.
        builder.HasIndex(v => new { v.PilotoId, v.TransportistaId }).IsUnique();

        // Lookup escopeado que necesitará el selector de piloto offline (PR4/PR5).
        builder.HasIndex(v => new { v.TransportistaId, v.Activo });

        // Predicado del delta-sync (FechaModificacion > watermark).
        builder.HasIndex(v => v.FechaModificacion);
    }
}
