using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SmsBackend.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddBoletaReimpresion : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "CantidadReimpresiones",
                table: "Boleta",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTime>(
                name: "UltimaReimpresionFecha",
                table: "Boleta",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "UltimaReimpresionUsuario",
                table: "Boleta",
                type: "nvarchar(max)",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CantidadReimpresiones",
                table: "Boleta");

            migrationBuilder.DropColumn(
                name: "UltimaReimpresionFecha",
                table: "Boleta");

            migrationBuilder.DropColumn(
                name: "UltimaReimpresionUsuario",
                table: "Boleta");
        }
    }
}
