using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace SmsBackend.Domain.Centros;

public class ConfiguracionCentroConfiguration : IEntityTypeConfiguration<ConfiguracionCentro>
{
    public void Configure(EntityTypeBuilder<ConfiguracionCentro> builder)
    {
        builder.ToTable("ConfiguracionCentro");

        // 1:1 con el Maestro/Centro: el Id del centro ES la PK — no puede
        // haber dos filas por centro, sin necesidad de índice único aparte.
        builder.HasKey(c => c.CentroId);

        // Las cinco columnas son FKs lógicas a Maestro (sin relación EF),
        // misma convención que Bascula.CentroId y VinculoPilotoTransportista.
    }
}
