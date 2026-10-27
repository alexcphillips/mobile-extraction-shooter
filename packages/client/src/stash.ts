import type { BuyPageRequest, ProfileResponse, SaveProfileRequest } from '@mes/shared';
import { AccountError, call } from './account';

/*
 * Saving the stash (session 13). Every change is applied here at once and saved a moment
 * later as the whole profile (PUT /api/profile), one save at a time, so a burst of moves
 * is one request. The server checks it (design.md → Trust model). Leaving the stash or
 * starting a raid waits for the save first.
 */

/** How long after the last change the profile is sent. */
const SAVE_DELAY_MS = 800;

export type StashSaveStatus =
  | { kind: 'saved' }
  | { kind: 'unsaved' }
  | { kind: 'saving' }
  /** Not sent: the message says why (no connection, signed out, refused). */
  | { kind: 'failed'; message: string; code: AccountError['code'] | null };

export class StashSaver {
  status: StashSaveStatus = { kind: 'saved' };
  private timer = 0;
  private running: Promise<void> | null = null;
  private dirty = false;

  /**
   * @param me the profile as last read; its profile object is the one being edited.
   * @param onChange called when the status or `me` changes.
   * @param onReload called with the profile read afresh, and why, when the server's copy
   *   wins: another device changed it, or the server refused the change.
   */
  constructor(
    public me: ProfileResponse,
    private readonly onChange: () => void,
    private readonly onReload: (me: ProfileResponse, why: string) => void,
  ) {}

  /** The profile was changed: save it soon. */
  changed(): void {
    this.dirty = true;
    this.set({ kind: 'unsaved' });
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), SAVE_DELAY_MS);
  }

  /** Saves now if there's anything unsaved, and resolves when the server has it all. */
  async flush(): Promise<StashSaveStatus> {
    clearTimeout(this.timer);
    while (this.running) await this.running;
    if (this.dirty) {
      this.running = this.save();
      await this.running;
      this.running = null;
    }
    return this.status;
  }

  /**
   * Buys the next stash page on the server, once everything is saved. Resolves with the
   * profile it replies with, which the stash should be reopened on; throws an AccountError
   * to show (offline, not enough money).
   */
  async buyPage(): Promise<ProfileResponse> {
    const status = await this.flush();
    if (status.kind === 'failed') throw new AccountError(status.code ?? 'offline', status.message);
    const body: BuyPageRequest = { version: this.me.version };
    this.me = (await (await call('POST', '/stash/pages', body)).json()) as ProfileResponse;
    this.onChange();
    return this.me;
  }

  private async save(): Promise<void> {
    this.dirty = false;
    this.set({ kind: 'saving' });
    const body: SaveProfileRequest = { version: this.me.version, profile: this.me.profile };
    try {
      const res = await call('PUT', '/profile', body);
      const saved = (await res.json()) as ProfileResponse;
      // Keep editing the same objects: only the version and the rest of the reply move on.
      this.me = { ...saved, profile: this.me.profile };
      this.set(this.dirty ? { kind: 'unsaved' } : { kind: 'saved' });
    } catch (err) {
      if (!(err instanceof AccountError)) throw err;
      if (err.code === 'stale' || err.code === 'invalid' || err.code === 'in-raid') {
        // The server's copy wins (another device changed it, or the change broke a rule),
        // and the stash shows it afresh.
        const why =
          err.code === 'invalid'
            ? `The server refused that change (${err.message}), so your stash was reloaded.`
            : 'Your stash was changed on another device, so it was reloaded.';
        try {
          this.me = (await (await call('GET', '/profile')).json()) as ProfileResponse;
        } catch (e) {
          if (!(e instanceof AccountError)) throw e;
          this.dirty = true;
          this.set({ kind: 'failed', message: e.message, code: e.code });
          return;
        }
        this.dirty = false;
        this.set({ kind: 'saved' });
        this.onReload(this.me, why);
        return;
      }
      this.dirty = true;
      this.set({ kind: 'failed', message: err.message, code: err.code });
    }
  }

  private set(status: StashSaveStatus): void {
    this.status = status;
    this.onChange();
  }
}
