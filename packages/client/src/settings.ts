import { defaultSettings, loadSettings, type Settings } from '@mes/shared';

const KEY = 'mes.settings';

type Listener = (settings: Settings) => void;

/**
 * The player's settings, kept in local storage (synced to the account once the server
 * exists, session 12). Changes apply straight away: listeners are told, and code that
 * reads settings every tick just reads `current`.
 */
class SettingsStore {
  current: Settings;
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
  }

  /** Replaces the settings with a changed copy, saves them and tells the listeners. */
  update(change: (draft: Settings) => void): void {
    const next = structuredClone(this.current);
    change(next);
    this.current = next;
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
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
