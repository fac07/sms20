using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SmsBackend.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddIngresoManualPeso : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "MotivoPesoManual",
                table: "Boleta",
                type: "nvarchar(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "MotivoPesoManualDetalle",
                table: "Boleta",
                type: "nvarchar(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "PermiteIngresoManual",
                table: "Bascula",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<decimal>(
                name: "PesoMaximoManual",
                table: "Bascula",
                type: "decimal(12,2)",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "PesoMinimoManual",
                table: "Bascula",
                type: "decimal(12,2)",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "MotivoPesoManual",
                table: "Boleta");

            migrationBuilder.DropColumn(
                name: "MotivoPesoManualDetalle",
                table: "Boleta");

            migrationBuilder.DropColumn(
                name: "PermiteIngresoManual",
                table: "Bascula");

            migrationBuilder.DropColumn(
                name: "PesoMaximoManual",
                table: "Bascula");

            migrationBuilder.DropColumn(
                name: "PesoMinimoManual",
                table: "Bascula");
        }
    }
}
