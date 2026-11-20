// src/eligibility.ts: which protocols the radar ranks, and why every other one is out.
//
// A protocol is the radar's subject when it records no token and stands on its own. Two things take
// it out, and both are facts in the snapshot rather than a judgement about the project:
//
//   1. a token already trades (a market cap, a CoinGecko id or a symbol on record): the launch
//      happened, so the market's own number stands and the model does not price it again;
//   2. the tokenless protocol is really someone else's token: a wrapped, staked, restaked or bridged
//      product, an exchange's own book, or a versioned pool of another protocol. Ranking one of
//      those would put a second name on one asset and inflate the board with it.
//
// The rules come in two families, and the file keeps them apart because only one is the house's:
//
//   house  the rule input/README.md states, reproducible from the snapshot's own fields: no token
//          recorded, no version marker at the end of the name, a category that is not a derivative,
//          no whole word wrapped, staked or staking in the name, and no exchange brand at the front.
//   radar  what the snapshot cannot state, because DefiLlama's parentProtocol field is not one of
//          its ten: restaking, staking pool and staking vault categories, the bridges the house does
//          not name, and a compact wrapper ticker (wTAO, stHYPE, cbETH). Each is labelled, counted
//          and switchable with { radarExtensions: false }.
//
// Every exclusion carries a sentence a reader can check against the snapshot's own fields, and the
// dashboard shows it in its Set aside view.
//
// The watchlist is coverage, never permission. A slug the watchlist names is ranked even when a rule
// here would have excluded it, because the gate reads coverage first, and this file reports the
// disagreement in `conflicts` rather than hiding it.

/** The snapshot's ten-field protocol record, as this module reads it. */
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

/** The part of the snapshot this classifier consults. main.ts's Snapshot fits it as it stands. */
export interface SnapshotLike {
  watchlist: string[];
  /** The watchlist's floor; a protocol under it is an early radar row, never a reason to exclude one. */
  floor_usd?: number;
  as_of?: string;
}

/** Why a protocol is not a pre-token candidate. One code per excluded row, the first rule that fires. */
export type ExclusionCode =
  | 'no-tvl'
  | 'token-recorded'
  | 'versioned'
  | 'wrapped'
  | 'staked'
  | 'restaked'
  | 'bridged'
  | 'exchange';

/** A non-fatal observation about an eligible row: it ranks, with a caveat attached. */
export type SignalCode = 'house-list' | 'below-floor' | 'unlisted-above-floor' | 'product-line' | 'multi-chain';

/** Which rule family decided a row: the house's own rule, or an extension this module adds. */
export type RuleSource = 'house' | 'radar';

/** Where a protocol ended up: the house's list, the radar's own rows, or out. */
export type Tier = 'watchlist' | 'radar' | 'excluded';

/** One exclusion rule, as the dashboard's Set aside view renders it. */
export interface ExclusionRule {
  code: ExclusionCode;
  /** Chip text: what kind of product this row is. */
  label: string;
  /** The sentence shape for one row; `detail` on the verdict fills in the protocol's own fields. */
  why: string;
  source: RuleSource;
}

/** The rules, keyed by their code. `source` says whether the sealed input states the rule or this file adds it. */
export const EXCLUSION_RULES: Record<ExclusionCode, ExclusionRule> = {
  'no-tvl': {
    code: 'no-tvl',
    label: 'No TVL recorded',
    why: 'no TVL is recorded, so no position can be sized and no number can be modelled.',
    source: 'house',
  },
  'token-recorded': {
    code: 'token-recorded',
    label: 'Token already recorded',
    why: 'a token field is set, so its launch already happened and the market owns the number.',
    source: 'house',
  },
  versioned: {
    code: 'versioned',
    label: 'Version of another protocol',
    why: 'the name ends in a version marker, so it is a pool or a release of another protocol.',
    source: 'house',
  },
  wrapped: {
    code: 'wrapped',
    label: 'Wrapped asset',
    why: 'it wraps an asset that already trades, so its token inherits that asset instead of launching one.',
    source: 'house',
  },
  staked: {
    code: 'staked',
    label: 'Staked asset',
    why: 'it is a staked position in an asset that already trades, so its receipt is a second name for one asset.',
    source: 'house',
  },
  restaked: {
    code: 'restaked',
    label: 'Restaked asset',
    why: 'it restakes an asset that already trades, so its receipt is a claim on that asset, not a launch.',
    source: 'house',
  },
  bridged: {
    code: 'bridged',
    label: 'Bridge product',
    why: 'it represents an asset moved from another chain, so its supply is a claim on tokens that already exist.',
    source: 'house',
  },
  exchange: {
    code: 'exchange',
    label: 'Exchange product',
    why: 'it is an exchange or an exchange-branded product, so the claim inside it is the exchange, not a new protocol.',
    source: 'house',
  },
};

