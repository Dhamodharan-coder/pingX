export interface PingXOptions {
  apiKey: string;
  baseUrl: string;
}

export class PingX {
  constructor(readonly options: PingXOptions) {}
}
