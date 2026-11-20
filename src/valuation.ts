// The radar's value model: what a protocol's token would be worth if its record stayed as it is.
//
// Three parts, and the dashboard states each one so a reader can check the arithmetic.
//
//   1. A peer multiple. Every protocol in the snapshot whose token already trades gives one
//      observation of market cap over TVL. Those observations are winsorized to the market's own
//      tenth and ninetieth percentile, pooled by category, and shrunk toward the whole market's
//      multiple in proportion to how many live peers the category has. A category with fifteen live
//      peers speaks for itself; a category with one peer mostly borrows the market's number, because
//      one comparable is not a market.
//
//   2. Growth damping. change_7d is a seven-day flow, and a seven-day flow is a weak signal for a
//      value that would last for years. It is clamped and passed through tanh, so a strong week
//      moves the value a little and an extreme one barely moves it further.
//
//   3. Age damping. A record gets more credible as it survives, then less launchable as the years
//      pass with no token. The curve rises from 0.70 for a fresh listing to 1.00 at two years, then
//      decays 5% a year, so the model peaks at a protocol with a full cycle of history behind it and
//      discounts both a three-week-old TVL spike and a protocol four years past its window.
//
// The band comes from the peer table itself: the point value uses the shrunk median multiple, and
// the band uses the same arithmetic at the shrunk 25th and 75th percentile multiples of the same
// peers, widened when the record is missing its growth or its listing date. Nothing here is random,
// nothing reads the clock, and no protocol name is special-cased: the same functions score every
// row, so two runs write the same bytes.

