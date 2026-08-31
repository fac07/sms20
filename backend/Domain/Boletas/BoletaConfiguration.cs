using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SmsBackend.Domain.Basculas;
using SmsBackend.Domain.Maestros;
using SmsBackend.Domain.TiposMovimiento;

namespace SmsBackend.Domain.Boletas;

public class BoletaConfiguration : IEntityTypeConfiguration<Boleta>
{
    public void Configure(EntityTypeBuilder<Boleta> builder)
    {
        builder.ToTable("Boleta");

        builder.HasKey(b => b.Id);

        builder.Property(b => b.NumeroBoleta)
            .HasMaxLength(30)
            .IsRequired();

        // Único: es el correlativo legible que se muestra/imprime, dos
        // boletas con el mismo número rompen la trazabilidad.
        builder.HasIndex(b => b.NumeroBoleta).IsUnique();

        builder.Property(b => b.Estado)
            .HasConversion<string>()
            .HasMaxLength(20)
            .IsRequired();

        builder.Property(b => b.EstadoSync)
            .HasConversion<string>()
            .HasMaxLength(20)
            .IsRequired();

        builder.Property(b => b.OrigenPesoIngreso)
            .HasConversion<string>()
            .HasMaxLength(20)
            .IsRequired();

        builder.Property(b => b.OrigenPesoSalida)
            .HasConversion<string>()
            .HasMaxLength(20);

        builder.Property(b => b.PesoIngreso).HasColumnType("decimal(12,2)");
        builder.Property(b => b.PesoSalida).HasColumnType("decimal(12,2)");
        builder.Property(b => b.PesoNeto).HasColumnType("decimal(12,2)");

        builder.Property(b => b.UsuarioIngreso).HasMaxLength(150).IsRequired();
        builder.Property(b => b.UsuarioSalida).HasMaxLength(150);
        builder.Property(b => b.UsuarioAnula).HasMaxLength(150);
        builder.Property(b => b.UsuarioAutoriza).HasMaxLength(150);

        builder.Property(b => b.MotivoAnulacion).HasMaxLength(500);

        builder.Property(b => b.RespuestaD365Id).HasMaxLength(100);

        builder.Property(b => b.RowVersion).IsRowVersion();

        // FKs reales hacia Bascula — Restrict, no tiene sentido borrar una
        // báscula que ya pesó boletas.
        builder.HasOne<Bascula>()
            .WithMany()
            .HasForeignKey(b => b.BasculaId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne<Bascula>()
            .WithMany()
            .HasForeignKey(b => b.BasculaSalidaId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne<TipoMovimiento>()
            .WithMany()
            .HasForeignKey(b => b.TipoMovimientoId)
            .OnDelete(DeleteBehavior.Restrict);

        // Siete FKs distintas hacia Maestro, sin navigation property
        // compartida — cada una representa un rol distinto dentro de la
        // misma boleta (equipo, transportista, piloto, tercero, producto,
        // almacén origen/destino).
        builder.HasOne<Maestro>()
            .WithMany()
            .HasForeignKey(b => b.EquipoId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne<Maestro>()
            .WithMany()
            .HasForeignKey(b => b.TransportistaId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne<Maestro>()
            .WithMany()
            .HasForeignKey(b => b.PilotoId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne<Maestro>()
            .WithMany()
            .HasForeignKey(b => b.TerceroId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne<Maestro>()
            .WithMany()
            .HasForeignKey(b => b.ProductoId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne<Maestro>()
            .WithMany()
            .HasForeignKey(b => b.AlmacenOrigenId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne<Maestro>()
            .WithMany()
            .HasForeignKey(b => b.AlmacenDestinoId)
            .OnDelete(DeleteBehavior.Restrict);

        // Self-FKs, sin navigation property — mismo patrón que
        // Maestro.FusionadoConId.
        builder.HasOne<Boleta>()
            .WithMany()
            .HasForeignKey(b => b.BoletaReemplazoId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne<Boleta>()
            .WithMany()
            .HasForeignKey(b => b.BoletaOrigenId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
