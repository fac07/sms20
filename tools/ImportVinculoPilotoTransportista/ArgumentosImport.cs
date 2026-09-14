namespace ImportVinculoPilotoTransportista;

/// <summary>Argumentos de línea de comandos ya validados. Ver Program.cs para el uso completo.</summary>
public sealed record ArgumentosImport(string ConnectionString, string RutaCsv, string Usuario, bool DryRun)
{
    public static ArgumentosImport? Parsear(string[] args)
    {
        string? connectionString = null;
        string? rutaCsv = null;
        var usuario = "import-legado";
        var dryRun = false;

        for (var i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--connection-string" when i + 1 < args.Length:
                    connectionString = args[++i];
                    break;
                case "--csv" when i + 1 < args.Length:
                    rutaCsv = args[++i];
                    break;
                case "--usuario" when i + 1 < args.Length:
                    usuario = args[++i];
                    break;
                case "--dry-run":
                    dryRun = true;
                    break;
            }
        }

        if (string.IsNullOrWhiteSpace(connectionString) || string.IsNullOrWhiteSpace(rutaCsv))
        {
            Console.Error.WriteLine(
                "Uso: --connection-string <SmsCentral> --csv <ruta> [--usuario <nombre>] [--dry-run]");
            return null;
        }

        if (!File.Exists(rutaCsv))
        {
            Console.Error.WriteLine($"No existe el archivo CSV: '{rutaCsv}'.");
            return null;
        }

        return new ArgumentosImport(connectionString, rutaCsv, usuario, dryRun);
    }
}
