import { useState, type ReactNode } from 'react';
import type { TestReport } from '../net/conn-test';

/*
 * The connection test's results over the menu (docs/coop.md, C4): each other device, how
 * it connected and how well, and the timed log. Copy puts it all on the clipboard for the
 * notes; Close ends the test and its connections.
 */

const STATE: Record<TestReport['peers'][number]['state'], string> = {
  calling: 'Calling…',
  answering: 'Answering…',
  connecting: 'Connecting…',
  open: 'Connected',
  failed: 'Failed',
  closed: 'Closed',
};

const ms = (n: number | null): string => (n === null ? '–' : `${n} ms`);

export function ConnTestPanel({
  report,
  host,
  text,
  onClose,
}: {
  report: TestReport;
  /** Who would host a co-op raid in this party now. */
  host: string | null;
  /** The results as text, for Copy. */
  text: () => string;
  onClose: () => void;
}): ReactNode {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (): void => {
    navigator.clipboard.writeText(text()).then(
      () => setCopied('Copied.'),
      () => setCopied("Couldn't copy here (it needs HTTPS): the log is below."),
    );
  };
  return (
    <div className="conn-test" role="dialog" aria-label="Connection test">
      <header className="party-row">
        <b>Connection test</b>
        <span className="party-state">
          {report.relay === null ? '' : report.relay ? 'relay available' : 'no relay (STUN only)'}
          {host && ` · ${host} would host`}
        </span>
        <span className="raid-spacer" />
        <button onClick={copy}>Copy</button>
        <button onClick={onClose}>Close</button>
      </header>
      {copied && <p className="party-state">{copied}</p>}
      {report.peers.length === 0 && <p className="party-state">Waiting…</p>}
      <ul className="conn-peers">
        {report.peers.map((p) => (
          <li key={p.account}>
            <b>{p.username}</b> · {STATE[p.state]}
            {p.path && ` · ${p.path === 'relay' ? 'relayed' : 'direct'}`}
            <span className="party-state">
              connect {ms(p.connectMs)} · ping {ms(p.rttMs)} (mean {ms(p.rttMeanMs)}) ·{' '}
              {p.calling ? `sent ${p.sent}, they got ${p.received}` : `got ${p.received}`}
              {p.rateKBps !== null && ` · ${p.rateKBps} kB/s`}
            </span>
          </li>
        ))}
      </ul>
      <pre className="conn-log">{report.log.join('\n')}</pre>
    </div>
  );
}
