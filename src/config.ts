export type Config = {
  volcAppId?: string;
  volcToken?: string;
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
  volcAppId: process.env.VOLC_APP_ID,
  volcToken: process.env.VOLC_TOKEN,
  volcCluster: process.env.VOLC_CLUSTER ?? 'volcano_tts',
  volcAsrUrl: process.env.VOLC_ASR_URL ?? 'wss://openspeech.bytedance.com/api/v2/asr',
  volcTtsUrl: process.env.VOLC_TTS_URL ?? 'wss://openspeech.bytedance.com/api/v1/tts/ws_binary',
  volcVoiceType: process.env.VOLC_VOICE_TYPE ?? 'BV700_V2_streaming',
  volcSampleRate: Number(process.env.VOLC_SAMPLE_RATE ?? 24000),
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiBaseUrl: process.env.OPENAI_BASE_URL,
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini'
};
