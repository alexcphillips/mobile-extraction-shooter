/*
 * One direct connection to another player's device (docs/coop.md, C4): a WebRTC peer
 * connection with one data channel, reliable and ordered. The offer and answer each carry
 * every ICE candidate (no trickle), so they're passed through the server once each way.
 * Works the same in Safari on iOS and in desktop browsers.
 */

/** How the connection goes: straight between the devices, or through the TURN relay. */
export type PeerPath = 'direct' | 'relay';

/** The longest to wait for ICE candidates before sending a description anyway (ms). */
const GATHER_MS = 5000;
/**
 * Once a relay candidate is in, how much longer to wait for others (ms). Gathering from
 * every TURN address can take the whole GATHER_MS; one relay is enough to connect through.
 */
const AFTER_RELAY_MS = 1000;

/**
 * Resolves when the connection has all its ICE candidates, or AFTER_RELAY_MS after its
 * first relay candidate, or after GATHER_MS.
 */
function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    let soon = 0;
    const done = (): void => {
      clearTimeout(timer);
      clearTimeout(soon);
      pc.removeEventListener('icegatheringstatechange', check);
      pc.removeEventListener('icecandidate', check);
      resolve();
    };
    const check = (): void => {
      if (pc.iceGatheringState === 'complete') done();
      // Read from the description, so candidates found before this listened count too.
      else if (!soon && pc.localDescription?.sdp.includes(' typ relay'))
        soon = window.setTimeout(done, AFTER_RELAY_MS);
    };
    const timer = setTimeout(done, GATHER_MS);
    pc.addEventListener('icegatheringstatechange', check);
    pc.addEventListener('icecandidate', check);
    check();
  });
}

export class PeerLink {
  readonly pc: RTCPeerConnection;
  private channel: RTCDataChannel | null = null;
  onOpen: () => void = () => {};
  /** Messages that came before anyone listened (see listen). */
  private inbox: string[] | null = [];
  private onMessage: (data: string) => void = (data) => this.inbox?.push(data);
  /** The channel closed or the connection failed. */
  onClose: (why: string) => void = () => {};
  private closed = false;

  constructor(iceServers: RTCIceServer[]) {
    this.pc = new RTCPeerConnection({ iceServers });
    this.pc.addEventListener('connectionstatechange', () => {
      const s = this.pc.connectionState;
      if (s === 'failed' || s === 'closed') this.finish(`connection ${s}`);
    });
    this.pc.addEventListener('datachannel', (e) => this.use(e.channel));
  }

  /** Calling: makes the channel and the offer to send. */
  async offer(): Promise<string> {
    this.use(this.pc.createDataChannel('game', { ordered: true }));
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await gathered(this.pc);
    return this.pc.localDescription!.sdp;
  }

  /** Answering an offer: the answer to send back. */
  async answer(offer: string): Promise<string> {
    await this.pc.setRemoteDescription({ type: 'offer', sdp: offer });
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await gathered(this.pc);
    return this.pc.localDescription!.sdp;
  }

  /** Calling: the answer came back. */
  async accept(answer: string): Promise<void> {
    await this.pc.setRemoteDescription({ type: 'answer', sdp: answer });
  }

  get open(): boolean {
    return this.channel?.readyState === 'open';
  }

  /** Bytes queued on the channel and not yet sent: a sender should back off when it grows. */
  get buffered(): number {
    return this.channel?.bufferedAmount ?? 0;
  }

  send(data: string): void {
    if (this.channel?.readyState === 'open') this.channel.send(data);
  }

  /** Whether the connection in use is direct or relayed, once connected. */
  async path(): Promise<PeerPath | null> {
    const stats = await this.pc.getStats();
    let pairId: string | undefined;
    stats.forEach((s: { type: string; selectedCandidatePairId?: string }) => {
      if (s.type === 'transport' && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId;
    });
    let local: string | undefined;
    stats.forEach(
      (s: {
        type: string;
        id: string;
        state?: string;
        nominated?: boolean;
        localCandidateId?: string;
      }) => {
        // Safari has no transport stats: the nominated, succeeded pair is the one in use.
        if (s.type !== 'candidate-pair') return;
        if (pairId ? s.id === pairId : s.nominated && s.state === 'succeeded')
          local = s.localCandidateId;
      },
    );
    if (!local) return null;
    let kind: string | undefined;
    stats.forEach((s: { type: string; id: string; candidateType?: string }) => {
      if (s.id === local) kind = s.candidateType;
    });
    return kind === 'relay' ? 'relay' : kind ? 'direct' : null;
  }

  /** Takes the messages: any that came before this first, then each as it comes. */
  listen(fn: (data: string) => void): void {
    this.onMessage = fn;
    const held = this.inbox ?? [];
    this.inbox = null;
    for (const data of held) fn(data);
  }

  close(): void {
    this.finish('closed here');
  }

  private use(ch: RTCDataChannel): void {
    this.channel = ch;
    ch.addEventListener('open', () => this.onOpen());
    ch.addEventListener('message', (e: MessageEvent<unknown>) => {
      if (typeof e.data === 'string') this.onMessage(e.data);
    });
    ch.addEventListener('close', () => this.finish('channel closed'));
  }

  private finish(why: string): void {
    if (this.closed) return;
    this.closed = true;
    this.channel?.close();
    this.pc.close();
    this.onClose(why);
  }
}
