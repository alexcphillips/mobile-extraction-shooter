import { SIGNAL, type IceResponse, type Signal, type SignalsResponse } from '@mes/shared';
import { AccountError, call } from '../account';
import { PeerLink, type PeerPath } from './peer';

/*
 * The connection test from the party strip (docs/coop.md, C4): connects this device to
 * every other member's, then measures what co-op needs to know. The caller sends a stream
 * of snapshot-sized messages (SNAPSHOT_BYTES at SNAPSHOT_HZ, as a host would) for
 * BURST_MS; both ends ping each other every second. Every event is logged with the time,
 * so locking a phone or hiding a tab mid-test shows what that does to the link.
 */

const SNAPSHOT_BYTES = 3000;
const SNAPSHOT_HZ = 20;
const BURST_MS = 10_000;
/** Give up on an answer after this long (ms). */
const ANSWER_MS = 30_000;

export interface PeerReport {
  account: string;
  username: string;
  /** This device called them (it plays the host's part), or answered. */
  calling: boolean;
  state: 'calling' | 'answering' | 'connecting' | 'open' | 'failed' | 'closed';
  path: PeerPath | null;
  /** From the offer or answer being sent to the channel opening (ms). */
  connectMs: number | null;
  /** The latest round trip, and the mean of all of them (ms). */
  rttMs: number | null;
  rttMeanMs: number | null;
  /** Snapshot messages: sent by the caller, received by the answerer (as it reports). */
  sent: number;
  received: number;
  /** Received over the burst (kB/s), as the answerer measured it. */
  rateKBps: number | null;
}

export interface TestReport {
  /** Whether a TURN relay was on offer. */
  relay: boolean | null;
  peers: PeerReport[];
  log: string[];
}

type Wire =
  | { t: 'ping'; at: number }
  | { t: 'pong'; at: number }
  | { t: 'snap'; n: number; pad: string }
  | { t: 'got'; n: number; kBps: number | null };

interface Peer {
  report: PeerReport;
  link: PeerLink;
  session: string;
  startedAt: number;
  rtts: number[];
  timers: number[];
  /** Answering: when the first snapshot came, and bytes since. */
  firstSnap: number;
  bytes: number;
}

async function json<T>(method: string, path: string, body?: unknown): Promise<T> {
  return (await (await call(method, path, body)).json()) as T;
}

export class ConnTest {
  private readonly peers = new Map<string, Peer>();
  private readonly log: string[] = [];
  private relay: boolean | null = null;
  private ice: RTCIceServer[] | null = null;
  private polling = 0;
  private readonly t0 = performance.now();
  private stopped = false;

  constructor(
    /** Account id → username, for the report. */
    private readonly names: (account: string) => string,
    private readonly onUpdate: (r: TestReport) => void,
  ) {
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('pageshow', this.onPageShow);
  }

  /** Calls each of these accounts: this device plays the host. */
  async callAll(accounts: string[]): Promise<void> {
    const ice = await this.iceServers();
    for (const account of accounts) {
      if (this.peers.has(account)) continue;
      const peer = this.add(account, true, ice);
      try {
        const sdp = await peer.link.offer();
        peer.startedAt = performance.now();
        await call('POST', '/party/signal', {
          to: account,
          session: peer.session,
          kind: 'offer',
          sdp,
        });
        this.note(`offer sent to ${peer.report.username} (${sdp.length} chars)`);
      } catch (err) {
        this.fail(peer, err);
      }
    }
    this.pollAnswers();
  }

