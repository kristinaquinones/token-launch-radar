// Who is still waiting on a token: the eligibility half of the token radar.
//
// The snapshot's watchlist is the house's own answer: every protocol at or above the floor that
// records no token and is not a wrapped, staked or bridged product of one that already trades.
// This module re-derives that judgement from the ten fields the snapshot carries, so the radar can
// apply it below the floor as well, and show its working for every row it drops.
//
// Two rule sources, kept apart on purpose:
//
//   house  the rule input/README.md states, reproducible from the file: no token recorded, no
//          version marker at the end of the name, a category that is not a derivative, no whole
//          word wrapped, staked or staking in the name, and no exchange brand at the front.
//   radar  the extensions the file cannot state, because DefiLlama's parentProtocol field is not
//          one of its ten: restaking, staking pool and staking vault categories, bridge categories
//          the house does not name, and a compact wrapper ticker (wTAO, stHYPE, cbETH). Each one
//          is labelled, counted, and switched off with { radarExtensions: false }.
//
// A slug the snapshot's watchlist names is never excluded here. That list is the gate's coverage
// row, so a board carrying the radar has to carry every slug on it whatever these rules think.
// Conflicts are reported in `universe.conflicts` and missing slugs in `universe.missing`, so the
// caller can fail loudly instead of quietly dropping a row the scorer requires.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The part of the snapshot this module reads. main.ts's Snapshot fits it as it stands. */
export interface EligibilitySnapshot {
  as_of: string;
  floor_usd: number;
  protocols: ProtocolRecord[];
  watchlist: string[];
}

/** Why a protocol is not a pre-token candidate. One code per excluded row, the first that fires. */
export type ExclusionCode =
  | 'token-recorded'
  | 'versioned'
  | 'wrapped'
  | 'staked'
  | 'restaked'
  | 'bridged'
  | 'exchange';

/** A non-fatal observation about an eligible row: it ranks, with a caveat attached. */
export type SignalCode =
  | 'house-list'
  | 'below-floor'
  | 'unlisted-above-floor'
  | 'product-line'
  | 'multi-chain';

/** Which rule family decided a row: the house's own rule, or an extension this module adds. */
export type RuleSource = 'house' | 'radar';

/** Where a protocol ended up: the house's list, the radar's own rows, or out. */
export type Tier = 'watchlist' | 'radar' | 'excluded';

/** One exclusion rule, as the dashboard renders it. */
export interface ExclusionRule {
  code: ExclusionCode;
  /** Chip text: what kind of product this row is. */
  label: string;
  /** The one line the board carries as `reason`: short enough to group and count. */
  summary: string;
  /** The longer sentence under it, for the exclusions view. */
  why: string;
  source: RuleSource;
}

/**
 * The exclusion rules, in the order they are tested. `summary` is the line a board row carries,
 * `why` is the sentence the exclusions view shows, and `source` says whether the sealed input
 * states the rule (house) or this module adds it (radar).
 */
