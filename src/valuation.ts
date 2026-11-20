// src/valuation.ts: what a protocol's launch could be worth, and how sure the model is.
//
// Three parts, and the dashboard shows each one for every row.
//
//   1. A peer multiple. Every protocol in the snapshot whose token already trades gives one
//      observation of market cap over TVL. Those observations are winsorized to the market's own
//      tenth and ninetieth percentile, pooled by category, and shrunk toward the whole market's
//      multiple in proportion to how many live peers the category has. A category with fifteen live
//      peers speaks for itself; a category with one peer mostly borrows the market's number, because
//      one comparable is not a market. The blend is geometric, in log space, because a multiple is a
//      ratio: one peer cannot drag a category 3x off the market, and low < median < high survives it.
//
//   2. Growth damping. change_7d is a seven-day flow, and a seven-day flow is a weak signal for a
//      value that would last for years. It is clamped and passed through tanh, so a strong week
//      moves the value a little and an extreme week barely moves it further.
//
//   3. Age damping. A record gets more credible as it survives, then less launchable as the years
//      pass with no token. The curve rises from 0.70 for a fresh listing to 1.00 at two years, then
//      decays 5% a year, so the model peaks at a protocol with a full cycle behind it and discounts
//      both a three-week-old TVL spike and one four years past its window.
//
//   implied = tvl x peer multiple x growth multiplier x age multiplier
//
// The band is the same arithmetic at the same peers' 25th and 75th percentile multiples, widened when
// the record is missing its flow or its listing date. It is not a statistical interval: the snapshot
// holds one observation per protocol, so no sample can say what the next launch will price at. It is
// the spread of the comparables, carried through the model, and the dashboard says so.
//
// Nothing here is random, nothing reads the clock, and no protocol name is special-cased: the same
// functions score every row, so two runs write the same bytes.

