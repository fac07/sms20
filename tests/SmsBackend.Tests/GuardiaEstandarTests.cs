using Microsoft.AspNetCore.Http;
using SmsBackend.Domain.Configuracion;
using Xunit;

namespace SmsBackend.Tests;

/// <summary>
/// <see cref="GuardiaEstandar"/> — llamadas estáticas directas, sin base de
/// datos. Cubre el candado de secciones/campos estándar (design D8,
/// LOCKED constraint 2): rechaza renombrar clave, desactivar, borrar y aflojar
/// <c>Requerido</c> reservado; permite agregar campos no reservados y reordenar.
/// </summary>
public sealed class GuardiaEstandarTests
{
    private static Seccion SeccionEstandarCalidad() => new()
    {
        Id = Guid.NewGuid(),
        Clave = "calidad",
        Nombre = "Calidad",
        Cardinalidad = Cardinalidad.Unica,
        Estandar = true,
        Activa = true,
    };

    private static void EsBloqueo409(IResult? resultado)
    {
        Assert.NotNull(resultado);
        var conCodigo = Assert.IsAssignableFrom<IStatusCodeHttpResult>(resultado);
        Assert.Equal(StatusCodes.Status409Conflict, conCodigo.StatusCode);
    }

    [Fact]
    public void Rechaza_renombrar_la_clave_de_una_seccion_estandar()
    {
        var seccion = SeccionEstandarCalidad();

        var resultado = GuardiaEstandar.ParaActualizarSeccion(seccion, "calidad2", nuevaActiva: true);

        EsBloqueo409(resultado);
    }

    [Fact]
    public void Rechaza_desactivar_una_seccion_estandar()
    {
        var seccion = SeccionEstandarCalidad();

        var resultado = GuardiaEstandar.ParaActualizarSeccion(seccion, "calidad", nuevaActiva: false);

        EsBloqueo409(resultado);
    }

    [Fact]
    public void Rechaza_eliminar_una_seccion_estandar()
    {
        var resultado = GuardiaEstandar.ParaEliminarSeccion(SeccionEstandarCalidad());

        EsBloqueo409(resultado);
    }

    [Fact]
    public void Rechaza_aflojar_requerido_en_un_campo_reservado()
    {
        var seccion = SeccionEstandarCalidad();
        var campo = new Campo { Id = Guid.NewGuid(), SeccionId = seccion.Id, Clave = "acidez", Requerido = true };

        var resultado = GuardiaEstandar.ParaActualizarCampo(campo, seccion, nuevoRequerido: false);

        EsBloqueo409(resultado);
    }

    [Fact]
    public void Rechaza_versionar_o_borrar_un_campo_reservado()
    {
        var seccion = SeccionEstandarCalidad();
        var campo = new Campo { Id = Guid.NewGuid(), SeccionId = seccion.Id, Clave = "acidez", Requerido = true };

        EsBloqueo409(GuardiaEstandar.ParaNuevaVersionCampo(campo, seccion));
        EsBloqueo409(GuardiaEstandar.ParaEliminarCampo(campo, seccion));
    }

    [Fact]
    public void Permite_agregar_un_campo_no_reservado_a_una_seccion_estandar()
    {
        var seccion = SeccionEstandarCalidad();

        var resultado = GuardiaEstandar.ParaCrearCampo(seccion, "brix");

        Assert.Null(resultado);
    }

    [Fact]
    public void Permite_reordenar_y_reetiquetar_un_campo_reservado()
    {
        var seccion = SeccionEstandarCalidad();
        var campo = new Campo { Id = Guid.NewGuid(), SeccionId = seccion.Id, Clave = "acidez", Requerido = true };

        // Reordenar / reetiquetar no toca Requerido → sin bloqueo.
        var resultado = GuardiaEstandar.ParaActualizarCampo(campo, seccion, nuevoRequerido: true);

        Assert.Null(resultado);
    }

    [Fact]
    public void No_bloquea_nada_en_una_seccion_no_estandar()
    {
        var seccion = new Seccion
        {
            Id = Guid.NewGuid(),
            Clave = "mi_seccion",
            Nombre = "Mi sección",
            Cardinalidad = Cardinalidad.Unica,
            Estandar = false,
            Activa = true,
        };
        var campo = new Campo { Id = Guid.NewGuid(), SeccionId = seccion.Id, Clave = "acidez", Requerido = true };

        Assert.Null(GuardiaEstandar.ParaActualizarSeccion(seccion, "otra_clave", nuevaActiva: false));
        Assert.Null(GuardiaEstandar.ParaEliminarSeccion(seccion));
        Assert.Null(GuardiaEstandar.ParaActualizarCampo(campo, seccion, nuevoRequerido: false));
        Assert.Null(GuardiaEstandar.ParaEliminarCampo(campo, seccion));
    }
}
