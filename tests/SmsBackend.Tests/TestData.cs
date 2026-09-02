using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using SmsBackend.Domain.Basculas;
using SmsBackend.Domain.Boletas;
using SmsBackend.Domain.Boletas.Valores;
using SmsBackend.Domain.Configuracion;
using SmsBackend.Domain.Maestros;
using SmsBackend.Domain.TiposMovimiento;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>Centro + báscula + tipo de movimiento recién creados para un test.</summary>
public sealed record Escenario(Guid CentroId, Guid BasculaId, string BasculaCodigo, Guid TipoMovimientoId);

/// <summary>
/// Helpers HTTP contra la API real (misma serialización que
/// <c>Program.cs</c>: enums como string, camelCase) más pequeñas utilidades de
/// armado de datos. Todo lo que crea usa un sufijo único para poder compartir la
/// base entre clases de test sin colisiones de clave/código.
/// </summary>
public static class TestData
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    public static string Sufijo() => Guid.NewGuid().ToString("N")[..8];

    public static async Task<T> PostAsync<T>(HttpClient client, string url, object body)
    {
        var resp = await client.PostAsJsonAsync(url, body, Json);
        var texto = await resp.Content.ReadAsStringAsync();
        Assert.True(resp.IsSuccessStatusCode, $"POST {url} => {(int)resp.StatusCode}: {texto}");
        return JsonSerializer.Deserialize<T>(texto, Json)!;
    }

    public static async Task<Escenario> NuevoEscenarioAsync(HttpClient client)
    {
        var s = Sufijo();

        var centro = await PostAsync<MaestroDto>(client, "/api/maestros",
            new GuardarMaestroRequest(TipoCatalogo.Centro, $"C-{s}", $"Centro {s}", null));

        var bascula = await PostAsync<BasculaDto>(client, "/api/basculas",
            new GuardarBasculaRequest(
                $"B-{s}", $"Bascula {s}", centro.Id, TipoConexion.Serial, "COM1", null, null, 9600, 8, "STX"));

        var tipo = await PostAsync<TipoMovimientoDto>(client, "/api/tipos-movimiento",
            new GuardarTipoMovimientoRequest(
                $"TM-{s}", $"Tipo {s}", "REC", DireccionMovimiento.Entrada, null, false, null));

        return new Escenario(centro.Id, bascula.Id, bascula.Codigo, tipo.Id);
    }

    public static Task<SeccionDto> CrearSeccionAsync(
        HttpClient client, string clave, Cardinalidad cardinalidad = Cardinalidad.Unica, int orden = 90) =>
        PostAsync<SeccionDto>(client, "/api/secciones",
            new CrearSeccionRequest(clave, $"Sección {clave}", cardinalidad, true, orden));

    public static Task<CampoDto> CrearCampoAsync(
        HttpClient client,
        Guid seccionId,
        string clave,
        TipoCampo tipo,
        bool requerido = false,
        string? configuracion = null,
        TipoCatalogo? catalogoRef = null,
        int orden = 1) =>
        PostAsync<CampoDto>(client, "/api/campos",
            new CrearCampoRequest(seccionId, clave, $"Etiqueta {clave}", tipo, catalogoRef, requerido, configuracion, orden));

    public static async Task AsignarSeccionesAsync(
        HttpClient client, Guid tipoMovimientoId, params AsignacionSeccionRequest[] asignaciones)
    {
        var resp = await client.PutAsJsonAsync(
            $"/api/tipos-movimiento/{tipoMovimientoId}/secciones", asignaciones, Json);
        Assert.True(resp.IsSuccessStatusCode,
            $"PUT secciones => {(int)resp.StatusCode}: {await resp.Content.ReadAsStringAsync()}");
    }

    public static async Task<IReadOnlyList<CampoAplicable>> FormularioAsync(HttpClient client, Guid tipoMovimientoId)
    {
        var campos = await client.GetFromJsonAsync<List<CampoAplicable>>(
            $"/api/tipos-movimiento/{tipoMovimientoId}/formulario", Json);
        return campos!;
    }

    public static string NumeroBoleta() => $"N-{Guid.NewGuid():N}"[..18];

    public static async Task<(HttpResponseMessage Response, string Body)> CrearBoletaRawAsync(
        HttpClient client,
        Escenario escenario,
        IEnumerable<ValorCampoDto>? valores = null,
        OrigenPeso origenPesoIngreso = OrigenPeso.Bascula)
    {
        var req = new CrearBoletaRequest(
            NumeroBoleta(), escenario.BasculaId, escenario.TipoMovimientoId,
            1000m, origenPesoIngreso, "tester", false, valores?.ToList());
        var resp = await client.PostAsJsonAsync("/api/boletas", req, Json);
        return (resp, await resp.Content.ReadAsStringAsync());
    }

    public static async Task<BoletaDto> CrearBoletaAsync(
        HttpClient client,
        Escenario escenario,
        IEnumerable<ValorCampoDto>? valores = null,
        OrigenPeso origenPesoIngreso = OrigenPeso.Bascula)
    {
        var (resp, body) = await CrearBoletaRawAsync(client, escenario, valores, origenPesoIngreso);
        Assert.True(resp.IsSuccessStatusCode, $"POST /api/boletas => {(int)resp.StatusCode}: {body}");
        return JsonSerializer.Deserialize<BoletaDto>(body, Json)!;
    }

    public static Task<HttpResponseMessage> CerrarAsync(
        HttpClient client, Guid boletaId, decimal pesoSalida = 900m, OrigenPeso origen = OrigenPeso.Bascula) =>
        client.PostAsJsonAsync(
            $"/api/boletas/{boletaId}/cerrar",
            new CerrarBoletaRequest(pesoSalida, origen, "tester", null),
            Json);

    public static Task<HttpResponseMessage> CerrarRawAsync(HttpClient client, Guid boletaId, string rawJsonBody) =>
        client.PostAsync(
            $"/api/boletas/{boletaId}/cerrar",
            new StringContent(rawJsonBody, Encoding.UTF8, "application/json"));

    public static async Task<BoletaDto> GetBoletaAsync(HttpClient client, Guid boletaId)
    {
        var dto = await client.GetFromJsonAsync<BoletaDto>($"/api/boletas/{boletaId}", Json);
        return dto!;
    }

    public static async Task<List<ErrorCampo>> LeerErroresAsync(HttpResponseMessage resp)
    {
        var body = await resp.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<List<ErrorCampo>>(body, Json) ?? new List<ErrorCampo>();
    }

    /// <summary>
    /// Arma el payload crudo de <c>/api/boletas/sync</c> "Crear" con la misma
    /// forma que escribe <c>frontend/electron/db.ts</c>.
    /// </summary>
    public static object SyncCrearPayload(
        Guid boletaId,
        Escenario escenario,
        DateTime fechaHoraIngreso,
        IEnumerable<ValorCampoDto> valores,
        OrigenPeso origenPesoIngreso = OrigenPeso.Bascula) =>
        new
        {
            basculaCodigo = escenario.BasculaCodigo,
            operacion = "Crear",
            payload = new
            {
                id = boletaId,
                numeroBoleta = NumeroBoleta(),
                tipoMovimientoId = escenario.TipoMovimientoId,
                pesoIngreso = 1000m,
                origenPesoIngreso = origenPesoIngreso.ToString(),
                fechaHoraIngreso,
                usuarioIngreso = "tester",
                creadaOffline = true,
                valores = valores.Select(v => new
                {
                    campoId = v.CampoId,
                    ocurrencia = v.Ocurrencia,
                    valorTexto = v.ValorTexto,
                    valorNumero = v.ValorNumero,
                    valorFecha = v.ValorFecha,
                    valorBooleano = v.ValorBooleano,
                    valorMaestroId = v.ValorMaestroId,
                }).ToArray(),
            },
        };

    public static object SyncCerrarPayload(
        Guid boletaId,
        DateTime fechaHoraSalida,
        string basculaCodigo,
        decimal pesoIngreso = 1000m,
        decimal pesoSalida = 850m,
        OrigenPeso origenPesoSalida = OrigenPeso.Bascula) =>
        new
        {
            basculaCodigo,
            operacion = "Cerrar",
            payload = new
            {
                id = boletaId,
                pesoSalida,
                origenPesoSalida = origenPesoSalida.ToString(),
                fechaHoraSalida,
                usuarioSalida = "tester",
                pesoNeto = Math.Abs(pesoIngreso - pesoSalida),
            },
        };

    public static async Task<(HttpResponseMessage Response, string Body)> SyncAsync(HttpClient client, object request)
    {
        var resp = await client.PostAsJsonAsync("/api/boletas/sync", request, Json);
        return (resp, await resp.Content.ReadAsStringAsync());
    }

    public static Guid CampoId(IReadOnlyList<CampoAplicable> formulario, string seccionClave, string campoClave) =>
        formulario.Single(c => c.SeccionClave == seccionClave && c.CampoClave == campoClave).CampoId;

    public static ValorCampoDto Texto(Guid campoId, string valor, int ocurrencia = 0) =>
        new(campoId, ocurrencia, valor, null, null, null, null);

    public static ValorCampoDto Numero(Guid campoId, decimal valor, int ocurrencia = 0) =>
        new(campoId, ocurrencia, null, valor, null, null, null);

    public static ValorCampoDto Fecha(Guid campoId, DateTime valor, int ocurrencia = 0) =>
        new(campoId, ocurrencia, null, null, valor, null, null);

    public static ValorCampoDto Booleano(Guid campoId, bool valor, int ocurrencia = 0) =>
        new(campoId, ocurrencia, null, null, null, valor, null);

    public static ValorCampoDto Referencia(Guid campoId, Guid maestroId, int ocurrencia = 0) =>
        new(campoId, ocurrencia, null, null, null, null, maestroId);
}
