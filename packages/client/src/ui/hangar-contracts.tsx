import {
  INTEL_DESK,
  cantTake,
  contractBoard,
  contractHandOverCount,
  contractProgress,
  contractStatus,
  moduleLevel,
  nextBoard,
  takenToday,
  type ActiveContract,
  type ContractDef,
  type Profile,
} from '@mes/shared';
import { useState, type ReactNode } from 'react';
import { contractObjectiveText, contractRewards, timeLeft, type Names } from './hangar-text';
import { ROMAN } from './vendors-page';

/*
 * The Intel desk's contracts on the Hangar page (session H6; rules in shared
 * contracts.ts): the one running, with its time left, each objective's progress, Hand
 * over for found-in-raid items, Claim once done and Drop; then today's board with Get
 * contract. A contract out of time unfinished shows as gone, as the server will settle it.
 */

export interface ContractActions {
  /** Each resolves when done or refused. */
  onTake: (def: ContractDef) => Promise<void>;
  onHandOver: (def: ContractDef, objective: string) => Promise<void>;
  onClaim: (def: ContractDef) => Promise<void>;
  onDrop: (def: ContractDef) => Promise<void>;
}

/** A button that's busy while its action runs, and asks for a second tap if `confirm` is given. */
function ActionButton({
  label,
  busyLabel,
  confirm,
  primary = true,
  disabled,
  why,
  onClick,
}: {
  label: string;
  busyLabel: string;
  confirm?: string;
  primary?: boolean;
  disabled?: boolean;
  why?: string | null;
  onClick: () => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  return (
    <button
      className={`${primary ? 'primary' : ''}${confirming ? ' confirm' : ''}`}
      disabled={busy || !!disabled}
      title={why ?? undefined}
      onBlur={() => setConfirming(false)}
      onClick={() => {
        if (busy) return;
        if (confirm && !confirming) return setConfirming(true);
        setConfirming(false);
        setBusy(true);
        void onClick().finally(() => setBusy(false));
      }}
    >
      {busy ? busyLabel : confirming ? confirm : label}
    </button>
  );
}

export function Contracts({
  contracts,
  profile,
  names,
  mapName,
  now,
  actions,
}: {
  contracts: ReadonlyMap<string, ContractDef>;
  profile: Profile;
  names: Names;
  mapName: (id: string) => string;
  now: number;
  actions: ContractActions;
}): ReactNode {
  const level = moduleLevel(profile, INTEL_DESK);
  if (!level) {
    return (
      <>
        <h3 className="hangar-heading">Contracts</h3>
        <p className="raid-note">Build the Intel desk to take contracts.</p>
      </>
    );
  }
  const a = profile.contracts.active;
  const def = a && contracts.get(a.id);
  const running = def && contractStatus(def, a!, now) !== 'expired' ? def : null;
  // The rules ask with what the server will have settled: nothing running once it's out of time.
  const settled: Profile = running
    ? profile
    : { ...profile, contracts: { day: profile.contracts.day, taken: profile.contracts.taken } };
  const board = contractBoard(contracts.values(), profile, now);
  return (
    <>
      {running && (
        <>
          <h3 className="hangar-heading">Your contract</h3>
          <Running
            def={running}
            active={a!}
            profile={profile}
            names={names}
            mapName={mapName}
            now={now}
            actions={actions}
          />
        </>
      )}
      <h3 className="hangar-heading">
        Today's contracts{' '}
        <span className="hangar-heading-note">· new in {timeLeft(nextBoard(now) - now)}</span>
      </h3>
      <ul className="hangar-recipes">
        {board.map((c) => {
          const taken =
            running?.id === c.id
              ? 'Running'
              : takenToday(profile, c.id, now)
                ? 'Taken today'
                : null;
          const why = taken ? null : cantTake(settled, contracts.values(), c, now);
          return (
            <li key={c.id} className={`hangar-recipe hangar-contract${taken ? ' locked' : ''}`}>
              <div className="hangar-recipe-body">
                <ContractHead def={c} names={names} />
                <ul className="hangar-objectives">
                  {c.objectives.map((o) => (
                    <li key={o.id}>{contractObjectiveText(names, mapName, o)}</li>
                  ))}
                </ul>
                <span className="hangar-recipe-meta">Pays {contractRewards(names, c)}</span>
                {taken ? (
                  <span className="hangar-recipe-meta">{taken}</span>
                ) : (
                  <ActionButton
                    label={`Get contract · ${hoursText(c.hours)}`}
                    busyLabel="Taking…"
                    disabled={!!why}
                    why={why}
                    onClick={() => actions.onTake(c)}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {level < 3 && (
        <p className="raid-note">
          Intel desk level {ROMAN[level + 1]} adds harder contracts to the board.
        </p>
      )}
      <p className="raid-note">
        One contract at a time. Its clock starts when you take it; kills count from raids started
        before it runs out, and hand-overs take only items found in raid. Out of time unfinished,
        it's gone, with nothing lost.
      </p>
    </>
  );
}

/** "3h" or "1h 30m": a contract's window. */
function hoursText(hours: number): string {
  const m = Math.round(hours * 60);
  return m % 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m / 60}h`;
}

function ContractHead({ def, names }: { def: ContractDef; names: Names }): ReactNode {
  return (
    <>
      <span className="hangar-contract-name">
        <b>{def.name}</b> · {names.vendor(def.vendor)}
      </span>
      <span className="hangar-contract-text">{def.description}</span>
    </>
  );
}

/** The running contract: time left or done, objectives with progress and Hand over, Claim and Drop. */
function Running({
  def,
  active,
  profile,
  names,
  mapName,
  now,
  actions,
}: {
  def: ContractDef;
  active: ActiveContract;
  profile: Profile;
  names: Names;
  mapName: (id: string) => string;
  now: number;
  actions: ContractActions;
}): ReactNode {
  const done = contractStatus(def, active, now) === 'done';
  return (
    <div className={`hangar-craft hangar-contract${done ? ' ready' : ''}`}>
      <div className="hangar-recipe-body">
        <ContractHead def={def} names={names} />
        <span className="hangar-craft-state">
          {done ? (
            <b>Done: claim it</b>
          ) : (
            <>
              <b>{timeLeft(active.ends - now)}</b> left
            </>
          )}
        </span>
        <ul className="hangar-objectives">
          {def.objectives.map((o) => {
            const got = contractProgress(active, o);
            const have = o.type === 'handOver' ? contractHandOverCount(profile, o.item) : 0;
            return (
              <li key={o.id} className={got >= o.count ? 'done' : undefined}>
                <span>{contractObjectiveText(names, mapName, o)}</span>
                <b>
                  {got}/{o.count}
                </b>
                {o.type === 'handOver' && got < o.count && (
                  <ActionButton
                    label={`Hand over (${have})`}
                    busyLabel="Handing over…"
                    confirm="Hand them over?"
                    primary={false}
                    disabled={!have}
                    why={have ? null : 'None found in raid in your stash'}
                    onClick={() => actions.onHandOver(def, o.id)}
                  />
                )}
              </li>
            );
          })}
        </ul>
        <span className="hangar-recipe-meta">Pays {contractRewards(names, def)}</span>
        <span className="hangar-contract-buttons">
          {!done && (
            <ActionButton
              label="Drop"
              busyLabel="Dropping…"
              confirm="Drop it?"
              primary={false}
              onClick={() => actions.onDrop(def)}
            />
          )}
          <ActionButton
            label="Claim"
            busyLabel="Claiming…"
            disabled={!done}
            onClick={() => actions.onClaim(def)}
          />
        </span>
      </div>
    </div>
  );
}