  /** Signals picked up from the server (by the menu or by this test's polling). */
  async handle(signals: Signal[]): Promise<void> {
    for (const s of signals) {
      if (s.kind === 'answer') {
        const peer = this.peers.get(s.from);
        if (!peer || peer.session !== s.session || peer.report.state !== 'calling') continue;
        peer.report.state = 'connecting';
        this.note(`answer from ${peer.report.username}`);
        await peer.link.accept(s.sdp).catch((err: unknown) => this.fail(peer, err));
      } else {
        // A new call replaces an old one from the same device.
        this.peers.get(s.from)?.link.close();
        this.peers.delete(s.from);
        const peer = this.add(s.from, false, await this.iceServers());
        peer.session = s.session;
        this.note(`offer from ${peer.report.username}`);
        try {
          const sdp = await peer.link.answer(s.sdp);
          peer.startedAt = performance.now();
          peer.report.state = 'connecting';
          await call('POST', '/party/signal', {
            to: s.from,
            session: s.session,
            kind: 'answer',
            sdp,
          });
          this.note(`answer sent to ${peer.report.username}`);
        } catch (err) {
          this.fail(peer, err);
        }
      }
      this.update();
    }
  }

  /** A summary to paste into docs/coop.md. */
  text(): string {
    const lines = [
      `Connection test, ${new Date().toISOString()}, ${navigator.userAgent}`,
      `TURN relay offered: ${this.relay === null ? '?' : this.relay ? 'yes' : 'no'}`,
    ];
    for (const p of this.peers.values()) {
      const r = p.report;
      lines.push(
        `${r.username} (${r.calling ? 'called' : 'answered'}): ${r.state}, ${r.path ?? '?'}, connect ${fmt(r.connectMs)} ms, rtt ${fmt(r.rttMeanMs)} ms mean, snapshots ${r.sent} sent / ${r.received} received, ${fmt(r.rateKBps)} kB/s`,
      );
    }
    return [...lines, '', ...this.log].join('\n');
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.polling);
    for (const p of this.peers.values()) {
      for (const t of p.timers) clearInterval(t);
      p.link.close();
    }
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('pageshow', this.onPageShow);
  }

  private async iceServers(): Promise<RTCIceServer[]> {
    if (!this.ice) {
      const r = await json<IceResponse>('POST', '/party/ice');
      this.relay = r.relay;
      this.ice = r.iceServers;
      this.note(r.relay ? 'STUN and TURN relay' : 'STUN only (no TURN key on the server)');
    }
    return this.ice;
  }

  private add(account: string, calling: boolean, ice: RTCIceServer[]): Peer {
    const link = new PeerLink(ice);
    const peer: Peer = {
      report: {
        account,
        username: this.names(account),
        calling,
        state: calling ? 'calling' : 'answering',
        path: null,
        connectMs: null,
        rttMs: null,
        rttMeanMs: null,
        sent: 0,
        received: 0,
        rateKBps: null,
      },
      link,
      session: crypto.randomUUID(),
      startedAt: performance.now(),
      rtts: [],
      timers: [],
      firstSnap: 0,
      bytes: 0,
    };
    this.peers.set(account, peer);
    link.onOpen = () => this.opened(peer);
    link.listen((data) => this.message(peer, data));
    link.onClose = (why) => {
      for (const t of peer.timers) clearInterval(t);
      if (peer.report.state !== 'failed')
        peer.report.state = peer.report.state === 'open' ? 'closed' : 'failed';
      this.note(`${peer.report.username}: ${why}`);
      this.update();
    };
    link.pc.addEventListener('iceconnectionstatechange', () =>
      this.note(`${peer.report.username}: ICE ${link.pc.iceConnectionState}`),
    );
    this.update();
    return peer;
  }

  private opened(peer: Peer): void {
    const r = peer.report;
    r.state = 'open';
    r.connectMs = Math.round(performance.now() - peer.startedAt);
    this.note(`${r.username}: open after ${r.connectMs} ms`);
    void peer.link.path().then((path) => {
      r.path = path;
      this.note(`${r.username}: ${path ?? 'unknown'} path`);
      this.update();
    });
    peer.timers.push(
      window.setInterval(() => this.send(peer, { t: 'ping', at: performance.now() }), 1000),
    );
    if (r.calling) {
      const end = performance.now() + BURST_MS;
      const pad = 'x'.repeat(SNAPSHOT_BYTES);
      const burst = window.setInterval(() => {
        if (performance.now() > end) {
          clearInterval(burst);
          this.note(`${r.username}: burst done, ${r.sent} sent`);
          return;
        }
        // A host would skip a snapshot rather than queue them up behind a slow link.
        if (peer.link.buffered > SNAPSHOT_BYTES * SNAPSHOT_HZ) return;
        r.sent++;
        this.send(peer, { t: 'snap', n: r.sent, pad });
      }, 1000 / SNAPSHOT_HZ);
      peer.timers.push(burst);
    } else {
      peer.timers.push(
        window.setInterval(() => {
          const secs = (performance.now() - peer.firstSnap) / 1000;
          const kBps = peer.firstSnap && secs > 0 ? peer.bytes / 1024 / secs : null;
          r.rateKBps = kBps === null ? null : Math.round(kBps * 10) / 10;
          this.send(peer, { t: 'got', n: r.received, kBps: r.rateKBps });
          this.update();
        }, 1000),
      );
    }
    this.update();
  }

  private message(peer: Peer, data: string): void {
    const r = peer.report;
    const m = JSON.parse(data) as Wire;
    switch (m.t) {
      case 'ping':
        this.send(peer, { t: 'pong', at: m.at });
        return;
      case 'pong': {
        const rtt = performance.now() - m.at;
        peer.rtts.push(rtt);
        r.rttMs = Math.round(rtt);
        r.rttMeanMs = Math.round(peer.rtts.reduce((a, b) => a + b, 0) / peer.rtts.length);
        this.update();
        return;
      }
      case 'snap':
        if (!peer.firstSnap) peer.firstSnap = performance.now();
        r.received++;
        peer.bytes += data.length;
        return;
      case 'got':
        r.received = m.n;
        r.rateKBps = m.kBps;
        this.update();
        return;
    }
  }

  private send(peer: Peer, m: Wire): void {
    peer.link.send(JSON.stringify(m));
  }

  /** While calling, asks for answers every SIGNAL.pollMs until all came or ANSWER_MS. */
  private pollAnswers(): void {
    const until = performance.now() + ANSWER_MS;
    const poll = async (): Promise<void> => {
      if (this.stopped) return;
      const waiting = [...this.peers.values()].filter((p) => p.report.state === 'calling');
      if (!waiting.length) return;
      if (performance.now() > until) {
        for (const p of waiting) {
          p.report.state = 'failed';
          this.note(
            `${p.report.username}: no answer in ${ANSWER_MS / 1000} s (is their menu open?)`,
          );
        }
        this.update();
        return;
      }
      try {
        await this.handle((await json<SignalsResponse>('GET', '/party/signals')).signals);
      } catch (err) {
        if (!(err instanceof AccountError)) throw err;
      }
      this.polling = window.setTimeout(() => void poll(), SIGNAL.pollMs);
    };
    void poll();
  }

  private fail(peer: Peer, err: unknown): void {
    peer.report.state = 'failed';
    this.note(`${peer.report.username}: ${err instanceof Error ? err.message : String(err)}`);
    this.update();
  }

  private note(text: string): void {
    const s = ((performance.now() - this.t0) / 1000).toFixed(1);
    this.log.push(`${s.padStart(6)} s  ${text}`);
    this.update();
  }

  private update(): void {
    if (this.stopped) return;
    this.onUpdate({
      relay: this.relay,
      peers: [...this.peers.values()].map((p) => ({ ...p.report })),
      log: [...this.log],
    });
  }

  private readonly onVisibility = (): void => this.note(`page ${document.visibilityState}`);
  private readonly onPageHide = (): void => this.note('page hidden (pagehide)');
  private readonly onPageShow = (): void => this.note('page shown (pageshow)');
}

function fmt(n: number | null): string {
  return n === null ? '?' : String(n);
}
