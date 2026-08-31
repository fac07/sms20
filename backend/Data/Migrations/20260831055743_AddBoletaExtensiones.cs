using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SmsBackend.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddBoletaExtensiones : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "BoletaCalidad",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    BoletaId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Acidez = table.Column<decimal>(type: "decimal(8,2)", nullable: true),
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
                    Clave = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    Valor = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    TipoDato = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false)
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
                    PedunculoLargo = table.Column<int>(type: "int", nullable: false),
                    Sacos = table.Column<decimal>(type: "decimal(10,2)", nullable: false),
                    Jornales = table.Column<decimal>(type: "decimal(10,2)", nullable: false),
                    Hectareas = table.Column<decimal>(type: "decimal(10,2)", nullable: false)
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
                column: "BoletaId");
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
        }
    }
}
