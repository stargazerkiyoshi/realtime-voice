import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { wsHandler } from './adapters/ws_handler';

const server = Fastify({ logger: true });

async function start() {
  await server.register(websocket);

  server.get('/ws/voice', { websocket: true }, (socket, _req) => {
    wsHandler(socket);
  });

  const port = Number(process.env.PORT || 3000);
  await server.listen({ port, host: '0.0.0.0' });
}

start().catch((err) => {
  server.log.error(err, 'failed to start server');
  process.exit(1);
});
