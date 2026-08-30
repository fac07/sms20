using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SmsBackend.Data.Migrations
{
    /// <inheritdoc />
    public partial class InitialTiposMovimiento : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "TipoMovimiento",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Codigo = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    Nombre = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
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

            migrationBuilder.CreateIndex(
                name: "IX_TipoMovimiento_Codigo",
                table: "TipoMovimiento",
                column: "Codigo",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TipoMovimiento");
        }
    }
}
