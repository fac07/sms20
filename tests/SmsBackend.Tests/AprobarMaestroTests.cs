using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SmsBackend.Data;
using SmsBackend.Domain.Maestros;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Slice M3 — aprobar-con-código y sugerencia de correlativo
/// (spec "Approve assigns an official Codigo" y "Suggestion returns the next
/// correlativo"). El cuerpo de <c>/aprobar</c> es obligatorio: el admin confirma
/// el <c>Codigo</c> (y puede corregir el <c>Nombre</c>); el <c>PROV-…</c> coinado
/// offline se reemplaza por el código real. Una colisión
/// <c>(TipoCatalogo, Codigo)</c> es 409 y deja la fila en <c>Provisional</c>.
/// <c>GET /siguiente-codigo</c> deriva <c>max(run de dígitos final)+1</c>
/// zero-padded, con fallback <c>"0001"</c> cuando no hay códigos numéricos.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class AprobarMaestroTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public AprobarMaestroTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<MaestroDto> CrearOficialAsync(TipoCatalogo tipo, string codigo, string nombre) =>
        TestData.PostAsync<MaestroDto>(_client, "/api/maestros",
            new GuardarMaestroRequest(tipo, codigo, nombre, null));

    private async Task<MaestroDto> CrearProvisionalAsync(TipoCatalogo tipo, string codigo, string nombre)
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var id = Guid.NewGuid();
        var (resp, body) = await TestData.SyncMaestroAsync(_client,
            TestData.SyncMaestroPayload(id, escenario.BasculaCodigo, tipo, codigo, nombre));
        Assert.True(resp.IsSuccessStatusCode, body);
        return JsonSerializer.Deserialize<MaestroDto>(body, TestData.Json)!;
    }

    [Fact]
    public async Task Aprobar_con_codigo_y_nombre_oficializa_reemplaza_el_prov_y_bumpea_fecha()
    {
        var s = TestData.Sufijo();
        var provisional = await CrearProvisionalAsync(
            TipoCatalogo.Piloto, $"PROV-01-{s}", $"Piloto prov {s}");
        var fechaPrevia = provisional.FechaModificacion;

        var (resp, body) = await TestData.AprobarMaestroAsync(
            _client, provisional.Id, $"PIL-{s}", $"Piloto Corregido {s}");

        Assert.True(resp.IsSuccessStatusCode, body);
        var dto = JsonSerializer.Deserialize<MaestroDto>(body, TestData.Json)!;
        Assert.Equal(EstadoMaestro.Oficial, dto.Estado);
        Assert.Equal($"PIL-{s}", dto.Codigo);
        Assert.Equal($"Piloto Corregido {s}", dto.Nombre);
        Assert.True(dto.Activo);
        Assert.True(dto.FechaModificacion > fechaPrevia);

        var recargado = await TestData.GetMaestroAsync(_client, provisional.Id);
        Assert.Equal(EstadoMaestro.Oficial, recargado.Estado);
        Assert.Equal($"PIL-{s}", recargado.Codigo);
    }

    [Fact]
    public async Task Aprobar_sin_nombre_conserva_el_nombre_provisional()
    {
        var s = TestData.Sufijo();
        var provisional = await CrearProvisionalAsync(
            TipoCatalogo.Finca, $"PROV-02-{s}", $"Finca {s}");

        var (resp, body) = await TestData.AprobarMaestroAsync(_client, provisional.Id, $"FIN-{s}");

        Assert.True(resp.IsSuccessStatusCode, body);
        var dto = JsonSerializer.Deserialize<MaestroDto>(body, TestData.Json)!;
        Assert.Equal($"Finca {s}", dto.Nombre);
        Assert.Equal($"FIN-{s}", dto.Codigo);
        Assert.Equal(EstadoMaestro.Oficial, dto.Estado);
    }

    [Fact]
    public async Task Aprobar_con_codigo_ya_usado_por_un_oficial_del_mismo_tipo_es_409_y_deja_provisional()
    {
        var s = TestData.Sufijo();
        var oficial = await CrearOficialAsync(TipoCatalogo.Transportista, $"TRA-{s}", $"Transportista {s}");
        var provisional = await CrearProvisionalAsync(
            TipoCatalogo.Transportista, $"PROV-03-{s}", $"Transportista prov {s}");

        var (resp, _) = await TestData.AprobarMaestroAsync(_client, provisional.Id, oficial.Codigo);

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
        var recargado = await TestData.GetMaestroAsync(_client, provisional.Id);
        Assert.Equal(EstadoMaestro.Provisional, recargado.Estado);
        Assert.Equal($"PROV-03-{s}", recargado.Codigo);
    }

    [Fact]
    public async Task Aprobar_sin_codigo_es_400()
    {
        var s = TestData.Sufijo();
        var provisional = await CrearProvisionalAsync(TipoCatalogo.Equipo, $"PROV-04-{s}", $"Equipo {s}");

        var (resp, _) = await TestData.AprobarMaestroAsync(_client, provisional.Id, "   ");

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Aprobar_un_id_inexistente_es_404()
    {
        var (resp, _) = await TestData.AprobarMaestroAsync(_client, Guid.NewGuid(), "X-1");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task Aprobar_un_maestro_que_no_es_provisional_es_409()
    {
        var s = TestData.Sufijo();
        var oficial = await CrearOficialAsync(TipoCatalogo.Equipo, $"EQ-{s}", $"Equipo {s}");

        var (resp, _) = await TestData.AprobarMaestroAsync(_client, oficial.Id, $"EQ2-{s}");

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
    }

    [Fact]
    public async Task Siguiente_codigo_devuelve_el_maximo_run_de_digitos_mas_uno_zero_padded()
    {
        var s = TestData.Sufijo();
        await CrearOficialAsync(TipoCatalogo.Almacen, $"ALM-{s}-007", $"Almacen A {s}");
        await CrearOficialAsync(TipoCatalogo.Almacen, $"ALM-{s}-012", $"Almacen B {s}");
        await CrearOficialAsync(TipoCatalogo.Almacen, $"ALM-{s}-003", $"Almacen C {s}");

        var sugerido = await TestData.SiguienteCodigoAsync(_client, TipoCatalogo.Almacen);

        Assert.Equal("013", sugerido.CodigoSugerido);
    }

    [Fact]
    public async Task Siguiente_codigo_sin_codigos_numericos_devuelve_fallback_0001()
    {
        var s = TestData.Sufijo();
        await CrearOficialAsync(TipoCatalogo.CicloCompostera, $"CICLO-{s}-alfa", $"Ciclo {s}");

        var sugerido = await TestData.SiguienteCodigoAsync(_client, TipoCatalogo.CicloCompostera);

        Assert.Equal("0001", sugerido.CodigoSugerido);
    }

    [Fact]
    public async Task Siguiente_codigo_solo_mira_oficiales_activos_del_tipo()
    {
        var s = TestData.Sufijo();
        // Provisional del mismo tipo con un run alto: no debe influir en la sugerencia.
        await CrearProvisionalAsync(TipoCatalogo.Tercero, $"PROV-{s}-999", $"Tercero prov {s}");
        await CrearOficialAsync(TipoCatalogo.Tercero, $"TER-{s}-4", $"Tercero {s}");

        var sugerido = await TestData.SiguienteCodigoAsync(_client, TipoCatalogo.Tercero);

        Assert.Equal("5", sugerido.CodigoSugerido);
    }
}
