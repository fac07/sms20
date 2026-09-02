namespace SmsBackend.Domain.Configuracion;

/// <summary>
/// Candado de las secciones/campos estándar (design D8, LOCKED constraint 2).
/// Estático y devuelve <c>IResult?</c> — <c>null</c> = la operación puede seguir,
/// no nulo = el 409 que el endpoint debe devolver TAL CUAL, antes de mutar nada.
/// No es una restricción de BD: las reglas son relacionales y necesitan mensajes
/// legibles. Lee <see cref="SeccionEstandar"/>, la misma tabla que consume el
/// seeder, para que no puedan divergir.
/// </summary>
public static class GuardiaEstandar
{
    // --- Seccion --------------------------------------------------------------

    /// <summary>Con <c>Estandar = 1</c> bloquea renombrar la clave y desactivar.</summary>
    public static IResult? ParaActualizarSeccion(Seccion actual, string nuevaClave, bool nuevaActiva)
    {
        if (!actual.Estandar)
        {
            return null;
        }

        if (!string.Equals(actual.Clave, nuevaClave, StringComparison.Ordinal))
        {
            return Bloqueo($"La sección estándar '{actual.Clave}' no permite cambiar su clave.");
        }

        if (actual.Activa && !nuevaActiva)
        {
            return Bloqueo($"La sección estándar '{actual.Clave}' no se puede desactivar.");
        }

        return null;
    }

    /// <summary>Con <c>Estandar = 1</c> bloquea el borrado.</summary>
    public static IResult? ParaEliminarSeccion(Seccion actual) =>
        actual.Estandar
            ? Bloqueo($"La sección estándar '{actual.Clave}' no se puede eliminar.")
            : null;

    // --- Campo --------------------------------------------------------------

    /// <summary>
    /// En una sección estándar, bloquea crear un campo con una clave reservada
    /// (esa clave la administra el seeder).
    /// </summary>
    public static IResult? ParaCrearCampo(Seccion seccion, string nuevaClave) =>
        seccion.Estandar && SeccionEstandar.EsCampoReservado(seccion.Clave, nuevaClave)
            ? Bloqueo(
                $"La clave '{nuevaClave}' está reservada en la sección estándar "
                + $"'{seccion.Clave}' y la administra el seeder.")
            : null;

    /// <summary>
    /// En un campo de clave reservada, bloquea aflojar <c>Requerido</c>
    /// (<c>true → false</c>). Renombrar la clave y cambiar el tipo ya son
    /// imposibles en su lugar por el versionado.
    /// </summary>
    public static IResult? ParaActualizarCampo(Campo actual, Seccion seccion, bool nuevoRequerido)
    {
        if (!EsReservado(actual, seccion))
        {
            return null;
        }

        return actual.Requerido && !nuevoRequerido
            ? Bloqueo(
                $"El campo reservado '{seccion.Clave}.{actual.Clave}' no puede dejar de ser requerido.")
            : null;
    }

    /// <summary>En un campo de clave reservada, bloquea el borrado.</summary>
    public static IResult? ParaEliminarCampo(Campo actual, Seccion seccion) =>
        EsReservado(actual, seccion)
            ? Bloqueo($"El campo reservado '{seccion.Clave}.{actual.Clave}' no se puede eliminar.")
            : null;

    /// <summary>
    /// En un campo de clave reservada, bloquea crear una versión nueva — implica
    /// ponerle <see cref="Campo.VigenteHasta"/> a la versión vigente.
    /// </summary>
    public static IResult? ParaNuevaVersionCampo(Campo actual, Seccion seccion) =>
        EsReservado(actual, seccion)
            ? Bloqueo(
                $"El campo reservado '{seccion.Clave}.{actual.Clave}' no se puede versionar "
                + "(implica cerrar la versión vigente).")
            : null;

    private static bool EsReservado(Campo campo, Seccion seccion) =>
        seccion.Estandar && SeccionEstandar.EsCampoReservado(seccion.Clave, campo.Clave);

    private static IResult Bloqueo(string mensaje) =>
        Results.Conflict(mensaje);
}