/** The signal labels the dashboard renders beside an eligible row. */
export const SIGNAL_LABELS: Record<SignalCode, string> = {
  'house-list': 'On the house watchlist',
  'below-floor': 'Below the floor: an early radar row',
  'unlisted-above-floor': 'Above the floor, not on the house list',
  'product-line': 'Reads as a product line of a brand',
  'multi-chain': 'Deployed on three or more chains',
};

/** What main.ts reads from this module. Extra fields are ignored there. */
export interface Verdict {
  eligible: boolean;
  /** The sentence a board row carries when the protocol is out, and '' when it ranks. */
  reason: string;
  /** The rule that decided it, or null when it ranks. */
  code: ExclusionCode | null;
  /** True when the snapshot's own watchlist names this slug. */
  on_watchlist: boolean;
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  tier: Tier;
  /** True when the protocol's TVL is under the snapshot's floor: an early radar row. */
  below_floor: boolean;
  /** How sure this is a protocol still waiting on a token, never how good an entry it is. */
  confidence: 'high' | 'medium' | 'low';
  /** The rule and the fields it saw, for the Set aside view. */
  exclusion: Exclusion | null;
  signals: SignalCode[];
}

/** One excluded row's rule and the sentence for it. */
export interface Exclusion {
  code: ExclusionCode;
  label: string;
  detail: string;
  source: RuleSource;
}

/** How the caller wants this module to behave. */
export interface EligibilityOptions {
  /** Apply the radar's own extension rules on top of the house's. Default true. */
  radarExtensions?: boolean;
}

/** The context one classify call needs, built once per snapshot. */
export interface EligibilityContext {
  floorUsd: number;
  watchlist: ReadonlySet<string>;
  radarExtensions: boolean;
}

/** The counts a dashboard headline and a run log both need. */
export interface EligibilityStats {
  protocols: number;
  tokenless: number;
  watchlist: number;
  rankable: number;
  rankable_above_floor: number;
  rankable_below_floor: number;
  excluded: number;
}

/** Everything this module produces for one snapshot, for a caller that wants the whole split. */
export interface EligibilityUniverse {
  as_of: string;
  floor_usd: number;
  verdicts: Verdict[];
  /** Every row a board may rank, house list first, then by TVL. */
  eligible: Verdict[];
  excluded: Verdict[];
  /** The verdict for each house watchlist slug, in the snapshot's own order, for board coverage. */
  watchlist_verdicts: Verdict[];
  counts: Record<ExclusionCode, number>;
  stats: EligibilityStats;
  /** Watchlist slugs a rule would have excluded: a disagreement, reported rather than hidden. */
  conflicts: string[];
  /** Watchlist slugs the snapshot's protocols array does not carry: cannot be scored at all. */
  missing: string[];
}

const WORD_BREAK = /[^a-z0-9]+/;

/** A protocol name as lower-case whole words. "Binance-Peg BTC" reads as binance, peg, btc. */
export function words(name: string): string[] {
  return name.toLowerCase().split(WORD_BREAK).filter((word) => word.length > 0);
}

/** DefiLlama's version marker: a trailing space and a release, meaning a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A compact wrapper ticker: a short prefix then an upper-case ticker, the whole name. */
const WRAPPER_TICKER = /^(w|we|st|r|cb|sf|m|s)([A-Z0-9]{2,9})$/;

