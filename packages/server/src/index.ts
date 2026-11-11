import { Hono } from 'hono';
import { PROTOCOL_VERSION, TICK_RATE, type HelloResponse } from '@mes/shared';
import { admin, adminOnly } from './admin';
import { auth, signedIn, type AppEnv } from './auth';
import { contracts } from './contracts';
import { fail } from './errors';
import { hangar } from './hangar';
import { profiles, settingsRoute, stashRoute } from './profiles';
import { quests } from './quests';
import { raids } from './raids';
import { friends, party, presence } from './social';
import { vendors } from './vendors';

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
app.use('/stash/*', signedIn);
app.route('/stash', stashRoute);
app.use('/settings', signedIn);
app.route('/settings', settingsRoute);
app.use('/raids', signedIn);
app.use('/raids/*', signedIn);
app.route('/raids', raids);
app.use('/vendors/*', signedIn);
app.route('/vendors', vendors);
app.use('/hangar/*', signedIn);
app.route('/hangar', hangar);
app.use('/contracts/*', signedIn);
app.route('/contracts', contracts);
app.use('/quests/*', signedIn);
app.route('/quests', quests);
app.use('/friends', signedIn);
app.use('/friends/*', signedIn);
app.route('/friends', friends);
app.use('/party', signedIn);
app.use('/party/*', signedIn);
app.route('/party', party);
app.use('/presence', signedIn);
app.route('/presence', presence);
app.use('/admin/*', adminOnly, signedIn);
app.route('/admin', admin);

app.notFound((c) => fail(c, 'not-found'));

export default app;
