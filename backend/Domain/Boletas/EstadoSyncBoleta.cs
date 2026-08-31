namespace SmsBackend.Domain.Boletas;

public enum EstadoSyncBoleta
{
    Local,
    SincronizadoCentral,
    ErrorCentral,
    SincronizadoD365,
    ErrorD365,
}
