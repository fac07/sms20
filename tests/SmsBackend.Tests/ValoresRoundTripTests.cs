using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SmsBackend.Data;
using SmsBackend.Domain.Boletas.Valores;
using SmsBackend.Domain.Configuracion;
using SmsBackend.Domain.TiposMovimiento;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Una sola representación de <c>valores</c> keyed por <c>campoId</c> +
/// <c>ocurrencia</c> (spec "One shared valores representation keyed by CampoId"):
/// <c>POST /api/boletas</c> y <c>/api/boletas/sync</c> "Crear" producen filas
/// <c>BoletaValorCampo</c> idénticas; el <c>GET</c> devuelve cada valor con
/// <c>campoId</c>/<c>seccionClave</c>/<c>campoClave</c>/<c>etiqueta</c>; una
/// sección <c>Repetible</c> guarda ocurrencias 0 y 1.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class ValoresRoundTripTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public ValoresRoundTripTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<List<(Guid CampoId, int Ocurrencia, string? Texto, decimal? Numero, DateTime? Fecha, bool? Bool, Guid? Maestro, Guid Seccion)>>
        FilasAsync(Guid boletaId)
    {
        using var scope = _factory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SmsDbContext>();
        var filas = await db.BoletaValores.AsNoTracking()
            .Where(v => v.BoletaId == boletaId)
            .OrderBy(v => v.CampoId).ThenBy(v => v.Ocurrencia)
            .Select(v => new
            {
                v.CampoId, v.Ocurrencia, v.ValorTexto, v.ValorNumero,
                v.ValorFecha, v.ValorBooleano, v.ValorMaestroId, v.SeccionId,
            })
            .ToListAsync();

        return filas
            .Select(v => (v.CampoId, v.Ocurrencia, v.ValorTexto, v.ValorNumero,
                v.ValorFecha, v.ValorBooleano, v.ValorMaestroId, v.SeccionId))
            .ToList();
    }

    [Fact]
    public async Task El_crear_tipado_y_el_sync_crear_producen_filas_identicas()
    {
        var s = TestData.Sufijo();
        var seccion = await TestData.CrearSeccionAsync(_client, $"rt_{s}");
        var nota = await TestData.CrearCampoAsync(_client, seccion.Id, "nota", TipoCampo.Texto, orden: 1);
        var medida = await TestData.CrearCampoAsync(_client, seccion.Id, "medida", TipoCampo.Decimal, orden: 2);

        var escenario = await TestData.NuevoEscenarioAsync(_client);
        await TestData.AsignarSeccionesAsync(
            _client, escenario.TipoMovimientoId, new AsignacionSeccionRequest(seccion.Id, false, 1));

        var valores = new[]
        {
            TestData.Texto(nota.Id, "hola"),
            TestData.Numero(medida.Id, 3.14m),
        };

        var tipada = await TestData.CrearBoletaAsync(_client, escenario, valores);

        var idSync = Guid.NewGuid();
        var (respSync, bodySync) = await TestData.SyncAsync(
            _client, TestData.SyncCrearPayload(idSync, escenario, DateTime.UtcNow, valores));
        Assert.True(respSync.IsSuccessStatusCode, bodySync);

        Assert.Equal(await FilasAsync(tipada.Id), await FilasAsync(idSync));
    }

    [Fact]
    public async Task El_get_devuelve_cada_valor_con_claves_y_etiqueta_legibles()
    {
        var s = TestData.Sufijo();
        var seccion = await TestData.CrearSeccionAsync(_client, $"rd_{s}");
        var nota = await TestData.CrearCampoAsync(_client, seccion.Id, "nota", TipoCampo.Texto);

        var escenario = await TestData.NuevoEscenarioAsync(_client);
        await TestData.AsignarSeccionesAsync(
            _client, escenario.TipoMovimientoId, new AsignacionSeccionRequest(seccion.Id, false, 1));

        var boleta = await TestData.CrearBoletaAsync(_client, escenario, new[] { TestData.Texto(nota.Id, "hola") });

        var recargada = await TestData.GetBoletaAsync(_client, boleta.Id);
        var valor = Assert.Single(recargada.Valores);
        Assert.Equal(nota.Id, valor.CampoId);
        Assert.Equal($"rd_{s}", valor.SeccionClave);
        Assert.Equal("nota", valor.CampoClave);
        Assert.Equal("Etiqueta nota", valor.Etiqueta);
        Assert.Equal("hola", valor.ValorTexto);
    }

    [Fact]
    public async Task Una_seccion_repetible_guarda_ocurrencias_0_y_1()
    {
        var secciones = await _client.GetFromJsonAsync<List<SeccionDto>>("/api/secciones", TestData.Json);
        var marchamos = secciones!.Single(x => x.Clave == "marchamos");

        var escenario = await TestData.NuevoEscenarioAsync(_client);
        await TestData.AsignarSeccionesAsync(
            _client, escenario.TipoMovimientoId, new AsignacionSeccionRequest(marchamos.Id, false, 1));

        var formulario = await TestData.FormularioAsync(_client, escenario.TipoMovimientoId);
        var numero = TestData.CampoId(formulario, "marchamos", "numero");

        var boleta = await TestData.CrearBoletaAsync(_client, escenario, new[]
        {
            TestData.Texto(numero, "M-0", ocurrencia: 0),
            TestData.Texto(numero, "M-1", ocurrencia: 1),
        });

        var filas = await FilasAsync(boleta.Id);
        Assert.Equal(new[] { 0, 1 }, filas.Where(f => f.CampoId == numero).Select(f => f.Ocurrencia).OrderBy(o => o));
    }
}
