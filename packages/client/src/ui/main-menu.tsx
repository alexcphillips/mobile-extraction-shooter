import {
  applyStash,
  itemDef,
  nextPagePrice,
  openStash,
  stashOwner,
  stashPageOf,
  type GearSlot,
  type InventoryAction,
  type Item,
  type ItemDb,
  type ItemRef,
  type ProfileResponse,
  type StashState,
  type VendorDef,
} from '@mes/shared';
import { useEffect, useMemo, useReducer, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { AccountError } from '../account';
import { StashSaver, type StashSaveStatus } from '../stash';
import { InventoryController } from './inventory-controller';
import { Inventory } from './raid-screen';
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
  /** Opens the settings screen over the menu; done is called when it closes. */
  openSettings: (done: () => void) => void;
}

/** What the player chose: a raid to start, with the profile as saved. */
export interface MenuChoice {
  raid: string;
  me: ProfileResponse;
}

type Page = 'menu' | 'stash' | 'vendors';

/** What you're taking in, for the menu: guns and armour by name. */
const SHOWN: readonly GearSlot[] = ['primary1', 'primary2', 'sidearm', 'helmet', 'bodyArmour'];

function loadoutLine(items: ItemDb, me: ProfileResponse): string {
  const gear = me.profile.gear as unknown as Record<GearSlot, Item | null>;
  const names = SHOWN.flatMap((s) => (gear[s] ? [itemDef(items, gear[s].item).name] : []));
  return names.length ? names.join(' · ') : 'Only your knife';
}

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
  const raid = opts.raids[0];

  const start = (): void => {
    if (!raid || busy) return;
    setBusy(true);
    void saver.flush().then((status) => {
      if (status.kind === 'failed') {
        setBusy(false);
        setNotice(`Your stash isn't saved, so the raid can't start yet: ${status.message}`);
        return;
      }
      onRaid({ raid: raid.id, me: saver.me });
    });
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

  if (page === 'vendors') {
    return (
      <VendorsPage
        vendors={opts.vendors}
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
        onBuy={(vendor, offer) => {
          const o = vendor.sells[offer]!;
          const name = itemDef(opts.items, o.item).name;
          return saver
            .buy(vendor.id, offer, startPage)
            .then(
              (bought) =>
                reopen(
                  bought,
                  startPage,
                  `Bought ${name}${(o.count ?? 1) > 1 ? ` ×${o.count}` : ''}: it's in your stash.`,
                ),
              refused(`${name} wasn't bought`),
            );
        }}
      />
    );
  }
  if (page === 'stash') {
    return (
      <StashPage
        stash={stash}
        items={opts.items}
        saver={saver}
        notice={notice}
        busy={busy}
        onBack={() => {
          setNotice(null);
          void saver.flush();
          setPage('menu');
        }}
        onRaid={start}
        startPage={startPage}
        onVendors={() => {
          setNotice(null);
          void saver.flush();
          setPage('vendors');
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
  return (
    <div className="menu">
      <header className="menu-top">
        <h1>Extraction</h1>
        <span className="raid-spacer" />
        <span className="menu-who">
          {me.username} · <b>{me.profile.money.toLocaleString()}</b> money
        </span>
        <button onClick={() => opts.openSettings(redraw)}>Settings</button>
      </header>
      <div className="menu-body">
        <div className="menu-buttons">
          <button className="primary menu-raid" disabled={!raid || busy} onClick={start}>
            {busy ? 'Starting…' : 'Start raid'}
            {raid && (
              <span>
                {raid.name} · {Math.round(raid.duration / 60)} min
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
          <button disabled>
            Quests <span>Coming in session 14</span>
          </button>
        </div>
        {notice && <p className="menu-notice">{notice}</p>}
      </div>
    </div>
  );
}

function StashPage({
  stash,
  items,
  saver,
  notice,
  busy,
  onBack,
  onRaid,
  onBuyPage,
  onSell,
  onVendors,
  startPage,
}: {
  stash: StashState;
  items: ItemDb;
  saver: StashSaver;
  notice: string | null;
  busy: boolean;
  onBack: () => void;
  onRaid: () => void;
  /** Buys the next page; resolves with whether it was bought. */
  onBuyPage: () => Promise<boolean>;
  /** Sells items, all or none; the page shown is kept. Resolves when sold or refused. */
  onSell: (refs: ItemRef[], page: number) => Promise<void>;
  onVendors: () => void;
  /** The page to show when the stash is (re)opened. */
  startPage: number;
}): ReactNode {
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const pages = stash.profile.stash.length;
  // Buying asks for a second tap.
  const [confirming, setConfirming] = useState(false);
  const [buying, setBuying] = useState(false);
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
          if (applyStash(stash, items, action, pageOf())) saver.changed();
          bump();
        },
        nameOf: () => (stash.profile.stash.length > 1 ? `Stash · page ${pageOf() + 1}` : 'Stash'),
        close: onBack,
        stash: true,
        sell: (refs) => onSell(refs, pageOf()),
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
  const buy = (): void => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setBuying(true);
    void onBuyPage().then(() => setBuying(false));
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
        {pages > 1 &&
          stash.profile.stash.map((_, p) => (
            <button
              key={p}
              className={`stash-page${p === shown ? ' active' : ''}`}
              aria-label={`Stash page ${p + 1}`}
              data-drop={JSON.stringify({ into: stashOwner(p) })}
              onClick={() => show(p)}
            >
              {p + 1}
            </button>
          ))}
        {price !== null && (
          <button
            className={`stash-buy${confirming ? ' confirm' : ''}`}
            disabled={buying || stash.profile.money < price}
            onClick={buy}
            onBlur={() => setConfirming(false)}
          >
            {buying
              ? 'Buying…'
              : confirming
                ? `Buy for ${price.toLocaleString()}?`
                : `+ Page · ${price.toLocaleString()}`}
          </button>
        )}
        <span className="vendors-money">
          <b>{stash.profile.money.toLocaleString()}</b> money
        </span>
        <button onClick={onVendors}>Vendors</button>
        <button className="primary" disabled={busy} onClick={onRaid}>
          {busy ? 'Starting…' : 'Start raid'}
        </button>
      </header>
      {notice && <p className="menu-notice">{notice}</p>}
      <Inventory inv={inv} version={version} />
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
