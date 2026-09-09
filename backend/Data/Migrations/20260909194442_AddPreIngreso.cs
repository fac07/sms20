using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SmsBackend.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddPreIngreso : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PreIngreso",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CentroId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    PilotoId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    TransportistaId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    EquipoId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    RegionId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    FincaId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    NumeroEnvio = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    PesoEnviado = table.Column<decimal>(type: "decimal(12,2)", nullable: false),
                    Racimos = table.Column<int>(type: "int", nullable: true),
                    Sacos = table.Column<int>(type: "int", nullable: true),
                    Estado = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    BoletaId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    UsuarioCreacion = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: false),
                    UsuarioCancela = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: true),
                    MotivoCancelacion = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    FechaCreacion = table.Column<DateTime>(type: "datetime2", nullable: false),
                    FechaModificacion = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PreIngreso", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PreIngreso_Boleta_BoletaId",
                        column: x => x.BoletaId,
                        principalTable: "Boleta",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PreIngreso_BoletaId",
                table: "PreIngreso",
                column: "BoletaId");

            migrationBuilder.CreateIndex(
                name: "IX_PreIngreso_CentroId_Estado",
                table: "PreIngreso",
                columns: new[] { "CentroId", "Estado" });

            migrationBuilder.CreateIndex(
                name: "IX_PreIngreso_FechaModificacion",
                table: "PreIngreso",
                column: "FechaModificacion");

            migrationBuilder.CreateIndex(
                name: "IX_PreIngreso_NumeroEnvio",
                table: "PreIngreso",
                column: "NumeroEnvio");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PreIngreso");
        }
    }
}
