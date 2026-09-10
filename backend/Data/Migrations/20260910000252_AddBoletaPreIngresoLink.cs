using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SmsBackend.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddBoletaPreIngresoLink : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "MarcaPreIngreso",
                table: "Boleta",
                type: "nvarchar(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Boleta_PreIngresoId",
                table: "Boleta",
                column: "PreIngresoId",
                unique: true,
                filter: "[PreIngresoId] IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Boleta_PreIngresoId",
                table: "Boleta");

            migrationBuilder.DropColumn(
                name: "MarcaPreIngreso",
                table: "Boleta");
        }
    }
}
