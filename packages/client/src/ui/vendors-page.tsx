import {
  MAX_BUY,
  VENDOR,
  VENDOR_LEVELS,
  buyPrice,
  itemDef,
  newStashItem,
  nextRestock,
  offerLevel,
  standingOf,
  vendorLevel,
  vendorStock,
  type Item,
  type ItemDb,
  type ProfileResponse,
  type QuestDef,
  type VendorDef,
  type VendorOffer,
  type VendorStanding,
} from '@mes/shared';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { itemPortrait } from '../render/item-portrait';
import { ItemDetails } from './item-details';
import { TraderQuests, vendorQuestCounts } from './quests-page';
import { colourOf } from './raid-screen';
import { CATEGORIES, searcher, type Category } from './stash-search';

/*
 * The vendors page between raids (session 13b; reworked 2026-11-06 after Tarkov's traders;
 * reworked again 2026-11-10, the user's call, as Tarkov's unified trader screen). It opens
 * on the hub: a card for each vendor, in its colour, with its level, the progress to the
 * next and its quests ready to hand in or new. A vendor opens on its own page, with its
 * standing down the side, a Shop and a Quests tab, and the other vendors to switch to.
 * Shop: its offers as cards, with category chips, a search and a sort; offers above its
 * level show locked, and a tap opens the item's details with how many to buy. Stock is
 * unlimited; selling is done from the stash page.
 */

type Sort = 'level' | 'cheap' | 'dear' | 'name';
const SORTS: readonly [Sort, string][] = [
  ['level', 'Level'],
  ['cheap', 'Price ↑'],
  ['dear', 'Price ↓'],
  ['name', 'Name'],
];

type Tab = 'shop' | 'quests';

/** Level numbers as Tarkov writes loyalty levels. */
export const ROMAN = ['', 'I', 'II', 'III', 'IV'];

const COMPACT = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

