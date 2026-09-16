using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SmsBackend.Data;
using SmsBackend.Domain.Basculas;
using SmsBackend.Domain.Boletas;
using SmsBackend.Domain.Maestros;
using SmsBackend.Domain.Seguridad;
using SmsBackend.Domain.TiposMovimiento;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Alcance de Centro en listados (design D6, PR3): un Operador solo ve el
/// Centro que <see cref="Data.Seeding.SeguridadSeeder"/> le asignó
/// (<c>CentroA</c>), un Supervisor ve sus N Centros (<c>CentroA</c>+<c>CentroB</c>),
/// y un Administrador ve todo — sin restricción (alcance global, design D2).
///
/// Los básculas de prueba se insertan DIRECTO por <c>SmsDbContext</c> (no vía
/// <c>POST /api/basculas</c>) para poder fijar <c>CentroId</c> exactamente en
/// los Centros sembrados por <c>SeguridadSeeder</c> — <c>Bascula.CentroId</c>
/// tiene FK real hacia <c>Maestro</c> (<c>BasculaConfiguration.cs</c>), así
/// que cada Centro necesita también su propia fila <c>Maestro</c> (TipoCatalogo=Centro)
/// insertada a mano con el mismo Guid.
///
/// La aserción NO cuenta filas totales: <see cref="ApiFactory.ResetAsync"/>
/// no limpia <c>Basculas</c>/<c>Maestros</c> entre tests (ver su comentario de
/// clase), así que la suite completa acumula básculas de Centros random de
/// OTROS archivos de test, todas visibles para Administrador. Se verifica en
/// cambio que cada rol ve EXACTAMENTE los Centros que le corresponden entre
/// los tres que este test arma, ignorando cualquier ruido de otros tests.
/// </summary>
[Collection(ApiCollection.Name)]
[Trait("Category", "Seguridad")]
public sealed class CentroScopingTests : IAsyncLifetime
{
    // Mismos valores que Data/Seeding/SeguridadSeeder.cs — Operador -> CentroA,
    // Supervisor -> CentroA+CentroB, Administrador -> global (ninguno de los dos).
    private static readonly Guid CentroA = new("11111111-1111-1111-1111-111111111111");
    private static readonly Guid CentroB = new("22222222-2222-2222-2222-222222222222");

    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public CentroScopingTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<string> LoginTokenAsync(string usuario, string clave)
    {
        var resp = await _client.PostAsJsonAsync(
            "/api/auth/login", new { nombreUsuario = usuario, clave }, TestData.Json);
        resp.EnsureSuccessStatusCode();
        var login = await resp.Content.ReadFromJsonAsync<ResultadoLogin>(TestData.Json);
        return login!.Token;
    }

    /// <summary>Garantiza una fila Maestro (TipoCatalogo=Centro) con el Guid exacto pedido — FK real de Bascula.CentroId.</summary>
    private static async Task AsegurarCentroMaestroAsync(SmsDbContext db, Guid centroId)
    {
        if (await db.Maestros.AnyAsync(m => m.Id == centroId))
        {
            return;
        }

        var s = TestData.Sufijo();
        db.Maestros.Add(new Maestro
        {
            Id = centroId,
            TipoCatalogo = TipoCatalogo.Centro,
            Codigo = $"C-{s}",
            Nombre = $"Centro {s}",
            Activo = true,
        });
        await db.SaveChangesAsync();
    }

    private static async Task<Bascula> CrearBasculaEnCentroAsync(SmsDbContext db, Guid centroId)
    {
        await AsegurarCentroMaestroAsync(db, centroId);

        var s = TestData.Sufijo();
        var bascula = new Bascula
        {
            Id = Guid.NewGuid(),
            Codigo = $"B-{s}",
            Nombre = $"Bascula {s}",
            CentroId = centroId,
            TipoConexion = TipoConexion.Serial,
            Puerto = "COM1",
            Velocidad = 9600,
            BitsDatos = 8,
            ModoComunicacion = "STX",
            Activa = true,
        };
        db.Basculas.Add(bascula);
        await db.SaveChangesAsync();
        return bascula;
    }

    [Fact]
    public async Task GET_basculas_Operador_ve_solo_su_Centro_Supervisor_ve_los_suyos_Administrador_ve_todos()
    {
        Bascula basculaA, basculaB, basculaC;
        var centroC = Guid.NewGuid();
        using (var scope = _factory.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<SmsDbContext>();
            basculaA = await CrearBasculaEnCentroAsync(db, CentroA);
            basculaB = await CrearBasculaEnCentroAsync(db, CentroB);
            basculaC = await CrearBasculaEnCentroAsync(db, centroC);
        }

        var tokenOperador = await LoginTokenAsync("operador", "Operador123!");
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenOperador);
        var idsOperador = await IdsVisiblesAsync();
        Assert.Contains(basculaA.Id, idsOperador);
        Assert.DoesNotContain(basculaB.Id, idsOperador);
        Assert.DoesNotContain(basculaC.Id, idsOperador);

