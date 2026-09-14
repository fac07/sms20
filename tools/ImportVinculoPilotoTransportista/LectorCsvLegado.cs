namespace ImportVinculoPilotoTransportista;

/// <summary>Una fila resuelta del extracto legado <c>mas_Piloto_Transportista</c>.</summary>
public sealed record FilaLegado(string Licencia, string Transportista, bool Activo);

/// <summary>
/// Lector plano del CSV sin encabezado <c>Licencia,Transportista,Activo</c>.
/// Sin librería externa a propósito — un extracto de códigos de catálogo no
/// lleva comas embebidas, así que un split simple alcanza para esta
/// herramienta de un solo uso.
/// </summary>
public static class LectorCsvLegado
{
    public static IReadOnlyList<FilaLegado> Leer(string ruta)
    {
        var filas = new List<FilaLegado>();

        foreach (var linea in File.ReadLines(ruta))
        {
            if (string.IsNullOrWhiteSpace(linea))
            {
                continue;
            }

            var columnas = linea.Split(',');
            if (columnas.Length < 3)
            {
                Console.Error.WriteLine($"Línea ignorada (menos de 3 columnas): '{linea}'");
                continue;
            }

            var licencia = columnas[0].Trim().Trim('"');
            var transportista = columnas[1].Trim().Trim('"');
            var activoRaw = columnas[2].Trim().Trim('"');

            var activo = activoRaw is "1" || string.Equals(activoRaw, "true", StringComparison.OrdinalIgnoreCase);

            filas.Add(new FilaLegado(licencia, transportista, activo));
        }

        return filas;
    }
}
