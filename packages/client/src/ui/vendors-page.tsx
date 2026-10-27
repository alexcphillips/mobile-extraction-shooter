import {
  VENDOR,
  buyPrice,
  itemDef,
  type ItemDb,
  type ProfileResponse,
  type VendorDef,
} from '@mes/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { colourOf } from './raid-screen';

/*
 * The vendors page between raids (session 13b): each vendor's offers, bought into the
 * stash. Stock is unlimited; the price is the item's value. Selling is done from the stash
 * page (select an item, Sell), since every vendor buys everything at the same share.
 */

export function VendorsPage({
  vendors,
  items,
  me,
  notice,
  onBack,
  onStash,
  onBuy,
}: {
  vendors: readonly VendorDef[];
  items: ItemDb;
  me: ProfileResponse;
  notice: string | null;
  onBack: () => void;
  onStash: () => void;
  /** Buys an offer by its index; resolves when bought or refused. */
  onBuy: (vendor: VendorDef, offer: number) => Promise<void>;
}): ReactNode {
  const [shown, setShown] = useState(0);
  // Buying asks for a second tap on the same offer.
  const [confirming, setConfirming] = useState<number | null>(null);
  const [buying, setBuying] = useState<number | null>(null);
  const vendor = vendors[shown];
  const money = me.profile.money;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);
  const show = (i: number): void => {
    setConfirming(null);
    setShown(i);
  };
  const buy = (i: number): void => {
    if (!vendor || buying !== null) return;
    if (confirming !== i) {
      setConfirming(i);
      return;
    }
    setConfirming(null);
    setBuying(i);
    void onBuy(vendor, i).finally(() => setBuying(null));
  };
  return (
    <div className="raid stash vendors" role="dialog" aria-label="Vendors">
      <header className="raid-tabs">
        <button onClick={onBack}>Back</button>
        {vendors.map((v, i) => (
          <button key={v.id} className={i === shown ? 'active' : ''} onClick={() => show(i)}>
            {v.name}
          </button>
        ))}
        <span className="raid-spacer" />
        <span className="vendors-money">
          <b>{money.toLocaleString()}</b> money
        </span>
        <button onClick={onStash}>Stash</button>
      </header>
      {notice && <p className="menu-notice">{notice}</p>}
      {vendor && (
        <div className="vendors-body">
          {vendor.blurb && <p className="vendors-blurb">{vendor.blurb}</p>}
          <ul className="vendors-offers">
            {vendor.sells.map((o, i) => {
              const def = itemDef(items, o.item);
              const price = buyPrice(items, o);
              const n = o.count ?? 1;
              return (
                <li key={i}>
                  <span
                    className="vendors-icon"
                    style={{
                      background: colourOf(def),
                      aspectRatio: `${def.size[0]} / ${def.size[1]}`,
                    }}
                  />
                  <span className="vendors-name">
                    {def.name}
                    {n > 1 && <span> ×{n}</span>}
                  </span>
                  <button
                    className={confirming === i ? 'confirm' : ''}
                    disabled={buying !== null || money < price}
                    onBlur={() => setConfirming((c) => (c === i ? null : c))}
                    onClick={() => buy(i)}
                  >
                    {buying === i
                      ? 'Buying…'
                      : confirming === i
                        ? `Buy for ${price.toLocaleString()}?`
                        : price.toLocaleString()}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="raid-note">
            Bought items go into your stash. To sell, open the stash, select an item and press Sell:
            vendors pay {Math.round(VENDOR.sellShare * 100)}% of its value, less if it's worn or
            used.
          </p>
        </div>
      )}
    </div>
  );
}
