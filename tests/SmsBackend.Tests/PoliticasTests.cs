using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.DependencyInjection;
using SmsBackend.Domain.Seguridad;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Tres políticas de rol jerárquico (design D4): Administrador ⊇ Supervisor ⊇
/// Operador. Registra las tres políticas reales contra un
/// <see cref="IAuthorizationService"/> mínimo (sin host HTTP — nada de esto
/// depende de un endpoint todavía, ver Program.cs 0.10) y verifica la
/// jerarquía completa, no solo los dos extremos.
/// </summary>
[Trait("Category", "Seguridad")]
public sealed class PoliticasTests
{
    private static IAuthorizationService BuildAuthorizationService()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddAuthorizationBuilder()
            .AddPolicy(Politicas.Operador, p => p.RequireAssertion(ctx => Politicas.CumpleRolMinimo(ctx, Rol.Operador)))
            .AddPolicy(Politicas.Supervisor, p => p.RequireAssertion(ctx => Politicas.CumpleRolMinimo(ctx, Rol.Supervisor)))
            .AddPolicy(Politicas.Administrador, p => p.RequireAssertion(ctx => Politicas.CumpleRolMinimo(ctx, Rol.Administrador)));

        return services.BuildServiceProvider().GetRequiredService<IAuthorizationService>();
    }

    private static ClaimsPrincipal PrincipalConRol(Rol rol)
    {
        var identity = new ClaimsIdentity(new[] { new Claim(ClaimsSms20.Rol, rol.ToString()) }, "test");
        return new ClaimsPrincipal(identity);
    }

    [Fact]
    public async Task Operador_es_denegado_por_la_politica_Administrador()
    {
        var authz = BuildAuthorizationService();
        var operador = PrincipalConRol(Rol.Operador);

        var resultado = await authz.AuthorizeAsync(operador, Politicas.Administrador);

        Assert.False(resultado.Succeeded);
    }

    [Fact]
    public async Task Administrador_pasa_las_tres_politicas()
    {
        var authz = BuildAuthorizationService();
        var administrador = PrincipalConRol(Rol.Administrador);

        Assert.True((await authz.AuthorizeAsync(administrador, Politicas.Operador)).Succeeded);
        Assert.True((await authz.AuthorizeAsync(administrador, Politicas.Supervisor)).Succeeded);
        Assert.True((await authz.AuthorizeAsync(administrador, Politicas.Administrador)).Succeeded);
    }

    [Fact]
    public async Task Supervisor_pasa_Operador_y_Supervisor_pero_no_Administrador()
    {
        // Triangulación: rol intermedio — si la jerarquía estuviera mal
        // implementada como una lista de igualdad exacta en vez de rango,
        // Supervisor fallaría contra la política Operador.
        var authz = BuildAuthorizationService();
        var supervisor = PrincipalConRol(Rol.Supervisor);

        Assert.True((await authz.AuthorizeAsync(supervisor, Politicas.Operador)).Succeeded);
        Assert.True((await authz.AuthorizeAsync(supervisor, Politicas.Supervisor)).Succeeded);
        Assert.False((await authz.AuthorizeAsync(supervisor, Politicas.Administrador)).Succeeded);
    }

    [Fact]
    public async Task Sin_claim_de_rol_es_denegado_por_cualquier_politica()
    {
        var authz = BuildAuthorizationService();
        var anonimo = new ClaimsPrincipal(new ClaimsIdentity());

        var resultado = await authz.AuthorizeAsync(anonimo, Politicas.Operador);

        Assert.False(resultado.Succeeded);
    }
}