/** Exchange brands the house rule refuses at the front of a name. */
const EXCHANGE_BRANDS: readonly string[] = ['binance', 'coinbase', 'bybit', 'kraken', 'bitget', 'okx', 'bitfinex', 'gemini'];

/** The categories the sealed input's own definition refuses. */
const HOUSE_CATEGORIES: ReadonlyMap<string, ExclusionCode> = new Map<string, ExclusionCode>([
  ['Bridge', 'bridged'],
  ['Canonical Bridge', 'bridged'],
  ['Liquid Staking', 'staked'],
  ['Liquid Restaking', 'restaked'],
  ['Restaked BTC', 'restaked'],
  ['CEX', 'exchange'],
]);

/** The categories this module adds: staking products and the bridges the house leaves unnamed. */
const RADAR_CATEGORIES: ReadonlyMap<string, ExclusionCode> = new Map<string, ExclusionCode>([
  ['Restaking', 'restaked'],
  ['Staking Pool', 'staked'],
  ['Staking Vault', 'staked'],
  ['Cross Chain Bridge', 'bridged'],
]);

/** Words that end a product line of a brand: "Nado Spot", "Mellow Core", "IPOR Fusion". */
const PRODUCT_WORDS: ReadonlySet<string> = new Set([
  'perps',
  'spot',
  'lending',
  'borrowing',
  'basis',
  'curator',
  'curation',
  'prime',
  'fusion',
  'gateway',
  'strategies',
  'strategy',
  'core',
  'markets',
  'market',
  'exchange',
  'international',
  'vault',
  'vaults',
  'earn',
  'hub',
  'layer',
  'fund',
  'index',
]);

/** A protocol records a token when any of its three token fields is set. */
export function tokenRecorded(protocol: Protocol): boolean {
  return protocol.mcap_usd !== null || protocol.gecko_id !== null || protocol.symbol !== null;
}

/** The token a protocol records, in words, or null when it records none. */
function recordedToken(protocol: Protocol): string | null {
  if (protocol.symbol !== null && protocol.symbol.length > 0) return protocol.symbol;
  if (protocol.gecko_id !== null && protocol.gecko_id.length > 0) return `the CoinGecko id ${protocol.gecko_id}`;
  if (protocol.mcap_usd !== null) return 'a market cap';
  return null;
}

