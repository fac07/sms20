using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SmsBackend.Domain.Boletas;

namespace SmsBackend.Domain.PreIngresos;

public class PreIngresoConfiguration : IEntityTypeConfiguration<PreIngreso>
{
    public void Configure(EntityTypeBuilder<PreIngreso> builder)
    {
        builder.ToTable("PreIngreso");

        builder.HasKey(p => p.Id);

        builder.Property(p => p.NumeroEnvio)
            .HasMaxLength(40)
            .IsRequired();

        builder.Property(p => p.PesoEnviado).HasColumnType("decimal(12,2)");

        // Enum-as-string, igual que Boleta.Estado / Bascula.TipoConexion. La
        // columna es nvarchar(20) — el HasConversion no altera el esquema.
        builder.Property(p => p.Estado)
            .HasConversion<string>()
            .HasMaxLength(20)
            .IsRequired();

        builder.Property(p => p.UsuarioCreacion).HasMaxLength(150).IsRequired();
        builder.Property(p => p.UsuarioCancela).HasMaxLength(150);
        builder.Property(p => p.MotivoCancelacion).HasMaxLength(500);

        // Única FK real (design D3): el pre-ingreso es el lado canónico del
        // enlace 1:1. Restrict — no tiene sentido borrar una boleta que un
        // pre-ingreso ya referencia.
        builder.HasOne<Boleta>()
            .WithMany()
            .HasForeignKey(p => p.BoletaId)
            .OnDelete(DeleteBehavior.Restrict);

        // CentroId, PilotoId, TransportistaId, EquipoId, RegionId, FincaId son
        // FKs lógicas hacia Maestro — sin relación EF, igual que Bascula.CentroId.

        // Lectura de la cola por centro + estado.
        builder.HasIndex(p => new { p.CentroId, p.Estado });

        // Predicado del delta-sync (FechaModificacion > watermark).
        builder.HasIndex(p => p.FechaModificacion);

        // Filtro por número de envío (no único).
        builder.HasIndex(p => p.NumeroEnvio);
    }
}
