import {
  applyStash,
  itemDef,
  pickHost,
  sortGrid,
  nextPagePrice,
  nextPageQuarters,
  boughtPages,
  sortToCategoryPages,
  QUARTERS,
  openStash,
  quickEquip,
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
  type HangarModuleDef,
  type QuestDef,
  type RecipeDef,
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
import { StashSaver } from '../stash';
import { AdminPage } from './admin-page';
import { ConnTestPanel } from './conn-test-panel';
import { FriendsPage } from './friends-page';
import { lastMode, rememberMode, rememberRaid, type GameMode } from './last-raid';
import {
  ACCENT,
  CharacterStage,
  DeployScreen,
  Drawer,
  Fact,
  Icon,
  LoadoutCard,
  LobbyNav,
  ModeList,
  kitLook,
  lobbyLook,
  type ModeCard,
  type NavItem,
} from './lobby';
import { mapFacts, overviewMap } from './map-overview';
import { InventoryController } from './inventory-controller';
import { favourites } from './favourites';
import { sounds } from '../audio/sounds';
import { GAME_SOUNDS } from '../audio/sound-ids';
import { PartyStrip } from './party-strip';
import {
  Inventory,
  StashSearchContext,
  Worth,
  gearWorth,
  worth,
  type StashSearch,
} from './raid-screen';
import { CATEGORIES, countHits, searcher, type Category } from './stash-search';
import { CategoryIcon } from './category-icons';
import { questCounts, questsLine } from './quests-page';
import { VendorsPage } from './vendors-page';
import { HangarPage } from './hangar-page';
import { collectedLine, hangarLine, readyCrafts, type Names } from './hangar-text';

/** A raid the menu can start. */
export interface RaidChoice {
  id: string;
  name: string;
  /** Seconds. */
  duration: number;
  /** Its map's id in content/maps, for the deploy screen's overview. */
  map: string;
  /** Shown on its entry: "starter". */
  tags?: string[] | undefined;
}

export interface MenuOptions {
  me: ProfileResponse;
  items: ItemDb;
  raids: RaidChoice[];
  /** The raid picked at first (the last one played), else the first in the list. */
  raid?: string | null;
  vendors: VendorDef[];
  quests: QuestDef[];
  /** The Hangar's modules (H3), in their order, and every crafting recipe. */
  hangar: HangarModuleDef[];
  recipes: RecipeDef[];
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
  /** Its map's id in content/maps. */
  map: string;
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

type Page = 'menu' | 'stash' | 'vendors' | 'hangar' | 'admin' | 'friends';

/** What you're taking in, for the menu: guns and armour by name. */
const SHOWN: readonly GearSlot[] = ['primary1', 'primary2', 'sidearm', 'helmet', 'bodyArmour'];

function loadoutLine(items: ItemDb, me: ProfileResponse): string {
  const gear = me.profile.gear as unknown as Record<GearSlot, Item | null>;
  const names = SHOWN.flatMap((s) => (gear[s] ? [itemDef(items, gear[s].item).name] : []));
  return names.length ? names.join(' · ') : 'Only your knife';
}

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
  const [raidId, setRaidId] = useState(
    () => opts.raids.find((r) => r.id === opts.raid)?.id ?? opts.raids[0]?.id,
  );
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

  // The lobby's drawers and the deploy screen (2026-11-09).
  const [sheet, setSheet] = useState<null | 'deploy' | 'modes' | 'party'>(null);
  // You as the lobby shows you, afresh each time you come back from another page.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const look = useMemo(() => lobbyLook(stash.player), [stash, page]);
  const kit = useMemo(
    () => (zombiesMode ? kitLook(opts.items, zombiesMode.kit) : null),
    [opts.items, zombiesMode],
  );

  if (page === 'vendors') {
    const progress = (r: ProfileResponse, q: QuestDef, o: string): number => {
      const s = r.profile.quests[q.id];
      return s?.status === 'active' ? (s.progress[o] ?? 0) : 0;
    };
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
  if (page === 'hangar') {
    const name = (id: string): string => (opts.items.has(id) ? itemDef(opts.items, id).name : id);
    const names: Names = { item: name };
    return (
      <HangarPage
        modules={opts.hangar}
        recipes={opts.recipes}
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
        onUpgrade={(m) =>
          saver.upgradeModule(m.id).then(
            (r) => {
              const level = r.profile.hangar[m.id] ?? 0;
              reopen(
                r,
                startPage,
                level > 1 ? `${m.name} is now level ${level}.` : `Built the ${m.name}.`,
              );
            },
            refused(`The ${m.name} wasn't upgraded`),
          )
        }
        onCraft={(m, recipe) =>
          saver
            .craft(m.id, recipe.id)
            .then(
              (r) =>
                reopen(
                  r,
                  startPage,
                  recipe.output
                    ? `The ${m.name} is making ${name(recipe.output.item)}.`
                    : `The ${m.name} is decrypting: collect it here once it's done.`,
                ),
              refused(`The ${m.name} didn't start`),
            )
        }
        onCollect={(m) => {
          const what = me.profile.crafts[m.id];
          return saver
            .collectCraft(m.id, startPage)
            .then(
              (r) => reopen(r, startPage, collectedLine(names, what)),
              refused('Nothing was collected'),
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
        onBack={() => {
          setNotice(null);
          void saver.flush();
          setPage('menu');
        }}
        startPage={startPage}
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
    setSheet(null);
  };
  const zombies = mode === 'zombies' && !!zombiesMode;
  const accent = zombies ? ACCENT.zombies : ACCENT.extraction;
  const modeCards: ModeCard[] = [
    {
      id: 'extraction',
      name: 'Extraction',
      line: 'Go in with your gear, loot what you can and get out alive. Die and you lose it.',
      tags: ['Solo or party', 'Keeps loot'],
    },
    ...(zombiesModes.length
      ? [
          {
            id: 'zombies',
            name: 'Zombies',
            line: 'Hold out against endless rounds. Earn points, open the box, rebuild the windows.',
            tags: ['Solo', 'Fixed kit'],
          },
        ]
      : []),
  ];
  const leaderName = party?.members.find((m) => m.id === party.leader)?.username ?? 'the leader';
  const partyStatus = together
    ? following
      ? `${leaderName} starts the raid`
      : waiting.length
        ? `Waiting for ${waiting.map((m) => m.username).join(', ')}`
        : 'Everyone is ready'
    : undefined;
  const nav: NavItem[] = zombies
    ? [
        {
          id: 'friends',
          label: 'Friends',
          icon: 'friends',
          badge: partyRes?.friendRequests ?? 0,
          title: friendsLine(partyRes),
          onClick: () => setPage('friends'),
        },
      ]
    : [
        {
          id: 'stash',
          label: 'Stash',
          icon: 'stash',
          title: loadoutLine(opts.items, me),
          onClick: () => setPage('stash'),
        },
        {
          id: 'vendors',
          label: 'Vendors',
          icon: 'vendors',
          disabled: !opts.vendors.length,
          // Quests live inside the vendors (2026-11-10), so their badge and line are here.
          badge: questCounts(opts.quests, me).fresh,
          title: opts.quests.length
            ? questsLine(opts.quests, me)
            : opts.vendors.map((v) => v.name).join(' · ') || 'None yet',
          onClick: () => setPage('vendors'),
        },
        {
          id: 'hangar',
          label: 'Hangar',
          icon: 'hangar',
          disabled: !opts.hangar.length,
          badge: readyCrafts(me),
          title: hangarLine(opts.hangar, me),
          onClick: () => setPage('hangar'),
        },
        {
          id: 'friends',
          label: 'Friends',
          icon: 'friends',
          badge: partyRes?.friendRequests ?? 0,
          title: friendsLine(partyRes),
          onClick: () => setPage('friends'),
        },
      ];
  if (import.meta.env.DEV) {
    nav.push({
      id: 'admin',
      label: 'Admin',
      icon: 'admin',
      title: zombies
        ? 'Infinite points, guns to start with, cheats (dev server only)'
        : 'Give yourself items, turn on cheats (dev server only)',
      onClick: () => setPage('admin'),
    });
  }
  const invites = partyRes?.invites.length ?? 0;
  // Everything you take in, vault included, as the stash's Gear Value shows it (2026-11-09).
  const loadoutWorth = gearWorth(opts.items, me.profile.gear);
  // The vault and knife survive a death, so only the rest is at risk.
  const atRisk = gearWorth(opts.items, me.profile.gear, false);

  const top = (
    <header className="lobby-top">
      <button
        className="lobby-mode-button"
        aria-label={`Game mode: ${zombies ? 'Zombies' : 'Extraction'}. Change`}
        disabled={modeCards.length < 2}
        onClick={() => setSheet('modes')}
      >
        <Icon name="modes" size={16} />
        <span>
          <small>Mode</small>
          {zombies ? 'Zombies' : 'Extraction'}
        </span>
        {modeCards.length > 1 && <Icon name="chevron" size={14} />}
      </button>
      <span className="raid-spacer" />
      {!zombies && (
        <button
          className={`lobby-chip${together ? ' active' : ''}`}
          aria-label="Party"
          onClick={() => setSheet('party')}
        >
          <Icon name="party" size={16} />
          <span>{party ? `${party.members.length}` : 'Party'}</span>
          {invites > 0 && <b className="lobby-badge">{invites}</b>}
        </button>
      )}
      {!zombies && (
        <span className="lobby-money" title={`${me.profile.money.toLocaleString()} money`}>
          ${me.profile.money.toLocaleString()}
        </span>
      )}
      <span className="lobby-who">{me.username}</span>
      <button
        className="lobby-icon-button"
        aria-label="Settings"
        data-pad-options
        onClick={() => opts.openSettings(redraw)}
      >
        <Icon name="settings" size={20} />
      </button>
    </header>
  );

  const members = party && together && (
    <ul className="lobby-party" aria-label="Party">
      {party.members.map((m) => (
        <li key={m.id} className={`${m.ready ? 'ready' : ''}${m.online ? '' : ' away'}`}>
          {m.id === party.leader && <span title="Leader">★</span>}
          {m.username}
          <i>{m.ready ? '✓' : m.online ? '…' : 'away'}</i>
        </li>
      ))}
    </ul>
  );

  // The card over Deploy: your loadout, or in zombies the kit everyone starts with.
  const side = zombies ? (
    <div className="lobby-card lobby-kit">
      <span className="lobby-card-head">
        <span>Starting kit</span>
        <span className="lobby-worth">{zombiesMode.points.toLocaleString()} pts</span>
      </span>
      <p>{[...zombiesMode.kit.map((id) => itemDef(opts.items, id).name), 'Knife'].join(' · ')}</p>
      <p className="lobby-card-note">Nothing from your stash goes in, and nothing comes out.</p>
    </div>
  ) : (
    <LoadoutCard
      items={opts.items}
      player={stash.player}
      worth={loadoutWorth}
      onOpen={() => setPage('stash')}
    />
  );

  const deployLine = zombies
    ? `${zombiesMode.name} · solo`
    : raid
      ? `${raid.name} · ${Math.round(raid.duration / 60)} min`
      : 'No maps';

  let deploy: ReactNode = null;
  if (sheet === 'deploy' && zombies) {
    const names = (ids: readonly string[]): string =>
      ids.map((id) => itemDef(opts.items, id).name).join(' · ');
    deploy = (
      <DeployScreen
        title="Zombies"
        entries={zombiesModes.map((z) => ({ id: z.id, name: z.name, line: 'Endless rounds' }))}
        selected={zombiesMode.id}
        onSelect={setZombiesId}
        locked={null}
        map={overviewMap(zombiesMode.map)}
        info={
          <>
            <h3 className="lobby-intel-title">{zombiesMode.name}</h3>
            <Fact icon="vendors" label="Points">
              {zombiesMode.points.toLocaleString()}
            </Fact>
            <Fact icon="squad" label="Start with" block>
              {names(zombiesMode.kit)} · Knife
            </Fact>
            <Fact icon="stash" label="Mystery box" block>
              {names(zombiesMode.box)}
            </Fact>
            <p className="lobby-intel-note">
              Zombies climb in through the windows, more and tougher each round. Shoot them and
              rebuild barricades for points, then spend them on wall guns, doors and the box.
            </p>
          </>
        }
        action={{
          label: busy ? 'Starting…' : 'Start game',
          primary: true,
          disabled: busy || !!party,
          onClick: () => go('', undefined, zombiesMode.id),
          status: party ? 'Solo only for now: leave the party to play' : undefined,
        }}
        onClose={() => setSheet(null)}
      />
    );
  } else if (sheet === 'deploy' && raid) {
    const map = overviewMap(raid.map);
    const facts = map ? mapFacts(map) : null;
    deploy = (
      <DeployScreen
        title="Select map"
        entries={opts.raids.map((r) => ({
          id: r.id,
          name: r.name,
          line: `${Math.round(r.duration / 60)} min`,
          tags: r.tags,
        }))}
        selected={raid.id}
        onSelect={(id) => {
          setRaidId(id);
          rememberRaid(id);
        }}
        locked={partyRaid ? `${leaderName} picks the map` : null}
        map={map}
        info={
          <>
            <h3 className="lobby-intel-title">{raid.name}</h3>
            <Fact icon="clock" label="Raid time">
              {Math.round(raid.duration / 60)} min
            </Fact>
            {facts && (
              <>
                <Fact icon="exit" label="Extracts">
                  {facts.fixed}
                  {facts.rotating > 0 && ` + ${facts.rotatingOpen} of ${facts.rotating}`}
                </Fact>
                <Fact icon="skull" label="PMC squads">
                  {facts.pmcs
                    ? facts.pmcs[0] === facts.pmcs[1]
                      ? facts.pmcs[0]
                      : `${facts.pmcs[0]}–${facts.pmcs[1]}`
                    : 'None'}
                </Fact>
                <Fact icon="stash" label="Area">
                  {facts.size[0]} × {facts.size[1]} m
                </Fact>
              </>
            )}
            <Fact icon="squad" label="At risk">
              ${atRisk.toLocaleString()}
            </Fact>
            <Fact icon="squad" label="Taking in" block>
              {loadoutLine(opts.items, me)}
            </Fact>
            <p className="lobby-legend">
              <i className="fixed" /> Always open <i className="maybe" /> Some raids
            </p>
          </>
        }
        action={{
          label: raidButton.label,
          primary: raidButton.primary,
          disabled: raidButton.disabled,
          onClick: raidButton.onClick,
          status: partyStatus,
        }}
        onClose={() => setSheet(null)}
      />
    );
  }

  return (
    <div className={`menu lobby${zombies ? ' zombies' : ''}`}>
      <CharacterStage
        items={opts.items}
        character={zombies ? (kit ?? look) : look}
        accent={accent}
      />
      {top}
      <div className="lobby-main">
        <LobbyNav items={nav} />
        <span className="raid-spacer" />
        <div className="lobby-right">
          {side}
          <button
            className="lobby-deploy-button"
            disabled={zombies ? false : !raid}
            onClick={() => {
              setNotice(null);
              setSheet('deploy');
            }}
          >
            <span className="lobby-deploy-label">{zombies ? 'Play' : 'Deploy'}</span>
            <span className="lobby-deploy-line">{deployLine}</span>
            {!zombies && partyStatus && <span className="lobby-deploy-line">{partyStatus}</span>}
          </button>
        </div>
      </div>
      {members}
      {notice && (
        <button className="lobby-toast" onClick={() => setNotice(null)}>
          {notice}
        </button>
      )}
      {deploy}
      {sheet === 'modes' && (
        <Drawer side="left" title="Game mode" onClose={() => setSheet(null)}>
          <ModeList
            modes={modeCards}
            current={zombies ? 'zombies' : 'extraction'}
            disabled={busy}
            onPick={(id) => pickMode(id as GameMode)}
          />
        </Drawer>
      )}
      {(sheet === 'party' || testReport) && !zombies && (
        <Drawer
          side="right"
          title="Party"
          onClose={() => (testReport ? closeTest() : setSheet(null))}
        >
          <PartyStrip
            party={partyRes}
            me={me.username}
            onParty={setPartyRes}
            onNotice={setNotice}
            onTest={startTest}
            onFriends={() => setPage('friends')}
          />
          {testReport && (
            <ConnTestPanel
              report={testReport}
              host={party ? nameOf(pickHost(party) ?? '') : null}
              text={() => test.current?.text() ?? ''}
              onClose={closeTest}
            />
          )}
        </Drawer>
      )}
    </div>
  );
}

/** The Friends button's line: who's online, from the menu's heartbeat (UX-5). */
function friendsLine(p: PartyResponse | null): string {
  if (!p || !p.friendCount) return 'Add friends and invite them to your party';
  return p.friendsOnline ? `${p.friendsOnline} online` : 'No one online';
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
  onBack,
  onBuyPage,
  onSell,
  startPage,
}: {
  stash: StashState;
  items: ItemDb;
  quests: readonly QuestDef[];
  saver: StashSaver;
  notice: string | null;
  onBack: () => void;
  /** Buys the next page; resolves with whether it was bought. */
  onBuyPage: () => Promise<boolean>;
  /** Sells items, all or none; the page shown is kept. Resolves when sold or refused. */
  onSell: (refs: ItemRef[], page: number) => Promise<void>;
  /** The page to show when the stash is (re)opened. */
  startPage: number;
}): ReactNode {
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  // Buying asks for a second tap.
  const [confirming, setConfirming] = useState(false);
  const [buying, setBuying] = useState(false);
  // The locked next page's tooltip: which Quarters level it needs (H4).
  const [lockTip, setLockTip] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const [sortOpen, setSortOpen] = useState(false);
  const [sortNote, setSortNote] = useState<string | null>(null);
  // A short message over the stash that goes by itself (quick equip's "Stash full").
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(t);
  }, [toast]);
  const hit = searcher(items, query, category);
  const hits = stash.profile.stash.map((page) => (hit ? countHits(page, hit) : 0));
  const price = nextPagePrice(stash.profile);
  // The next page needs Quarters a level higher (H4); below it, the tab shows a lock.
  const quarters = nextPageQuarters(stash.profile);
  const locked = quarters !== null && (stash.profile.hangar[QUARTERS] ?? 0) < quarters;
  const bought = boughtPages(stash.profile);
  /** Leaving the stash: auto sort puts loose items onto their category pages first (H4). */
  const close = (): void => {
    if (sortToCategoryPages(items, stash.profile)) saver.changed();
    onBack();
  };
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
        nameOf: () => {
          const only = stash.profile.stash[pageOf()]?.only;
          if (only) return `Stash · ${CATEGORIES.find((c) => c.id === only)!.label}`;
          return stash.profile.stash.length > 1 ? `Stash · page ${pageOf() + 1}` : 'Stash';
        },
        close,
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
      if (e.code === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const show = (p: number): void => {
    setConfirming(false);
    inv.setTarget(stashOwner(p));
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
  /**
   * Empties the gear into the stash and puts on the best kit (2026-11-09, the user's
   * call; stash-quick-equip.ts). If what comes off won't fit, nothing changes.
   */
  const equipBest = (): void => {
    inv.select(null);
    const result = quickEquip(stash.profile, items, favourites(), Math.max(0, shown));
    if (result === 'full') {
      sounds().play(GAME_SOUNDS.refuse);
      setToast('Stash full');
    } else if (result === 'equipped') saver.changed();
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
  // Down the right of the grid (UX-3, 2026-11-08), not in the header.
  const tabs = (
    <div
      className="stash-pages"
      role="tablist"
      aria-label="Stash pages"
      aria-orientation="vertical"
    >
      {stash.profile.stash.map((g, p) => {
        const label = g.only ? CATEGORIES.find((c) => c.id === g.only)!.label : `page ${p + 1}`;
        return (
          <button
            key={p}
            role="tab"
            aria-selected={p === shown}
            className={`stash-page${g.only ? ' stash-cat' : ''}${p === shown ? ' active' : ''}${hit && !hits[p] ? ' no-hits' : ''}`}
            aria-label={`Stash ${label}${hit ? `, ${hits[p]} found` : ''}`}
            title={g.only ? `${label} page: only ${label.toLowerCase()} go here` : undefined}
            data-drop={JSON.stringify({ into: stashOwner(p) })}
            onClick={() => show(p)}
            // The next page's button comes after the bought pages, before the category ones.
            style={{ order: g.only ? 2 : 0 }}
          >
            {g.only ? <CategoryIcon id={g.only} /> : p + 1}
            {hit && hits[p]! > 0 && <span className="stash-page-hits">{hits[p]}</span>}
          </button>
        );
      })}
      {/*
        The next page: a + that buys it (two taps), or with Quarters too low a lock whose
        tap says the level it needs (H4; a lock with a placeholder tooltip from 2026-11-09).
      */}
      {price !== null && !locked && (
        <button
          className={`stash-buy${confirming ? ' confirm' : ''}`}
          title={`Buy page ${bought + 1} for ${price.toLocaleString()}`}
          disabled={buying || stash.profile.money < price}
          onClick={buy}
          onBlur={() => setConfirming(false)}
          style={{ order: 1 }}
        >
          {buying ? '…' : confirming ? `Buy · ${price.toLocaleString()}?` : '+'}
        </button>
      )}
      {price !== null && locked && (
        <span className="stash-lock-wrap" style={{ order: 1 }}>
          <button
            className={`stash-lock${lockTip ? ' active' : ''}`}
            aria-label={`Page ${bought + 1}, locked`}
            aria-describedby={lockTip ? 'stash-lock-tip' : undefined}
            onClick={() => setLockTip(!lockTip)}
            onBlur={() => setLockTip(false)}
          >
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
              <path
                d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <rect x="3" y="7" width="10" height="7.5" rx="1.2" fill="currentColor" />
            </svg>
          </button>
          {lockTip && (
            <span id="stash-lock-tip" className="stash-lock-tip" role="tooltip">
              Page {bought + 1} needs Quarters level {quarters} (Hangar)
            </span>
          )}
        </span>
      )}
    </div>
  );
  const head = (
    <>
      <span className="raid-spacer" />
      <span className="stash-used" title="Cells used on this page">
        {used}/{page.w * page.h}
      </span>
    </>
  );
  // The bar along the stash's bottom (2026-11-09, the user's call): sort, and sell.
  const foot = (
    <>
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
      <span className="raid-spacer" />
      {!inv.selling && <button onClick={() => inv.startSelling()}>Sell</button>}
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
    foot,
    gearFoot: (
      <button
        className="stash-quick-equip"
        title="Put everything in the stash, then equip the best gun you have rounds for, armour, bags and meds"
        onClick={equipBest}
      >
        Quick equip
      </button>
    ),
    tabs,
  };
  return (
    <div className="raid stash" role="dialog" aria-label="Stash">
      {/* A back arrow and the title, and the money on the right (2026-11-09, the user's
          call); Vendors and the raid button are on the menu, selling and sorting in the bar
          along the stash's bottom. */}
      <header className="raid-tabs stash-top">
        <button className="stash-back" aria-label="Back" onClick={close}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M19 12H5M11 5l-7 7 7 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <span className="stash-top-title">Stash</span>
        <span className="raid-spacer" />
        <span className="stash-money">${stash.profile.money.toLocaleString()}</span>
      </header>
      {(sortNote ?? notice) && <p className="menu-notice">{sortNote ?? notice}</p>}
      <StashSearchContext.Provider value={search}>
        <Inventory inv={inv} version={version} />
      </StashSearchContext.Provider>
      {toast && (
        <button className="stash-toast" role="status" onClick={() => setToast(null)}>
          {toast}
        </button>
      )}
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
