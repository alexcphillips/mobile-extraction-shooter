import type { KeyboardEvent, ReactNode } from 'react';

/**
 * The deploy screen's region map (2026-11-11): one made-up valley drawn in faded dark colors,
 * with a marker for each raid at its `region` spot (content/raids). Tapping a marker picks
 * it; a raid above the player's level shows dimmed, with its level over it, and can't be
 * picked. The frame is 1000 × 600; it fills its pane, cropping the edges if the shapes differ.
 */

/** A raid on the region map. */
export interface RegionSpot {
  id: string;
  name: string;
  /** Under the name: "20 min · starter". */
  line: string;
  x: number;
  y: number;
  /** Why it can't be picked yet ("Level 2"), shown over its marker; null when open. */
  needs: string | null;
}

export function RegionMap({
  spots,
  selected,
  onSelect,
  frozen,
}: {
  spots: readonly RegionSpot[];
  selected: string;
  onSelect: (id: string) => void;
  /** In someone else's party: only the leader's pick shows as live. */
  frozen: boolean;
}): ReactNode {
  return (
    <svg
      className="region-map"
      viewBox="0 0 1000 600"
      preserveAspectRatio="xMidYMid slice"
      role="radiogroup"
      aria-label="Map"
    >
      {TERRAIN}
      {spots.map((s) => (
        <Marker
          key={s.id}
          spot={s}
          active={s.id === selected}
          disabled={!!s.needs || (frozen && s.id !== selected)}
          onSelect={onSelect}
        />
      ))}
    </svg>
  );
}

function Marker({
  spot,
  active,
  disabled,
  onSelect,
}: {
  spot: RegionSpot;
  active: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
}): ReactNode {
  const pick = (): void => {
    if (!disabled) onSelect(spot.id);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    pick();
  };
  // The plate fits the longer of the two lines (no text measuring in an SVG: a fair guess).
  const plate = Math.max(spot.name.length * 15.5, spot.line.length * 8.6) + 30;
  const cls = `region-spot${active ? ' active' : ''}${spot.needs ? ' locked' : ''}`;
  return (
    <g
      className={cls}
      transform={`translate(${spot.x} ${spot.y})`}
      role="radio"
      aria-checked={active}
      aria-disabled={disabled}
      aria-label={spot.needs ? `${spot.name}, needs ${spot.needs}` : spot.name}
      tabIndex={disabled ? -1 : 0}
      onClick={pick}
      onKeyDown={onKey}
    >
      {active && (
        <>
          <circle className="region-area" r={78} />
          <circle className="region-pulse" r={18} />
        </>
      )}
      <circle className="region-hit" r={44} />
      <g className="region-body">
        <circle className="region-ring" r={18} />
        {spot.needs ? (
          <path
            className="region-lock"
            transform="translate(-9 -10) scale(0.75)"
            d="M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z"
          />
        ) : (
          <rect
            className="region-pin"
            x={-6}
            y={-6}
            width={12}
            height={12}
            transform="rotate(45)"
          />
        )}
        <rect className="region-plate" x={28} y={-24} width={plate} height={48} />
        <rect className="region-plate-edge" x={28} y={-24} width={3} height={48} />
        <text className="region-name" x={42} y={-2}>
          {spot.name}
        </text>
        <text className="region-line" x={42} y={16}>
          {spot.line}
        </text>
      </g>
      {spot.needs && (
        <g className="region-needs" transform="translate(0 -44)">
          <rect x={-56} y={-14} width={112} height={28} />
          <path
            transform="translate(-47 -8) scale(0.62)"
            d="M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z"
          />
          <text x={9} y={5}>
            {spot.needs}
          </text>
        </g>
      )}
    </g>
  );
}

// Northpoint's town: a grid of blocks around the mall, some left empty for lots and parks.
const CITY: ReactNode[] = [];
for (let gx = -5; gx <= 5; gx++) {
  for (let gy = -3; gy <= 3; gy++) {
    if (Math.abs(gx) <= 1 && Math.abs(gy) <= 1) continue; // the mall
    if ((gx * 7 + gy * 3 + 20) % 5 === 0) continue;
    if (Math.abs(gx) + Math.abs(gy) > 7) continue;
    CITY.push(
      <rect
        key={`${gx},${gy}`}
        x={640 + gx * 24 - 9}
        y={175 + gy * 20 - 7}
        width={18}
        height={14}
      />,
    );
  }
}

// Silver Creek: a few houses and barns along the road and the creek.
const VILLAGE = [
  [300, 380],
  [312, 404],
  [286, 410],
  [344, 372],
  [352, 420],
  [366, 396],
  [322, 432],
  [270, 388],
  [384, 380],
  [338, 452],
].map(([x, y], i) => (
  <rect
    key={i}
    x={x! - 6}
    y={y! - 5}
    width={i % 3 ? 12 : 16}
    height={10}
    transform={`rotate(${((i * 23) % 40) - 20} ${x} ${y})`}
  />
));

