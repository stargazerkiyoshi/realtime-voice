import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Divider, Input, Space, Tag, Typography } from 'antd';
import { useAppStore } from '../store/appStore';

const { Text } = Typography;

const ASR_SAMPLE_RATE = 16000;
const TTS_SAMPLE_RATE = 24000;
const LOG_LIMIT = 300;

function downsampleTo16k(input: Float32Array, inputRate: number): Int16Array {
  if (inputRate === ASR_SAMPLE_RATE) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      const s = Math.max(-1, Math.min(1, input[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  const ratio = inputRate / ASR_SAMPLE_RATE;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(outLen);
  let pos = 0;

  for (let i = 0; i < outLen; i += 1) {
    const nextPos = Math.floor((i + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let j = pos; j < nextPos && j < input.length; j += 1) {
      sum += input[j];
      count += 1;
    }
    pos = nextPos;
    const avg = count > 0 ? sum / count : 0;
    const s = Math.max(-1, Math.min(1, avg));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function calcRms(input: Float32Array): number {
  if (input.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < input.length; i += 1) {
    sum += input[i] * input[i];
  }
  return Math.sqrt(sum / input.length);
}

function int16ToBase64(pcm16: Int16Array): string {
  const bytes = new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToInt16Array(payload: string): Int16Array {
  const bin = atob(payload);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

export default function VoiceTest() {
  const wsUrl = useAppStore((s) => s.wsUrl);

  const [connected, setConnected] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [latestAsr, setLatestAsr] = useState('');
  const [latestAssistant, setLatestAssistant] = useState('');
  const [errorText, setErrorText] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [micRms, setMicRms] = useState(0);
  const [zeroChunks, setZeroChunks] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const playCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTsRef = useRef(0);

  const log = (msg: string) => {
    const ts = new Date().toISOString().slice(11, 19);
    setLogs((prev) => [...prev, `[${ts}] ${msg}`].slice(-LOG_LIMIT));
  };

  const summarizeOutbound = (payload: Record<string, unknown>) => {
    if (payload.type === 'audio' && typeof payload.payload_b64 === 'string') {
      const b64Len = payload.payload_b64.length;
      const pcmBytes = Math.floor((b64Len * 3) / 4);
      const durationMs = Math.floor((pcmBytes / 2 / ASR_SAMPLE_RATE) * 1000);
      return JSON.stringify({
        type: 'audio',
        ts_ms: payload.ts_ms,
        payload_b64: `<${b64Len} chars>`,
        pcm_bytes: pcmBytes,
        duration_ms: durationMs
      });
    }
    return JSON.stringify(payload);
  };

  const clearMic = () => {
    processorRef.current?.disconnect();
    micSourceRef.current?.disconnect();
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    processorRef.current = null;
    micSourceRef.current = null;
    mediaStreamRef.current = null;
    if (audioCtxRef.current) {
      void audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    setCapturing(false);
    setMicRms(0);
    setZeroChunks(0);
  };

  const closeWs = () => {
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
    setSessionStarted(false);
  };

  useEffect(() => {
    return () => {
      clearMic();
      closeWs();
      if (playCtxRef.current) {
        void playCtxRef.current.close();
        playCtxRef.current = null;
      }
    };
  }, []);

  const connect = () => {
    if (wsRef.current) return;
    setErrorText('');

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      log('WebSocket connected');
    };

    ws.onmessage = (ev) => {
      const dataText = typeof ev.data === 'string' ? ev.data : '[binary]';
      log(`<= ${dataText}`);

      if (typeof ev.data !== 'string') return;
      try {
        const msg = JSON.parse(ev.data) as Record<string, unknown>;
        const type = String(msg.type ?? '');

        if (type === 'ready') {
          setSessionStarted(true);
          return;
        }
        if (type === 'asr') {
          const text = String(msg.text ?? '');
          const isFinal = Boolean(msg.is_final);
          setLatestAsr(isFinal ? `[final] ${text}` : `[partial] ${text}`);
          return;
        }
        if (type === 'assistant') {
          setLatestAssistant(String(msg.text ?? ''));
          return;
        }
        if (type === 'error') {
          setErrorText(`${msg.code ?? 'ERROR'}: ${msg.message ?? 'unknown error'}`);
          return;
        }
        if (type === 'tts' && typeof msg.payload_b64 === 'string') {
          const pcm16 = base64ToInt16Array(msg.payload_b64);
          const playCtx = playCtxRef.current ?? new AudioContext();
          playCtxRef.current = playCtx;

          const samples = new Float32Array(pcm16.length);
          for (let i = 0; i < pcm16.length; i += 1) {
            samples[i] = pcm16[i] / 0x8000;
          }

          const buffer = playCtx.createBuffer(1, samples.length, TTS_SAMPLE_RATE);
          buffer.getChannelData(0).set(samples);
          const source = playCtx.createBufferSource();
          source.buffer = buffer;
          source.connect(playCtx.destination);

          const startAt = Math.max(playCtx.currentTime, nextPlayTsRef.current);
          source.start(startAt);
          nextPlayTsRef.current = startAt + buffer.duration;
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      setConnected(false);
      setSessionStarted(false);
      clearMic();
      log('WebSocket closed');
    };

    ws.onerror = () => {
      setErrorText('WebSocket error');
      log('WebSocket error');
    };
  };

  const disconnect = () => {
    clearMic();
    closeWs();
  };

  const send = (payload: Record<string, unknown>) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify(payload));
    log(`=> ${summarizeOutbound(payload)}`);
  };

  const startSession = () => {
    const payload: Record<string, unknown> = { type: 'start' };
    if (sessionId.trim()) payload.session_id = sessionId.trim();
    send(payload);
  };

  const stopSession = () => {
    clearMic();
    send({ type: 'stop', reason: 'frontend_stop' });
  };

  const startMic = async () => {
    if (!sessionStarted || capturing) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

      const audioCtx = new AudioContext();
      const micSource = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (event) => {
        if (!sessionStarted || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        const input = event.inputBuffer.getChannelData(0);
        const rms = calcRms(input);
        setMicRms(rms);

        const pcm16 = downsampleTo16k(input, audioCtx.sampleRate);
        if (pcm16.length === 0) return;

        let nonZero = false;
        for (let i = 0; i < pcm16.length; i += 1) {
          if (pcm16[i] !== 0) {
            nonZero = true;
            break;
          }
        }
        setZeroChunks((v) => (nonZero ? 0 : v + 1));

        send({
          type: 'audio',
          payload_b64: int16ToBase64(pcm16),
          ts_ms: Date.now()
        });
      };

      micSource.connect(processor);
      processor.connect(audioCtx.destination);

      mediaStreamRef.current = stream;
      audioCtxRef.current = audioCtx;
      micSourceRef.current = micSource;
      processorRef.current = processor;
      setCapturing(true);
      setMicRms(0);
      setZeroChunks(0);
      log(`Mic capture started: in=${audioCtx.sampleRate}Hz out=${ASR_SAMPLE_RATE}Hz`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Cannot access microphone';
      setErrorText(message);
      log(`Mic start failed: ${message}`);
      clearMic();
    }
  };

  const stopMic = () => {
    clearMic();
    log('Mic capture stopped');
  };

  return (
    <Card title="Voice Test" bordered style={{ background: '#111827', color: '#e6edf3' }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {errorText ? <Alert type="error" showIcon message={errorText} /> : null}

        <Space wrap>
          <Button type="primary" onClick={connect} disabled={connected}>
            Connect
          </Button>
          <Button onClick={disconnect} disabled={!connected}>
            Disconnect
          </Button>
          <Input
            placeholder="optional session_id"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            style={{ width: 220 }}
          />
          <Button type="primary" ghost onClick={startSession} disabled={!connected}>
            Start Session
          </Button>
          <Button danger onClick={stopSession} disabled={!connected}>
            Stop Session
          </Button>
          <Tag color={connected ? 'green' : 'red'}>{connected ? 'Connected' : 'Disconnected'}</Tag>
          <Tag color={sessionStarted ? 'blue' : 'default'}>{sessionStarted ? 'Session On' : 'Session Off'}</Tag>
        </Space>

        <Space wrap>
          <Button onClick={startMic} disabled={!sessionStarted || capturing}>
            Start Mic
          </Button>
          <Button onClick={stopMic} disabled={!capturing}>
            Stop Mic
          </Button>
          <Tag color={capturing ? 'processing' : 'default'}>{capturing ? 'Capturing' : 'Idle'}</Tag>
          <Tag color={micRms > 0.005 ? 'green' : 'default'}>RMS: {micRms.toFixed(4)}</Tag>
          <Tag color={zeroChunks > 20 ? 'red' : 'default'}>Zero Chunks: {zeroChunks}</Tag>
        </Space>

        <Divider style={{ borderColor: '#1f2937', margin: '8px 0' }} />

        <Card size="small" title="ASR" style={{ background: '#0b1222', borderColor: '#1f2937' }}>
          <Text style={{ color: '#cbd5f5' }}>{latestAsr || 'N/A'}</Text>
        </Card>

        <Card size="small" title="Assistant" style={{ background: '#0b1222', borderColor: '#1f2937' }}>
          <Text style={{ color: '#cbd5f5' }}>{latestAssistant || 'N/A'}</Text>
        </Card>

        <div
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
            fontSize: 12,
            background: '#0b1222',
            border: '1px solid #1f2937',
            borderRadius: 8,
            padding: 12,
            height: 280,
            overflow: 'auto',
            whiteSpace: 'pre-wrap'
          }}
        >
          {logs.map((l, i) => (
            <div key={i} style={{ color: '#cbd5f5' }}>
              {l}
            </div>
          ))}
        </div>
      </Space>
    </Card>
  );
}
