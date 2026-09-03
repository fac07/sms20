using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace SmsBackend.Domain.Configuracion;

public class SeccionConfiguration : IEntityTypeConfiguration<Seccion>
{
    public void Configure(EntityTypeBuilder<Seccion> builder)
    {
        builder.ToTable("Seccion");

        builder.HasKey(s => s.Id);

        builder.Property(s => s.Clave)
            .HasMaxLength(50)
            .IsRequired();

        builder.Property(s => s.Nombre)
            .HasMaxLength(100)
            .IsRequired();

        // Persistido como string (no int) para que la fila en SQL Server sea
        // legible sin recordar qué número es cada cardinalidad — mismo criterio
        // que el resto de los enums del modelo.
        builder.Property(s => s.Cardinalidad)
            .HasConversion<string>()
            .HasMaxLength(20)
            .IsRequired();

        // La clave es el identificador estable que usan la báscula, el seeder y
        // el guardia de secciones estándar — dos secciones con la misma clave
        // rompen esa referencia.
        builder.HasIndex(s => s.Clave).IsUnique();

        // Marca de agua del sync incremental. defaultValueSql sella las filas ya
        // sembradas cuando corre la migración incremental; el override de
        // SaveChanges la mantiene al día en cada escritura posterior.
        builder.Property(s => s.FechaModificacion)
            .HasColumnType("datetime2")
            .HasDefaultValueSql("SYSUTCDATETIME()")
            .IsRequired();
    }
}
