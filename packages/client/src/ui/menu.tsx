import { createRoot, type Root } from 'react-dom/client';
import { pause } from '../app/pause';
import type { Hud } from '../hud/hud';
import { editLayout } from '../hud/layout-editor';
import { SettingsPanel } from './settings-panel';

let root: Root | null = null;

/**
 * Opens the settings screen over the game, which stays paused until it's closed (the
 * layout editor counts as part of it), then calls onClose (opened from the main menu,
 * not a raid). This module is loaded on first use, so React isn't in the startup bundle.
 */
export function openSettings(container: HTMLElement, hud: Hud, onClose?: () => void): void {
  root ??= createRoot(container);
  pause.set('menu', true);
  container.hidden = false;
  const close = (): void => {
    root?.render(null);
    container.hidden = true;
  };
  root.render(
    <SettingsPanel
      closeLabel={onClose ? 'Done' : 'Resume'}
      onClose={() => {
        close();
        pause.set('menu', false);
        onClose?.();
      }}
      onEditLayout={() => {
        close();
        editLayout(hud, () => openSettings(container, hud, onClose));
      }}
    />,
  );
}
