import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type HelloResponse } from '@mes/shared';
import { app } from './index';

describe('GET /api/hello', () => {
  it('responds with the protocol version', async () => {
    const res = await app.request('/api/hello');
    expect(res.status).toBe(200);
    const body = await res.json<HelloResponse>();
    expect(body.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it('404s unknown API routes', async () => {
    const res = await app.request('/api/nope');
    expect(res.status).toBe(404);
  });
});
