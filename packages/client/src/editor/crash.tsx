import { Component, type ReactNode } from 'react';

/**
 * Catches a panel that throws, so the editor shows what went wrong rather than losing every
 * button. The map is untouched (the editor's state lives outside React), so Retry draws the
 * panel again; an Undo first gets past an edit that left something the panel can't show.
 */
export class PanelCrash extends Component<
  { children: ReactNode; undo: () => void },
  { error: Error | null }
> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    console.error('editor panel crashed:', error);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const retry = (): void => this.setState({ error: null });
    return (
      <div className="ed-inspector" style={{ position: 'fixed', top: 8, left: 8, maxWidth: 480 }}>
        <h3>The panel crashed</h3>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>{error.stack ?? error.message}</pre>
        <div className="ed-row">
          <button onClick={retry}>Retry</button>
          <button
            onClick={() => {
              this.props.undo();
              retry();
            }}
          >
            Undo and retry
          </button>
        </div>
        <p className="ed-note">Your changes are kept as a draft; reloading restores them.</p>
      </div>
    );
  }
}
