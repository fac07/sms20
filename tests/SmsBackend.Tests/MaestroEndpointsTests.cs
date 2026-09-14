using System.Net;
using System.Net.Http.Json;
using SmsBackend.Domain.Maestros;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Slice A1 (maestros-catalogos-faltantes) — los 8 nuevos <see cref="TipoCatalogo"/>
/// (Unidad, TipoUnidad, TipoEquipo, BodegaExterna, Tanque, Lote, CicloCosecha,
/// SeccionFinca), el filtro <c>?rol=</c> sobre Tercero (spec "Tercero carries a
/// Cliente/Proveedor role marker", diseño D7), el filtro <c>?codigoPrefijo=</c>
/// (diseño D5) y el ajuste Lote-aware de <c>/siguiente-codigo</c> (diseño D5,
/// gotcha G2 — la sugerencia sobre todos los códigos del tipo no sirve para el
/// código compuesto <c>{FincaCodigo}-{LoteCodigo}</c>).
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class MaestroEndpointsTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public MaestroEndpointsTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<MaestroDto> CrearAsync(TipoCatalogo tipo, string codigo, string nombre, string? datosAdicionales = null) =>
        TestData.PostAsync<MaestroDto>(_client, "/api/maestros",
            new GuardarMaestroRequest(tipo, codigo, nombre, datosAdicionales));

    private Task<List<MaestroDto>> ListarAsync(string query) =>
        _client.GetFromJsonAsync<List<MaestroDto>>($"/api/maestros?{query}", TestData.Json)!;

    public static IEnumerable<object[]> TiposNuevos() => new[]
    {
        new object[] { TipoCatalogo.Unidad },
        new object[] { TipoCatalogo.TipoUnidad },
        new object[] { TipoCatalogo.TipoEquipo },
        new object[] { TipoCatalogo.BodegaExterna },
        new object[] { TipoCatalogo.Tanque },
        new object[] { TipoCatalogo.Lote },
        new object[] { TipoCatalogo.CicloCosecha },
        new object[] { TipoCatalogo.SeccionFinca },
    };

    [Theory]
    [MemberData(nameof(TiposNuevos))]
    public async Task Crea_y_lista_cada_tipo_de_catalogo_nuevo(TipoCatalogo tipo)
    {
        var s = TestData.Sufijo();
        var creado = await CrearAsync(tipo, $"COD-{s}", $"Nombre {s}");
        Assert.Equal(tipo, creado.TipoCatalogo);

        var listado = await ListarAsync($"tipoCatalogo={tipo}");

        Assert.Contains(listado, m => m.Id == creado.Id);
    }

    [Fact]
    public async Task Codigo_duplicado_dentro_de_un_tipo_nuevo_es_409()
    {
        var s = TestData.Sufijo();
        await CrearAsync(TipoCatalogo.Unidad, $"U-{s}", $"Unidad {s}");

        var resp = await _client.PostAsJsonAsync("/api/maestros",
            new GuardarMaestroRequest(TipoCatalogo.Unidad, $"U-{s}", $"Otra unidad {s}", null), TestData.Json);

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
    }

    [Fact]
    public async Task Rol_sin_tipoCatalogo_tercero_es_400()
    {
        var resp = await _client.GetAsync("/api/maestros?rol=Cliente");
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Rol_con_tipoCatalogo_distinto_de_tercero_es_400()
    {
        var resp = await _client.GetAsync("/api/maestros?tipoCatalogo=Piloto&rol=Cliente");
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Rol_filtra_terceros_por_rol_en_DatosAdicionales()
    {
        var s = TestData.Sufijo();
        var cliente = await CrearAsync(
            TipoCatalogo.Tercero, $"TER-CLI-{s}", $"Cliente {s}", "{\"roles\":[\"Cliente\"]}");
        var proveedor = await CrearAsync(
            TipoCatalogo.Tercero, $"TER-PRO-{s}", $"Proveedor {s}", "{\"roles\":[\"Proveedor\"]}");
        var ambos = await CrearAsync(
            TipoCatalogo.Tercero, $"TER-AMB-{s}", $"Ambos {s}", "{\"roles\":[\"Cliente\",\"Proveedor\"]}");

        var listado = await ListarAsync("tipoCatalogo=Tercero&rol=Cliente");

        Assert.Contains(listado, m => m.Id == cliente.Id);
        Assert.Contains(listado, m => m.Id == ambos.Id);
        Assert.DoesNotContain(listado, m => m.Id == proveedor.Id);
    }

    [Fact]
    public async Task CodigoPrefijo_filtra_por_StartsWith_via_parametro_LINQ()
    {
        var s = TestData.Sufijo();
        var f1Lote1 = await CrearAsync(TipoCatalogo.Lote, $"F1{s}-1", $"Lote 1 finca F1 {s}");
        var f1Lote2 = await CrearAsync(TipoCatalogo.Lote, $"F1{s}-2", $"Lote 2 finca F1 {s}");
        var f2Lote1 = await CrearAsync(TipoCatalogo.Lote, $"F2{s}-1", $"Lote 1 finca F2 {s}");

        var listado = await ListarAsync($"tipoCatalogo=Lote&codigoPrefijo=F1{s}-");

        Assert.Contains(listado, m => m.Id == f1Lote1.Id);
        Assert.Contains(listado, m => m.Id == f1Lote2.Id);
        Assert.DoesNotContain(listado, m => m.Id == f2Lote1.Id);
    }

    [Fact]
    public async Task Siguiente_codigo_de_lote_sin_codigoPrefijo_es_400()
    {
        var resp = await _client.GetAsync("/api/maestros/siguiente-codigo?tipoCatalogo=Lote");
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Siguiente_codigo_de_lote_es_prefix_aware_por_finca()
    {
        var s = TestData.Sufijo();
        var prefijoF1 = $"F1{s}-";
        var prefijoF2 = $"F2{s}-";
        await CrearAsync(TipoCatalogo.Lote, $"{prefijoF1}007", $"Lote {s}");
        await CrearAsync(TipoCatalogo.Lote, $"{prefijoF1}012", $"Lote {s}");
        // Un run de dígitos más alto en OTRA finca no debe filtrarse a F1.
        await CrearAsync(TipoCatalogo.Lote, $"{prefijoF2}999", $"Lote {s}");

        var sugerido = await _client.GetFromJsonAsync<SiguienteCodigoResponse>(
            $"/api/maestros/siguiente-codigo?tipoCatalogo=Lote&codigoPrefijo={prefijoF1}", TestData.Json);

        Assert.Equal("013", sugerido!.CodigoSugerido);
    }
}