/** Whole dollars, short, for a reason sentence. */
function usdShort(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${Math.round(n)}`;
}

/** The exclusion a category alone decides, or null. */
function categoryRule(category: string | null, radarExtensions: boolean): ExclusionCode | null {
  if (category === null) return null;
  const house = HOUSE_CATEGORIES.get(category);
  if (house !== undefined) return house;
  if (!radarExtensions) return null;
  const radar = RADAR_CATEGORIES.get(category);
  if (radar !== undefined) return radar;
  // Any other bridge category is still a bridge: it moves an asset that trades.
  if (category.toLowerCase().includes('bridge')) return 'bridged';
  return null;
}

/** The exclusion a name alone decides, or null. */
function nameRule(name: string, radarExtensions: boolean): ExclusionCode | null {
  const parts = words(name);
  if (parts.includes('wrapped')) return 'wrapped';
  if (parts.includes('staked') || parts.includes('staking')) return 'staked';
  if (parts.includes('restaked') || parts.includes('restaking')) return radarExtensions ? 'restaked' : null;
  if (parts.includes('bridged') || parts.includes('bridge') || parts.includes('bridges')) return 'bridged';
  const lower = name.toLowerCase();
  if (EXCHANGE_BRANDS.some((brand) => lower.startsWith(brand))) return 'exchange';
  const ticker = WRAPPER_TICKER.exec(name);
  if (ticker !== null) return ticker[1] === 'w' || ticker[1] === 'we' ? 'wrapped' : 'staked';
  return null;
}

/** Whether a name reads as "<brand> <product word>", a line of a protocol rather than a protocol. */
export function readsAsProductLine(name: string): boolean {
  const parts = words(name);
  if (parts.length < 2) return false;
  return PRODUCT_WORDS.has(parts[parts.length - 1] as string);
}

/** The first exclusion a protocol earns, or null when it is a pre-token candidate. */
function firstExclusion(protocol: Protocol, radarExtensions: boolean): ExclusionCode | null {
  if (!(protocol.tvl_usd > 0)) return 'no-tvl';
  if (tokenRecorded(protocol)) return 'token-recorded';
  if (VERSIONED.test(protocol.name)) return 'versioned';
  const byCategory = categoryRule(protocol.category, radarExtensions);
  if (byCategory !== null) return byCategory;
  return nameRule(protocol.name, radarExtensions);
}

/** The sentence the Set aside view shows for one row: the rule, and what it saw in this protocol. */
function exclusionSentence(protocol: Protocol, code: ExclusionCode): string {
  const category = protocol.category === null ? '' : ` (${protocol.category})`;
  switch (code) {
    case 'no-tvl':
      return `${protocol.name} records no TVL, so no position can be sized and no number can be modelled.`;
    case 'token-recorded':
      return `${protocol.name} records ${recordedToken(protocol) ?? 'a token'}${protocol.mcap_usd !== null ? ` and a ${usdShort(protocol.mcap_usd)} market cap` : ''}, so its launch already happened.`;
    case 'versioned':
      return `${protocol.name} ends in a version marker, so it is a pool or a release of another protocol rather than one with a launch of its own.`;
    case 'wrapped':
      return `${protocol.name}${category} wraps an asset that already trades, so its token inherits that asset instead of launching a new one.`;
    case 'staked':
      return `${protocol.name}${category} is a staked position in an asset that already trades, so its receipt is a second name for one asset.`;
    case 'restaked':
      return `${protocol.name}${category} restakes an asset that already trades, so its receipt is a claim on that asset rather than a launch of its own.`;
    case 'bridged':
      return `${protocol.name}${category} represents an asset moved from another chain, so its supply is a claim on tokens that already exist.`;
    case 'exchange':
      return `${protocol.name}${category} is an exchange's own book or product, so the claim inside it is the exchange, not a new protocol.`;
  }
}

/** The exclusion object for one row. */
function exclusionFor(protocol: Protocol, code: ExclusionCode): Exclusion {
  const rule = EXCLUSION_RULES[code];
  return { code, label: rule.label, detail: exclusionSentence(protocol, code), source: rule.source };
}

/** How sure this row is genuinely a protocol still waiting on a token. */
function confidenceFor(tier: Tier, signals: SignalCode[]): Verdict['confidence'] {
  if (tier === 'watchlist') return 'high';
  if (signals.includes('unlisted-above-floor')) return 'low';
  if (signals.includes('product-line')) return 'medium';
  return 'high';
}

/** The eligibility context for one snapshot: the floor, the house list as a set, and the rule mode. */
export function createEligibilityContext(snapshot: SnapshotLike, options: EligibilityOptions = {}): EligibilityContext {
  return {
    floorUsd: snapshot.floor_usd ?? 0,
    watchlist: new Set(snapshot.watchlist),
    radarExtensions: options.radarExtensions ?? true,
  };
}

/** One context per snapshot object, so a per-protocol call does not rebuild the watchlist set. */
const CONTEXTS = new WeakMap<object, EligibilityContext>();

/** The cached context for a snapshot, in the default rule mode. */
function contextFor(snapshot: SnapshotLike): EligibilityContext {
  const cached = CONTEXTS.get(snapshot);
  if (cached !== undefined) return cached;
  const context = createEligibilityContext(snapshot);
  CONTEXTS.set(snapshot, context);
  return context;
}

/** Whether an argument is already a context rather than a snapshot. */
function isContext(value: SnapshotLike | EligibilityContext): value is EligibilityContext {
  return 'floorUsd' in value && value.watchlist instanceof Set;
}

/**
 * What main.ts asks about one protocol: is it a subject of the radar, and if not, why not.
 *
 * `snapshot` supplies the watchlist, or a context from createEligibilityContext for a non-default
 * rule mode. A watchlisted slug is always reported eligible: the gate requires every one of them on
 * the board, and coverage outranks a name rule. Every other protocol is decided by the rules in
 * order, and the first that fires is the one reported.
 */
