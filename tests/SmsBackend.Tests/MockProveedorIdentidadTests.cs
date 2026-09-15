using System.Security.Claims;
using Microsoft.Extensions.DependencyInjection;
using SmsBackend.Data;
using SmsBackend.Domain.Seguridad;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Puerto/adapter mock de identidad (design D1/D3, spec "Mock Identity Behind
/// Replaceable Port"): valida que <see cref="MockProveedorIdentidad"/> emite
/// sesión solo para credenciales que coinciden EXACTAMENTE contra el usuario
/// sembrado por <see cref="SmsBackend.Data.Seeding.SeguridadSeeder"/>, y
/// rechaza cualquier otra combinación sin distinguir "usuario no existe" de
/// "clave incorrecta" (ambos casos deben verse igual desde afuera).
/// </summary>
[Collection(ApiCollection.Name)]
[Trait("Category", "Seguridad")]
public sealed class MockProveedorIdentidadTests : IAsyncLifetime
{
    private readonly ApiFactory _factory;

    public MockProveedorIdentidadTests(ApiFactory factory)
    {
        _factory = factory;
    }

    public Task InitializeAsync() => _factory.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private IProveedorIdentidad CrearProveedor(SmsDbContext db) => new MockProveedorIdentidad(db);

    [Fact]
    public async Task Autenticar_Valid_Invalid()
    {
        using var scope = _factory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SmsDbContext>();
        var proveedor = CrearProveedor(db);

        var valido = await proveedor.AutenticarAsync("operador", "Operador123!", CancellationToken.None);
        Assert.NotNull(valido);
        Assert.NotEmpty(valido!.Token);
        Assert.Equal(Rol.Operador, valido.Rol);

        var claveIncorrecta = await proveedor.AutenticarAsync("operador", "clave-incorrecta", CancellationToken.None);
        Assert.Null(claveIncorrecta);

        var usuarioInexistente = await proveedor.AutenticarAsync("no-existe", "cualquiera", CancellationToken.None);
        Assert.Null(usuarioInexistente);
    }

    [Fact]
    public async Task ResolverPrincipalAsync_MaterializesClaims()
    {
        // Operador: exactamente un claim sms20/centro, alcance "asignado".
        using (var scope = _factory.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<SmsDbContext>();
            var proveedor = CrearProveedor(db);
            var login = await proveedor.AutenticarAsync("operador", "Operador123!", CancellationToken.None);
            Assert.NotNull(login);

            var principal = await proveedor.ResolverPrincipalAsync(login!.Token, CancellationToken.None);
            Assert.NotNull(principal);

            Assert.Equal("operador", principal!.FindFirstValue(ClaimTypes.NameIdentifier));
            Assert.Equal(login.UsuarioId.ToString(), principal.FindFirstValue(ClaimsSms20.UsuarioId));
            Assert.Equal("Operador", principal.FindFirstValue(ClaimsSms20.Rol));
            Assert.Equal(ClaimsSms20.AlcanceAsignado, principal.FindFirstValue(ClaimsSms20.CentroAlcance));
            Assert.Single(principal.FindAll(ClaimsSms20.Centro));
        }

        // Triangulación — Supervisor: DOS claims sms20/centro (uno por Centro
        // asignado), no uno. Si la implementación estuviera "hardcodeada" a
        // un solo claim, esta aserción la rompe.
        using (var scope = _factory.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<SmsDbContext>();
            var proveedor = CrearProveedor(db);
            var login = await proveedor.AutenticarAsync("supervisor", "Supervisor123!", CancellationToken.None);
            Assert.NotNull(login);

            var principal = await proveedor.ResolverPrincipalAsync(login!.Token, CancellationToken.None);
            Assert.NotNull(principal);

            Assert.Equal("Supervisor", principal!.FindFirstValue(ClaimsSms20.Rol));
            Assert.Equal(ClaimsSms20.AlcanceAsignado, principal.FindFirstValue(ClaimsSms20.CentroAlcance));
            Assert.Equal(2, principal.FindAll(ClaimsSms20.Centro).Count());
        }

        // Triangulación — Administrador: CERO claims sms20/centro, alcance "global".
        using (var scope = _factory.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<SmsDbContext>();
            var proveedor = CrearProveedor(db);
            var login = await proveedor.AutenticarAsync("administrador", "Administrador123!", CancellationToken.None);
            Assert.NotNull(login);

            var principal = await proveedor.ResolverPrincipalAsync(login!.Token, CancellationToken.None);
            Assert.NotNull(principal);

            Assert.Equal("Administrador", principal!.FindFirstValue(ClaimsSms20.Rol));
            Assert.Equal(ClaimsSms20.AlcanceGlobal, principal.FindFirstValue(ClaimsSms20.CentroAlcance));
            Assert.Empty(principal.FindAll(ClaimsSms20.Centro));
        }
    }

    [Fact]
    public async Task ResolverPrincipalAsync_token_invalido_o_expirado_es_null()
    {
        using var scope = _factory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SmsDbContext>();
        var proveedor = CrearProveedor(db);

        var principal = await proveedor.ResolverPrincipalAsync("token-que-no-existe", CancellationToken.None);

        Assert.Null(principal);
    }

    [Fact]
    public async Task Autenticar_genera_tokens_distintos_por_login()
    {
        // Triangulación: dos logins válidos consecutivos no pueden compartir
        // token — si el mock devolviera un valor fijo (Fake It), esta
        // aserción lo expondría.
        using var scope = _factory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SmsDbContext>();
        var proveedor = CrearProveedor(db);

        var primero = await proveedor.AutenticarAsync("administrador", "Administrador123!", CancellationToken.None);
        var segundo = await proveedor.AutenticarAsync("administrador", "Administrador123!", CancellationToken.None);

        Assert.NotNull(primero);
        Assert.NotNull(segundo);
        Assert.NotEqual(primero!.Token, segundo!.Token);
        Assert.Equal(Rol.Administrador, primero.Rol);
    }
}
