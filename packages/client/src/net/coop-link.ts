import { SIGNAL, type IceResponse, type SignalsResponse } from '@mes/shared';
import { AccountError, call } from '../account';
import { PeerLink } from './peer';

/*
 * Connecting a party raid's devices (docs/coop.md, C5): the host calls each guest and the
 * guests answer, through the server's signals, named by the raid's session. Each side
 * asks for signals every SIGNAL.pollMs while it waits. The host can come up to a heartbeat
 * (10 s) plus loading later than a guest, so both wait CONNECT_MS.
 */

const CONNECT_MS = 60_000;

async function json<T>(method: string, path: string, body?: unknown): Promise<T> {
  return (await (await call(method, path, body)).json()) as T;
}

async function iceServers(): Promise<RTCIceServer[]> {
  return (await json<IceResponse>('POST', '/party/ice')).iceServers;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Resolves when the link's channel opens, or rejects if it closes first. */
function opened(link: PeerLink): Promise<void> {
  return new Promise((resolve, reject) => {
    if (link.open) return resolve();
    link.onOpen = () => resolve();
    link.onClose = (why) => reject(new Error(why));
  });
}

/**
 * The host's side: calls every guest, and resolves with the links that opened within
 * CONNECT_MS (any that didn't are left out). `status` says what it's waiting for.
 */
export async function callGuests(
  session: string,
  guests: { id: string; name: string }[],
  status: (text: string) => void,
): Promise<Map<string, PeerLink>> {
  const ice = await iceServers();
  const links = new Map<string, PeerLink>();
  const waiting = new Map<string, PeerLink>();
  for (const g of guests) {
    const link = new PeerLink(ice);
    const sdp = await link.offer();
    await call('POST', '/party/signal', { to: g.id, session, kind: 'offer', sdp });
    waiting.set(g.id, link);
  }
  const until = performance.now() + CONNECT_MS;
  const opening: Promise<void>[] = [];
  while (waiting.size && performance.now() < until) {
    status(
      `Waiting for ${guests
        .filter((g) => waiting.has(g.id))
        .map((g) => g.name)
        .join(', ')}…`,
    );
    try {
      const { signals } = await json<SignalsResponse>('GET', '/party/signals');
      for (const s of signals) {
        const link = waiting.get(s.from);
        if (!link || s.kind !== 'answer' || s.session !== session) continue;
        waiting.delete(s.from);
        await link.accept(s.sdp);
        opening.push(
          opened(link).then(
            () => void links.set(s.from, link),
            () => link.close(),
          ),
        );
      }
    } catch (err) {
      if (!(err instanceof AccountError)) throw err;
    }
    if (waiting.size) await sleep(SIGNAL.pollMs);
  }
  for (const link of waiting.values()) link.close();
  // Give the answered ones a moment to finish connecting.
  await Promise.race([Promise.all(opening), sleep(15_000)]);
  return links;
}

/** A guest's side: waits for the host's call and answers it. Rejects after CONNECT_MS. */
export async function answerHost(
  session: string,
  host: { id: string; name: string },
  status: (text: string) => void,
): Promise<PeerLink> {
  const until = performance.now() + CONNECT_MS;
  status(`Waiting for ${host.name} to host…`);
  while (performance.now() < until) {
    try {
      const { signals } = await json<SignalsResponse>('GET', '/party/signals');
      const offer = signals.find(
        (s) => s.kind === 'offer' && s.from === host.id && s.session === session,
      );
      if (offer) {
        status(`Connecting to ${host.name}…`);
        const link = new PeerLink(await iceServers());
        const sdp = await link.answer(offer.sdp);
        await call('POST', '/party/signal', { to: host.id, session, kind: 'answer', sdp });
        await Promise.race([
          opened(link),
          sleep(20_000).then(() => {
            throw new Error('the connection timed out');
          }),
        ]);
        return link;
      }
    } catch (err) {
      if (!(err instanceof AccountError)) throw err;
    }
    await sleep(SIGNAL.pollMs);
  }
  throw new Error(`${host.name} didn't start hosting in time`);
}
