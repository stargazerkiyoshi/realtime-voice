import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Collapse, Divider, Input, Space, Tag, Typography } from 'antd';
import { useAppStore } from '../store/appStore';

const { Text } = Typography;

const ASR_SAMPLE_RATE = 16000;
const TTS_SAMPLE_RATE = 24000;
const LOG_LIMIT = 300;

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
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [micRms, setMicRms] = useState(0);
  const [zeroChunks, setZeroChunks] = useState(0);
  const [dialog, setDialog] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
  const [rawRecording, setRawRecording] = useState(false);
  const [rawMime, setRawMime] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const frontendVadRef = useRef<{ speech: boolean }>({ speech: false });
  const rawRecorderRef = useRef<MediaRecorder | null>(null);
  const rawChunksRef = useRef<Blob[]>([]);

  const playCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTsRef = useRef(0);
  const outPacketsRef = useRef(0);

  // Ensure we have an AudioContext that is allowed to play; browsers often start in "suspended" state
  const getPlayableCtx = async (): Promise<AudioContext> => {
    const playCtx = playCtxRef.current ?? new AudioContext();
    playCtxRef.current = playCtx;
    if (playCtx.state === 'suspended') {
      try {
        await playCtx.resume();
      } catch (err) {
        log(`AudioContext resume failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return playCtx;
  };

  const log = (msg: string) => {
    const ts = new Date().toISOString().slice(11, 19);
    setLogs((prev) => [...prev, `[${ts}] ${msg}`].slice(-LOG_LIMIT));
  };

  const clearLogs = () => setLogs([]);

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
    if (rawRecorderRef.current) {
      try {
        if (rawRecorderRef.current.state !== 'inactive') {
          rawRecorderRef.current.stop();
        }
      } catch {
        // ignore
      }
      rawRecorderRef.current = null;
      rawChunksRef.current = [];
      setRawRecording(false);
      setRawMime('');
    }
    processorRef.current?.disconnect();
    micSourceRef.current?.disconnect();
    workletNodeRef.current?.disconnect();
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    processorRef.current = null;
    micSourceRef.current = null;
    workletNodeRef.current = null;
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

    ws.onmessage = async (ev) => {
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
          if (isFinal) {
            setLatestAssistant('');
            setDialog((prev) => [...prev, { role: 'user', text }]);
          }
          return;
        }
        // ignore vad for uplink gating; backend handles turn boundaries
        if (type === 'assistant') {
          const delta = String(msg.text ?? '');
          setLatestAssistant((prev) => prev + delta);
          setDialog((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant') {
              const updated = [...prev];
              updated[updated.length - 1] = { role: 'assistant', text: last.text + delta };
              return updated;
            }
            return [...prev, { role: 'assistant', text: delta }];
          });
          return;
        }
        if (type === 'error') {
          setErrorText(`${msg.code ?? 'ERROR'}: ${msg.message ?? 'unknown error'}`);
          return;
        }
        if (type === 'tts' && typeof msg.payload_b64 === 'string') {
          const pcm16 = base64ToInt16Array(msg.payload_b64);
          const playCtx = await getPlayableCtx();

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
    setDialog([]);
    setLatestAssistant('');
    setLatestAsr('');
    clearMic();
    closeWs();
  };

  const send = (payload: Record<string, unknown>) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify(payload));
    log(`=> ${summarizeOutbound(payload)}`);
  };

  const pickRecorderMime = () => {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported(c)) return c;
    }
    return '';
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const startRawRecording = () => {
    if (!mediaStreamRef.current || rawRecording) return;
    try {
      const mimeType = pickRecorderMime();
      const recorder = new MediaRecorder(mediaStreamRef.current, mimeType ? { mimeType } : undefined);
      rawChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) rawChunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        const chunks = rawChunksRef.current;
        rawChunksRef.current = [];
        const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
        if (!blob.size) return;
        const sr = audioCtxRef.current?.sampleRate ?? 'unknown';
        const ext = mimeType.includes('ogg') ? 'ogg' : 'webm';
        const stamp = new Date().toISOString().replace(/[:.]/g, '');
        const filename = `mic-${sr}hz-${stamp}.${ext}`;
        downloadBlob(blob, filename);
        log(`Raw recording saved: ${filename} (${Math.round(blob.size / 1024)}KB, mime=${mimeType || 'default'})`);
      };
      recorder.start(250);
      rawRecorderRef.current = recorder;
      setRawRecording(true);
      setRawMime(mimeType || 'default');
      log(`Raw recording started (${mimeType || 'default'})`);
    } catch (err) {
      log(`Raw recording failed: ${err instanceof Error ? err.message : String(err)}`);
      setRawRecording(false);
      setRawMime('');
    }
  };

  const stopRawRecording = () => {
    const recorder = rawRecorderRef.current;
    if (!recorder) return;
    if (recorder.state !== 'inactive') recorder.stop();
    rawRecorderRef.current = null;
    setRawRecording(false);
    setRawMime('');
  };

  const startSession = () => {
    const payload: Record<string, unknown> = { type: 'start' };
    if (sessionId.trim()) payload.session_id = sessionId.trim();
    send(payload);
    // pre-warm/resume audio context right after a user gesture (button click)
    void getPlayableCtx();
  };

  const stopSession = () => {
    clearMic();
    send({ type: 'stop', reason: 'frontend_stop' });
  };

  const startMic = async () => {
    if (!sessionStarted || capturing) return;
    try {
      // resume playback context on user gesture to avoid autoplay restrictions
      await getPlayableCtx();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1
        }
      });

      const audioCtx = new AudioContext();
      await audioCtx.audioWorklet.addModule('/worklets/mic-processor.js');

      const micSource = audioCtx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(audioCtx, 'mic-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        processorOptions: {
          targetSampleRate: ASR_SAMPLE_RATE,
          inputSampleRate: audioCtx.sampleRate,
          vadStartThresh: 2e-4,
          vadStopThresh: 1e-4,
          vadHangFrames: 6
        }
      });

      worklet.port.onmessage = (event) => {
        const { type, buffer, rms, event: vadEvent } = event.data as {
          type: string;
          buffer?: ArrayBuffer;
          rms?: number;
          event?: 'speech_start' | 'speech_end';
        };

        if (type === 'vad' && vadEvent) {
          frontendVadRef.current.speech = vadEvent === 'speech_start';
          setMicRms(rms ?? 0);
          return;
        }

        if (type !== 'pcm' || !buffer) return;
        setMicRms(rms ?? 0);

        if (!sessionStarted || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        const pcm16 = new Int16Array(buffer);
        if (pcm16.length === 0) return;

        let nonZero = false;
        for (let i = 0; i < pcm16.length; i += 1) {
          if (pcm16[i] !== 0) {
            nonZero = true;
            break;
          }
        }
        setZeroChunks((v) => (nonZero ? 0 : v + 1));

        outPacketsRef.current += 1;
        if (outPacketsRef.current % 20 === 0) {
          let sumSq = 0;
          let zero = 0;
          for (let i = 0; i < pcm16.length; i += 1) {
            const v = pcm16[i];
            if (v === 0) zero += 1;
            const f = v / 0x8000;
            sumSq += f * f;
          }
          const rms = Math.sqrt(sumSq / pcm16.length);
          const zeroPct = (zero / pcm16.length) * 100;
          log(`out pcm stats: rms=${rms.toFixed(6)} zero_pct=${zeroPct.toFixed(2)}`);
        }

        send({
          type: 'audio',
          payload_b64: int16ToBase64(pcm16),
          ts_ms: Date.now()
        });
      };

      micSource.connect(worklet);

      mediaStreamRef.current = stream;
      audioCtxRef.current = audioCtx;
      micSourceRef.current = micSource;
      workletNodeRef.current = worklet;
      setCapturing(true);
      setMicRms(0);
      setZeroChunks(0);
      log(`Mic capture started (AudioWorklet): in=${audioCtx.sampleRate}Hz out=${ASR_SAMPLE_RATE}Hz`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Cannot access microphone';
      setErrorText(message);
      log(`Mic start failed: ${message}`);
      clearMic();
    }
  };

  const stopMic = () => {
    stopRawRecording();
    clearMic();
    log('Mic capture stopped');
  };

  return (
    <Card title="Voice Test" bordered style={{ background: '#fff', color: '#141414' }}>
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
          <Button onClick={startRawRecording} disabled={!capturing || rawRecording}>
            Start Hi-Res Rec
          </Button>
          <Button onClick={stopRawRecording} disabled={!rawRecording}>
            Stop Hi-Res Rec
          </Button>
          <Tag color={capturing ? 'processing' : 'default'}>{capturing ? 'Capturing' : 'Idle'}</Tag>
          <Tag color={rawRecording ? 'green' : 'default'}>
            Hi-Res Rec: {rawRecording ? 'On' : 'Off'}
          </Tag>
          {rawRecording ? <Tag color="default">Mime: {rawMime}</Tag> : null}
          <Tag color={micRms > 0.005 ? 'green' : 'default'}>RMS: {micRms.toFixed(4)}</Tag>
          <Tag color={zeroChunks > 20 ? 'red' : 'default'}>Zero Chunks: {zeroChunks}</Tag>
        </Space>

        <Divider style={{ margin: '8px 0' }} />

        <Card size="small" title="ASR">
          <Text>{latestAsr || 'N/A'}</Text>
        </Card>

        <Card size="small" title="Assistant">
          <Text>{latestAssistant || 'N/A'}</Text>
        </Card>

        <Card size="small" title="对话记录" bodyStyle={{ padding: 12 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12
            }}
          >
            <div style={{ color: '#1677ff' }}>助手</div>
            <div style={{ color: '#faad14', textAlign: 'right' }}>用户</div>
            {dialog.map((m, idx) => (
              <div
                key={`${m.role}-${idx}`}
                style={{
                  gridColumn: m.role === 'assistant' ? '1 / 2' : '2 / 3',
                  textAlign: m.role === 'assistant' ? 'left' : 'right',
                  background: '#f5f5f5',
                  border: '1px solid #d9d9d9',
                  borderRadius: 8,
                  padding: '8px 10px',
                  color: '#141414',
                  whiteSpace: 'pre-wrap'
                }}
              >
                {m.text || '(空)'}
              </div>
            ))}
          </div>
        </Card>

        <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space>
            <Button onClick={() => setLogsExpanded((v) => !v)} size="small">
              {logsExpanded ? '收起日志' : '展开日志'}
            </Button>
            <Button onClick={clearLogs} size="small" disabled={logs.length === 0}>
              清空日志
            </Button>
          </Space>
          <Tag color="default">最多保留 {LOG_LIMIT} 条</Tag>
        </Space>

        <Collapse
          activeKey={logsExpanded ? ['logs'] : []}
          onChange={(keys) => setLogsExpanded(keys.length > 0)}
        >
          <Collapse.Panel key="logs" header="调试日志">
            <div
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
                fontSize: 12,
                background: '#f5f5f5',
                border: '1px solid #d9d9d9',
                borderRadius: 8,
                padding: 12,
                maxHeight: 280,
                overflow: 'auto',
                whiteSpace: 'pre-wrap'
              }}
            >
              {logs.length === 0 ? (
                <div style={{ color: '#8c8c8c' }}>暂无日志</div>
              ) : (
                logs.map((l, i) => (
                  <div key={i} style={{ color: '#141414' }}>
                    {l}
                  </div>
                ))
              )}
            </div>
          </Collapse.Panel>
        </Collapse>
      </Space>
    </Card>
  );
}
