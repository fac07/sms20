using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SmsBackend.Data.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Maestro",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TipoCatalogo = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    Codigo = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false),
                    Nombre = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: false),
                    DatosAdicionales = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Estado = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    FusionadoConId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    FechaModificacion = table.Column<DateTime>(type: "datetime2", nullable: false),
                    Activo = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Maestro", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Maestro_Maestro_FusionadoConId",
                        column: x => x.FusionadoConId,
                        principalTable: "Maestro",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Seccion",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Clave = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    Nombre = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    Cardinalidad = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    Reportable = table.Column<bool>(type: "bit", nullable: false),
                    Estandar = table.Column<bool>(type: "bit", nullable: false),
                    Orden = table.Column<int>(type: "int", nullable: false),
                    Activa = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Seccion", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "TipoMovimiento",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Codigo = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    Nombre = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    Prefijo = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    Direccion = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    HabilitaCalidad = table.Column<bool>(type: "bit", nullable: false),
                    HabilitaMarchamos = table.Column<bool>(type: "bit", nullable: false),
                    HabilitaQR = table.Column<bool>(type: "bit", nullable: false),
                    HabilitaDatosFinca = table.Column<bool>(type: "bit", nullable: false),
                    HabilitaDetalleFruta = table.Column<bool>(type: "bit", nullable: false),
                    HabilitaCompostera = table.Column<bool>(type: "bit", nullable: false),
                    IntegracionD365 = table.Column<bool>(type: "bit", nullable: false),
                    FormatoBoletaId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    Activo = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TipoMovimiento", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Bascula",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Codigo = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    Nombre = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    CentroId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TipoConexion = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    Puerto = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    Ip = table.Column<string>(type: "nvarchar(45)", maxLength: 45, nullable: true),
                    PuertoTcp = table.Column<int>(type: "int", nullable: true),
                    Velocidad = table.Column<int>(type: "int", nullable: true),
                    BitsDatos = table.Column<int>(type: "int", nullable: true),
                    ModoComunicacion = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    Activa = table.Column<bool>(type: "bit", nullable: false),
                    CodigoAprovisionamiento = table.Column<string>(type: "nvarchar(12)", maxLength: 12, nullable: true),
                    CodigoAprovisionamientoExpira = table.Column<DateTime>(type: "datetime2", nullable: true),
                    Aprovisionada = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Bascula", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Bascula_Maestro_CentroId",
                        column: x => x.CentroId,
                        principalTable: "Maestro",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Campo",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    SeccionId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Clave = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    Etiqueta = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    TipoCampo = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    TipoCatalogoRef = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    Requerido = table.Column<bool>(type: "bit", nullable: false),
                    Configuracion = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Orden = table.Column<int>(type: "int", nullable: false),
                    VigenteDesde = table.Column<DateTime>(type: "datetime2", nullable: false),
                    VigenteHasta = table.Column<DateTime>(type: "datetime2", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Campo", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Campo_Seccion_SeccionId",
                        column: x => x.SeccionId,
                        principalTable: "Seccion",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "TipoMovimientoSeccion",
                columns: table => new
                {
                    TipoMovimientoId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    SeccionId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    VigenteDesde = table.Column<DateTime>(type: "datetime2", nullable: false),
                    VigenteHasta = table.Column<DateTime>(type: "datetime2", nullable: true),
                    Requerida = table.Column<bool>(type: "bit", nullable: false),
                    Orden = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TipoMovimientoSeccion", x => new { x.TipoMovimientoId, x.SeccionId, x.VigenteDesde });
                    table.ForeignKey(
                        name: "FK_TipoMovimientoSeccion_Seccion_SeccionId",
                        column: x => x.SeccionId,
                        principalTable: "Seccion",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_TipoMovimientoSeccion_TipoMovimiento_TipoMovimientoId",
                        column: x => x.TipoMovimientoId,
                        principalTable: "TipoMovimiento",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Boleta",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    NumeroBoleta = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false),
                    BasculaId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TipoMovimientoId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Estado = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    EstadoSync = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    EquipoId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TransportistaId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    PilotoId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TerceroId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ProductoId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    AlmacenOrigenId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    AlmacenDestinoId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    PesoIngreso = table.Column<decimal>(type: "decimal(12,2)", nullable: false),
                    PesoSalida = table.Column<decimal>(type: "decimal(12,2)", nullable: true),
                    PesoNeto = table.Column<decimal>(type: "decimal(12,2)", nullable: true),
                    OrigenPesoIngreso = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    OrigenPesoSalida = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    FechaHoraIngreso = table.Column<DateTime>(type: "datetime2", nullable: false),
                    FechaHoraSalida = table.Column<DateTime>(type: "datetime2", nullable: true),
                    UsuarioIngreso = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: false),
                    UsuarioSalida = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: true),
                    UsuarioAnula = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: true),
                    UsuarioAutoriza = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: true),
                    MotivoAnulacion = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    BoletaReemplazoId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    BoletaOrigenId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    BasculaSalidaId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    RespuestaD365Id = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    CreadaOffline = table.Column<bool>(type: "bit", nullable: false),
                    RowVersion = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Boleta", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Boleta_Bascula_BasculaId",
                        column: x => x.BasculaId,
                        principalTable: "Bascula",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Boleta_Bascula_BasculaSalidaId",
                        column: x => x.BasculaSalidaId,
                        principalTable: "Bascula",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Boleta_Boleta_BoletaOrigenId",
                        column: x => x.BoletaOrigenId,
                        principalTable: "Boleta",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Boleta_Boleta_BoletaReemplazoId",
                        column: x => x.BoletaReemplazoId,
                        principalTable: "Boleta",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Boleta_Maestro_AlmacenDestinoId",
                        column: x => x.AlmacenDestinoId,
                        principalTable: "Maestro",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Boleta_Maestro_AlmacenOrigenId",
                        column: x => x.AlmacenOrigenId,
                        principalTable: "Maestro",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Boleta_Maestro_EquipoId",
                        column: x => x.EquipoId,
                        principalTable: "Maestro",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Boleta_Maestro_PilotoId",
                        column: x => x.PilotoId,
                        principalTable: "Maestro",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Boleta_Maestro_ProductoId",
                        column: x => x.ProductoId,
                        principalTable: "Maestro",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Boleta_Maestro_TerceroId",
                        column: x => x.TerceroId,
                        principalTable: "Maestro",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Boleta_Maestro_TransportistaId",
                        column: x => x.TransportistaId,
                        principalTable: "Maestro",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Boleta_TipoMovimiento_TipoMovimientoId",
                        column: x => x.TipoMovimientoId,
                        principalTable: "TipoMovimiento",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "BoletaCalidad",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    BoletaId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Acidez = table.Column<decimal>(type: "decimal(8,2)", nullable: true),
                    Luz = table.Column<decimal>(type: "decimal(8,2)", nullable: true),
                    DOBI = table.Column<decimal>(type: "decimal(8,2)", nullable: true),
                    Humedad = table.Column<decimal>(type: "decimal(8,2)", nullable: true),
                    Temperatura = table.Column<decimal>(type: "decimal(8,2)", nullable: true),
                    NumeroRevisionQA = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BoletaCalidad", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BoletaCalidad_Boleta_BoletaId",
                        column: x => x.BoletaId,
                        principalTable: "Boleta",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "BoletaCaracteristica",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    BoletaId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CaracteristicaId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Cantidad = table.Column<decimal>(type: "decimal(10,2)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BoletaCaracteristica", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BoletaCaracteristica_Boleta_BoletaId",
                        column: x => x.BoletaId,
                        principalTable: "Boleta",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BoletaCaracteristica_Maestro_CaracteristicaId",
                        column: x => x.CaracteristicaId,
                        principalTable: "Maestro",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "BoletaCompostera",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    BoletaId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CUI = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    CamaId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    SeccionId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CicloId = table.Column<Guid>(type: "uniqueidentifier", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BoletaCompostera", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BoletaCompostera_Boleta_BoletaId",
                        column: x => x.BoletaId,
                        principalTable: "Boleta",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BoletaCompostera_Maestro_CamaId",
                        column: x => x.CamaId,
                        principalTable: "Maestro",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BoletaCompostera_Maestro_CicloId",
                        column: x => x.CicloId,
                        principalTable: "Maestro",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BoletaCompostera_Maestro_SeccionId",
                        column: x => x.SeccionId,
                        principalTable: "Maestro",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "BoletaDetalleFruta",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    BoletaId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    RacimosVerdes = table.Column<int>(type: "int", nullable: false),
                    RacimosMaduros = table.Column<int>(type: "int", nullable: false),
                    RacimosSobreMaduros = table.Column<int>(type: "int", nullable: false),
                    RacimosPasados = table.Column<int>(type: "int", nullable: false),
                    PedunculoLargo = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BoletaDetalleFruta", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BoletaDetalleFruta_Boleta_BoletaId",
                        column: x => x.BoletaId,
                        principalTable: "Boleta",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "BoletaValorCampo",
                columns: table => new
                {
                    BoletaId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CampoId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Ocurrencia = table.Column<int>(type: "int", nullable: false),
                    SeccionId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ValorTexto = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    ValorNumero = table.Column<decimal>(type: "decimal(18,4)", nullable: true),
                    ValorFecha = table.Column<DateTime>(type: "datetime2", nullable: true),
                    ValorBooleano = table.Column<bool>(type: "bit", nullable: true),
                    ValorMaestroId = table.Column<Guid>(type: "uniqueidentifier", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BoletaValorCampo", x => new { x.BoletaId, x.CampoId, x.Ocurrencia });
                    table.CheckConstraint("CK_BoletaValorCampo_UnSoloValor", "(CASE WHEN ValorTexto IS NULL THEN 0 ELSE 1 END + CASE WHEN ValorNumero IS NULL THEN 0 ELSE 1 END + CASE WHEN ValorFecha IS NULL THEN 0 ELSE 1 END + CASE WHEN ValorBooleano IS NULL THEN 0 ELSE 1 END + CASE WHEN ValorMaestroId IS NULL THEN 0 ELSE 1 END) = 1");
                    table.ForeignKey(
                        name: "FK_BoletaValorCampo_Boleta_BoletaId",
                        column: x => x.BoletaId,
                        principalTable: "Boleta",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_BoletaValorCampo_Campo_CampoId",
                        column: x => x.CampoId,
                        principalTable: "Campo",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BoletaValorCampo_Maestro_ValorMaestroId",
                        column: x => x.ValorMaestroId,
                        principalTable: "Maestro",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BoletaValorCampo_Seccion_SeccionId",
                        column: x => x.SeccionId,
                        principalTable: "Seccion",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Bascula_CentroId",
                table: "Bascula",
                column: "CentroId");

            migrationBuilder.CreateIndex(
                name: "IX_Bascula_Codigo",
                table: "Bascula",
                column: "Codigo",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Boleta_AlmacenDestinoId",
                table: "Boleta",
                column: "AlmacenDestinoId");

            migrationBuilder.CreateIndex(
                name: "IX_Boleta_AlmacenOrigenId",
                table: "Boleta",
                column: "AlmacenOrigenId");

            migrationBuilder.CreateIndex(
                name: "IX_Boleta_BasculaId",
                table: "Boleta",
                column: "BasculaId");

            migrationBuilder.CreateIndex(
                name: "IX_Boleta_BasculaSalidaId",
                table: "Boleta",
                column: "BasculaSalidaId");

            migrationBuilder.CreateIndex(
                name: "IX_Boleta_BoletaOrigenId",
                table: "Boleta",
                column: "BoletaOrigenId");

            migrationBuilder.CreateIndex(
                name: "IX_Boleta_BoletaReemplazoId",
                table: "Boleta",
                column: "BoletaReemplazoId");

            migrationBuilder.CreateIndex(
                name: "IX_Boleta_EquipoId",
                table: "Boleta",
                column: "EquipoId");

            migrationBuilder.CreateIndex(
                name: "IX_Boleta_NumeroBoleta",
                table: "Boleta",
                column: "NumeroBoleta",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Boleta_PilotoId",
                table: "Boleta",
                column: "PilotoId");

            migrationBuilder.CreateIndex(
                name: "IX_Boleta_ProductoId",
                table: "Boleta",
                column: "ProductoId");

            migrationBuilder.CreateIndex(
                name: "IX_Boleta_TerceroId",
                table: "Boleta",
                column: "TerceroId");

            migrationBuilder.CreateIndex(
                name: "IX_Boleta_TipoMovimientoId",
                table: "Boleta",
                column: "TipoMovimientoId");

            migrationBuilder.CreateIndex(
                name: "IX_Boleta_TransportistaId",
                table: "Boleta",
                column: "TransportistaId");

            migrationBuilder.CreateIndex(
                name: "IX_BoletaCalidad_BoletaId",
                table: "BoletaCalidad",
                column: "BoletaId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BoletaCaracteristica_BoletaId",
                table: "BoletaCaracteristica",
                column: "BoletaId");

            migrationBuilder.CreateIndex(
                name: "IX_BoletaCaracteristica_CaracteristicaId",
                table: "BoletaCaracteristica",
                column: "CaracteristicaId");

            migrationBuilder.CreateIndex(
                name: "IX_BoletaCompostera_BoletaId",
                table: "BoletaCompostera",
                column: "BoletaId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BoletaCompostera_CamaId",
                table: "BoletaCompostera",
                column: "CamaId");

            migrationBuilder.CreateIndex(
                name: "IX_BoletaCompostera_CicloId",
                table: "BoletaCompostera",
                column: "CicloId");

            migrationBuilder.CreateIndex(
                name: "IX_BoletaCompostera_SeccionId",
                table: "BoletaCompostera",
                column: "SeccionId");

            migrationBuilder.CreateIndex(
                name: "IX_BoletaDetalleFruta_BoletaId",
                table: "BoletaDetalleFruta",
                column: "BoletaId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BoletaValorCampo_BoletaId_SeccionId",
                table: "BoletaValorCampo",
                columns: new[] { "BoletaId", "SeccionId" });

            migrationBuilder.CreateIndex(
                name: "IX_BoletaValorCampo_CampoId_ValorNumero",
                table: "BoletaValorCampo",
                columns: new[] { "CampoId", "ValorNumero" });

            migrationBuilder.CreateIndex(
                name: "IX_BoletaValorCampo_SeccionId",
                table: "BoletaValorCampo",
                column: "SeccionId");

            migrationBuilder.CreateIndex(
                name: "IX_BoletaValorCampo_ValorMaestroId",
                table: "BoletaValorCampo",
                column: "ValorMaestroId");

            migrationBuilder.CreateIndex(
                name: "IX_Campo_SeccionId_Clave",
                table: "Campo",
                columns: new[] { "SeccionId", "Clave" },
                unique: true,
                filter: "[VigenteHasta] IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Campo_SeccionId_Orden",
                table: "Campo",
                columns: new[] { "SeccionId", "Orden" });

            migrationBuilder.CreateIndex(
                name: "IX_Maestro_FusionadoConId",
                table: "Maestro",
                column: "FusionadoConId");

            migrationBuilder.CreateIndex(
                name: "IX_Maestro_TipoCatalogo_Codigo",
                table: "Maestro",
                columns: new[] { "TipoCatalogo", "Codigo" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Seccion_Clave",
                table: "Seccion",
                column: "Clave",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_TipoMovimiento_Codigo",
                table: "TipoMovimiento",
                column: "Codigo",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_TipoMovimientoSeccion_SeccionId",
                table: "TipoMovimientoSeccion",
                column: "SeccionId");

            migrationBuilder.CreateIndex(
                name: "IX_TipoMovimientoSeccion_TipoMovimientoId_SeccionId",
                table: "TipoMovimientoSeccion",
                columns: new[] { "TipoMovimientoId", "SeccionId" },
                unique: true,
                filter: "[VigenteHasta] IS NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BoletaCalidad");

            migrationBuilder.DropTable(
                name: "BoletaCaracteristica");

            migrationBuilder.DropTable(
                name: "BoletaCompostera");

            migrationBuilder.DropTable(
                name: "BoletaDetalleFruta");

            migrationBuilder.DropTable(
                name: "BoletaValorCampo");

            migrationBuilder.DropTable(
                name: "TipoMovimientoSeccion");

            migrationBuilder.DropTable(
                name: "Boleta");

            migrationBuilder.DropTable(
                name: "Campo");

            migrationBuilder.DropTable(
                name: "Bascula");

            migrationBuilder.DropTable(
                name: "TipoMovimiento");

            migrationBuilder.DropTable(
                name: "Seccion");

            migrationBuilder.DropTable(
                name: "Maestro");
        }
    }
}
