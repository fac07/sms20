using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SmsBackend.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddBascula : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Bascula",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Codigo = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    Nombre = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    CentroId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TipoConexion = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    Puerto = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    Ip = table.Column<string>(type: "nvarchar(45)", maxLength: 45, nullable: true),
                    PuertoTcp = table.Column<int>(type: "int", nullable: true),
                    Velocidad = table.Column<int>(type: "int", nullable: true),
                    BitsDatos = table.Column<int>(type: "int", nullable: true),
                    ModoComunicacion = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    Activa = table.Column<bool>(type: "bit", nullable: false),
                    CodigoAprovisionamiento = table.Column<string>(type: "nvarchar(12)", maxLength: 12, nullable: true),
                    CodigoAprovisionamientoExpira = table.Column<DateTime>(type: "datetime2", nullable: true),
                    Aprovisionada = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Bascula", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Bascula_Maestro_CentroId",
                        column: x => x.CentroId,
                        principalTable: "Maestro",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Bascula_CentroId",
                table: "Bascula",
                column: "CentroId");

            migrationBuilder.CreateIndex(
                name: "IX_Bascula_Codigo",
                table: "Bascula",
                column: "Codigo",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Bascula");
        }
    }
}
