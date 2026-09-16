using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using SmsBackend.Domain.Seguridad;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// Puerto de alcance de Centro (design D6): <see cref="ICentroContext"/> lee
/// los claims <c>sms20/centro</c>/<c>sms20/centro-alcance</c> ya
/// materializados por <see cref="Seguridad.MockAuthenticationHandler"/> (PR1),
/// sin host HTTP — mismo criterio que <see cref="PoliticasTests"/>: se arma un
/// <see cref="ClaimsPrincipal"/> a mano vía <see cref="IHttpContextAccessor"/>.
/// El contrato de <see cref="ICentroContext.Autorizar"/> es el mismo que un
/// Guard: <c>null</c> = seguir, no-<c>null</c> = el <see cref="IResult"/> a
/// devolver (siempre 403 acá — el 401 anónimo ya lo resuelve el pipeline de
/// autenticación antes de llegar a este chequeo).
/// </summary>
[Trait("Category", "Seguridad")]
public sealed class CentroContextTests
{
    private static ICentroContext Crear(Rol rol, params Guid[] centrosAsignados)
    {
        var claims = new List<Claim> { new(ClaimsSms20.Rol, rol.ToString()) };

        if (rol == Rol.Administrador)
        {
            claims.Add(new Claim(ClaimsSms20.CentroAlcance, ClaimsSms20.AlcanceGlobal));
        }
        else
        {
            claims.Add(new Claim(ClaimsSms20.CentroAlcance, ClaimsSms20.AlcanceAsignado));
            foreach (var centroId in centrosAsignados)
            {
                claims.Add(new Claim(ClaimsSms20.Centro, centroId.ToString()));
            }
        }

        var httpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test")),
        };
        var accessor = new HttpContextAccessor { HttpContext = httpContext };

        return new CentroContext(accessor);
    }

    [Fact]
    public void Autorizar_centro_propio_del_Operador_es_null()
    {
        var centroPropio = Guid.NewGuid();
        var ctx = Crear(Rol.Operador, centroPropio);

        var resultado = ctx.Autorizar(centroPropio);

        Assert.Null(resultado);
    }

    [Fact]
    public async Task Autorizar_centro_ajeno_del_Operador_devuelve_403()
    {
        var centroPropio = Guid.NewGuid();
        var centroAjeno = Guid.NewGuid();
        var ctx = Crear(Rol.Operador, centroPropio);

        var resultado = ctx.Autorizar(centroAjeno);

        Assert.NotNull(resultado);
        // Results.StatusCode resuelve un ILogger vía HttpContext.RequestServices
        // al ejecutarse — sin un contenedor real ahí tira ArgumentNullException,
        // no relacionado con lo que este test verifica.
        var servicios = new ServiceCollection().AddLogging().BuildServiceProvider();
        var httpContext = new DefaultHttpContext { RequestServices = servicios };
        await resultado!.ExecuteAsync(httpContext);
        Assert.Equal(StatusCodes.Status403Forbidden, httpContext.Response.StatusCode);
    }

    [Fact]
    public void Autorizar_Supervisor_pasa_para_CUALQUIERA_de_sus_N_Centros()
    {
        // Triangulación: Permitidos es una colección, no un único valor — si
        // Autorizar comparara solo contra Permitidos.First(), el segundo
        // Centro fallaría acá.
        var centroA = Guid.NewGuid();
        var centroB = Guid.NewGuid();
        var ctx = Crear(Rol.Supervisor, centroA, centroB);

        Assert.Null(ctx.Autorizar(centroA));
        Assert.Null(ctx.Autorizar(centroB));
    }

    [Fact]
    public void Autorizar_Administrador_global_pasa_para_cualquier_Centro_sin_estar_asignado()
    {
        // Triangulación: alcance global no tiene NINGÚN claim sms20/centro
        // (design D2) — si Autorizar dependiera de Permitidos.Contains sin
        // chequear EsGlobal primero, esto fallaría siempre para Admin.
        var ctx = Crear(Rol.Administrador);

        var resultado = ctx.Autorizar(Guid.NewGuid());

        Assert.Null(resultado);
    }
}
