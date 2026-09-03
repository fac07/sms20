using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SmsBackend.Domain.TiposMovimiento;

namespace SmsBackend.Domain.Configuracion;

public class TipoMovimientoSeccionConfiguration : IEntityTypeConfiguration<TipoMovimientoSeccion>
{
    public void Configure(EntityTypeBuilder<TipoMovimientoSeccion> builder)
    {
        builder.ToTable("TipoMovimientoSeccion");

        // La PK de dos columnas del v7 §03 no puede expresar el candado temporal:
        // reasignar una sección chocaría con la fila cerrada. VigenteDesde entra
        // a la PK y el índice filtrado de abajo garantiza una sola asignación
        // abierta por par.
        builder.HasKey(x => new { x.TipoMovimientoId, x.SeccionId, x.VigenteDesde });

        builder.Property(x => x.VigenteDesde)
            .HasColumnType("datetime2")
            .IsRequired();

        builder.HasIndex(x => new { x.TipoMovimientoId, x.SeccionId })
            .IsUnique()
            .HasFilter("[VigenteHasta] IS NULL");

        // FKs sin navigation property — Restrict, las asignaciones nunca se
        // borran en físico.
        builder.HasOne<TipoMovimiento>()
            .WithMany()
            .HasForeignKey(x => x.TipoMovimientoId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne<Seccion>()
            .WithMany()
            .HasForeignKey(x => x.SeccionId)
            .OnDelete(DeleteBehavior.Restrict);

        // Marca de agua del sync incremental (ver SeccionConfiguration).
        builder.Property(x => x.FechaModificacion)
            .HasColumnType("datetime2")
            .HasDefaultValueSql("SYSUTCDATETIME()")
            .IsRequired();
    }
}
