import {
  MAX_SELL,
  applyStash,
  itemDef,
  pickHost,
  sellAll,
  sellAllPrice,
  sortGrid,
  nextPagePrice,
  openStash,
  stashOwner,
  stashPageOf,
  type GearSlot,
  type InventoryAction,
  type Item,
  type ItemDb,
  type ItemRef,
  type PartyResponse,
  type ProfileResponse,
  type SignalsResponse,
  type QuestDef,
  type SortKey,
  type StashState,
  type VendorDef,
} from '@mes/shared';
import { warmItemOrigins } from '../content';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createRoot } from 'react-dom/client';
import { AccountError, call } from '../account';
import { ConnTest, type TestReport } from '../net/conn-test';
import { applySimCheats, readCheats } from '../admin-cheats';
import type { CoopOptions } from '../play/coop';
import { PartyWatch, joinParty, pickPartyRaid, setReady, startPartyRaid } from '../social';
import { StashSaver, type StashSaveStatus } from '../stash';
import { AdminPage } from './admin-page';
import { ConnTestPanel } from './conn-test-panel';
import { FriendsPage } from './friends-page';
import { lastMode, rememberMode, rememberRaid, type GameMode } from './last-raid';
import { InventoryController } from './inventory-controller';
import { PartyStrip } from './party-strip';
import { Inventory, StashSearchContext, Worth, worth, type StashSearch } from './raid-screen';
import { countHits, searcher, type Category } from './stash-search';
import { QuestsPage, questsLine } from './quests-page';
import { VendorsPage } from './vendors-page';

/** A raid the menu can start. */
export interface RaidChoice {
  id: string;
  name: string;
  /** Seconds. */
  duration: number;
}

export interface MenuOptions {
  me: ProfileResponse;
  items: ItemDb;
  raids: RaidChoice[];
  vendors: VendorDef[];
  quests: QuestDef[];
  /** Opens the settings screen over the menu; done is called when it closes. */
  openSettings: (done: () => void) => void;
  /** The code of a party invite link the game was opened from, to join on arrival. */
  joinCode?: string | null;
  /** Zombies modes (content/zombies), to play instead of a raid. */
  zombies?: ZombiesChoice[];
}

/** A zombies mode the menu can start, with what its page shows about it. */
export interface ZombiesChoice {
  id: string;
  name: string;
  /** The points each player starts with. */
  points: number;
  /** Item ids of the gear everyone starts in (the knife besides). */
  kit: string[];
  /** Item ids of the mystery box's guns. */
  box: string[];
}

/** What the player chose: a raid to start (or a zombies game), with the profile as saved. */
export interface MenuChoice {
  raid: string;
  me: ProfileResponse;
  /** A zombies mode's id to play instead of the raid (2026-11-04). */
  zombies?: string;
  /** A party raid: whether this device hosts it or joins it, and who's in it. */
  coop?: CoopOptions;
}

/**
 * The button that starts the raid: alone or leading, it starts it; in someone else's party
 * it toggles ready instead.
 */
interface RaidButton {
  label: string;
  primary: boolean;
  disabled: boolean;
  onClick: () => void;
}

/** Party raids already joined from this tab, so coming back to the menu doesn't rejoin one. */
const joined = new Set<string>();

type Page = 'menu' | 'stash' | 'vendors' | 'quests' | 'admin' | 'friends';

/** What you're taking in, for the menu: guns and armour by name. */
const SHOWN: readonly GearSlot[] = ['primary1', 'primary2', 'sidearm', 'helmet', 'bodyArmour'];

function loadoutLine(items: ItemDb, me: ProfileResponse): string {
  const gear = me.profile.gear as unknown as Record<GearSlot, Item | null>;
  const names = SHOWN.flatMap((s) => (gear[s] ? [itemDef(items, gear[s].item).name] : []));
  return names.length ? names.join(' · ') : 'Only your knife';
}

const MODES: readonly { id: GameMode; label: string }[] = [
  { id: 'extraction', label: 'Extraction' },
  { id: 'zombies', label: 'Zombies' },
];

