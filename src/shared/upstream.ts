/** A data source we depend on (SEPA, Open-Meteo) failed: the API answers 502 with a plain message, not a generic 500. */
export class UpstreamError extends Error {
  constructor(
    readonly source: 'SEPA' | 'Open-Meteo',
    message: string,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}
