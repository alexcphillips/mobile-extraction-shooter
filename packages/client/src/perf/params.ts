/** Perf test knobs, read from the URL so limits can be probed on the phone without a rebuild. */
export interface PerfParams {
  boxes: number;
  chars: number;
  /** Extra random raycasts per tick, on top of one per character and the aim ray. */
  rays: number;
  pixelRatio: number;
  antialias: boolean;
  fogFar: number;
}

export function readParams(search: string): PerfParams {
  const q = new URLSearchParams(search);
  const num = (key: string, fallback: number): number => {
    const v = Number(q.get(key));
    return q.has(key) && Number.isFinite(v) && v >= 0 ? v : fallback;
  };
  return {
    boxes: Math.floor(num('boxes', 2000)),
    chars: Math.floor(num('chars', 10)),
    rays: Math.floor(num('rays', 100)),
    pixelRatio: num('dpr', Math.min(window.devicePixelRatio, 2)),
    antialias: q.get('aa') !== '0',
    fogFar: num('fog', 120),
  };
}
