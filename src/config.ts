export type Config = {
  // Volc ASR v3 sauc/bigmodel_* headers
  volcAppKey?: string;
  volcAccessKey?: string;
  volcResourceId?: string;
  volcConnectId?: string;
  // Optional: still keep legacy TTS fields
  volcCluster?: string;
  volcAsrUrl: string;
  volcTtsUrl: string;
  volcVoiceType: string;
  volcSampleRate: number;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiModel: string;
};

// Centralized config with sensible defaults; all values can be overridden via env.
export const config: Config = {
  volcAppKey: process.env.VOLC_APP_KEY,
  volcAccessKey: process.env.VOLC_ACCESS_KEY,
  volcResourceId: process.env.VOLC_RESOURCE_ID,
  volcConnectId: process.env.VOLC_CONNECT_ID,
  volcCluster: process.env.VOLC_CLUSTER ?? 'volcano_tts',
  // v3 bigmodel_async is the optimized bidirectional streaming endpoint
  volcAsrUrl: process.env.VOLC_ASR_URL ?? 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async',
  volcTtsUrl: process.env.VOLC_TTS_URL ?? 'wss://openspeech.bytedance.com/api/v1/tts/ws_binary',
  volcVoiceType: process.env.VOLC_VOICE_TYPE ?? 'BV700_V2_streaming',
  volcSampleRate: Number(process.env.VOLC_SAMPLE_RATE ?? 24000),
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiBaseUrl: process.env.OPENAI_BASE_URL,
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini'
};