export function classifyProtocol(protocol: Protocol, snapshot: SnapshotLike | EligibilityContext): Verdict {
  const context = isContext(snapshot) ? snapshot : contextFor(snapshot);
  const onWatchlist = context.watchlist.has(protocol.slug);
  const belowFloor = protocol.tvl_usd < context.floorUsd;
  const base = {
    slug: protocol.slug,
    name: protocol.name,
    category: protocol.category,
    tvl_usd: protocol.tvl_usd,
    on_watchlist: onWatchlist,
    below_floor: belowFloor,
  };

  if (onWatchlist) {
    const signals: SignalCode[] = ['house-list'];
    if (belowFloor) signals.push('below-floor');
    if (protocol.chains.length >= 3) signals.push('multi-chain');
    return { ...base, eligible: true, reason: '', code: null, tier: 'watchlist', confidence: 'high', exclusion: null, signals };
  }

  const code = firstExclusion(protocol, context.radarExtensions);
  if (code !== null) {
    const exclusion = exclusionFor(protocol, code);
    return {
      ...base,
      eligible: false,
      reason: exclusion.detail,
      code,
      tier: 'excluded',
      confidence: 'high',
      exclusion,
      signals: [],
    };
  }

  const signals: SignalCode[] = [];
  if (belowFloor) signals.push('below-floor');
  else signals.push('unlisted-above-floor');
  if (readsAsProductLine(protocol.name)) signals.push('product-line');
  if (protocol.chains.length >= 3) signals.push('multi-chain');

  const tier: Tier = 'radar';
  return {
    ...base,
    eligible: true,
    reason: '',
    code: null,
    tier,
    confidence: confidenceFor(tier, signals),
    exclusion: null,
    signals,
  };
}

/** Every protocol the board would rank, for a caller that wants the split in one pass. */
export function classifyAll(protocols: Protocol[], snapshot: SnapshotLike): { eligible: Protocol[]; excluded: Array<{ protocol: Protocol; code: ExclusionCode; reason: string }> } {
  const context = contextFor(snapshot);
  const eligible: Protocol[] = [];
  const excluded: Array<{ protocol: Protocol; code: ExclusionCode; reason: string }> = [];
  for (const protocol of protocols) {
    const verdict = classifyProtocol(protocol, context);
    if (verdict.eligible) eligible.push(protocol);
    else excluded.push({ protocol, code: verdict.code ?? 'no-tvl', reason: verdict.reason });
  }
  return { eligible, excluded };
}

/** Whether one protocol is a rankable pre-token candidate under this snapshot's rules. */
export function isEligible(protocol: Protocol, snapshot: SnapshotLike, options: EligibilityOptions = {}): boolean {
  const context = Object.keys(options).length === 0 ? contextFor(snapshot) : createEligibilityContext(snapshot, options);
  return classifyProtocol(protocol, context).eligible;
}

/** An empty count per exclusion code, so every key is present for the dashboard. */
function emptyCounts(): Record<ExclusionCode, number> {
  return {
    'no-tvl': 0,
    'token-recorded': 0,
    versioned: 0,
    wrapped: 0,
    staked: 0,
    restaked: 0,
    bridged: 0,
    exchange: 0,
  };
}

const byTvlThenSlug = (a: Verdict, b: Verdict): number => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);

const TIER_ORDER: Record<Tier, number> = { watchlist: 0, radar: 1, excluded: 2 };

/**
 * Classify a whole snapshot.
 *
 * `eligible` is what a board ranks: every house watchlist row first, then the radar's own rows by
 * TVL. `excluded` carries one reason each, grouped for the Set aside view. `conflicts` and `missing`
 * are the two ways coverage can break, and both should be empty.
 */