export const EXCLUSION_RULES: Record<ExclusionCode, ExclusionRule> = {
  'token-recorded': {
    code: 'token-recorded',
    label: 'Token already recorded',
    summary: 'Token already recorded: the market prices this protocol.',
    why: 'A symbol, a CoinGecko id or a market cap is on the record, so the market already prices this protocol.',
    source: 'house',
  },
  versioned: {
    code: 'versioned',
    label: 'Version of another protocol',
    summary: 'Version of another protocol: a pool or a release, not a protocol of its own.',
    why: 'The name ends in a release marker (V2, v3, 2.0), so this row is a pool or a version of another protocol.',
    source: 'house',
  },
  wrapped: {
    code: 'wrapped',
    label: 'Wrapped asset',
    summary: 'Wrapped asset: it wraps an asset that already trades.',
    why: 'The name carries the whole word wrapped, or a wrapper ticker, so the row is an asset that already trades in another form.',
    source: 'house',
  },
  staked: {
    code: 'staked',
    label: 'Staked asset',
    summary: 'Staked asset: it holds a token that already trades.',
    why: 'The name or the category says staked or staking, so the row holds a token that already trades rather than waiting on one.',
    source: 'house',
  },
  restaked: {
    code: 'restaked',
    label: 'Restaked asset',
    summary: 'Restaked asset: it restakes a token that already trades.',
    why: 'The row restakes an asset that already trades, so its value follows that asset rather than a launch of its own.',
    source: 'house',
  },
  bridged: {
    code: 'bridged',
    label: 'Bridge product',
    summary: 'Bridge product: it moves an asset that already trades.',
    why: 'The category or the name is a bridge, which moves an asset that already trades instead of issuing one.',
    source: 'house',
  },
  exchange: {
    code: 'exchange',
    label: 'Exchange product',
    summary: 'Exchange product: the exchange is the claim, not a new token.',
    why: 'The row is an exchange or carries an exchange brand at the front of its name, so the claim inside it is the exchange.',
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

/** One excluded row's reason, ready to render and to count. */
export interface Exclusion {
  code: ExclusionCode;
  label: string;
  summary: string;
  detail: string;
  source: RuleSource;
}

/** The verdict on one protocol. */
export interface Verdict {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  tier: Tier;
  eligible: boolean;
  /** The line a board row carries for an excluded protocol, and '' for one that ranks. */
  reason: string;
  /** True when the protocol's TVL is under the snapshot's floor: an early radar row. */
  below_floor: boolean;
  /** How sure this is a protocol still waiting on a token, never how good an entry it is. */
  confidence: 'high' | 'medium' | 'low';
  /** The reason it is out, or null when it is in. */
  exclusion: Exclusion | null;
  signals: SignalCode[];
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

/** Everything this module produces for one snapshot. */
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
  /** Watchlist slugs a rule above would have excluded: must stay empty, else the rules are wrong. */
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

/** The token a protocol records, in words, or null when it records none. */
function recordedToken(protocol: ProtocolRecord): string | null {
  if (protocol.symbol !== null && protocol.symbol.length > 0) return protocol.symbol;
  if (protocol.gecko_id !== null && protocol.gecko_id.length > 0) return `CoinGecko id ${protocol.gecko_id}`;
  if (protocol.mcap_usd !== null) return 'a market cap';
  return null;
}

/** The sentence the exclusions view shows for one row: which rule fired, and what it saw. */
function exclusionDetail(protocol: ProtocolRecord, code: ExclusionCode, token: string | null): string {
  const category = protocol.category === null ? '' : ` (category ${protocol.category})`;
  switch (code) {
    case 'token-recorded':
      return `${protocol.name} records ${token ?? 'a token'}, so the market already prices it.`;
    case 'versioned':
      return `${protocol.name} ends in a version marker, so it is a pool or a release of another protocol.`;
    case 'wrapped':
      return `${protocol.name} wraps an asset that already trades${category}.`;
    case 'staked':
      return `${protocol.name} is a staking product${category}, so it holds an asset that already trades.`;
    case 'restaked':
      return `${protocol.name} restakes an asset that already trades${category}.`;
    case 'bridged':
      return `${protocol.name} is a bridge product${category}, so it moves an asset that already trades.`;
    case 'exchange':
      return `${protocol.name} is an exchange or an exchange's own product${category}.`;
  }
}

/** The exclusion object for one row. */
function exclusionFor(protocol: ProtocolRecord, code: ExclusionCode, token: string | null): Exclusion {
  const rule = EXCLUSION_RULES[code];
  return {
    code,
    label: rule.label,
    summary: rule.summary,
    detail: exclusionDetail(protocol, code, token),
    source: rule.source,
  };
}

/** The first exclusion a protocol earns, or null when it is a pre-token candidate. */
function firstExclusion(protocol: ProtocolRecord, radarExtensions: boolean): ExclusionCode | null {
  if (recordedToken(protocol) !== null) return 'token-recorded';
  if (VERSIONED.test(protocol.name)) return 'versioned';
  const byCategory = categoryRule(protocol.category, radarExtensions);
  if (byCategory !== null) return byCategory;
  return nameRule(protocol.name, radarExtensions);
}

/** How sure this row is genuinely a protocol still waiting on a token. */
function confidenceFor(tier: Tier, signals: SignalCode[]): Verdict['confidence'] {
  if (tier === 'watchlist') return 'high';
  if (signals.includes('unlisted-above-floor')) return 'low';
  if (signals.includes('product-line')) return 'medium';
  return 'high';
}

/** The eligibility context for one snapshot: the floor, the house list as a set, and the rule mode. */
export function createEligibilityContext(snapshot: EligibilitySnapshot, options: EligibilityOptions = {}): EligibilityContext {
  return {
    floorUsd: snapshot.floor_usd,
    watchlist: new Set(snapshot.watchlist),
    radarExtensions: options.radarExtensions ?? true,
  };
}

/** One context per snapshot object, so a per-protocol call does not rebuild the watchlist set. */
const CONTEXTS = new WeakMap<object, EligibilityContext>();

/** The cached context for a snapshot, in the default rule mode. */
function contextFor(snapshot: EligibilitySnapshot): EligibilityContext {
  const cached = CONTEXTS.get(snapshot);
  if (cached !== undefined) return cached;
  const context = createEligibilityContext(snapshot);
  CONTEXTS.set(snapshot, context);
  return context;
}

/** Whether an argument is already a context rather than a snapshot. */
function isContext(value: EligibilitySnapshot | EligibilityContext): value is EligibilityContext {
  return 'floorUsd' in value && value.watchlist instanceof Set;
}

/**
 * The verdict on one protocol.
 *
 * `source` is the snapshot itself (the usual call, one protocol at a time) or a context from
 * createEligibilityContext for a non-default rule mode.
 *
 * A slug on the snapshot's watchlist comes back tier 'watchlist' and eligible, always: the gate's
 * coverage row is the house's, and a rule here that disagreed with it would cost the entry its
 * place. Every other protocol is decided by the rules in order, and the first that fires is the
 * one reported.
 */
export function classifyProtocol(protocol: ProtocolRecord, source: EligibilitySnapshot | EligibilityContext): Verdict {
  const context = isContext(source) ? source : contextFor(source);
  const belowFloor = protocol.tvl_usd < context.floorUsd;
  const onHouseList = context.watchlist.has(protocol.slug);

  if (onHouseList) {
    const signals: SignalCode[] = ['house-list'];
    if (belowFloor) signals.push('below-floor');
    if (protocol.chains.length >= 3) signals.push('multi-chain');
    return {
      slug: protocol.slug,
      name: protocol.name,
      category: protocol.category,
      tvl_usd: protocol.tvl_usd,
      tier: 'watchlist',
      eligible: true,
      reason: '',
      below_floor: belowFloor,
      confidence: 'high',
      exclusion: null,
      signals,
    };
  }

  const token = recordedToken(protocol);
  const code = firstExclusion(protocol, context.radarExtensions);
  if (code !== null) {
    const exclusion = exclusionFor(protocol, code, token);
    return {
      slug: protocol.slug,
      name: protocol.name,
      category: protocol.category,
      tvl_usd: protocol.tvl_usd,
      tier: 'excluded',
      eligible: false,
      reason: exclusion.summary,
      below_floor: belowFloor,
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
    slug: protocol.slug,
    name: protocol.name,
    category: protocol.category,
    tvl_usd: protocol.tvl_usd,
    tier,
    eligible: true,
    reason: '',
    below_floor: belowFloor,
    confidence: confidenceFor(tier, signals),
    exclusion: null,
    signals,
  };
}

/** Whether one protocol is a rankable pre-token candidate under this snapshot's rules. */
export function isEligible(protocol: ProtocolRecord, snapshot: EligibilitySnapshot, options: EligibilityOptions = {}): boolean {
  const context = Object.keys(options).length === 0 ? contextFor(snapshot) : createEligibilityContext(snapshot, options);
  return classifyProtocol(protocol, context).eligible;
}

/** An empty count per exclusion code, so every key is present for the dashboard. */
function emptyCounts(): Record<ExclusionCode, number> {
  return {
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
 * TVL. `excluded` carries one reason each, grouped for the exclusions view. `conflicts` and
 * `missing` are the two ways coverage can break, and both should be empty.
 */
export function classifyUniverse(snapshot: EligibilitySnapshot, options: EligibilityOptions = {}): EligibilityUniverse {
  const context = createEligibilityContext(snapshot, options);
  const verdicts = snapshot.protocols.map((protocol) => classifyProtocol(protocol, context));
  const counts = emptyCounts();
  for (const verdict of verdicts) {
    if (verdict.exclusion !== null) counts[verdict.exclusion.code] += 1;
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

  const tokenless = snapshot.protocols.filter((protocol) => recordedToken(protocol) === null).length;

  return {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    verdicts,
    eligible,
    excluded,
    watchlist_verdicts: watchlistVerdicts,
    counts,
    stats: {
      protocols: verdicts.length,
      tokenless,
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

/** The rows the dashboard's exclusions view groups by rule, largest group first. */
export function exclusionsByRule(universe: EligibilityUniverse): Array<{ rule: ExclusionRule; verdicts: Verdict[] }> {
  const groups: Array<{ rule: ExclusionRule; verdicts: Verdict[] }> = [];
  for (const code of Object.keys(EXCLUSION_RULES) as ExclusionCode[]) {
    const verdicts = universe.excluded.filter((v) => v.exclusion?.code === code);
    if (verdicts.length > 0) groups.push({ rule: EXCLUSION_RULES[code], verdicts });
  }
  return groups.sort((a, b) => b.verdicts.length - a.verdicts.length);
}
