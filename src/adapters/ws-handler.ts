import type WebSocket from 'ws';
import { Session } from '../core/session';

const nowMs = () => Date.now();

export function wsHandler(socket: WebSocket) {
  let session: Session | null = null;

  const sendJson = async (payload: Record<string, unknown>) => {
    socket.send(JSON.stringify(payload));
  };

  socket.on('message', async (data: any) => {
    try {
      const raw = typeof data === 'string' ? data : data.toString('utf8');
      const msg = JSON.parse(raw);
      const t = msg.type as string | undefined;

      if (t === 'start') {
        const sid = msg.session_id || cryptoRandomId();
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
        await session.feedAudio(b, msg.ts_ms ?? nowMs());
        return;
      }

      if (t === 'stop') {
        if (session) {
          await session.stop(msg.reason ?? 'stop');
        }
        socket.close();
        return;
      }

      if (t === 'ping') {
        await sendJson({ type: 'pong', ts_ms: nowMs() });
      }
    } catch (_e) {
      if (session) {
        await session.stop('ws_error');
      }
    }
  });

  socket.on('close', async () => {
    if (session) {
      await session.stop('ws_closed');
    }
  });
}

function cryptoRandomId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
