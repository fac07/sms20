using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SmsBackend.Data.Migrations
{
    /// <inheritdoc />
    public partial class RediseñarDetalleFrutaYCalidadLuz : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_BoletaDetalleFruta_BoletaId",
                table: "BoletaDetalleFruta");

            migrationBuilder.DropColumn(
                name: "Hectareas",
                table: "BoletaDetalleFruta");

            migrationBuilder.DropColumn(
                name: "Jornales",
                table: "BoletaDetalleFruta");

            migrationBuilder.DropColumn(
                name: "Sacos",
                table: "BoletaDetalleFruta");

            migrationBuilder.AddColumn<decimal>(
                name: "Luz",
                table: "BoletaCalidad",
                type: "decimal(8,2)",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_BoletaDetalleFruta_BoletaId",
                table: "BoletaDetalleFruta",
                column: "BoletaId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_BoletaDetalleFruta_BoletaId",
                table: "BoletaDetalleFruta");

            migrationBuilder.DropColumn(
                name: "Luz",
                table: "BoletaCalidad");

            migrationBuilder.AddColumn<decimal>(
                name: "Hectareas",
                table: "BoletaDetalleFruta",
                type: "decimal(10,2)",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "Jornales",
                table: "BoletaDetalleFruta",
                type: "decimal(10,2)",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "Sacos",
                table: "BoletaDetalleFruta",
                type: "decimal(10,2)",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.CreateIndex(
                name: "IX_BoletaDetalleFruta_BoletaId",
                table: "BoletaDetalleFruta",
                column: "BoletaId");
        }
    }
}
