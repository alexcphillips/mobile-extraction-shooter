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
} from '@mes/shared';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { itemPortrait } from '../render/item-portrait';
import { ItemDetails } from './item-details';
import { colourOf } from './raid-screen';
import { CATEGORIES, searcher, type Category } from './stash-search';

/*
 * The vendors page between raids (session 13b; reworked 2026-11-06, the user's call, after
 * Tarkov's traders): the vendors down the side with their levels, and the one picked's
 * offers as cards, with its level's progress, category chips, a search and a sort. Offers
 * above its level show locked. A tap on an offer opens its details, with how many to buy.
 * Stock is unlimited; selling is done from the stash page.
 */

type Sort = 'level' | 'cheap' | 'dear' | 'name';
const SORTS: readonly [Sort, string][] = [
  ['level', 'Level'],
  ['cheap', 'Price ↑'],
  ['dear', 'Price ↓'],
  ['name', 'Name'],
];

/** Level numbers as Tarkov writes loyalty levels. */
const ROMAN = ['', 'I', 'II', 'III', 'IV'];

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
}): ReactNode {
  const [shown, setShown] = useState(0);
  const [inspecting, setInspecting] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const [sort, setSort] = useState<Sort>('level');
  const [locked, setLocked] = useState(true);
  // The time, for a rotating vendor's stock and its countdown.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);
  const vendor = vendors[shown];
  const profile = me.profile;
  // Each offer as the item it buys, to draw and search (made once per vendor).
  const goods = useMemo(
    () => vendor?.sells.map((o) => newStashItem(items, o)) ?? [],
    [vendor, items],
  );
  if (!vendor) return null;
  const level = vendorLevel(vendor, standingOf(profile, vendor.id));
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
  const show = (i: number): void => {
    setInspecting(null);
    setShown(i);
  };
  return (
    <div className="raid stash vendors" role="dialog" aria-label="Vendors">
      <header className="raid-tabs">
        <button onClick={onBack}>Back</button>
        <span className="stash-title">Vendors</span>
        <span className="raid-spacer" />
        <span className="vendors-money">
          <b>{profile.money.toLocaleString()}</b> money
        </span>
        <button onClick={onStash}>Stash</button>
      </header>
      {notice && <p className="menu-notice">{notice}</p>}
      <div className="vendors-layout">
        <nav className="vendors-list" aria-label="Vendors">
          {vendors.map((v, i) => (
            <VendorCard
              key={v.id}
              vendor={v}
              level={vendorLevel(v, standingOf(profile, v.id))}
              active={i === shown}
              onClick={() => show(i)}
            />
          ))}
        </nav>
        <section className="vendors-main" style={{ ['--vendor' as string]: colourOf2(vendor) }}>
          <VendorHead vendor={vendor} profile={profile} level={level} now={now} />
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
            <select
              aria-label="Sort by"
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
            >
              {SORTS.map(([s, label]) => (
                <option key={s} value={s}>
                  {label}
                </option>
              ))}
            </select>
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
            Bought items go into your stash. Buying from a vendor and doing its quests raise your
            level with it. To sell, open the stash, select an item and press Sell: vendors pay{' '}
            {Math.round(VENDOR.sellShare * 100)}% of its value, less if it's worn or used.
          </p>
        </section>
      </div>
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
          onBuy={(times) => onBuy(vendor, inspecting, times)}
          onClose={() => setInspecting(null)}
        />
      )}
    </div>
  );
}

/** A vendor's colour, or the amber the screens use. */
function colourOf2(vendor: VendorDef): string {
  return vendor.colour ?? '#e3a33a';
}

/** A vendor in the list down the side: its initial in its colour, its name and level. */
export function VendorCard({
  vendor,
  level,
  active,
  onClick,
  badge,
}: {
  vendor: VendorDef;
  level: number;
  active: boolean;
  onClick: () => void;
  /** A count in the corner (the quests page's quests ready to hand in). */
  badge?: number;
}): ReactNode {
  return (
    <button
      className={`vendors-card${active ? ' active' : ''}`}
      style={{ ['--vendor' as string]: colourOf2(vendor) }}
      aria-pressed={active}
      onClick={onClick}
    >
      <span className="vendors-portrait" aria-hidden>
        {vendor.name[0]}
      </span>
      <span className="vendors-card-text">
        <b>{vendor.name}</b>
        <span className="vendors-ll" aria-label={`level ${level}`}>
          {ROMAN[level]}
        </span>
      </span>
      {badge ? <span className="vendors-badge">{badge}</span> : null}
    </button>
  );
}

/**
 * The vendor picked: its name, level and blurb, and what the next level needs, with bars
 * for the reputation and money so far. A rotating vendor says when its stock changes.
 */
function VendorHead({
  vendor,
  profile,
  level,
  now,
}: {
  vendor: VendorDef;
  profile: ProfileResponse['profile'];
  level: number;
  now: number;
}): ReactNode {
  const standing = standingOf(profile, vendor.id);
  const next = level < VENDOR_LEVELS ? vendor.levels[level - 1]! : null;
  const restock = nextRestock(vendor, now);
  return (
    <header className="vendors-head">
      <div className="vendors-title">
        <h2>{vendor.name}</h2>
        <span className="vendors-ll big">Level {ROMAN[level]}</span>
        {vendor.markup && vendor.markup > 1 && (
          <span className="vendors-tag">Prices ×{vendor.markup}</span>
        )}
        {restock !== null && (
          <span className="vendors-tag">New stock in {duration(restock - now)}</span>
        )}
      </div>
      {vendor.blurb && <p className="vendors-blurb">{vendor.blurb}</p>}
      {next ? (
        <div className="vendors-progress" aria-label={`To level ${level + 1}`}>
          <span>To level {ROMAN[level + 1]}:</span>
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
      ) : (
        <p className="vendors-progress">Top level: everything it has is yours to buy.</p>
      )}
    </header>
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
