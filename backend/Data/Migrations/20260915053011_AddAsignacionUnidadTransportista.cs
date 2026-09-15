using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SmsBackend.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddAsignacionUnidadTransportista : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AsignacionUnidadTransportista",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UnidadId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TransportistaId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    VigenteDesde = table.Column<DateTime>(type: "datetime2", nullable: false),
                    VigenteHasta = table.Column<DateTime>(type: "datetime2", nullable: true),
                    UsuarioAsigna = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: false),
                    MotivoCambio = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AsignacionUnidadTransportista", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AsignacionUnidadTransportista_UnidadId",
                table: "AsignacionUnidadTransportista",
                column: "UnidadId",
                unique: true,
                filter: "[VigenteHasta] IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_AsignacionUnidadTransportista_UnidadId_VigenteDesde",
                table: "AsignacionUnidadTransportista",
                columns: new[] { "UnidadId", "VigenteDesde" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AsignacionUnidadTransportista");
        }
    }
}
