import type WebSocket from 'ws';
import { Session } from '../core/session';
import { logger } from '../observability/logger';

const nowMs = () => Date.now();

export function wsHandler(socket: WebSocket) {
  let session: Session | null = null;
  let audioPackets = 0;

  const sendJson = async (payload: Record<string, unknown>) => {
    logger.debug('ws->client', payload.type, summarizePayload(payload));
    socket.send(JSON.stringify(payload));
  };

  socket.on('message', async (data: unknown) => {
    try {
      const raw = typeof data === 'string' ? data : (data as Buffer).toString('utf8');
      const msg = JSON.parse(raw);
      const t = msg.type as string | undefined;

      if (t === 'start') {
        const sid = msg.session_id || cryptoRandomId();
        logger.info('ws start', { sid });
        session = new Session(sid, sendJson);
        await session.start();
        return;
      }

      if (t === 'audio') {
        if (!session) {
          await sendJson({ type: 'error', code: 'NO_SESSION', message: 'send start first' });
          return;
        }
        const b = Buffer.from(msg.payload_b64, 'base64');
        audioPackets += 1;
        if (audioPackets % 20 === 0) {
          logger.debug('ws audio packet', { sid: session.sessionId, packets: audioPackets, bytes: b.length });
        }
        await session.feedAudio(b, msg.ts_ms ?? nowMs());
        return;
      }

      if (t === 'stop') {
        if (session) {
          logger.info('ws stop', { sid: session.sessionId, reason: msg.reason ?? 'stop' });
          await session.stop(msg.reason ?? 'stop');
        }
        socket.close();
        return;
      }

      if (t === 'ping') {
        await sendJson({ type: 'pong', ts_ms: nowMs() });
      }
    } catch (e) {
      logger.error('ws handler error', e);
      await sendJson({ type: 'error', code: 'WS_HANDLER_ERROR', message: 'invalid websocket message' });
      if (session) {
        await session.stop('ws_error');
      }
    }
  });

  socket.on('close', async () => {
    if (session) {
      logger.info('ws close', { sid: session.sessionId });
      await session.stop('ws_closed');
    }
  });
}

function cryptoRandomId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function summarizePayload(payload: Record<string, unknown>) {
  const type = String(payload.type ?? '');
  if (type === 'tts' && typeof payload.payload_b64 === 'string') {
    const b64Len = payload.payload_b64.length;
    const pcmBytes = Math.floor((b64Len * 3) / 4);
    return {
      ...payload,
      payload_b64: `<${b64Len} chars>`,
      pcm_bytes: pcmBytes
    };
  }
  if ((type === 'assistant' || type === 'asr') && typeof payload.text === 'string' && payload.text.length > 80) {
    return {
      ...payload,
      text: `${payload.text.slice(0, 80)}...`,
      text_len: payload.text.length
    };
  }
  return payload;
}
