namespace SmsBackend.Domain.Boletas;

/// <summary>
/// Marca de revisión sobre el par piloto+transportista capturado en la
/// sección "transporte" — null en el caso normal (par vinculado, o la sección
/// no está configurada/capturada). La fija ÚNICAMENTE la ingesta central de
/// sync (<c>POST /api/boletas/sync</c>, design D3) cuando el par declarado
/// offline no tiene un <see cref="Transporte.VinculoPilotoTransportista"/>
/// activo en central; la vía típada central (<c>POST /api/boletas</c>) rechaza
/// ese mismo caso con 400 en vez de marcar (design D2) — el marcador y el
/// rechazo son mutuamente excluyentes por superficie. Fijarla NUNCA cambia la
/// validez, los pesos ni el estado de la boleta — es puramente informativa,
/// igual que <see cref="MarcaPreIngreso"/>. Se persiste como string
/// (<c>nvarchar(30)</c>) vía <c>HasConversion</c>, el mismo precedente que
/// <see cref="MotivoPesoManual"/>/<see cref="MarcaPreIngreso"/>.
/// </summary>
public enum MarcaVinculoTransporte
{
    /// <summary>
    /// El par piloto+transportista declarado offline no tiene un vínculo
    /// activo en central al momento de la ingesta (p.ej. un caché local de
    /// vínculos desactualizado). La boleta se persiste tal cual fue pesada —
    /// la ingesta de sync NUNCA rechaza un evento por esto, porque un 4xx acá
    /// rompe la secuencia entera del outbox del terminal (design D3,
    /// evidencia outbox-dispatcher.ts).
    /// </summary>
    VinculoInvalido,
}
