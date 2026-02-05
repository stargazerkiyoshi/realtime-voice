export type Config = {
  asrProvider: 'volc';
  ttsProvider: 'volc';
  enableBargeIn: boolean;
  // VAD controls
  enableBackendVad: boolean; // whether server-side VAD gates audio before ASR
  expectFrontendVad: boolean; // hint that frontend may already gate/stop audio
  // Volc ASR v3 sauc/bigmodel_* headers
  volcAppKey?: string;
  volcAccessKey?: string;
  volcAsrResourceId?: string;
  volcTtsResourceId?: string;
  volcResourceId?: string;
  volcConnectId?: string;
  volcAsrUrl: string;
  volcTtsUrl: string;
  volcVoiceType: string;
  volcSampleRate: number;
  volcTtsModel?: string;
  volcAsrIdleMs?: number;
  maxUtterMs?: number;
  silenceToHangupMs?: number;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiModel: string;
};

function resolveAsrProvider(): Config['asrProvider'] {
  switch (process.env.ASR_PROVIDER) {
    case undefined:
    case 'volc':
      return 'volc';
    default:
      return 'volc';
  }
}

function resolveTtsProvider(): Config['ttsProvider'] {
  switch (process.env.TTS_PROVIDER) {
    case undefined:
    case 'volc':
      return 'volc';
    default:
      return 'volc';
  }
}

// Centralized config with sensible defaults; all values can be overridden via env.
export const config: Config = {
  asrProvider: resolveAsrProvider(),
  ttsProvider: resolveTtsProvider(),
  enableBargeIn: String(process.env.ENABLE_BARGE_IN ?? 'false').toLowerCase() === 'true',
  enableBackendVad: String(process.env.ENABLE_BACKEND_VAD ?? 'true').toLowerCase() === 'true',
  expectFrontendVad: String(process.env.EXPECT_FRONTEND_VAD ?? 'false').toLowerCase() === 'true',
  volcAppKey: process.env.VOLC_APP_KEY,
  volcAccessKey: process.env.VOLC_ACCESS_KEY,
  volcAsrResourceId: process.env.VOLC_ASR_RESOURCE_ID,
  volcTtsResourceId: process.env.VOLC_TTS_RESOURCE_ID ?? 'seed-tts-1.0',
  volcResourceId: process.env.VOLC_RESOURCE_ID,
  volcConnectId: process.env.VOLC_CONNECT_ID,
  // v3 bigmodel_async is the optimized bidirectional streaming endpoint
  volcAsrUrl: process.env.VOLC_ASR_URL ?? 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async',
  volcTtsUrl: process.env.VOLC_TTS_URL ?? 'wss://openspeech.bytedance.com/api/v3/tts/bidirection',
  volcVoiceType: process.env.VOLC_VOICE_TYPE ?? 'BV700_V2_streaming',
  volcSampleRate: Number(process.env.VOLC_SAMPLE_RATE ?? 24000),
  volcTtsModel: process.env.VOLC_TTS_MODEL,
  volcAsrIdleMs: process.env.VOLC_ASR_IDLE_MS ? Number(process.env.VOLC_ASR_IDLE_MS) : undefined,
  maxUtterMs: process.env.MAX_UTTER_MS ? Number(process.env.MAX_UTTER_MS) : undefined,
  silenceToHangupMs: process.env.SILENCE_TO_HANGUP_MS ? Number(process.env.SILENCE_TO_HANGUP_MS) : undefined,
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiBaseUrl: process.env.OPENAI_BASE_URL,
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini'
};
