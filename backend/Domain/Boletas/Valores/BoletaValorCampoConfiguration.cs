using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SmsBackend.Domain.Configuracion;
using SmsBackend.Domain.Maestros;

namespace SmsBackend.Domain.Boletas.Valores;

public class BoletaValorCampoConfiguration : IEntityTypeConfiguration<BoletaValorCampo>
{
    public void Configure(EntityTypeBuilder<BoletaValorCampo> builder)
    {
        // El check constraint es la única integridad que la BD todavía puede
        // hacer cumplir después del salto a EAV: exactamente una columna de
        // valor poblada por fila.
        builder.ToTable("BoletaValorCampo", t => t.HasCheckConstraint(
            "CK_BoletaValorCampo_UnSoloValor",
            "(CASE WHEN ValorTexto IS NULL THEN 0 ELSE 1 END + CASE WHEN ValorNumero IS NULL THEN 0 ELSE 1 END"
            + " + CASE WHEN ValorFecha IS NULL THEN 0 ELSE 1 END + CASE WHEN ValorBooleano IS NULL THEN 0 ELSE 1 END"
            + " + CASE WHEN ValorMaestroId IS NULL THEN 0 ELSE 1 END) = 1"));

        builder.HasKey(v => new { v.BoletaId, v.CampoId, v.Ocurrencia });

        builder.Property(v => v.ValorTexto).HasMaxLength(500);
        builder.Property(v => v.ValorNumero).HasColumnType("decimal(18,4)");

        // ÚNICO Cascade deliberado en un esquema que por lo demás es todo
        // Restrict: los valores son composición (no viven sin su boleta),
        // mientras que toda otra FK es una referencia a catálogo. Marcado para
        // que el reviewer lo cuestione.
        builder.HasOne<Boleta>()
            .WithMany()
            .HasForeignKey(v => v.BoletaId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne<Campo>()
            .WithMany()
            .HasForeignKey(v => v.CampoId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne<Seccion>()
            .WithMany()
            .HasForeignKey(v => v.SeccionId)
            .OnDelete(DeleteBehavior.Restrict);

        // FK real e indexada desde el día uno aunque la fusión de provisionales
        // aterrice en un cambio posterior — retrofitear una FK + índice sobre
        // una tabla EAV ya poblada es estrictamente más caro que crearla bien
        // ahora.
        builder.HasOne<Maestro>()
            .WithMany()
            .HasForeignKey(v => v.ValorMaestroId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(v => v.ValorMaestroId);
        builder.HasIndex(v => new { v.BoletaId, v.SeccionId });
        builder.HasIndex(v => new { v.CampoId, v.ValorNumero });
    }
}
