using System.Net;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SmsBackend.Data;
using SmsBackend.Domain.Boletas;
using SmsBackend.Domain.Configuracion;
using SmsBackend.Domain.TiposMovimiento;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Resolución del conjunto de campos "as-of creación" (spec "Field set resolved
/// as-of boleta creation"): un campo agregado después no aplica a una boleta
/// anterior; un campo retirado sigue resolviendo para una boleta cerrada; un
/// valor capturado contra <c>CampoId = A</c> no se re-resuelve a <c>B</c> cuando
/// la clave se versiona.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class ResolucionAsOfTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public ResolucionAsOfTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task ConScope(Func<SmsDbContext, Task> accion)
    {
        using var scope = _factory.CreateScope();
        await accion(scope.ServiceProvider.GetRequiredService<SmsDbContext>());
    }

    [Fact]
    public async Task Un_campo_requerido_agregado_despues_no_bloquea_una_boleta_anterior()
    {
        var s = TestData.Sufijo();
        var seccion = await TestData.CrearSeccionAsync(_client, $"asof_{s}");
        var nota = await TestData.CrearCampoAsync(_client, seccion.Id, "nota", TipoCampo.Texto, requerido: false, orden: 1);

        var escenario = await TestData.NuevoEscenarioAsync(_client);
        await TestData.AsignarSeccionesAsync(
            _client, escenario.TipoMovimientoId, new AsignacionSeccionRequest(seccion.Id, Requerida: true, Orden: 1));

        // Boleta T0 — sección requerida satisfecha con una ocurrencia de `nota`.
        var anterior = await TestData.CrearBoletaAsync(
            _client, escenario, new[] { TestData.Texto(nota.Id, "primera") });

        var t0 = anterior.FechaHoraIngreso;

        // Campo requerido nuevo, vigente 1s DESPUÉS de la creación de la boleta T0.
        await ConScope(async db =>
        {
            db.Campos.Add(new Campo
            {
                Id = Guid.NewGuid(),
                SeccionId = seccion.Id,
                Clave = "obligatorio_nuevo",
                Etiqueta = "Obligatorio nuevo",
                TipoCampo = TipoCampo.Texto,
                Requerido = true,
                Orden = 9,
                VigenteDesde = t0.AddSeconds(1),
                VigenteHasta = null,
            });
            await db.SaveChangesAsync();
        });

        // La boleta T0 cierra: el campo nuevo no está en su conjunto as-of.
        var cierreAnterior = await TestData.CerrarAsync(_client, anterior.Id);
        Assert.Equal(HttpStatusCode.OK, cierreAnterior.StatusCode);

        // Una boleta cuya creación cae DESPUÉS del alta del campo sí lo ve y no
        // puede cerrar sin él (FechaHoraIngreso ajustada por BD para fijar el asOf).
        var posterior = await TestData.CrearBoletaAsync(
            _client, escenario, new[] { TestData.Texto(nota.Id, "segunda") });
        await ConScope(async db =>
        {
            var b = await db.Boletas.SingleAsync(x => x.Id == posterior.Id);
            b.FechaHoraIngreso = t0.AddMinutes(5);
            await db.SaveChangesAsync();
        });
        var cierrePosterior = await TestData.CerrarAsync(_client, posterior.Id);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, cierrePosterior.StatusCode);
    }

    [Fact]
    public async Task Un_campo_retirado_sigue_resolviendo_para_una_boleta_cerrada()
    {
        var s = TestData.Sufijo();
        var seccion = await TestData.CrearSeccionAsync(_client, $"retiro_{s}");
        var dato = await TestData.CrearCampoAsync(_client, seccion.Id, "dato", TipoCampo.Texto, requerido: false);

        var escenario = await TestData.NuevoEscenarioAsync(_client);
        await TestData.AsignarSeccionesAsync(
            _client, escenario.TipoMovimientoId, new AsignacionSeccionRequest(seccion.Id, Requerida: false, Orden: 1));

        var boleta = await TestData.CrearBoletaAsync(_client, escenario, new[] { TestData.Texto(dato.Id, "valor-x") });
        (await TestData.CerrarAsync(_client, boleta.Id)).EnsureSuccessStatusCode();

        // Retira el campo.
        await ConScope(async db =>
        {
            var campo = await db.Campos.SingleAsync(c => c.Id == dato.Id);
            campo.VigenteHasta = DateTime.UtcNow;
            await db.SaveChangesAsync();
        });

        var recargada = await TestData.GetBoletaAsync(_client, boleta.Id);
        var valor = Assert.Single(recargada.Valores);
        Assert.Equal(dato.Id, valor.CampoId);
        Assert.Equal("dato", valor.CampoClave);
        Assert.Equal("valor-x", valor.ValorTexto);
    }

    [Fact]
    public async Task El_valor_queda_ligado_al_campoid_original_aunque_la_clave_se_versione()
    {
        var s = TestData.Sufijo();
        var seccion = await TestData.CrearSeccionAsync(_client, $"version_{s}");
        var campoA = await TestData.CrearCampoAsync(_client, seccion.Id, "medida", TipoCampo.Decimal, requerido: false);

        var escenario = await TestData.NuevoEscenarioAsync(_client);
        await TestData.AsignarSeccionesAsync(
            _client, escenario.TipoMovimientoId, new AsignacionSeccionRequest(seccion.Id, Requerida: false, Orden: 1));

        var boleta = await TestData.CrearBoletaAsync(_client, escenario, new[] { TestData.Numero(campoA.Id, 12.5m) });

        // Versiona `medida` a Entero → nuevo Id, misma clave, cierra la versión A.
        var campoB = await TestData.PostAsync<SmsBackend.Domain.Configuracion.CampoDto>(
            _client, $"/api/campos/{campoA.Id}/nueva-version",
            new NuevaVersionCampoRequest("Medida", TipoCampo.Entero, null, false, null, 1));
        Assert.NotEqual(campoA.Id, campoB.Id);

        var recargada = await TestData.GetBoletaAsync(_client, boleta.Id);
        var valor = Assert.Single(recargada.Valores);
        Assert.Equal(campoA.Id, valor.CampoId);
        Assert.Equal(12.5m, valor.ValorNumero);
    }
}
