using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SmsBackend.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddPrefijoToTipoMovimiento : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Prefijo",
                table: "TipoMovimiento",
                type: "nvarchar(10)",
                maxLength: 10,
                nullable: false,
                defaultValue: "");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Prefijo",
                table: "TipoMovimiento");
        }
    }
}
