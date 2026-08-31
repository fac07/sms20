using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SmsBackend.Data.Migrations
{
    /// <inheritdoc />
    public partial class RediseñarBoletaCaracteristica : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Clave",
                table: "BoletaCaracteristica");

            migrationBuilder.DropColumn(
                name: "TipoDato",
                table: "BoletaCaracteristica");

            migrationBuilder.DropColumn(
                name: "Valor",
                table: "BoletaCaracteristica");

            migrationBuilder.AddColumn<decimal>(
                name: "Cantidad",
                table: "BoletaCaracteristica",
                type: "decimal(10,2)",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<Guid>(
                name: "CaracteristicaId",
                table: "BoletaCaracteristica",
                type: "uniqueidentifier",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.CreateIndex(
                name: "IX_BoletaCaracteristica_CaracteristicaId",
                table: "BoletaCaracteristica",
                column: "CaracteristicaId");

            migrationBuilder.AddForeignKey(
                name: "FK_BoletaCaracteristica_Maestro_CaracteristicaId",
                table: "BoletaCaracteristica",
                column: "CaracteristicaId",
                principalTable: "Maestro",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_BoletaCaracteristica_Maestro_CaracteristicaId",
                table: "BoletaCaracteristica");

            migrationBuilder.DropIndex(
                name: "IX_BoletaCaracteristica_CaracteristicaId",
                table: "BoletaCaracteristica");

            migrationBuilder.DropColumn(
                name: "Cantidad",
                table: "BoletaCaracteristica");

            migrationBuilder.DropColumn(
                name: "CaracteristicaId",
                table: "BoletaCaracteristica");

            migrationBuilder.AddColumn<string>(
                name: "Clave",
                table: "BoletaCaracteristica",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "TipoDato",
                table: "BoletaCaracteristica",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Valor",
                table: "BoletaCaracteristica",
                type: "nvarchar(500)",
                maxLength: 500,
                nullable: false,
                defaultValue: "");
        }
    }
}
