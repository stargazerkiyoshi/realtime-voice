export type AsrPartial = {
  text: string;
  confidence?: number;
  startMs?: number;
  endMs?: number;
  isFinal?: boolean;
};

export type AsrFinal = AsrPartial & { isFinal: true };

export type AsrResult = AsrPartial | AsrFinal;

export interface AsrProvider {
  connect(): Promise<void>;
  close(): Promise<void>;
  feed(pcm16: Buffer): Promise<void>;
  stream(): AsyncGenerator<AsrResult>;
  isPlannedClose?(): boolean;
  planClose?(): void;
}
