using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SmsBackend.Data;
using SmsBackend.Domain.Boletas;
using SmsBackend.Domain.Boletas.Marchamos;
using SmsBackend.Domain.Boletas.Valores;
using SmsBackend.Domain.Seguridad;
using SmsBackend.Domain.TiposMovimiento;
using Xunit;

namespace SmsBackend.Tests;

[Collection(ApiCollection.Name)]
public sealed class BoletaMarchamosEndpointsTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public BoletaMarchamosEndpointsTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Agregar_crea_una_nueva_ocurrencia_en_una_boleta_cerrada()
    {
        var boletaId = await CrearBoletaAsync();
        var actual = await LeerAsync(boletaId);

        var response = await AgregarAsync(boletaId, actual.RowVersion, "M-100", "P-01", "Sello nuevo");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var resultado = await response.Content.ReadFromJsonAsync<MarchamosResponse>(TestData.Json);
        var marchamo = Assert.Single(resultado!.Marchamos);
        Assert.Equal("M-100", marchamo.Numero);
        Assert.Equal("P-01", marchamo.Placa);
        Assert.True(marchamo.Activo);
        Assert.Equal("Sello nuevo", marchamo.Observaciones);
        Assert.NotEqual(actual.RowVersion, resultado.RowVersion);
    }

    [Fact]
    public async Task Rectificar_actualiza_numero_y_observaciones_sin_recrear_la_ocurrencia()
    {
        var boletaId = await CrearBoletaAsync("M-100");
        var actual = await LeerAsync(boletaId);

        var response = await RectificarAsync(
            boletaId, 0, actual.RowVersion, "M-101", true, "Corregido", "Error de digitación");

        response.EnsureSuccessStatusCode();
        var resultado = await response.Content.ReadFromJsonAsync<MarchamosResponse>(TestData.Json);
        var marchamo = Assert.Single(resultado!.Marchamos);
        Assert.Equal(0, marchamo.Ocurrencia);
        Assert.Equal("M-101", marchamo.Numero);
        Assert.Equal("Corregido", marchamo.Observaciones);
    }

    [Fact]
    public async Task Desactivar_marca_inactiva_la_ocurrencia()
    {
        var boletaId = await CrearBoletaAsync("M-100");
        var actual = await LeerAsync(boletaId);

        var response = await RectificarAsync(
            boletaId, 0, actual.RowVersion, "M-100", false, "Retirado", "Marchamo roto");

        response.EnsureSuccessStatusCode();
        var resultado = await response.Content.ReadFromJsonAsync<MarchamosResponse>(TestData.Json);
        Assert.False(Assert.Single(resultado!.Marchamos).Activo);
    }

    [Fact]
    public async Task Editar_boleta_no_cerrada_devuelve_409_con_mensaje_claro()
    {
        var boletaId = await CrearBoletaAsync(cerrar: false);
        var actual = await LeerAsync(boletaId);

        var response = await AgregarAsync(boletaId, actual.RowVersion, "M-100", null, "Nuevo");

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Contains("Cerrada", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Operador_no_puede_editar_marchamos()
    {
        var boletaId = await CrearBoletaAsync();
        var actual = await LeerAsync(boletaId);
        await LoginAsync("operador", "Operador123!");

        var response = await AgregarAsync(boletaId, actual.RowVersion, "M-100", null, "Nuevo");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Agregar_sin_observacion_del_cambio_devuelve_400()
    {
        var boletaId = await CrearBoletaAsync();
        var actual = await LeerAsync(boletaId);

        var response = await AgregarAsync(boletaId, actual.RowVersion, "M-100", null, "Nuevo", "  ");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("observación", await response.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task No_permite_numero_duplicado_entre_marchamos_activos()
    {
        var boletaId = await CrearBoletaAsync("M-100");
        var actual = await LeerAsync(boletaId);

        var response = await AgregarAsync(boletaId, actual.RowVersion, " M-100 ", "P-02", "Duplicado");

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Contains("activo", await response.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Escribe_auditoria_con_accion_valores_usuario_y_fecha_utc()
    {
        var boletaId = await CrearBoletaAsync("M-100");
        var actual = await LeerAsync(boletaId);
        var antes = DateTime.UtcNow;

        var response = await RectificarAsync(
            boletaId, 0, actual.RowVersion, "M-101", false, "Retirado", "Marchamo roto");

        response.EnsureSuccessStatusCode();
        using var scope = _factory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SmsDbContext>();
        var cambio = await db.BoletaMarchamoCambios.SingleAsync(c => c.BoletaId == boletaId);
        Assert.Equal(AccionMarchamo.Desactivar, cambio.Accion);
        Assert.Equal(0, cambio.Ocurrencia);
        Assert.Contains("M-100", cambio.ValorAnterior!);
        Assert.Contains("M-101", cambio.ValorNuevo);
        Assert.Equal("Marchamo roto", cambio.Observacion);
        Assert.Equal("administrador", cambio.Usuario);
        Assert.Equal(DateTimeKind.Utc, cambio.Fecha.Kind);
        Assert.InRange(cambio.Fecha, antes.AddSeconds(-5), DateTime.UtcNow.AddSeconds(5));
    }

    [Fact]
    public async Task RowVersion_desactualizado_devuelve_409_y_no_escribe()
    {
        var boletaId = await CrearBoletaAsync();
        var inicial = await LeerAsync(boletaId);
        (await AgregarAsync(boletaId, inicial.RowVersion, "M-100", null, "Primero"))
            .EnsureSuccessStatusCode();

        var response = await AgregarAsync(boletaId, inicial.RowVersion, "M-200", null, "Segundo");

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Contains("modificada", await response.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
        Assert.Single((await LeerAsync(boletaId)).Marchamos);
    }

    private async Task<Guid> CrearBoletaAsync(string? numero = null, bool cerrar = true)
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        Guid seccionId;
        Dictionary<string, Guid> campos;
        using (var scope = _factory.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<SmsDbContext>();
            var seccion = await db.Secciones.SingleAsync(s => s.Clave == "marchamos" && s.Activa);
            seccionId = seccion.Id;
            campos = await db.Campos
                .Where(c => c.SeccionId == seccionId && c.VigenteHasta == null)
                .ToDictionaryAsync(c => c.Clave, c => c.Id);
        }

        await TestData.AsignarSeccionesAsync(
            _client, escenario.TipoMovimientoId, new AsignacionSeccionRequest(seccionId, false, 1));

        var valores = numero is null
            ? Array.Empty<ValorCampoDto>()
            : new[]
            {
                TestData.Texto(campos["numero"], numero),
                TestData.Texto(campos["placa"], "P-00"),
                TestData.Booleano(campos["activo"], true),
                TestData.Texto(campos["observaciones"], "Original"),
            };
        var boleta = await TestData.CrearBoletaAsync(_client, escenario, valores);
        if (cerrar) (await TestData.CerrarAsync(_client, boleta.Id)).EnsureSuccessStatusCode();
        return boleta.Id;
    }

    private async Task<MarchamosResponse> LeerAsync(Guid boletaId)
    {
        var response = await _client.GetAsync($"/api/boletas/{boletaId}/marchamos");
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<MarchamosResponse>(TestData.Json))!;
    }

    private Task<HttpResponseMessage> AgregarAsync(
        Guid boletaId,
        string rowVersion,
        string numero,
        string? placa,
        string observaciones,
        string observacionCambio = "Corrección autorizada") =>
        _client.PostAsJsonAsync($"/api/boletas/{boletaId}/marchamos", new
        {
            numero,
            placa,
            activo = true,
            observaciones,
            observacionCambio,
            rowVersion,
        }, TestData.Json);

    private Task<HttpResponseMessage> RectificarAsync(
        Guid boletaId,
        int ocurrencia,
        string rowVersion,
        string numero,
        bool activo,
        string observaciones,
        string observacionCambio) =>
        _client.PutAsJsonAsync($"/api/boletas/{boletaId}/marchamos/{ocurrencia}", new
        {
            numero,
            activo,
            observaciones,
            observacionCambio,
            rowVersion,
        }, TestData.Json);

    private async Task LoginAsync(string usuario, string clave)
    {
        var response = await _client.PostAsJsonAsync(
            "/api/auth/login", new { nombreUsuario = usuario, clave }, TestData.Json);
        response.EnsureSuccessStatusCode();
        var login = await response.Content.ReadFromJsonAsync<ResultadoLogin>(TestData.Json);
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login!.Token);
    }

    private sealed record MarchamosResponse(string RowVersion, IReadOnlyList<MarchamoResponse> Marchamos);

    private sealed record MarchamoResponse(
        int Ocurrencia,
        string Numero,
        string? Placa,
        Guid? EquipoId,
        bool Activo,
        string? Observaciones);
}
