import { defaultSettings, loadSettings, type Settings } from '@mes/shared';

const KEY = 'mes.settings';
/** When the settings were last changed on this device (Unix ms), for syncing. */
const AT_KEY = 'mes.settings.at';

type Listener = (settings: Settings) => void;

/**
 * The player's settings, kept in local storage and synced to the account (account.ts,
 * session 12b). Changes apply straight away: listeners are told, and code that reads
 * settings every tick just reads `current`.
 */
class SettingsStore {
  current: Settings;
  /** When they were last changed, here or on another device; 0 if never. */
  changedAt = 0;
  private readonly listeners = new Set<Listener>();

  constructor() {
    let raw: unknown = null;
    try {
      const text = localStorage.getItem(KEY);
      if (text) raw = JSON.parse(text);
    } catch {
      // Blocked storage or bad JSON: use the defaults.
    }
    this.current = loadSettings(raw);
    try {
      this.changedAt = Number(localStorage.getItem(AT_KEY)) || 0;
    } catch {
      // As above.
    }
  }

  /** Replaces the settings with a changed copy, saves them and tells the listeners. */
  update(change: (draft: Settings) => void): void {
    const next = structuredClone(this.current);
    change(next);
    this.replace(next, Date.now());
  }

  /** Takes settings changed at a time (synced from another device, or a change here). */
  replace(next: Settings, at: number): void {
    this.current = next;
    this.changedAt = at;
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
      localStorage.setItem(AT_KEY, String(at));
    } catch {
      // Private mode or full storage: keep them for this session only.
    }
    for (const l of this.listeners) l(next);
  }

  reset(): void {
    this.update((s) => Object.assign(s, defaultSettings()));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const settings = new SettingsStore();