export function classifyUniverse(snapshot: SnapshotLike & { protocols: Protocol[]; as_of?: string }, options: EligibilityOptions = {}): EligibilityUniverse {
  const context = createEligibilityContext(snapshot, options);
  const verdicts = snapshot.protocols.map((protocol) => classifyProtocol(protocol, context));
  const counts = emptyCounts();
  for (const verdict of verdicts) {
    if (verdict.code !== null) counts[verdict.code] += 1;
  }

  const eligible = verdicts.filter((v) => v.eligible).sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || byTvlThenSlug(a, b));
  const excluded = verdicts.filter((v) => !v.eligible).sort(byTvlThenSlug);

  const index = new Map(verdicts.map((v) => [v.slug, v]));
  const watchlistVerdicts: Verdict[] = [];
  const conflicts: string[] = [];
  const missing: string[] = [];
  for (const slug of snapshot.watchlist) {
    const verdict = index.get(slug);
    if (verdict === undefined) missing.push(slug);
    else if (!verdict.eligible) conflicts.push(slug);
    else watchlistVerdicts.push(verdict);
  }

  return {
    as_of: snapshot.as_of ?? '',
    floor_usd: snapshot.floor_usd ?? 0,
    verdicts,
    eligible,
    excluded,
    watchlist_verdicts: watchlistVerdicts,
    counts,
    stats: {
      protocols: verdicts.length,
      tokenless: snapshot.protocols.filter((protocol) => !tokenRecorded(protocol)).length,
      watchlist: snapshot.watchlist.length,
      rankable: eligible.length,
      rankable_above_floor: eligible.filter((v) => !v.below_floor).length,
      rankable_below_floor: eligible.filter((v) => v.below_floor).length,
      excluded: excluded.length,
    },
    conflicts,
    missing,
  };
}

/** The two ways a board's coverage can break, as one object the caller can assert on. */
export interface WatchlistDrift {
  missing: string[];
  conflicts: string[];
  /**
   * Above the floor, tokenless, and every visible rule passes, but the house list does not name it.
   * These are the rows DefiLlama ties to a parent protocol by a field the snapshot does not carry,
   * so the rules cannot see the tie. They rank as radar rows, never as watchlist ones.
   */
  unlisted_above_floor: string[];
  ok: boolean;
}

/** Compare this module's reading of the snapshot with the house's own watchlist. */
export function watchlistDrift(universe: EligibilityUniverse): WatchlistDrift {
  const unlisted = universe.eligible.filter((v) => !v.below_floor && v.tier !== 'watchlist').map((v) => v.slug);
  return {
    missing: universe.missing,
    conflicts: universe.conflicts,
    unlisted_above_floor: unlisted.sort(),
    ok: universe.missing.length === 0 && universe.conflicts.length === 0,
  };
}

/** The counts as one line, in the order a run log reads best. */
export function summaryLine(universe: EligibilityUniverse): string {
  const { stats, counts } = universe;
  const parts = (Object.keys(counts) as ExclusionCode[])
    .filter((code) => counts[code] > 0)
    .sort((a, b) => counts[b] - counts[a])
    .map((code) => `${EXCLUSION_RULES[code].label.toLowerCase()} ${counts[code]}`);
  return (
    `eligibility: ${stats.protocols} protocols, ${stats.tokenless} record no token, ` +
    `${stats.watchlist} on the house list, ${stats.rankable} rankable ` +
    `(${stats.rankable_above_floor} above the floor, ${stats.rankable_below_floor} early), ` +
    `${stats.excluded} excluded${parts.length > 0 ? `: ${parts.join(', ')}` : ''}`
  );
}

/** The exclusions grouped by rule, largest group first, for the dashboard's Set aside view. */
export function exclusionsByRule(universe: EligibilityUniverse): Array<{ rule: ExclusionRule; verdicts: Verdict[] }> {
  const groups: Array<{ rule: ExclusionRule; verdicts: Verdict[] }> = [];
  for (const code of Object.keys(EXCLUSION_RULES) as ExclusionCode[]) {
    const verdicts = universe.excluded.filter((v) => v.code === code);
    if (verdicts.length > 0) groups.push({ rule: EXCLUSION_RULES[code], verdicts });
  }
  return groups.sort((a, b) => b.verdicts.length - a.verdicts.length);
}
