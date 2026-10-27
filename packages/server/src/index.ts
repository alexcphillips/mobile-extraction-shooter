import { Hono } from 'hono';
import { PROTOCOL_VERSION, TICK_RATE, type HelloResponse } from '@mes/shared';
import { auth, signedIn, type AppEnv } from './auth';
import { fail } from './errors';
import { profiles, settingsRoute } from './profiles';
import { raids } from './raids';

export const app = new Hono<AppEnv>().basePath('/api');

app.get('/hello', (c) =>
  c.json<HelloResponse>({
    message: 'hello from the Worker',
    protocolVersion: PROTOCOL_VERSION,
    tickRate: TICK_RATE,
  }),
);

app.route('/', auth);
app.use('/profile', signedIn);
app.route('/profile', profiles);
app.use('/settings', signedIn);
app.route('/settings', settingsRoute);
app.use('/raids', signedIn);
app.use('/raids/*', signedIn);
app.route('/raids', raids);

app.notFound((c) => fail(c, 'not-found'));

export default app;
