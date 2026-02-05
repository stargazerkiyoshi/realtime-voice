export type EventType =
  | 'SESSION_START'
  | 'AUDIO_IN'
  | 'VAD_SPEECH_START'
  | 'VAD_SPEECH_END'
  | 'ASR_PARTIAL'
  | 'ASR_FINAL'
  | 'TURN_COMMIT'
  | 'LLM_TOKEN'
  | 'LLM_DONE'
  | 'ASSISTANT_CHUNK'
  | 'TTS_DONE'
  | 'TTS_AUDIO'
  | 'PLAYBACK_DRAINED'
  | 'BARGE_IN'
  | 'SESSION_END_REQUEST'
  | 'REMOTE_HANGUP'
  | 'ERROR';

export interface Event {
  type: EventType;
  data: Record<string, unknown>;
  ts_ms: number;
}
