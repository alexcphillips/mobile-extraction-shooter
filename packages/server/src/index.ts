import { Hono } from 'hono';
import { PROTOCOL_VERSION, TICK_RATE, type HelloResponse } from '@mes/shared';

export const app = new Hono().basePath('/api');

app.get('/hello', (c) =>
  c.json<HelloResponse>({
    message: 'hello from the Worker',
    protocolVersion: PROTOCOL_VERSION,
    tickRate: TICK_RATE,
  }),
);

export default app;