const SAVE_TEXT: Record<StashSaveStatus['kind'], string> = {
  saved: 'Saved',
  unsaved: 'Saving…',
  saving: 'Saving…',
  failed: '',
};

function Menu({ opts, onRaid }: { opts: MenuOptions; onRaid: (c: MenuChoice) => void }) {
  const [page, setPage] = useState<Page>('menu');
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [notice, setNotice] = useState<string | null>(null);
  // The stash being edited, wrapped for the inventory; replaced when the server's copy wins.
  const [stash, setStash] = useState<StashState>(() => openStash(opts.me.profile));
  const saver = useMemo(
    () =>
      new StashSaver(opts.me, redraw, (me, why) => {
        setStash(openStash(me.profile));
        setNotice(why);
      }),
    [opts.me],
  );
  const [busy, setBusy] = useState(false);
  const [startPage, setStartPage] = useState(0);
  const me = saver.me;
  const [raidId, setRaidId] = useState(opts.raids[0]?.id);
  const zombiesModes = opts.zombies ?? [];
  // The game mode whose menu shows; extraction if there's no zombies mode to pick.
  const [mode, setMode] = useState<GameMode>(() =>
    zombiesModes.length ? lastMode() : 'extraction',
  );
  const [zombiesId, setZombiesId] = useState(zombiesModes[0]?.id);
  const zombiesMode = zombiesModes.find((z) => z.id === zombiesId) ?? zombiesModes[0];
  // The party and invites, kept fresh by the heartbeat while the menu shows (co-op C3).
  const [partyRes, setPartyRes] = useState<PartyResponse | null>(null);
  // Set further down, once what it needs is defined.
  const onStart = useRef<(p: PartyResponse) => void>(() => {});
  /** The party as the server has it now; going in if its raid has started. */
  const receive = useCallback((p: PartyResponse): void => {
    setPartyRes(p);
    onStart.current(p);
  }, []);
  useEffect(() => {
    const watch = new PartyWatch(receive);
    return () => watch.stop();
  }, [receive]);
  // Opened from an invite link: join that party.
  useEffect(() => {
    const code = opts.joinCode;
    if (!code) return;
    joinParty(code).then(
      (p) => {
        setPartyRes(p);
        const leader = p.party?.members.find((m) => m.id === p.party?.leader);
        setNotice(leader ? `You're in ${leader.username}'s party.` : null);
      },
      (err: unknown) => {
        if (!(err instanceof AccountError)) throw err;
        setNotice(`The invite link didn't work: ${err.message}`);
      },
    );
  }, [opts.joinCode]);
  const party = partyRes?.party ?? null;
  const mine = party?.members.find((m) => m.username === me.username);
  const leading = !!party && !!mine && party.leader === mine.id;
  // In someone else's party, the raid is the leader's pick.
  const partyRaid = party && !leading ? party.raid : null;
  const raid = opts.raids.find((r) => r.id === (partyRaid ?? raidId)) ?? opts.raids[0];
  const together = !!party && party.members.length > 1;

  // The connection test (co-op C4): started here, or by a call from another member.
  const test = useRef<ConnTest | null>(null);
  const [testReport, setTestReport] = useState<TestReport | null>(null);
  const nameOf = (id: string): string =>
    party?.members.find((m) => m.id === id)?.username ?? 'someone';
  // The test outlives renders: it reads the names as they are now.
  const names = useRef(nameOf);
  useEffect(() => {
    names.current = nameOf;
  });
  const openTest = (): ConnTest => {
    test.current ??= new ConnTest((id) => names.current(id), setTestReport);
    return test.current;
  };
  const closeTest = (): void => {
    test.current?.stop();
    test.current = null;
    setTestReport(null);
  };
  useEffect(() => () => test.current?.stop(), []);
  // Someone's calling: pick the signals up and answer. Not once a party raid has started:
  // its calls are for the raid, which picks them up itself.
  const signals = partyRes?.signals ?? 0;
  const starting = !!party?.start && !joined.has(party.start.session);
  useEffect(() => {
    if (!signals || starting) return;
    call('GET', '/party/signals')
      .then((r) => r.json() as Promise<SignalsResponse>)
      .then((r) => (r.signals.length ? openTest().handle(r.signals) : undefined))
      .catch((err: unknown) => {
        if (!(err instanceof AccountError)) throw err;
      });
  }, [signals, starting, partyRes]);
  const startTest = (): void => {
    if (!party) return;
    closeTest();
    void openTest()
      .callAll(party.members.filter((m) => m.username !== me.username && m.online).map((m) => m.id))
      .catch((err: unknown) => {
        if (!(err instanceof AccountError)) throw err;
        setNotice(`The test couldn't start: ${err.message}`);
      });
  };
  // Leading, the party follows your pick.
  useEffect(() => {
    if (!leading || !raid || party?.raid === raid.id) return;
    pickPartyRaid(raid.id).then(setPartyRes, (err: unknown) => {
      if (!(err instanceof AccountError)) throw err;
    });
  }, [leading, raid, party?.raid]);

  /** Saves the stash, then goes into the raid (or a zombies game, with zombies). */
  const go = (raidId: string, coop?: CoopOptions, zombies?: string): void => {
    setBusy(true);
    void saver.flush().then((status) => {
      if (status.kind === 'failed') {
        setBusy(false);
        setNotice(`Your stash isn't saved, so the raid can't start yet: ${status.message}`);
        return;
      }
      onRaid({
        raid: raidId,
        me: saver.me,
        ...(coop ? { coop } : {}),
        ...(zombies ? { zombies } : {}),
      });
    });
  };
  const start = (): void => {
    if (!raid || busy) return;
    if (!together) {
      go(raid.id);
      return;
    }
    // The leader starts the party's raid; everyone's menu sees it and goes in (below).
    setBusy(true);
    startPartyRaid().then(
      (p) => {
        setBusy(false);
        receive(p);
      },
      (err: unknown) => {
        setBusy(false);
        if (!(err instanceof AccountError)) throw err;
        setNotice(`The party raid didn't start: ${err.message}`);
      },
    );
  };
  // The party's raid has started (seen in a heartbeat, or the reply to starting it): in we
  // go, hosting it or joining the host. Read through a ref, as the heartbeat outlives renders.
  useEffect(() => {
    onStart.current = (p) => {
      const s = p.party?.start;
      const self = p.party?.members.find((m) => m.username === me.username);
      if (!s || !p.party || !self || joined.has(s.session)) return;
      joined.add(s.session);
      test.current?.stop();
      const hostName = p.party.members.find((m) => m.id === s.host)?.username ?? 'the host';
      const coop: CoopOptions =
        s.host === self.id
          ? {
              role: 'host',
              session: s.session,
              name: self.username,
              guests: p.party.members
                .filter((m) => m.id !== self.id)
                .map((m) => ({ id: m.id, name: m.username })),
            }
          : {
              role: 'guest',
              session: s.session,
              name: self.username,
              host: { id: s.host, name: hostName },
            };
      setNotice(
        s.host === self.id ? 'Starting the party raid: you host.' : `Joining ${hostName}'s raid…`,
      );
      go(s.raid, coop);
    };
  });
  const waiting = together
    ? party!.members.filter((m) => m.id !== mine?.id && (!m.ready || !m.online))
    : [];
  // In someone else's party the leader starts the raid: you say whether you're ready for it.
  const following = together && !leading;
  const ready = !!mine?.ready;
  const toggleReady = (): void => {
    if (busy) return;
    setBusy(true);
    setReady(!ready).then(
      (p) => {
        setBusy(false);
        receive(p);
      },
      (err: unknown) => {
        setBusy(false);
        if (!(err instanceof AccountError)) throw err;
        setNotice(err.message);
      },
    );
  };
  /** The raid button, the same on the menu and in the stash. */
  const raidButton: RaidButton = following
    ? { label: ready ? 'Ready ✓' : 'Ready?', primary: ready, disabled: busy, onClick: toggleReady }
    : {
        label: busy ? 'Starting…' : together ? 'Start party raid' : 'Start raid',
        primary: true,
        disabled: !raid || busy || waiting.length > 0,
        onClick: start,
      };

  /** What the server replied with after buying or selling: the stash shows it afresh. */
  const reopen = (bought: ProfileResponse, on: number, why: string): void => {
    setStartPage(on);
    setStash(openStash(bought.profile));
    setNotice(why);
  };
  const refused = (what: string) => (err: unknown) => {
    if (!(err instanceof AccountError)) throw err;
    setNotice(`${what}: ${err.message}`);
  };

  if (page === 'quests') {
    const progress = (r: ProfileResponse, q: QuestDef, o: string): number => {
      const s = r.profile.quests[q.id];
      return s?.status === 'active' ? (s.progress[o] ?? 0) : 0;
    };
    return (
      <QuestsPage
        vendors={opts.vendors}
        quests={opts.quests}
        items={opts.items}
        me={me}
        notice={notice}
        onBack={() => {
          setNotice(null);
          setPage('menu');
        }}
        onStash={() => {
          setNotice(null);
          setPage('stash');
        }}
        onAccept={(q) =>
          saver
            .acceptQuest(q.id)
            .then(
              (r) => reopen(r, startPage, `Accepted ${q.name}.`),
              refused(`${q.name} wasn't accepted`),
            )
        }
        onHandOver={(q, o) => {
          const before = progress(me, q, o);
          return saver.handOver(q.id, o).then((r) => {
            const def = q.objectives.find((x) => x.id === o);
            const name =
              def && def.type === 'handOver' ? itemDef(opts.items, def.item).name : 'items';
            reopen(r, startPage, `Handed over ${progress(r, q, o) - before} × ${name}.`);
          }, refused('Nothing was handed over'));
        }}
        onComplete={(q) =>
          saver
            .completeQuest(q.id, startPage)
            .then(
              (r) => reopen(r, startPage, `${q.name} is done. The rewards are in your stash.`),
              refused(`${q.name} wasn't handed in`),
            )
        }
      />
    );
  }
  if (page === 'vendors') {
    return (
      <VendorsPage
        vendors={opts.vendors}
        items={opts.items}
        quests={opts.quests}
        me={me}
        notice={notice}
        onBack={() => {
          setNotice(null);
          setPage('menu');
        }}
        onStash={() => {
          setNotice(null);
          setPage('stash');
        }}
        onBuy={(vendor, offer, times) => {
          const o = vendor.sells[offer]!;
          const name = itemDef(opts.items, o.item).name;
          const n = (o.count ?? 1) * times;
          return saver
            .buy(vendor.id, offer, startPage, times)
            .then(
              (bought) =>
                reopen(
                  bought,
                  startPage,
                  `Bought ${name}${n > 1 ? ` ×${n}` : ''}: it's in your stash.`,
                ),
              refused(`${name} wasn't bought`),
            );
        }}
      />
    );
  }
  if (page === 'friends') {
    return <FriendsPage party={party} onBack={() => setPage('menu')} onParty={setPartyRes} />;
  }
  if (page === 'admin') {
    return (
      <AdminPage
        mode={mode}
        items={opts.items}
        notice={notice}
        onBack={() => {
          setNotice(null);
          setPage('menu');
        }}
        onStash={() => {
          setNotice(null);
          setPage('stash');
        }}
        onGive={(def, count) =>
          saver
            .give(def.id, count, startPage)
            .then(
              (given) =>
                reopen(given, startPage, `Gave ${def.name}${count > 1 ? ` ×${count}` : ''}.`),
              refused(`${def.name} wasn't given`),
            )
        }
      />
    );
  }
  if (page === 'stash') {
    return (
      <StashPage
        stash={stash}
        items={opts.items}
        quests={opts.quests}
        saver={saver}
        notice={notice}
        busy={busy}
        onBack={() => {
          setNotice(null);
          void saver.flush();
          setPage('menu');
        }}
        raidButton={raidButton}
        startPage={startPage}
        onVendors={() => {
          setNotice(null);
          void saver.flush();
          setPage('vendors');
        }}
        onSellAll={async (on) => {
          // Batches of at most MAX_SELL, each listed afresh from what the server has: refs
          // are by index, so the last batch's selling moved the rest.
          const before = saver.me.profile.money;
          let sold = 0;
          let last: ProfileResponse | null = null;
          try {
            await saver.flush();
            for (;;) {
              const refs = sellAll(saver.me.profile, opts.items).slice(0, MAX_SELL);
              if (!refs.length) break;
              last = await saver.sell(refs);
              sold += refs.length;
            }
          } catch (err) {
            refused(sold ? `Sold ${sold} items, then the rest weren't` : `Nothing was sold`)(err);
            if (last) reopen(last, on, `Sold ${sold} items, then stopped.`);
            return;
          }
          if (last)
            reopen(
              last,
              on,
              `Sold everything (${sold} items) for ${(last.profile.money - before).toLocaleString()}.`,
            );
          else setNotice('Nothing to sell.');
        }}
        onSell={(refs, on) => {
          const name =
            refs.length === 1 ? itemDef(opts.items, refs[0]!.item).name : `${refs.length} items`;
          const before = saver.me.profile.money;
          return saver
            .sell(refs)
            .then(
              (sold) =>
                reopen(
                  sold,
                  on,
                  `Sold ${name} for ${(sold.profile.money - before).toLocaleString()}.`,
                ),
              refused(`${name} wasn't sold`),
            );
        }}
        onBuyPage={() =>
          saver.buyPage().then(
            (bought) => {
              setNotice(null);
              // Open on the new page.
              setStartPage(bought.profile.stash.length - 1);
              setStash(openStash(bought.profile));
              return true;
            },
            (err: unknown) => {
              if (!(err instanceof AccountError)) throw err;
              setNotice(`The page wasn't bought: ${err.message}`);
              return false;
            },
          )
        }
      />
    );
  }
  const pickMode = (m: GameMode): void => {
    setMode(m);
    rememberMode(m);
    setNotice(null);
  };
  const header = (
    <header className="menu-top">
      <h1>{mode === 'zombies' ? 'Zombies' : 'Extraction'}</h1>
      <span className="raid-spacer" />
      <span className="menu-who">
        {me.username}
        {mode === 'extraction' && (
          <>
            {' '}
            · <b>{me.profile.money.toLocaleString()}</b> money
          </>
        )}
      </span>
      <button onClick={() => opts.openSettings(redraw)}>Settings</button>
    </header>
  );
  const modeTabs = zombiesModes.length > 0 && (
    <div className="menu-modes" role="tablist" aria-label="Game mode">
      {MODES.map((m) => (
        <button
          key={m.id}
          role="tab"
          aria-selected={m.id === mode}
          data-mode={m.id}
          className={m.id === mode ? 'active' : undefined}
          disabled={busy}
          onClick={() => pickMode(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
  const adminButton = import.meta.env.DEV && (
    <button onClick={() => setPage('admin')}>
      Admin
      <span>
        {mode === 'zombies'
          ? 'Infinite points, guns to start with, cheats (dev server only)'
          : 'Give yourself items, turn on cheats (dev server only)'}
      </span>
    </button>
  );

  if (mode === 'zombies' && zombiesMode) {
    const names = (ids: readonly string[]): string =>
      ids.map((id) => itemDef(opts.items, id).name).join(' · ');
    return (
      <div className="menu zombies">
        {header}
        <div className="menu-body">
          {modeTabs}
          <div className="menu-buttons">
            {zombiesModes.length > 1 && (
              <div className="menu-maps" role="radiogroup" aria-label="Map">
                {zombiesModes.map((z) => (
                  <button
                    key={z.id}
                    role="radio"
                    aria-checked={z.id === zombiesMode.id}
                    className={z.id === zombiesMode.id ? 'active' : undefined}
                    disabled={busy}
                    onClick={() => setZombiesId(z.id)}
                  >
                    {z.name}
                  </button>
                ))}
              </div>
            )}
            <button
              className="menu-raid primary"
              disabled={busy || !!party}
              onClick={() => go('', undefined, zombiesMode.id)}
            >
              {busy ? 'Starting…' : 'Start game'}
              <span>
                {party
                  ? 'Solo only for now: leave the party to play'
                  : `${zombiesMode.name} · solo · endless rounds`}
              </span>
            </button>
            <div className="menu-card">
              <h2>You start with</h2>
              <p>{names(zombiesMode.kit)} · Knife</p>
              <p>
                <b>{zombiesMode.points.toLocaleString()}</b> points
              </p>
            </div>
            <div className="menu-card">
              <h2>Mystery box</h2>
              <p>{names(zombiesMode.box)}</p>
            </div>
            <div className="menu-card wide">
              <h2>How it works</h2>
              <p>
                Zombies climb in through the windows, more and tougher each round. Shoot and rebuild
                barricades for points, then spend them on wall guns, doors and the box. Play until
                you go down.
              </p>
              <p className="menu-card-note">
                Nothing from your stash goes in, and nothing comes out.
              </p>
            </div>
            {adminButton}
          </div>
          {notice && <p className="menu-notice">{notice}</p>}
        </div>
      </div>
    );
  }
  return (
    <div className="menu">
      {header}
      <div className="menu-body">
        {modeTabs}
        <PartyStrip
          party={partyRes}
          me={me.username}
          onParty={setPartyRes}
          onNotice={setNotice}
          onTest={startTest}
        />
        {testReport && (
          <ConnTestPanel
            report={testReport}
            host={party ? nameOf(pickHost(party) ?? '') : null}
            text={() => test.current?.text() ?? ''}
            onClose={closeTest}
          />
        )}
        <div className="menu-buttons">
          {opts.raids.length > 1 && (
            <div className="menu-maps" role="radiogroup" aria-label="Map">
              {opts.raids.map((r) => (
                <button
                  key={r.id}
                  role="radio"
                  aria-checked={r.id === raid?.id}
                  className={r.id === raid?.id ? 'active' : undefined}
                  disabled={busy || (!!party && !leading)}
                  onClick={() => {
                    setRaidId(r.id);
                    rememberRaid(r.id);
                  }}
                >
                  {r.name}
                </button>
              ))}
            </div>
          )}
          <button
            className={`menu-raid${raidButton.primary ? ' primary' : ''}`}
            disabled={raidButton.disabled}
            onClick={raidButton.onClick}
          >
            {raidButton.label}
            {raid && (
              <span>
                {raid.name} · {Math.round(raid.duration / 60)} min
                {together &&
                  (following
                    ? ` · ${party!.members.find((m) => m.id === party!.leader)?.username ?? 'the leader'} starts it`
                    : waiting.length
                      ? ` · waiting for ${waiting.map((m) => m.username).join(', ')} to be ready`
                      : ' · everyone is ready')}
              </span>
            )}
          </button>
          <button onClick={() => setPage('stash')}>
            Stash and loadout
            <span>{loadoutLine(opts.items, me)}</span>
          </button>
          <button disabled={!opts.vendors.length} onClick={() => setPage('vendors')}>
            Vendors
            <span>{opts.vendors.map((v) => v.name).join(' · ') || 'None yet'}</span>
          </button>
          <button disabled={!opts.quests.length} onClick={() => setPage('quests')}>
            Quests
            <span>{questsLine(opts.quests, me)}</span>
          </button>
          <button onClick={() => setPage('friends')}>
            Friends
            <span>Add friends and invite them to your party</span>
          </button>
          {adminButton}
        </div>
        {notice && <p className="menu-notice">{notice}</p>}
      </div>
    </div>
  );
}

/** The stash's sorts, in the Sort menu. */
const SORTS: readonly [SortKey, string][] = [
  ['type', 'By type'],
  ['rarity', 'By rarity'],
  ['value', 'By value'],
];

function StashPage({
  stash,
  items,
  quests,
  saver,
  notice,
  busy,
  onBack,
  raidButton,
  onBuyPage,
  onSell,
  onSellAll,
  onVendors,
  startPage,
}: {
  stash: StashState;
  items: ItemDb;
  quests: readonly QuestDef[];
  saver: StashSaver;
  notice: string | null;
  busy: boolean;
  onBack: () => void;
  raidButton: RaidButton;
  /** Buys the next page; resolves with whether it was bought. */
  onBuyPage: () => Promise<boolean>;
  /** Sells items, all or none; the page shown is kept. Resolves when sold or refused. */
  onSell: (refs: ItemRef[], page: number) => Promise<void>;
  /** Sells everything that can be sold, gear and stash (sellAll); resolves when done. */
  onSellAll: (page: number) => Promise<void>;
  onVendors: () => void;
  /** The page to show when the stash is (re)opened. */
  startPage: number;
}): ReactNode {
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  // Buying asks for a second tap, and so does selling everything (showing what it brings).
  const [confirming, setConfirming] = useState(false);
  const [buying, setBuying] = useState(false);
  const [sellAllFor, setSellAllFor] = useState<number | null>(null);
  const [sellingAll, setSellingAll] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const [sortOpen, setSortOpen] = useState(false);
  const [sortNote, setSortNote] = useState<string | null>(null);
  const hit = searcher(items, query, category);
  const hits = stash.profile.stash.map((page) => (hit ? countHits(page, hit) : 0));
  const price = nextPagePrice(stash.profile);
  // The controller's open "container" is the page shown: a double-tap into the stash
  // tries it first. A new stash (a page bought, or reloaded) opens on startPage.
  const inv = useMemo(() => {
    const pageOf = (): number => Math.max(0, stashPageOf(ctrl.target ?? { kind: 'self' }));
    const ctrl: InventoryController = new InventoryController(
      {
        sim: stash.sim,
        player: stash.player,
        items,
        send: (action: InventoryAction) => {
          // Read each time: the admin page, a tap away, can change them.
          applySimCheats(stash.player, readCheats());
          if (applyStash(stash, items, action, pageOf())) saver.changed();
          bump();
        },
        nameOf: () => (stash.profile.stash.length > 1 ? `Stash · page ${pageOf() + 1}` : 'Stash'),
        close: onBack,
        stash: true,
        sell: (refs) => onSell(refs, pageOf()),
        quests,
      },
      stashOwner(Math.min(startPage, stash.profile.stash.length - 1)),
      bump,
    );
    return ctrl;
    // onBack and onSell are new each render, but do the same: no need for a new controller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stash, items, saver]);
  const shown = stashPageOf(inv.target ?? { kind: 'self' });
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);
  const show = (p: number): void => {
    setConfirming(false);
    inv.setTarget(stashOwner(p));
  };
  const sellEverything = (): void => {
    if (sellingAll) return;
    if (sellAllFor === null) {
      setSellAllFor(sellAllPrice(stash.profile, items));
      return;
    }
    setSellAllFor(null);
    setSellingAll(true);
    void onSellAll(Math.max(0, shown)).finally(() => setSellingAll(false));
  };
  const buy = (): void => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setBuying(true);
    void onBuyPage().then(() => setBuying(false));
  };
  /** Sorts the page shown (2026-11-06); refused, it says so and nothing moves. */
  const sort = (by: SortKey): void => {
    setSortOpen(false);
    const page = stash.profile.stash[Math.max(0, shown)]!;
    inv.select(null);
    if (sortGrid(items, page, by)) {
      saver.changed();
      setSortNote(null);
    } else setSortNote("It wouldn't all fit sorted: make some room first.");
    bump();
  };
  const page = stash.profile.stash[Math.max(0, shown)]!;
  const used = page.items.reduce(
    (n, g) => n + itemDef(items, g.item.item).size[0] * itemDef(items, g.item.item).size[1],
    0,
  );
  const stashWorth = worth(
    items,
    stash.profile.stash.flatMap((p) => p.items.map((g) => g.item)),
  );
  const head = (
    <>
      <div className="stash-pages" role="tablist" aria-label="Stash pages">
        {stash.profile.stash.map((_, p) => (
          <button
            key={p}
            role="tab"
            aria-selected={p === shown}
            className={`stash-page${p === shown ? ' active' : ''}${hit && !hits[p] ? ' no-hits' : ''}`}
            aria-label={`Stash page ${p + 1}${hit ? `, ${hits[p]} found` : ''}`}
            data-drop={JSON.stringify({ into: stashOwner(p) })}
            onClick={() => show(p)}
          >
            {p + 1}
            {hit && hits[p]! > 0 && <span className="stash-page-hits">{hits[p]}</span>}
          </button>
        ))}
        {price !== null && (
          <button
            className={`stash-buy${confirming ? ' confirm' : ''}`}
            title={`Buy another page for ${price.toLocaleString()}`}
            disabled={buying || stash.profile.money < price}
            onClick={buy}
            onBlur={() => setConfirming(false)}
          >
            {buying ? '…' : confirming ? `Buy · ${price.toLocaleString()}?` : '+'}
          </button>
        )}
      </div>
      <span className="raid-spacer" />
      <span className="stash-used" title="Cells used on this page">
        {used}/{page.w * page.h}
      </span>
      <span className="stash-sort">
        <button
          className={sortOpen ? 'active' : undefined}
          aria-expanded={sortOpen}
          onClick={() => setSortOpen(!sortOpen)}
        >
          Sort
        </button>
        {sortOpen && (
          <span className="stash-sort-menu" role="menu">
            {SORTS.map(([by, label]) => (
              <button key={by} role="menuitem" onClick={() => sort(by)}>
                {label}
              </button>
            ))}
          </span>
        )}
      </span>
    </>
  );
  const search: StashSearch = {
    query,
    setQuery,
    category,
    setCategory,
    hit,
    found: hits.reduce((sum, n) => sum + n, 0),
    title: (
      <>
        Stash <Worth n={stashWorth} />
      </>
    ),
    head,
  };
  const status = saver.status;
  return (
    <div className="raid stash" role="dialog" aria-label="Stash">
      <header className="raid-tabs">
        <button onClick={onBack}>Back</button>
        <span className="stash-title">Stash</span>
        <span className={`stash-save ${status.kind}`}>
          {status.kind === 'failed' ? `Not saved: ${status.message}` : SAVE_TEXT[status.kind]}
        </span>
        <span className="raid-spacer" />
        <span className="vendors-money">
          <b>{stash.profile.money.toLocaleString()}</b> money
        </span>
        <button
          className={`stash-buy${sellAllFor !== null ? ' confirm' : ''}`}
          disabled={sellingAll || busy}
          onClick={sellEverything}
          onBlur={() => setSellAllFor(null)}
        >
          {sellingAll
            ? 'Selling…'
            : sellAllFor !== null
              ? `Sell all for ${sellAllFor.toLocaleString()}?`
              : 'Sell everything'}
        </button>
        {!inv.selling && <button onClick={() => inv.startSelling()}>Select to sell</button>}
        <button onClick={onVendors}>Vendors</button>
        <button
          className={raidButton.primary ? 'primary' : undefined}
          disabled={raidButton.disabled}
          onClick={raidButton.onClick}
        >
          {raidButton.label}
        </button>
      </header>
      {(sortNote ?? notice) && <p className="menu-notice">{sortNote ?? notice}</p>}
      <StashSearchContext.Provider value={search}>
        <Inventory inv={inv} version={version} />
      </StashSearchContext.Provider>
    </div>
  );
}

/**
 * The main menu between sign-in and a raid (session 13): start a raid, the stash and
 * loadout, settings. Resolves when the player starts a raid, once the stash is saved.
 * Loaded lazily, like the other screens.
 */
export function showMainMenu(container: HTMLElement, opts: MenuOptions): Promise<MenuChoice> {
  return new Promise((resolve) => {
    const root = createRoot(container);
    container.hidden = false;
    // The item details' Source compiles every raid's map: do it now, between frames.
    warmItemOrigins();
    root.render(
      <Menu
        opts={opts}
        onRaid={(choice) => {
          root.unmount();
          container.hidden = true;
          resolve(choice);
        }}
      />,
    );
  });
}