        var tokenSupervisor = await LoginTokenAsync("supervisor", "Supervisor123!");
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenSupervisor);
        var idsSupervisor = await IdsVisiblesAsync();
        Assert.Contains(basculaA.Id, idsSupervisor);
        Assert.Contains(basculaB.Id, idsSupervisor);
        Assert.DoesNotContain(basculaC.Id, idsSupervisor);

        var tokenAdmin = await LoginTokenAsync("administrador", "Administrador123!");
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenAdmin);
        var idsAdmin = await IdsVisiblesAsync();
        Assert.Contains(basculaA.Id, idsAdmin);
        Assert.Contains(basculaB.Id, idsAdmin);
        Assert.Contains(basculaC.Id, idsAdmin);
    }

    private async Task<HashSet<Guid>> IdsVisiblesAsync()
    {
        var basculas = await _client.GetFromJsonAsync<List<BasculaDto>>("/api/basculas?incluirInactivas=true", TestData.Json);
        return basculas!.Select(b => b.Id).ToHashSet();
    }

    /// <summary>
    /// Boleta NO implementa <c>ICentroScoped</c> (design D6, verificado:
    /// solo tiene <c>BasculaId</c>) — su alcance se resuelve por el subquery
    /// correlacionado <c>Bascula.CentroId</c> en <c>SmsDbContext</c>. Se
    /// inserta directo por DB (bypass de <c>POST /api/boletas</c> y su
    /// validación de campos EAV, irrelevante para lo que este test verifica)
    /// para poder fijar <c>BasculaId</c> apuntando a cada uno de los tres
    /// Centros de prueba.
    /// </summary>
    [Fact]
    public async Task GET_boletas_se_filtra_por_Centro_via_BasculaId_no_por_CentroId_propio()
    {
        Guid boletaA, boletaB, boletaC;
        var centroC = Guid.NewGuid();
        using (var scope = _factory.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<SmsDbContext>();
            var basculaA = await CrearBasculaEnCentroAsync(db, CentroA);
            var basculaB = await CrearBasculaEnCentroAsync(db, CentroB);
            var basculaC = await CrearBasculaEnCentroAsync(db, centroC);

            var s = TestData.Sufijo();
            var tipoMovimiento = await TestData.PostAsync<TipoMovimientoDto>(_client, "/api/tipos-movimiento",
                new GuardarTipoMovimientoRequest($"TM-{s}", $"Tipo {s}", "REC", DireccionMovimiento.Entrada, null, false, null));

            boletaA = await CrearBoletaDirectaAsync(db, basculaA.Id, tipoMovimiento.Id);
            boletaB = await CrearBoletaDirectaAsync(db, basculaB.Id, tipoMovimiento.Id);
            boletaC = await CrearBoletaDirectaAsync(db, basculaC.Id, tipoMovimiento.Id);
        }

        var tokenOperador = await LoginTokenAsync("operador", "Operador123!");
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenOperador);
        var idsOperador = await IdsBoletasVisiblesAsync();
        Assert.Contains(boletaA, idsOperador);
        Assert.DoesNotContain(boletaB, idsOperador);
        Assert.DoesNotContain(boletaC, idsOperador);

        var tokenSupervisor = await LoginTokenAsync("supervisor", "Supervisor123!");
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenSupervisor);
        var idsSupervisor = await IdsBoletasVisiblesAsync();
        Assert.Contains(boletaA, idsSupervisor);
        Assert.Contains(boletaB, idsSupervisor);
        Assert.DoesNotContain(boletaC, idsSupervisor);

        var tokenAdmin = await LoginTokenAsync("administrador", "Administrador123!");
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenAdmin);
        var idsAdmin = await IdsBoletasVisiblesAsync();
        Assert.Contains(boletaA, idsAdmin);
        Assert.Contains(boletaB, idsAdmin);
        Assert.Contains(boletaC, idsAdmin);
    }

    private static async Task<Guid> CrearBoletaDirectaAsync(SmsDbContext db, Guid basculaId, Guid tipoMovimientoId)
    {
        var boleta = new Boleta
        {
            Id = Guid.NewGuid(),
            NumeroBoleta = $"N-{TestData.Sufijo()}",
            BasculaId = basculaId,
            TipoMovimientoId = tipoMovimientoId,
            Estado = EstadoBoleta.EnTransito,
            EstadoSync = EstadoSyncBoleta.SincronizadoCentral,
            PesoIngreso = 1000m,
            OrigenPesoIngreso = OrigenPeso.Bascula,
            FechaHoraIngreso = DateTime.UtcNow,
            UsuarioIngreso = "tester",
        };
        db.Boletas.Add(boleta);
        await db.SaveChangesAsync();
        return boleta.Id;
    }

    private async Task<HashSet<Guid>> IdsBoletasVisiblesAsync()
    {
        var boletas = await _client.GetFromJsonAsync<List<BoletaDto>>("/api/boletas", TestData.Json);
        return boletas!.Select(b => b.Id).ToHashSet();
    }
}
