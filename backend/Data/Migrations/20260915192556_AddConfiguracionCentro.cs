using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SmsBackend.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddConfiguracionCentro : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ConfiguracionCentro",
                columns: table => new
                {
                    CentroId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    SitioOrigenDefaultId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    SitioDestinoDefaultId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    AlmacenOrigenDefaultId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    AlmacenDestinoDefaultId = table.Column<Guid>(type: "uniqueidentifier", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ConfiguracionCentro", x => x.CentroId);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ConfiguracionCentro");
        }
    }
}