/** One protocol, exactly the ten fields the sealed snapshot carries. */
export interface Protocol {
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

/** The part of the snapshot the peer model reads. */
export interface PeerSnapshot {
  as_of: string;
  protocols: Protocol[];
}

/** The model's constants, quoted by the dashboard and changeable in one place. */
export interface ValuationModel {
  /** Observations before a category's own multiple outweighs the market's (pseudo count). */
  peer_prior_weight: number;
  /** Below this many live peers a row is marked blended, not priced off its category alone. */
  peer_min_sample: number;
  /** Ratios are clipped to this quantile of the whole market before pooling (winsorizing). */
  peer_winsor_quantile: number;
  /** The band is drawn at this quantile of the peer multiples, low and high. */
  band_low_quantile: number;
  band_high_quantile: number;
  /** Each end of the band is pushed out by this share, so a one-peer band is never a point. */
  band_edge_widening: number;
  /** The multiple the model applies never leaves this range, whatever the peers say. */
  multiple_floor: number;
  multiple_ceiling: number;
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
  band_low_quantile: 0.25,
  band_high_quantile: 0.75,
  band_edge_widening: 0.05,
  multiple_floor: 0.02,
  multiple_ceiling: 6,
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

/**
 * The constants in the flat shape main.ts copies into the dashboard's data, so the page can print
 * every number the model used without knowing this module's internal names. It is derived from MODEL,
 * never written twice.
 */
export const VALUATION = {
  version: MODEL_VERSION,
  growth_weight: MODEL.growth_weight,
  growth_floor: -MODEL.growth_clamp,
  growth_cap: MODEL.growth_clamp,
  maturity_floor: MODEL.age_floor,
  maturity_range: round4(1 - MODEL.age_floor),
  maturity_days: MODEL.age_proven_days,
  maturity_stale_days: MODEL.age_stale_days,
  maturity_decay_per_year: MODEL.age_decay_per_year,
  unknown_age_days: MODEL.age_unknown_days,
  min_category_sample: MODEL.peer_min_sample,
  peer_prior_weight: MODEL.peer_prior_weight,
  multiple_floor: MODEL.multiple_floor,
  multiple_ceiling: MODEL.multiple_ceiling,
  band_low_quantile: MODEL.band_low_quantile,
  band_high_quantile: MODEL.band_high_quantile,
} as const;

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

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
  /** The multiple the point estimate used, after shrinkage. */
  peer_multiple: number;
  /** Live peers behind that multiple, before shrinkage. */
  peer_count: number;
  /** The growth damper applied. */
  growth_multiplier: number;
  /** The age damper applied. */
  maturity_multiplier: number;
  age_days: number | null;
  /** The band, how well the peer set supports the point estimate, and why. */
  confidence: {
    low_usd: number;
    high_usd: number;
    /** 0.05 to about 0.9: how much of the number came from real peers and how tight the band is. */
    level: number;
    label: 'high' | 'medium' | 'low';
    reasons: string[];
  };
  /** One sentence of arithmetic, for the detail view. */
  rationale: string;
  /** The same numbers, unflattened, for a page that draws the working. */
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

/** Whole days from `asOf` back to `listedAt`; null when either date is missing or unreadable. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Market cap over TVL for one protocol, or null when it records no usable token value. */
export function peerRatio(p: Protocol): number | null {
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
function statOf(label: string, clipped: number[], winsorLow: number, winsorHigh: number, lowQ: number, highQ: number): PeerStat {
  const sorted = [...clipped].sort((a, b) => a - b);
  // No observation still gives a usable multiple: the middle of the clip window, so an empty
  // snapshot prices rows at one multiple instead of every row at zero.
  const empty = sorted.length === 0;
  return {
    label,
    sample: sorted.length,
    winsor_low: round(winsorLow, 4),
    winsor_high: round(winsorHigh, 4),
    p25: empty ? round(winsorLow, 4) : round(quantile(sorted, lowQ), 4),
    median: empty ? round((winsorLow + winsorHigh) / 2, 4) : round(quantile(sorted, 0.5), 4),
    p75: empty ? round(winsorHigh, 4) : round(quantile(sorted, highQ), 4),
  };
}

/**
 * Build the peer table from the snapshot's own protocols. Only protocols whose token already trades
 * contribute an observation: one with no token has no market cap, and inventing one would be circular.
 */
export function buildPeerTable(protocols: Protocol[], asOf: string, model: ValuationModel = MODEL): PeerTable {
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
  // the artefact. A snapshot with no live protocol at all falls back to a fraction of TVL, so the
  // board still ranks rather than writing every row the same dollar.
  const fallback = 0.2;
  const winsorLow = ratios.length > 0 ? quantile(ratios, model.peer_winsor_quantile) : fallback;
  const winsorHigh = ratios.length > 0 ? quantile(ratios, 1 - model.peer_winsor_quantile) : fallback * 5;
  const clip = (n: number): number => clamp(n, winsorLow, winsorHigh);

  const global = statOf('whole market', ratios.map(clip), winsorLow, winsorHigh, model.band_low_quantile, model.band_high_quantile);
  const categories: Record<string, PeerStat> = {};
  for (const [label, list] of byCategory) {
    categories[label] = statOf(label, list.map(clip), winsorLow, winsorHigh, model.band_low_quantile, model.band_high_quantile);
  }
  return { as_of: asOf, model_version: MODEL_VERSION, observations: ratios.length, global, categories };
}

/** The peer table for a whole snapshot: what main.ts calls once, before it scores a row. */
export function buildPeerModel(snapshot: PeerSnapshot, model: ValuationModel = MODEL): PeerTable {
  return buildPeerTable(snapshot.protocols, snapshot.as_of, model);
}

/**
 * The multiple one protocol is priced at. A category's own median is weighted against the market's
 * by its sample size over the prior weight, so more live peers means more of the category and fewer
 * means more of the market.
 */
export function resolvePeer(table: PeerTable, category: string | null, model: ValuationModel = MODEL): ResolvedPeer {
  const stat = table.categories[peerKey(category)];
  const sample = stat?.sample ?? 0;
  const bounded = (n: number): number => round(clamp(n, model.multiple_floor, model.multiple_ceiling), 6);
  if (stat === undefined || sample === 0) {
    return {
      multiple: bounded(table.global.median),
      low_multiple: bounded(table.global.p25),
      high_multiple: bounded(table.global.p75),
      sample: 0,
      source: 'global',
      category,
    };
  }
  const k = model.peer_prior_weight;
  // Multiples are ratios, so they are blended in log space. The geometric mean keeps one peer from
  // dragging a category 3x off the market, and keeps low < median < high through the blend.
  const blend = (own: number, prior: number): number => {
    const a = own > 0 ? own : prior > 0 ? prior : 1;
    const b = prior > 0 ? prior : a;
    return Math.exp((sample * Math.log(a) + k * Math.log(b)) / (sample + k));
  };
  return {
    multiple: bounded(blend(stat.median, table.global.median)),
    low_multiple: bounded(blend(stat.p25, table.global.p25)),
    high_multiple: bounded(blend(stat.p75, table.global.p75)),
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
export function bandWidening(p: Protocol, model: ValuationModel = MODEL): number {
  let widen = 0;
  if (p.change_7d === null) widen += model.band_missing_growth;
  if (p.listed_at === null) widen += model.band_missing_age;
  return Math.min(0.25, widen);
}

/**
 * How well the peer set supports the point estimate, 0.05 to about 0.9: how much of the multiple came
 * from the category's own peers rather than the market prior, and how narrow the band came out. The
 * band is measured against a twenty-times spread, because that is what an unpriced market looks like
 * here: a band narrower than that earns support, a wider one earns none. The floor is there because a
 * market-prior price is still a price, and a dashboard that prints 0% reads as broken rather than as
 * cautious.
 */
export function confidenceLevel(sample: number, low: number, high: number, model: ValuationModel = MODEL): number {
  const peerSupport = sample / (sample + model.peer_prior_weight);
  const spread = low > 0 && high > low ? Math.log(high / low) : Math.log(20);
  const bandSupport = clamp(1 - spread / Math.log(20), 0, 1);
  return round(clamp(0.05 + 0.55 * peerSupport + 0.4 * bandSupport, 0, 1), 4);
}

/** A short dollar figure for the rationale sentence. */
function usd(n: number): string {
  if (n >= 1e9) return `$${round(n / 1e9, 1)}B`;
  if (n >= 1e6) return `$${round(n / 1e6, 0)}M`;
  if (n >= 1e3) return `$${round(n / 1e3, 0)}K`;
  return `$${Math.round(n)}`;
}

/** One sentence of arithmetic: where the multiple came from, what each damper did, and the band. */
function rationaleOf(p: Protocol, peer: ResolvedPeer, gf: number, af: number, age: number | null, implied: number, low: number, high: number): string {
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

/** The reasons behind a row's confidence level, in the words the detail view shows. */
function reasonsFor(p: Protocol, peer: ResolvedPeer, age: number | null): string[] {
  const category = p.category === null ? 'its category' : p.category;
  const reasons: string[] = [];
  if (peer.source === 'global') reasons.push(`no live ${category} peer trades, so the whole market's median multiple is used`);
  else if (peer.source === 'blended') reasons.push(`${peer.sample} live ${category} peer${peer.sample === 1 ? '' : 's'} is too few to price a category alone, so the ${peer.multiple}x multiple is blended toward the market's median`);
  else reasons.push(`${peer.sample} live ${category} peers set a ${peer.multiple}x median multiple`);
  reasons.push(`the same peers price a dollar of TVL between ${peer.low_multiple}x and ${peer.high_multiple}x at the 25th and 75th percentile, which is the band`);
  if (p.change_7d === null) reasons.push('no seven-day change is recorded, so growth is treated as flat and the band widens');
  if (age === null) reasons.push('no listing date is recorded, so the age curve assumes a year and the band widens');
  return reasons;
}

/**
 * Price one protocol: TVL times the peer multiple, then the growth and age dampers. The band is the
 * same arithmetic at the peers' 25th and 75th percentile multiples, widened for missing inputs.
 */
export function valueProtocol(p: Protocol, peers: PeerTable, asOf: string, model: ValuationModel = MODEL): Valuation {
  const peer = resolvePeer(peers, p.category, model);
  const tvl = Math.max(0, finite(p.tvl_usd, 0));
  const age = ageDays(asOf, p.listed_at);
  const gf = growthFactor(p.change_7d, model);
  const af = ageFactor(age, model);
  const widen = bandWidening(p, model);

  const base = tvl * peer.multiple;
  // Each end is pushed out a little, so a category with one comparable still gets a band rather than
  // a point that would read as certainty.
  const lowMultiple = Math.min(peer.multiple, peer.low_multiple * (1 - model.band_edge_widening));
  const highMultiple = Math.max(peer.multiple, peer.high_multiple * (1 + model.band_edge_widening));

  const bound = (n: number): number => Math.max(1, Math.min(model.value_max_usd, Math.round(n)));
  const implied = bound(base * gf * af);
  // The band is ordered around the point estimate by construction, but rounding and the ceiling can
  // cross it, so it is re-ordered here rather than trusted.
  const low = Math.min(bound(tvl * lowMultiple * gf * af * (1 - widen)), implied);
  const high = Math.max(bound(tvl * highMultiple * gf * af * (1 + widen)), implied);
  const level = confidenceLevel(peer.sample, low, high, model);

  return {
    implied_value_usd: implied,
    peer_multiple: peer.multiple,
    peer_count: peer.sample,
    growth_multiplier: round(gf, 6),
    maturity_multiplier: round(af, 6),
    age_days: age,
    confidence: {
      low_usd: low,
      high_usd: high,
      level,
      label: level >= 0.45 ? 'high' : level >= 0.2 ? 'medium' : 'low',
      reasons: reasonsFor(p, peer, age),
    },
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
