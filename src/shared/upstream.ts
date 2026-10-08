/** A data source we depend on (SEPA, Open-Meteo) failed: the API answers 502 with a plain message, not a generic 500. */
export class UpstreamError extends Error {
  // A plain field, not a constructor parameter property: the data scripts run under Node's type stripping.
  readonly source: 'SEPA' | 'Open-Meteo';
  constructor(source: 'SEPA' | 'Open-Meteo', message: string) {
    super(message);
    this.name = 'UpstreamError';
    this.source = source;
  }
}
