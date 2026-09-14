using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SmsBackend.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddVinculoPilotoTransportista : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "VinculoPilotoTransportista",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    PilotoId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TransportistaId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Activo = table.Column<bool>(type: "bit", nullable: false),
                    UsuarioCreacion = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: false),
                    FechaCreacion = table.Column<DateTime>(type: "datetime2", nullable: false),
                    FechaModificacion = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VinculoPilotoTransportista", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_VinculoPilotoTransportista_FechaModificacion",
                table: "VinculoPilotoTransportista",
                column: "FechaModificacion");

            migrationBuilder.CreateIndex(
                name: "IX_VinculoPilotoTransportista_PilotoId_TransportistaId",
                table: "VinculoPilotoTransportista",
                columns: new[] { "PilotoId", "TransportistaId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_VinculoPilotoTransportista_TransportistaId_Activo",
                table: "VinculoPilotoTransportista",
                columns: new[] { "TransportistaId", "Activo" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "VinculoPilotoTransportista");
        }
    }
}
