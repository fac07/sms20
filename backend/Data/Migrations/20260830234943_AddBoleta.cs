using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SmsBackend.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddBoleta : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
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
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Boleta");
        }
    }
}