/** One protocol, exactly the ten fields the sealed snapshot carries. */
export interface ProtocolRecord {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The snapshot the peer model reads: its date and its protocols. */
export interface PeerSnapshot {
  as_of: string;
  protocols: ProtocolRecord[];
}

/** The model's constants. The dashboard prints this object so the numbers are auditable. */
export interface ValuationModel {
  /** Observations before a category's own multiple outweighs the market's (pseudo count). */
  peer_prior_weight: number;
  /** Below this many live peers a category is reported as blended, not as its own multiple. */
  peer_min_sample: number;
  /** Ratios are clipped to this quantile of the whole market before pooling (winsorizing). */
  peer_winsor_quantile: number;
  /** Weight of the growth signal: the multiplier moves at most this far either way. */
  growth_weight: number;
  /** tanh scale in percentage points: the growth at which the signal is about 76% spent. */
  growth_scale: number;
  /** change_7d is clamped to this many percentage points either way before damping. */
  growth_clamp: number;
  /** The age curve's value at a fresh listing. */
  age_floor: number;
  /** Days of record at which the age curve reaches 1.00. */
  age_proven_days: number;
  /** Days after which the launch prior starts decaying. */
  age_stale_days: number;
  /** Yearly decay applied past age_stale_days. */
  age_decay_per_year: number;
  /** The age curve never falls below this. */
  age_min: number;
  /** Age assumed when listed_at is missing. */
  age_unknown_days: number;
  /** Widening of the band when change_7d is missing. */
  band_missing_growth: number;
  /** Widening of the band when listed_at is missing. */
  band_missing_age: number;
  /** The gate's ceiling on implied_value_usd. */
  value_max_usd: number;
}

export const MODEL: ValuationModel = {
  peer_prior_weight: 6,
  peer_min_sample: 3,
  peer_winsor_quantile: 0.1,
  growth_weight: 0.2,
  growth_scale: 20,
  growth_clamp: 60,
  age_floor: 0.7,
  age_proven_days: 730,
  age_stale_days: 1460,
  age_decay_per_year: 0.95,
  age_min: 0.55,
  age_unknown_days: 365,
  band_missing_growth: 0.08,
  band_missing_age: 0.06,
  value_max_usd: 100_000_000_000_000,
};

export const MODEL_VERSION = 'peers-1';

/** The quantiles the band is drawn at, so the dashboard can state them truthfully. */
export const BAND_QUANTILES = { low: 0.25, high: 0.75 } as const;

/** How one set of comparable protocols prices a dollar of TVL. */
export interface PeerStat {
  label: string;
  /** Protocols that contributed a ratio. */
  sample: number;
  /** The clip bounds applied before pooling, as multiples. */
  winsor_low: number;
  winsor_high: number;
  p25: number;
  median: number;
  p75: number;
}

/** The peer table: the whole market's multiple and one per category, from this snapshot alone. */
export interface PeerTable {
  as_of: string;
  model_version: string;
  /** Protocols with a token and a TVL: the observations the table is built from. */
  observations: number;
  global: PeerStat;
  categories: Record<string, PeerStat>;
}

/** The multiple one protocol is priced at, and where it came from. */
export interface ResolvedPeer {
  multiple: number;
  low_multiple: number;
  high_multiple: number;
  sample: number;
  source: 'category' | 'blended' | 'global';
  category: string | null;
}

/** What the model did to one protocol, in the shape main.ts and the dashboard read. */
export interface Valuation {
  /** The point estimate the board ranks on: a positive whole number of dollars. */
  implied_value_usd: number;
  /** The multiple the point estimate used. */
  peer_multiple: number;
  /** Live peers behind that multiple, before shrinkage. */
  peer_count: number;
  /** The growth damper applied. */
  growth_multiplier: number;
  /** The age damper applied. */
  maturity_multiplier: number;
  age_days: number | null;
  /** The band, and how well the peer set supports the point estimate, 0 to 1. */
  confidence: { low_usd: number; high_usd: number; level: number };
  /** One sentence of working, for the detail view. */
  rationale: string;
  /** The same numbers, unflattened, for a dashboard that draws the working. */
  model: {
    peer_low_multiple: number;
    peer_high_multiple: number;
    peer_source: 'category' | 'blended' | 'global';
    /** TVL times the peer multiple, before the two dampers. */
    base_usd: number;
    growth_pct: number | null;
    /** The relative widening applied for missing inputs. */
    band_widened_by: number;
    model_version: string;
  };
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(n: number, low: number, high: number): number {
  return n < low ? low : n > high ? high : n;
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** The value at quantile `q` (0 to 1) of an ascending array, by linear interpolation. */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const at = clamp(q, 0, 1) * (sorted.length - 1);
  const lo = Math.floor(at);
  const hi = Math.min(sorted.length - 1, lo + 1);
  const w = at - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return quantile(sorted, 0.5);
}

/** Whole days from a listing date to the snapshot date, or null when either is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Market cap over TVL for one protocol, or null when it records no usable token value. */
export function peerRatio(p: ProtocolRecord): number | null {
  const mcap = finite(p.mcap_usd, NaN);
  const tvl = finite(p.tvl_usd, 0);
  if (!Number.isFinite(mcap) || mcap <= 0 || tvl <= 0) return null;
  return mcap / tvl;
}

/** The category's key in the table. */
export function peerKey(category: string | null): string {
  return category ?? 'Uncategorised';
}

/** A stat from ratios that are already clipped to the market's winsor bounds. */
function statOf(label: string, clipped: number[], winsorLow: number, winsorHigh: number): PeerStat {
  const sorted = [...clipped].sort((a, b) => a - b);
  return {
    label,
    sample: sorted.length,
    winsor_low: round(winsorLow, 4),
    winsor_high: round(winsorHigh, 4),
    p25: round(quantile(sorted, BAND_QUANTILES.low), 4),
    median: round(quantile(sorted, 0.5), 4),
    p75: round(quantile(sorted, BAND_QUANTILES.high), 4),
  };
}

/**
 * Build the peer table from the snapshot's own protocols. Only protocols whose token already trades
 * contribute an observation: a protocol with no token has no market cap, and inventing one would be
 * circular.
 */
export function buildPeerTable(protocols: ProtocolRecord[], asOf: string, model: ValuationModel = MODEL): PeerTable {
  const ratios: number[] = [];
  const byCategory = new Map<string, number[]>();
  for (const p of protocols) {
    const r = peerRatio(p);
    if (r === null) continue;
    ratios.push(r);
    const key = peerKey(p.category);
    const list = byCategory.get(key);
    if (list === undefined) byCategory.set(key, [r]);
    else list.push(r);
  }
  ratios.sort((a, b) => a - b);

  // Clip to the market's own tenth and ninetieth percentile: one token trading at 60x TVL is a
  // liquidity artefact, and letting it into a small category's median would price that category off
  // the artefact.
  const winsorLow = quantile(ratios, model.peer_winsor_quantile);
  const winsorHigh = quantile(ratios, 1 - model.peer_winsor_quantile);
  const clip = (n: number): number => clamp(n, winsorLow, winsorHigh);

  const global = statOf('whole market', ratios.map(clip), winsorLow, winsorHigh);
  const categories: Record<string, PeerStat> = {};
  for (const [label, list] of byCategory) {
    categories[label] = statOf(label, list.map(clip), winsorLow, winsorHigh);
  }
  return { as_of: asOf, model_version: MODEL_VERSION, observations: ratios.length, global, categories };
}

/** The peer table for a whole snapshot: what main.ts calls once, before it scores a row. */
export function buildPeerModel(snapshot: PeerSnapshot, model: ValuationModel = MODEL): PeerTable {
  return buildPeerTable(snapshot.protocols, snapshot.as_of, model);
}

/**
 * The multiple one protocol is priced at. A category's own median is weighted against the market's
 * by its sample size over the prior weight, so more peers means more of the category and fewer
 * peers means more of the market.
 */
export function resolvePeer(table: PeerTable, category: string | null, model: ValuationModel = MODEL): ResolvedPeer {
  const stat = table.categories[peerKey(category)];
  const sample = stat?.sample ?? 0;
  if (stat === undefined || sample === 0) {
    return {
      multiple: table.global.median,
      low_multiple: table.global.p25,
      high_multiple: table.global.p75,
      sample: 0,
      source: 'global',
      category,
    };
  }
  const k = model.peer_prior_weight;
  const blend = (own: number, prior: number): number => (sample * own + k * prior) / (sample + k);
  return {
    multiple: round(blend(stat.median, table.global.median), 6),
    low_multiple: round(blend(stat.p25, table.global.p25), 6),
    high_multiple: round(blend(stat.p75, table.global.p75), 6),
    sample,
    source: sample >= model.peer_min_sample ? 'category' : 'blended',
    category,
  };
}

/**
 * The growth damper: 1.00 for an unknown or flat week, at most (1 + growth_weight) for a strong one
 * and at least (1 - growth_weight) for a weak one, approached smoothly so the extremes flatten.
 */
export function growthFactor(change7d: number | null, model: ValuationModel = MODEL): number {
  if (change7d === null) return 1;
  const clamped = clamp(finite(change7d, 0), -model.growth_clamp, model.growth_clamp);
  return 1 + model.growth_weight * Math.tanh(clamped / model.growth_scale);
}

/**
 * The age damper: 0.70 for a fresh listing, 1.00 at age_proven_days, then 5% a year past
 * age_stale_days, never below age_min. An unknown listing date is assumed to be a year old.
 */
export function ageFactor(age: number | null, model: ValuationModel = MODEL): number {
  const days = age ?? model.age_unknown_days;
  const proven = clamp(days / model.age_proven_days, 0, 1);
  const ramp = model.age_floor + (1 - model.age_floor) * proven;
  const past = Math.max(0, days - model.age_stale_days);
  const decay = model.age_decay_per_year ** (past / 365);
  return Math.max(model.age_min, ramp * decay);
}

/** How much the band widens for inputs the record does not carry. */
export function bandWidening(p: ProtocolRecord, model: ValuationModel = MODEL): number {
  let widen = 0;
  if (p.change_7d === null) widen += model.band_missing_growth;
  if (p.listed_at === null) widen += model.band_missing_age;
  return Math.min(0.25, widen);
}

/**
 * How well the peer set supports the point estimate, 0 to 1: how much of the multiple came from the
 * category's own peers rather than the market prior, and how narrow the band came out. A dashboard
 * shows it as a percentage, never as a promise.
 */
export function confidenceLevel(sample: number, low: number, high: number, model: ValuationModel = MODEL): number {
  const peerSupport = sample / (sample + model.peer_prior_weight);
  const spread = low > 0 ? Math.log(high / low) : Math.log(10);
  const bandSupport = clamp(1 - spread / Math.log(10), 0, 1);
  return round(0.6 * peerSupport + 0.4 * bandSupport, 4);
}

/** A short dollar figure for the rationale sentence. */
function usd(n: number): string {
  if (n >= 1e9) return `$${round(n / 1e9, 1)}B`;
  if (n >= 1e6) return `$${round(n / 1e6, 0)}M`;
  if (n >= 1e3) return `$${round(n / 1e3, 0)}K`;
  return `$${Math.round(n)}`;
}

/** One sentence of working, naming where the multiple came from and what the dampers did. */
function rationaleOf(p: ProtocolRecord, peer: ResolvedPeer, gf: number, af: number, age: number | null, implied: number, low: number, high: number): string {
  const category = p.category === null ? 'uncategorised' : p.category;
  const peersPhrase = `${peer.sample} live ${category} peer${peer.sample === 1 ? '' : 's'}`;
  const source =
    peer.source === 'global'
      ? `the whole market's median multiple, because no ${category} peer trades`
      : peer.source === 'blended'
        ? `${peersPhrase}, blended toward the market's median`
        : `the median of ${peersPhrase}`;
  const growth = p.change_7d === null ? 'an unreported seven-day change' : `a ${p.change_7d > 0 ? '+' : ''}${round(p.change_7d, 1)}% week`;
  const record = age === null ? 'an unrecorded start date' : `${age} days of record`;
  return `${p.name} is priced at ${peer.multiple}x its ${usd(p.tvl_usd)} of TVL, from ${source}; ${growth} scales it ${round(gf, 2)} and ${record} scales it ${round(af, 2)}, giving ${usd(implied)} (band ${usd(low)} to ${usd(high)}).`;
}

/**
 * Value one protocol: TVL times the peer multiple, then the growth and age dampers. The band is the
 * same arithmetic at the peers' 25th and 75th percentile multiples, widened for missing inputs.
 */
export function valueProtocol(p: ProtocolRecord, peers: PeerTable, asOf: string, model: ValuationModel = MODEL): Valuation {
  const peer = resolvePeer(peers, p.category, model);
  const tvl = Math.max(0, finite(p.tvl_usd, 0));
  const age = ageDays(asOf, p.listed_at);
  const gf = growthFactor(p.change_7d, model);
  const af = ageFactor(age, model);
  const widen = bandWidening(p, model);

  const base = tvl * peer.multiple;
  const rawLow = tvl * peer.low_multiple * gf * af * (1 - widen);
  const rawHigh = tvl * peer.high_multiple * gf * af * (1 + widen);

  const bound = (n: number): number => Math.max(1, Math.min(model.value_max_usd, Math.round(n)));
  const implied = bound(base * gf * af);
  // The band is ordered around the point estimate by construction, but rounding and the ceiling can
  // cross it, so it is re-ordered here rather than trusted.
  const low = Math.min(bound(rawLow), implied);
  const high = Math.max(bound(rawHigh), implied);

  return {
    implied_value_usd: implied,
    peer_multiple: peer.multiple,
    peer_count: peer.sample,
    growth_multiplier: round(gf, 6),
    maturity_multiplier: round(af, 6),
    age_days: age,
    confidence: { low_usd: low, high_usd: high, level: confidenceLevel(peer.sample, low, high, model) },
    rationale: rationaleOf(p, peer, gf, af, age, implied, low, high),
    model: {
      peer_low_multiple: peer.low_multiple,
      peer_high_multiple: peer.high_multiple,
      peer_source: peer.source,
      base_usd: Math.round(base),
      growth_pct: p.change_7d === null ? null : round(p.change_7d, 4),
      band_widened_by: round(widen, 4),
      model_version: MODEL_VERSION,
    },
  };
}
