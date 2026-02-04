export interface TtsProvider {
  stream(text: string, signal?: AbortSignal): AsyncGenerator<Buffer>;
  close(): Promise<void>;
}
