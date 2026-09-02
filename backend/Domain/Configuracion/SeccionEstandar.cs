namespace SmsBackend.Domain.Configuracion;

/// <summary>
/// Única fuente de verdad de las 8 secciones estándar y sus claves de campo
/// reservadas. La consumen el seeder (inserta estas secciones/campos) y el
/// <c>GuardiaEstandar</c> (bloquea renombrar/borrar/aflojar estas claves), así
/// que no pueden divergir. WU1 solo crea la tabla; nadie la consume todavía.
/// </summary>
public static class SeccionEstandar
{
    /// <summary>Clave de sección estándar → claves de sus campos reservados.</summary>
    public static readonly IReadOnlyDictionary<string, IReadOnlyList<string>> ClavesReservadas =
        new Dictionary<string, IReadOnlyList<string>>
        {
            ["transporte"] = new[] { "transportista", "piloto", "equipo", "placa", "licencia" },
            ["producto"] = new[] { "articulo_ax", "cantidad", "tercero" },
            ["ubicacion"] = new[]
            {
                "almacen_origen", "almacen_destino", "sitio_origen", "sitio_destino", "bodega_externa",
            },
            ["calidad"] = new[] { "acidez", "luz", "temperatura", "dobi", "humedad", "revision_qa" },
            ["detalle_fruta"] = new[]
            {
                "finca", "lote", "numero_envio", "caporal", "racimos_verdes", "racimos_maduros",
                "racimos_sobremaduros", "racimos_pasados", "racimos_pedunculo_largo", "sacos",
                "libras", "jornales", "hectareas", "fecha_corte",
            },
            ["marchamos"] = new[] { "numero", "placa", "equipo", "activo", "observaciones" },
            ["caracteristicas"] = new[] { "clave", "valor", "tipo_dato" },
            ["compostera"] = new[] { "cui", "cama", "seccion", "ciclo", "numero_viaje" },
        };

    public static bool EsSeccionEstandar(string claveSeccion) =>
        ClavesReservadas.ContainsKey(claveSeccion);

    public static bool EsCampoReservado(string claveSeccion, string claveCampo) =>
        ClavesReservadas.TryGetValue(claveSeccion, out var claves) && claves.Contains(claveCampo);
}
