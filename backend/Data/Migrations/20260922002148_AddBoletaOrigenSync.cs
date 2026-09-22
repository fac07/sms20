using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SmsBackend.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddBoletaOrigenSync : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Boleta_Boleta_BoletaOrigenId",
                table: "Boleta");

            migrationBuilder.AddColumn<string>(
                name: "MarcaBoletaOrigen",
                table: "Boleta",
                type: "nvarchar(30)",
                maxLength: 30,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "MarcaBoletaOrigen",
                table: "Boleta");

            migrationBuilder.AddForeignKey(
                name: "FK_Boleta_Boleta_BoletaOrigenId",
                table: "Boleta",
                column: "BoletaOrigenId",
                principalTable: "Boleta",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }
    }
}