export function VendorsPage({
  vendors,
  items,
  quests,
  me,
  notice,
  onBack,
  onStash,
  onBuy,
  onAccept,
  onHandOver,
  onComplete,
}: {
  vendors: readonly VendorDef[];
  items: ItemDb;
  quests: readonly QuestDef[];
  me: ProfileResponse;
  notice: string | null;
  onBack: () => void;
  onStash: () => void;
  /** Buys `times` of an offer by its index; resolves when bought or refused. */
  onBuy: (vendor: VendorDef, offer: number, times: number) => Promise<void>;
  /** Each resolves when done or refused. */
  onAccept: (q: QuestDef) => Promise<void>;
  onHandOver: (q: QuestDef, objective: string) => Promise<void>;
  onComplete: (q: QuestDef) => Promise<void>;
}): ReactNode {
  // The vendor open, by id; null is the hub.
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('shop');
  // The time, for a rotating vendor's stock and its countdown.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code !== 'Escape') return;
      if (open) setOpen(null);
      else onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack, open]);
  const profile = me.profile;
  const counts = (v: VendorDef) => vendorQuestCounts(quests, profile, v.id);
  // A vendor opens on its quests when one is ready to hand in, else on its shop.
  const show = (v: VendorDef): void => {
    setTab(counts(v).ready ? 'quests' : 'shop');
    setOpen(v.id);
  };
  const vendor = vendors.find((v) => v.id === open);
  const money = (
    <span className="vendors-money">
      <b>{profile.money.toLocaleString()}</b> money
    </span>
  );

  if (!vendor) {
    return (
      <div className="raid stash vendors traders" role="dialog" aria-label="Vendors">
        <header className="raid-tabs">
          <button onClick={onBack}>Back</button>
          <span className="stash-title">Vendors</span>
          <span className="raid-spacer" />
          {money}
          <button onClick={onStash}>Stash</button>
        </header>
        {notice && <p className="menu-notice">{notice}</p>}
        <ul className="trader-hub" aria-label="Vendors">
          {vendors.map((v, i) => (
            <TraderTile
              key={v.id}
              vendor={v}
              index={i}
              standing={standingOf(profile, v.id)}
              counts={counts(v)}
              onClick={() => show(v)}
            />
          ))}
        </ul>
      </div>
    );
  }

  const level = vendorLevel(vendor, standingOf(profile, vendor.id));
  const mine = counts(vendor);
  const restock = nextRestock(vendor, now);
  return (
    <div className="raid stash vendors traders" role="dialog" aria-label={vendor.name}>
      <header className="raid-tabs">
        <button onClick={() => setOpen(null)} aria-label="All vendors">
          ‹ Vendors
        </button>
        <span className="stash-title trader-crumb">{vendor.name}</span>
        <span className="raid-spacer" />
        {money}
        <button onClick={onStash}>Stash</button>
      </header>
      {notice && <p className="menu-notice">{notice}</p>}
      <div className="trader-layout" style={{ ['--vendor' as string]: colourOf2(vendor) }}>
        <aside className="trader-side">
          <div className="trader-id">
            <Emblem vendor={vendor} />
            <div className="trader-id-text">
              <h2>{vendor.name}</h2>
              <span className="trader-ll">
                Level <b>{ROMAN[level]}</b>
              </span>
            </div>
          </div>
          {vendor.blurb && <p className="trader-blurb">{vendor.blurb}</p>}
          <Standing vendor={vendor} profile={profile} level={level} />
          {((vendor.markup && vendor.markup > 1) || restock !== null) && (
            <div className="trader-tags">
              {vendor.markup && vendor.markup > 1 && (
                <span className="vendors-tag">Prices ×{vendor.markup}</span>
              )}
              {restock !== null && (
                <span className="vendors-tag">New stock in {duration(restock - now)}</span>
              )}
            </div>
          )}
          <div className="trader-tabs" role="tablist" aria-label={vendor.name}>
            <button
              role="tab"
              aria-selected={tab === 'shop'}
              className={tab === 'shop' ? 'on' : undefined}
              onClick={() => setTab('shop')}
            >
              <span className="trader-tab-icon" aria-hidden>
                ◆
              </span>
              Shop
            </button>
            <button
              role="tab"
              aria-selected={tab === 'quests'}
              className={tab === 'quests' ? 'on' : undefined}
              onClick={() => setTab('quests')}
            >
              <span className="trader-tab-icon" aria-hidden>
                ✦
              </span>
              Quests
              <QuestPills counts={mine} />
            </button>
          </div>
          <nav className="trader-switch" aria-label="Other vendors">
            {vendors.map((v) => {
              const c = counts(v);
              return (
                <button
                  key={v.id}
                  className={v.id === vendor.id ? 'on' : undefined}
                  style={{ ['--vendor' as string]: colourOf2(v) }}
                  aria-current={v.id === vendor.id}
                  aria-label={v.name}
                  title={v.name}
                  onClick={() => show(v)}
                >
                  <Emblem vendor={v} small />
                  {c.ready ? (
                    <span className="trader-dot ready" />
                  ) : c.fresh ? (
                    <span className="trader-dot new" />
                  ) : null}
                </button>
              );
            })}
          </nav>
        </aside>
        <section className="trader-main" key={`${vendor.id}:${tab}`}>
          {tab === 'shop' ? (
            <TraderShop
              vendor={vendor}
              items={items}
              quests={quests}
              profile={profile}
              level={level}
              now={now}
              onBuy={(offer, times) => onBuy(vendor, offer, times)}
            />
          ) : (
            <TraderQuests
              vendor={vendor}
              quests={quests}
              items={items}
              me={me}
              onAccept={onAccept}
              onHandOver={onHandOver}
              onComplete={onComplete}
            />
          )}
        </section>
      </div>
    </div>
  );
}

/** A vendor's colour, or the amber the screens use. */
function colourOf2(vendor: VendorDef): string {
  return vendor.colour ?? '#e3a33a';
}

/** A vendor's mark: its initial on a hexagon in its colour. */
function Emblem({ vendor, small }: { vendor: VendorDef; small?: boolean }): ReactNode {
  return (
    <span
      className={`trader-emblem${small ? ' small' : ''}`}
      style={{ ['--vendor' as string]: colourOf2(vendor) }}
      aria-hidden
    >
      <span>{vendor.name[0]}</span>
    </span>
  );
}

