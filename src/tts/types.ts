export interface TtsProvider {
  stream(text: string, signal?: AbortSignal): AsyncGenerator<Buffer>;
  openStream?(signal?: AbortSignal): Promise<TtsStreamSession>;
  close(): Promise<void>;
}

export interface TtsStreamSession {
  send(text: string): Promise<void>;
  close(): Promise<void>;
  audio(): AsyncGenerator<Buffer>;
}