const HILL =
  'M-150 -20C-140 -90-40-110 40-95C130-80 170-20 160 40C150 100 60 120-20 110C-110 100-160 50-150-20Z';
const FOREST =
  'M-60 0C-62-30-30-46 0-40C24-50 58-34 60-6C70 20 44 44 14 40C-10 52-48 40-52 20C-64 14-62 6-60 0Z';
const COLUMNS = 'ABCDEFGHIJKLMNOPQRST';

// The valley itself never changes: built once.
const TERRAIN = (
  <g aria-hidden="true">
    <defs>
      <radialGradient id="region-vignette" cx="50%" cy="50%" r="70%">
        <stop offset="55%" stopColor="#000" stopOpacity="0" />
        <stop offset="100%" stopColor="#000" stopOpacity="0.55" />
      </radialGradient>
    </defs>
    <rect className="region-land" width={1000} height={600} />
    {/* Forest */}
    <g className="region-forest">
      {(
        [
          [120, 320, 1.6],
          [470, 520, 1.3],
          [230, 560, 1.1],
          [910, 250, 1.5],
          [440, 80, 1.2],
          [80, 180, 0.9],
          [770, 560, 1],
          [560, 330, 0.8],
        ] as const
      ).map(([x, y, s], i) => (
        <path key={i} d={FOREST} transform={`translate(${x} ${y}) scale(${s} ${s * 0.8})`} />
      ))}
    </g>
    {/* Hills: contour lines */}
    <g className="region-contour">
      {[1, 0.78, 0.56, 0.34].map((s) => (
        <path key={s} d={HILL} transform={`translate(800 450) scale(${s * 1.3} ${s})`} />
      ))}
      {[1, 0.7, 0.4].map((s) => (
        <path
          key={s}
          d={HILL}
          transform={`translate(190 120) rotate(-20) scale(${s * 0.8} ${s * 0.6})`}
        />
      ))}
    </g>
    {/* Fields by the village */}
    <g className="region-fields">
      <rect x={180} y={430} width={70} height={46} transform="rotate(-12 215 453)" />
      <rect x={258} y={468} width={56} height={40} transform="rotate(-8 286 488)" />
      <rect x={390} y={300} width={64} height={44} transform="rotate(14 422 322)" />
      <rect x={196} y={350} width={50} height={36} transform="rotate(-18 221 368)" />
      <rect x={410} y={430} width={60} height={42} transform="rotate(10 440 451)" />
    </g>
    {/* The reservoir and the creek */}
    <path
      className="region-water"
      d="M760 0H1000V150C960 170 900 150 880 110C860 70 800 80 770 50C750 30 750 10 760 0Z"
    />
    <path
      className="region-creek"
      d="M60 0C120 90 170 160 230 230S300 340 320 390S440 510 560 600"
    />
    {/* Roads */}
    <g className="region-road-minor">
      <path d="M330 400C340 470 350 540 360 600" />
      <path d="M640 175C660 110 680 50 700 0" />
      <path d="M640 175C720 250 800 300 1000 330" />
      <path d="M150 0C200 140 270 300 330 400" />
      <path d="M560 600C600 470 610 300 640 175" />
    </g>
    <path
      className="region-road"
      d="M0 470C150 450 230 420 330 400S520 260 640 175S860 110 1000 100"
    />
    <path
      className="region-road-dash"
      d="M0 470C150 450 230 420 330 400S520 260 640 175S860 110 1000 100"
    />
    {/* Towns */}
    <g className="region-blocks">
      {CITY}
      {VILLAGE}
    </g>
    <rect className="region-mall" x={612} y={155} width={56} height={40} />
    {/* Grid and its labels */}
    <g className="region-grid">
      {Array.from({ length: 19 }, (_, i) => (
        <line key={`x${i}`} x1={(i + 1) * 50} y1={0} x2={(i + 1) * 50} y2={600} />
      ))}
      {Array.from({ length: 11 }, (_, i) => (
        <line key={`y${i}`} x1={0} y1={(i + 1) * 50} x2={1000} y2={(i + 1) * 50} />
      ))}
    </g>
    <g className="region-grid-label">
      {COLUMNS.split('').map((c, i) => (
        <text key={c} x={i * 50 + 25} y={44}>
          {c}
        </text>
      ))}
      {Array.from({ length: 12 }, (_, i) => (
        <text key={i} x={24} y={i * 50 + 30}>
          {i + 1}
        </text>
      ))}
    </g>
    <text className="region-title" x={500} y={548}>
      ASHFORD VALLEY
    </text>
    {/* Compass */}
    <g className="region-compass" transform="translate(944 520)">
      <circle r={20} />
      <path d="M0-16L6 0 0 16-6 0Z" />
      <path className="north" d="M0-16L6 0H-6Z" />
      <text y={-26}>N</text>
    </g>
    <rect width={1000} height={600} fill="url(#region-vignette)" />
  </g>
);
