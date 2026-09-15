using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using SmsBackend.Data;
using SmsBackend.Domain.Boletas;
using Xunit;

namespace SmsBackend.Tests;

[Collection(ApiCollection.Name)]
public sealed class ReporteDiarioEndpointsTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public ReporteDiarioEndpointsTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public Task InitializeAsync() => _factory.ResetAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Agrupa_cerradas_por_fecha_salida_y_excluye_otros_estados_y_movimientos()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var otro = await TestData.NuevoEscenarioAsync(_client);

        using (var scope = _factory.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<SmsDbContext>();
            db.Boletas.AddRange(
                Boleta(escenario, "1", EstadoBoleta.Cerrada, new(2026, 9, 9, 22, 0, 0), new(2026, 9, 10, 1, 0, 0), 125m),
                Boleta(escenario, "2", EstadoBoleta.EnTransito, new(2026, 9, 10, 18, 0, 0), null, null),
                Boleta(escenario, "3", EstadoBoleta.Cerrada, new(2026, 9, 11, 8, 0, 0), new(2026, 9, 11, 9, 0, 0), 75m),
                Boleta(escenario, "4", EstadoBoleta.Anulada, new(2026, 9, 10, 8, 0, 0), new(2026, 9, 10, 9, 0, 0), 999m),
                Boleta(escenario, "5", EstadoBoleta.Reemitida, new(2026, 9, 10, 8, 0, 0), new(2026, 9, 10, 9, 0, 0), 999m),
                Boleta(otro, "6", EstadoBoleta.Cerrada, new(2026, 9, 10, 8, 0, 0), new(2026, 9, 10, 9, 0, 0), 999m),
                Boleta(escenario, "7", EstadoBoleta.Cerrada, new(2026, 9, 12, 8, 0, 0), new(2026, 9, 12, 9, 0, 0), 999m));
            await db.SaveChangesAsync();
        }

        var filas = await _client.GetFromJsonAsync<List<FilaReporte>>(
            $"/api/reportes/diario?tipoMovimientoId={escenario.TipoMovimientoId}&desde=2026-09-10&hasta=2026-09-11",
            TestData.Json);

        Assert.Equal(
            [new("2026-09-10", 1, 125m), new("2026-09-11", 1, 75m)],
            filas);
    }

    [Fact]
    public async Task Rechaza_un_rango_invertido()
    {
        var escenario = await TestData.NuevoEscenarioAsync(_client);
        var response = await _client.GetAsync(
            $"/api/reportes/diario?tipoMovimientoId={escenario.TipoMovimientoId}&desde=2026-09-11&hasta=2026-09-10");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    private static Boleta Boleta(
        Escenario escenario, string numero, EstadoBoleta estado, DateTime ingreso, DateTime? salida, decimal? neto) =>
        new()
        {
            Id = Guid.NewGuid(),
            NumeroBoleta = $"RD-{numero}-{Guid.NewGuid():N}"[..18],
            BasculaId = escenario.BasculaId,
            TipoMovimientoId = escenario.TipoMovimientoId,
            Estado = estado,
            EstadoSync = EstadoSyncBoleta.SincronizadoCentral,
            PesoIngreso = 1000m,
            PesoSalida = salida is null ? null : 1000m - neto,
            PesoNeto = neto,
            OrigenPesoIngreso = OrigenPeso.Bascula,
            OrigenPesoSalida = salida is null ? null : OrigenPeso.Bascula,
            FechaHoraIngreso = ingreso,
            FechaHoraSalida = salida,
            UsuarioIngreso = "tester",
            UsuarioSalida = salida is null ? null : "tester",
        };

    private sealed record FilaReporte(string Fecha, int CantidadBoletas, decimal PesoNetoTotal);
}
