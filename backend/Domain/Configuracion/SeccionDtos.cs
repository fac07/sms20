namespace SmsBackend.Domain.Configuracion;

public record SeccionDto(
    Guid Id,
    string Clave,
    string Nombre,
    Cardinalidad Cardinalidad,
    bool Reportable,
    bool Estandar,
    int Orden,
    bool Activa)
{
    public static SeccionDto FromEntity(Seccion s) => new(
        s.Id, s.Clave, s.Nombre, s.Cardinalidad, s.Reportable, s.Estandar, s.Orden, s.Activa);
}

/// <summary>
/// Alta de una sección. Siempre nace con <c>Estandar = 0</c> (el flag solo lo
/// pone el seeder) y por lo tanto totalmente editable.
/// </summary>
public record CrearSeccionRequest(
    string Clave,
    string Nombre,
    Cardinalidad Cardinalidad,
    bool Reportable,
    int Orden);

public record ActualizarSeccionRequest(
    string Clave,
    string Nombre,
    Cardinalidad Cardinalidad,
    bool Reportable,
    int Orden,
    bool Activa);