/** Quests ready to hand in (green) and new (red), as pills. */
function QuestPills({ counts }: { counts: { ready: number; fresh: number } }): ReactNode {
  return (
    <>
      {counts.ready > 0 && (
        <span className="trader-pill ready" title="Ready to hand in">
          {counts.ready} ready
        </span>
      )}
      {counts.fresh > 0 && (
        <span className="trader-pill new" title="New quests">
          {counts.fresh} new
        </span>
      )}
    </>
  );
}

/** How far to the next level: the lesser of the rep and spending shares. 1 at the top. */
function nextShare(vendor: VendorDef, standing: VendorStanding, level: number): number {
  const next = level < VENDOR_LEVELS ? vendor.levels[level - 1] : undefined;
  if (!next) return 1;
  const share = (v: number, need: number): number => (need <= 0 ? 1 : Math.min(1, v / need));
  return Math.min(share(standing.rep, next.rep), share(standing.spent, next.spent));
}

/** A vendor on the hub: a tall card in its colour with its mark, level and quests. */
function TraderTile({
  vendor,
  index,
  standing,
  counts,
  onClick,
}: {
  vendor: VendorDef;
  index: number;
  standing: VendorStanding;
  counts: { ready: number; fresh: number; active: number };
  onClick: () => void;
}): ReactNode {
  const level = vendorLevel(vendor, standing);
  const f = nextShare(vendor, standing, level);
  const top = level >= VENDOR_LEVELS;
  return (
    <li style={{ ['--i' as string]: index }}>
      <button
        className="trader-tile"
        style={{ ['--vendor' as string]: colourOf2(vendor) }}
        aria-label={`${vendor.name}, level ${level}${counts.ready ? `, ${counts.ready} quests ready` : ''}${counts.fresh ? `, ${counts.fresh} new quests` : ''}`}
        onClick={onClick}
      >
        <span className="trader-tile-art">
          <span className="trader-tile-mark" aria-hidden>
            {vendor.name[0]}
          </span>
          <Emblem vendor={vendor} />
          <span className="trader-tile-ll" aria-hidden>
            Lv <b>{ROMAN[level]}</b>
          </span>
          <span className="trader-tile-pills">
            <QuestPills counts={counts} />
          </span>
        </span>
        <span className="trader-tile-body">
          <b className="trader-tile-name">{vendor.name}</b>
          {vendor.blurb && <span className="trader-tile-blurb">{vendor.blurb}</span>}
          <span className="trader-tile-next">
            <span className="trader-tile-track">
              <span className="trader-tile-fill" style={{ transform: `scaleX(${f})` }} />
            </span>
            <span>{top ? 'Top level' : `To ${ROMAN[level + 1]}`}</span>
          </span>
          <span className="trader-tile-sub">
            {counts.active ? `${counts.active} quest${counts.active > 1 ? 's' : ''} active` : ' '}
          </span>
        </span>
      </button>
    </li>
  );
}

/** The vendor's standing: what the next level needs, with bars for rep and money so far. */
function Standing({
  vendor,
  profile,
  level,
}: {
  vendor: VendorDef;
  profile: ProfileResponse['profile'];
  level: number;
}): ReactNode {
  const standing = standingOf(profile, vendor.id);
  const next = level < VENDOR_LEVELS ? vendor.levels[level - 1]! : null;
  if (!next) return <p className="trader-standing top">Top level: everything is yours to buy.</p>;
  return (
    <div className="trader-standing" aria-label={`To level ${level + 1}`}>
      <span className="trader-standing-head">To level {ROMAN[level + 1]}</span>
      <Bar
        label="Rep"
        value={standing.rep}
        need={next.rep}
        text={`${standing.rep.toFixed(2)} / ${next.rep.toFixed(2)}`}
      />
      <Bar
        label="Spent"
        value={standing.spent}
        need={next.spent}
        text={`${COMPACT.format(standing.spent)} / ${COMPACT.format(next.spent)}`}
      />
    </div>
  );
}

/** A vendor's Shop tab: search, kinds, sort and locked over its offers as cards. */
function TraderShop({
  vendor,
  items,
  quests,
  profile,
  level,
  now,
  onBuy,
}: {
  vendor: VendorDef;
  items: ItemDb;
  quests: readonly QuestDef[];
  profile: ProfileResponse['profile'];
  level: number;
  now: number;
  onBuy: (offer: number, times: number) => Promise<void>;
}): ReactNode {
  const [inspecting, setInspecting] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const [sort, setSort] = useState<Sort>('level');
  const [sortOpen, setSortOpen] = useState(false);
  const [locked, setLocked] = useState(true);
  // Each offer as the item it buys, to draw and search (made once per vendor).
  const goods = useMemo(() => vendor.sells.map((o) => newStashItem(items, o)), [vendor, items]);
  const hit = searcher(items, query, category);
  const name = (i: number): string => itemDef(items, vendor.sells[i]!.item).name;
  const offers = vendorStock(vendor, now)
    .filter((i) => (locked || offerLevel(vendor.sells[i]!) <= level) && (!hit || hit(goods[i]!)))
    .sort((a, b) => {
      const [oa, ob] = [vendor.sells[a]!, vendor.sells[b]!];
      if (sort === 'name') return name(a).localeCompare(name(b));
      if (sort === 'level') return offerLevel(oa) - offerLevel(ob) || a - b;
      const d = buyPrice(items, oa, vendor) - buyPrice(items, ob, vendor);
      return sort === 'cheap' ? d : -d;
    });
  return (
    <>
      <div className="vendors-tools">
        <input
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="Search"
          aria-label={`Search ${vendor.name}'s goods`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query) {
              e.stopPropagation();
              setQuery('');
            }
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <div className="stash-chips" role="radiogroup" aria-label="Show">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              role="radio"
              aria-checked={c.id === category}
              className={c.id === category ? 'active' : undefined}
              onClick={() => setCategory(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
        {/* Not a <select> (CP-2): a pad's cursor can't open a native one. */}
        <span className="stash-sort">
          <button
            className={sortOpen ? 'active' : undefined}
            aria-expanded={sortOpen}
            aria-label="Sort by"
            onClick={() => setSortOpen(!sortOpen)}
          >
            Sort: {SORTS.find(([s]) => s === sort)![1]}
          </button>
          {sortOpen && (
            <span className="stash-sort-menu" role="menu">
              {SORTS.map(([s, label]) => (
                <button
                  key={s}
                  role="menuitemradio"
                  aria-checked={s === sort}
                  className={s === sort ? 'active' : undefined}
                  onClick={() => {
                    setSort(s);
                    setSortOpen(false);
                  }}
                >
                  {label}
                </button>
              ))}
            </span>
          )}
        </span>
        <button
          className={locked ? undefined : 'active'}
          aria-pressed={!locked}
          title="Hide what this vendor won't sell you yet"
          onClick={() => setLocked(!locked)}
        >
          {locked ? 'Hide locked' : 'Show locked'}
        </button>
      </div>
      <ul className="vendors-grid">
        {offers.map((i) => (
          <OfferCard
            key={i}
            items={items}
            vendor={vendor}
            offer={vendor.sells[i]!}
            item={goods[i]!}
            level={level}
            money={profile.money}
            onClick={() => setInspecting(i)}
          />
        ))}
        {!offers.length && <li className="raid-note">Nothing here matches.</li>}
      </ul>
      <p className="raid-note">
        Bought items go into your stash. Buying from a vendor and doing its quests raise your level
        with it. To sell, open the stash, select an item and press Sell: vendors pay{' '}
        {Math.round(VENDOR.sellShare * 100)}% of its value, less if it's worn or used.
      </p>
      {inspecting !== null && vendor.sells[inspecting] && (
        <OfferDetails
          key={`${vendor.id}:${inspecting}`}
          items={items}
          quests={quests}
          vendor={vendor}
          offer={vendor.sells[inspecting]}
          item={goods[inspecting]!}
          level={level}
          money={profile.money}
          onBuy={(times) => onBuy(inspecting, times)}
          onClose={() => setInspecting(null)}
        />
      )}
    </>
  );
}

function Bar({
  label,
  value,
  need,
  text,
}: {
  label: string;
  value: number;
  need: number;
  text: string;
}): ReactNode {
  const f = need <= 0 ? 1 : Math.min(1, value / need);
  return (
    <span className={`vendors-bar${f >= 1 ? ' met' : ''}`}>
      {label}
      <span className="vendors-bar-track">
        <span className="vendors-bar-fill" style={{ transform: `scaleX(${f})` }} />
      </span>
      <span className="vendors-bar-text">{text}</span>
    </span>
  );
}

/** "2h 05m" or "12m": how long until a time. */
function duration(ms: number): string {
  const m = Math.max(1, Math.ceil(ms / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

/** An offer as a card: its picture, name, price and level; locked above the vendor's level. */
function OfferCard({
  items,
  vendor,
  offer,
  item,
  level,
  money,
  onClick,
}: {
  items: ItemDb;
  vendor: VendorDef;
  offer: VendorOffer;
  item: Item;
  level: number;
  money: number;
  onClick: () => void;
}): ReactNode {
  const def = itemDef(items, offer.item);
  const need = offerLevel(offer);
  const lock = need > level;
  const price = buyPrice(items, offer, vendor);
  const url = itemPortrait(items, item, def.size);
  const n = offer.count ?? 1;
  return (
    <li>
      <button
        className={`vendors-offer${lock ? ' locked' : ''}`}
        style={{ ['--rarity' as string]: colourOf(def) }}
        aria-label={`${def.name}${n > 1 ? ` ×${n}` : ''}, ${price.toLocaleString()}${lock ? `, from level ${need}` : ''}`}
        onClick={onClick}
      >
        <span className="vendors-offer-art">
          {url && <img src={url} alt="" draggable={false} />}
        </span>
        <span className="vendors-offer-name">
          {def.name}
          {n > 1 && <span> ×{n}</span>}
        </span>
        <span className={`vendors-offer-price${money < price ? ' short' : ''}`}>
          {price.toLocaleString()}
        </span>
        {need > 1 && (
          <span className="vendors-offer-ll" title={`Sold from level ${need}`}>
            {lock ? '🔒 ' : ''}
            {ROMAN[need]}
          </span>
        )}
      </button>
    </li>
  );
}

/**
 * An offer's item details, as a new one of it, with how many to buy, what that costs, and
 * Buy, which asks for a second tap. Locked, it says what level is needed.
 */
function OfferDetails({
  items,
  quests,
  vendor,
  offer,
  item,
  level,
  money,
  onBuy,
  onClose,
}: {
  items: ItemDb;
  quests: readonly QuestDef[];
  vendor: VendorDef;
  offer: VendorOffer;
  item: Item;
  level: number;
  money: number;
  onBuy: (times: number) => Promise<void>;
  onClose: () => void;
}): ReactNode {
  const [times, setTimes] = useState(1);
  const [confirming, setConfirming] = useState(false);
  const [buying, setBuying] = useState(false);
  const each = buyPrice(items, offer, vendor);
  const most = Math.max(1, Math.min(MAX_BUY, Math.floor(money / each)));
  const total = each * times;
  const need = offerLevel(offer);
  const set = (n: number): void => {
    setConfirming(false);
    setTimes(Math.max(1, Math.min(most, n)));
  };
  const buy = (): void => {
    if (buying) return;
    if (!confirming) return setConfirming(true);
    setConfirming(false);
    setBuying(true);
    void onBuy(times).finally(() => setBuying(false));
  };
  return (
    <ItemDetails
      items={items}
      item={item}
      quests={quests}
      buyFor={each}
      onClose={onClose}
      actions={
        need > level ? (
          <span className="vendors-locked-note">
            {vendor.name} sells this from level {ROMAN[need]}.
          </span>
        ) : (
          <>
            <span className="vendors-qty" aria-label="How many">
              <button aria-label="One fewer" disabled={times <= 1} onClick={() => set(times - 1)}>
                −
              </button>
              <b>×{times}</b>
              <button aria-label="One more" disabled={times >= most} onClick={() => set(times + 1)}>
                +
              </button>
              <button disabled={times >= most} onClick={() => set(most)}>
                Max
              </button>
            </span>
            <button
              className={`primary${confirming ? ' confirm' : ''}`}
              disabled={buying || money < total}
              onBlur={() => setConfirming(false)}
              onClick={buy}
            >
              {buying
                ? 'Buying…'
                : confirming
                  ? `Buy for ${total.toLocaleString()}?`
                  : `Buy · ${total.toLocaleString()}`}
            </button>
          </>
        )
      }
    />
  );
}
