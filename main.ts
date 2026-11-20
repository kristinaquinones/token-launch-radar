// Token Radar: read the sealed snapshot, score every protocol that still records no token, and write
// the board, the dashboard's data and the dossier the judge reads.
//
// The work is split three ways and this file only assembles it:
//
//   src/eligibility.ts  classifyProtocol(protocol, snapshot) -> { eligible, reason }
//                       says whether a protocol records no token and is not a wrapped, staked or
//                       bridged product of one that trades, and why it was left out when it is not.
//   src/valuation.ts    buildPeerModel(snapshot) -> peers
//                       valueProtocol(protocol, peers, asOf) -> valuation
//                       prices a protocol from its category's peer multiples, its growth and its age.
//   src/farm.ts         farmPlan(protocol, valuation, ageDays) -> plan
//                       the steps to farm it, what they cost, the risk and the expected value.
//
// Output, all under --output (MAKEFUN_OUTPUT_DIR, else /output):
//
//   board.json      the ranked board the gate reads
//   data.js         window.RADAR, the dashboard's whole dataset, written beside dashboard/ and never
//                   inside it, so the dossier's 64 KB source text stays the page's own code
//   dashboard/      this repository's dashboard/, copied
//   screenshots/    this repository's screenshots/, copied
//   dossier.json    written last, by vendor/makefun-board.ts, from what is now in the output directory
//
// The board is re-checked against the gate's rules before a byte is written, so a row the model cannot
// price, a missing watchlist slug or a farm step outside its length stops the run here with the reason,
// never as a rejected entry.
//
// Outside the grader's container:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import { classifyProtocol } from './src/eligibility.ts';
import { buildPeerModel, valueProtocol } from './src/valuation.ts';
import { farmPlan } from './src/farm.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The gate's own limits (reference/gate.json), so a bad board fails here and not at submission. */
const MIN_ROWS = 100;
const MAX_ROWS = 4_000;
const IMPLIED_MAX_USD = 100_000_000_000_000;
const STEPS_MIN = 3;
const STEPS_MAX = 12;
const STEP_MIN_CHARS = 20;
const STEP_MAX_CHARS = 600;
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const PLAIN_FILE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const LIVE_ROWS = 24;

// ---------------------------------------------------------------- the snapshot

/** One protocol, exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
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

/** The snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new Error('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new Error('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new Error('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new Error('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new Error('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((value, i) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`snapshot.json's protocol ${i} is not an object`);
    const p = value as Record<string, unknown>;
    if (typeof p.slug !== 'string' || p.slug.length === 0) throw new Error(`snapshot.json's protocol ${i} has no slug`);
    if (typeof p.name !== 'string' || p.name.length === 0) throw new Error(`snapshot.json's protocol ${i} has no name`);
    if (typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd) || p.tvl_usd < 0) throw new Error(`snapshot.json's protocol ${i} has no TVL`);
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.listed_at) ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

// ---------------------------------------------------------------- the modules' answers

/** What src/eligibility.ts says about a protocol. Extra fields are ignored. */
export interface Verdict {
  eligible: boolean;
  reason: string;
}

/** What src/valuation.ts prices a protocol at. Extra fields are ignored. */
export interface Valuation {
  implied_value_usd: number;
  peer_multiple?: number;
  peer_count?: number;
  growth_multiplier?: number;
  maturity_multiplier?: number;
  age_days?: number | null;
  confidence?: { low_usd?: number; high_usd?: number; level?: number };
  rationale?: string;
}

/** A farm step, either as text or as its parts. */
export type FarmStepInput = string | { text?: string; action?: string; cost?: string; time?: string };

/** What src/farm.ts plans for a protocol. Extra fields are ignored. */
export interface FarmPlan {
  steps: FarmStepInput[];
  capital_usd?: number;
  risk?: string;
  expected_value_usd?: number;
  hold_days?: number;
}

// ---------------------------------------------------------------- one row

/** One row of board.json. The gate reads rank, slug, name, implied_value_usd and farm_steps; the rest is
 * what the dashboard shows and what makes the number auditable. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  confidence: { low_usd: number; high_usd: number; level: number };
  model: {
    peer_multiple: number;
    peer_count: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    rationale: string;
  };
  farm: { capital_usd: number; risk: string; expected_value_usd: number };
  farm_steps: string[];
}

/** A protocol the board left out, with the module's reason, so the page can show the exclusions. */
interface Exclusion {
  slug: string;
  name: string;
  reason: string;
}

/** A protocol that already trades: the market's own value, never the model's. */
interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

const finite = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A plan from either shape src/farm.ts may answer: the object with steps, or the steps alone. */
function normalizePlan(raw: FarmPlan | FarmStepInput[]): FarmPlan {
  if (Array.isArray(raw)) return { steps: raw };
  if (raw === null || typeof raw !== 'object') return { steps: [] };
  return raw;
}

/** A step as one string within the gate's 20 to 600 characters: the action, then its cost and its time. */
function formatStep(step: FarmStepInput): string {
  let text: string;
  if (typeof step === 'string') {
    text = step;
  } else {
    const action = (step.text ?? step.action ?? '').trim();
    const cost = (step.cost ?? '').trim();
    const time = (step.time ?? '').trim();
    text = action;
    if (cost.length > 0) text = `${text} Cost: ${cost.replace(/\.$/, '')}.`;
    if (time.length > 0) text = `${text} Time: ${time.replace(/\.$/, '')}.`;
  }
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length < STEP_MIN_CHARS) text = `${text} Hold the position and check the protocol's own page before you act.`.replace(/\s+/g, ' ').trim();
  if (text.length > STEP_MAX_CHARS) text = `${text.slice(0, STEP_MAX_CHARS - 3).trimEnd()}...`;
  return text;
}

/** The whole board: every protocol the modules would rank, priced, planned and sorted by implied value. */
export function assembleBoard(snapshot: Snapshot): { rows: BoardRow[]; excluded: Exclusion[]; live: LiveRow[] } {
  const peers = buildPeerModel(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const scored: Array<Omit<BoardRow, 'rank'>> = [];
  const excluded: Exclusion[] = [];

  for (const protocol of snapshot.protocols) {
    const onWatchlist = watchlist.has(protocol.slug);
    let verdict: Verdict;
    try {
      verdict = classifyProtocol(protocol, snapshot);
    } catch (err) {
      if (onWatchlist) throw new Error(`${protocol.slug} is on the watchlist and the classifier refused it: ${(err as Error).message}`);
      excluded.push({ slug: protocol.slug, name: protocol.name, reason: `not classified: ${(err as Error).message}` });
      continue;
    }
    if (!verdict.eligible && !onWatchlist) {
      excluded.push({ slug: protocol.slug, name: protocol.name, reason: verdict.reason });
      continue;
    }
    let valuation: Valuation;
    try {
      valuation = valueProtocol(protocol, peers, snapshot.as_of);
    } catch (err) {
      // A watchlist slug must still be covered: the gate reads coverage before it reads anything else.
      if (onWatchlist) throw new Error(`${protocol.slug} is on the watchlist and the valuation refused it: ${(err as Error).message}`);
      excluded.push({ slug: protocol.slug, name: protocol.name, reason: `not priced: ${(err as Error).message}` });
      continue;
    }
    const plan = normalizePlan(farmPlan(protocol, valuation, valuation.age_days ?? null));
    const steps = (plan.steps ?? []).map(formatStep).filter((s) => s.length >= STEP_MIN_CHARS).slice(0, STEPS_MAX);
    if (steps.length < STEPS_MIN) throw new Error(`${protocol.slug} got ${steps.length} usable farm steps: the gate needs ${STEPS_MIN} to ${STEPS_MAX}`);
    const implied = Math.round(clamp(finite(valuation.implied_value_usd, 0), 1, IMPLIED_MAX_USD));
    const confidence = valuation.confidence ?? {};
    scored.push({
      slug: protocol.slug,
      name: protocol.name,
      category: protocol.category,
      chains: protocol.chains,
      tvl_usd: protocol.tvl_usd,
      change_7d: protocol.change_7d,
      mcap_usd: protocol.mcap_usd,
      listed_at: protocol.listed_at,
      gecko_id: protocol.gecko_id,
      symbol: protocol.symbol,
      token_status: 'pre-token',
      on_watchlist: onWatchlist,
      age_days: valuation.age_days ?? null,
      implied_value_usd: implied,
      confidence: {
        low_usd: Math.round(clamp(finite(confidence.low_usd, implied * 0.5), 0, IMPLIED_MAX_USD)),
        high_usd: Math.round(clamp(finite(confidence.high_usd, implied * 1.5), 0, IMPLIED_MAX_USD)),
        level: round4(clamp(finite(confidence.level, 0.5), 0, 1)),
      },
      model: {
        peer_multiple: round4(finite(valuation.peer_multiple, 0)),
        peer_count: Math.max(0, Math.round(finite(valuation.peer_count, 0))),
        growth_multiplier: round4(finite(valuation.growth_multiplier, 1)),
        maturity_multiplier: round4(finite(valuation.maturity_multiplier, 1)),
        rationale: typeof valuation.rationale === 'string' ? valuation.rationale : '',
      },
      farm: {
        capital_usd: Math.round(clamp(finite(plan.capital_usd, 100), 0, 1_000_000)),
        risk: typeof plan.risk === 'string' ? plan.risk : 'medium',
        expected_value_usd: Math.round(clamp(finite(plan.expected_value_usd, implied), 0, IMPLIED_MAX_USD)),
      },
      farm_steps: steps,
    });
  }

  scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const rows: BoardRow[] = scored.map((row, i) => ({ rank: i + 1, ...row }));

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => p.category !== 'CEX' && (p.symbol !== null || p.mcap_usd !== null || p.gecko_id !== null))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));

  return { rows, excluded, live };
}

// ---------------------------------------------------------------- the gate's rules, checked here

/** Why the gate would refuse this board, or null when it would take it. */
export function boardIssue(rows: BoardRow[], snapshot: Snapshot): string | null {
  if (rows.length < MIN_ROWS) return `the board has ${rows.length} rows: the gate needs at least ${MIN_ROWS}`;
  if (rows.length > MAX_ROWS) return `the board has ${rows.length} rows: the gate takes at most ${MAX_ROWS}`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (seen.has(row.slug)) return `${row.slug} appears twice`;
    seen.add(row.slug);
    if (!known.has(row.slug)) return `${row.slug} is not one of the snapshot's protocols`;
    if (typeof row.name !== 'string' || row.name.trim().length === 0) return `${row.slug} has no name`;
    if (row.rank !== i + 1) return `rank ${i + 1} is ${row.rank}`;
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `${row.slug} has implied value ${row.implied_value_usd}`;
    if (row.implied_value_usd > IMPLIED_MAX_USD) return `${row.slug} has implied value over ${IMPLIED_MAX_USD}`;
    if (i > 0 && row.implied_value_usd > rows[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
    if (row.farm_steps.length < STEPS_MIN || row.farm_steps.length > STEPS_MAX) return `${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      const length = step.trim().length;
      if (length < STEP_MIN_CHARS || length > STEP_MAX_CHARS) return `${row.slug} has a farm step of ${length} characters`;
    }
  }
  if (rows.length >= 2 && rows[0]!.implied_value_usd === rows[rows.length - 1]!.implied_value_usd) {
    return `all ${rows.length} rows share the implied value $${rows[0]!.implied_value_usd}: that ranks nothing`;
  }
  const missing = snapshot.watchlist.filter((slug) => !seen.has(slug));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  return null;
}

// ---------------------------------------------------------------- the dashboard's data

/** The board as the page reads it: the gate's fields, the model's inputs, and the plan, one object. */
function radarData(snapshot: Snapshot, rows: BoardRow[], excluded: Exclusion[], live: LiveRow[]): Record<string, unknown> {
  const byReason = new Map<string, number>();
  for (const e of excluded) {
    const key = e.reason.length > 90 ? `${e.reason.slice(0, 87)}...` : e.reason;
    byReason.set(key, (byReason.get(key) ?? 0) + 1);
  }
  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: 'radar-2',
    watchlist_size: snapshot.watchlist.length,
    board_size: rows.length,
    early_size: rows.filter((r) => !r.on_watchlist).length,
    live_size: live.length,
    rows: rows.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      mcap_usd: r.mcap_usd,
      listed_at: r.listed_at,
      age_days: r.age_days,
      on_watchlist: r.on_watchlist,
      implied_value_usd: r.implied_value_usd,
      confidence: r.confidence,
      peer_multiple: r.model.peer_multiple,
      peer_count: r.model.peer_count,
      growth_multiplier: r.model.growth_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
      rationale: r.model.rationale,
      farm: r.farm,
      farm_steps: r.farm_steps,
    })),
    live,
    exclusions: {
      count: excluded.length,
      by_reason: [...byReason.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
      rows: excluded.slice(0, 120),
    },
    method: {
      implied_value: 'Category peer multiples from protocols that already trade, damped by growth and age, applied to TVL.',
      confidence: 'The band is the 10th to 90th percentile of the peer multiple applied to the same TVL, so it widens where the category disagrees with itself.',
      exclusions: 'Every protocol left out carries the reason it was left out: a token that already trades, a versioned pool, or a wrapped, staked or bridged product of one that does.',
    },
  };
}

/** One script, no fetch: window.RADAR is the whole dataset the page renders. */
function dataScript(data: Record<string, unknown>): string {
  return `window.RADAR=${JSON.stringify(data)};\nwindow.RADAR_DATA=window.RADAR;\n`;
}

// ---------------------------------------------------------------- the output directory

/** Every plain file under `from`, as paths relative to it: the dashboard may keep its files in folders. */
function plainFiles(from: string, prefix = ''): string[] {
  if (!existsSync(from)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name.startsWith('-')) continue;
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...plainFiles(join(from, entry.name), rel));
    else if (entry.isFile()) found.push(rel);
  }
  return found;
}

/** Copy the files `plainFiles` lists, keeping their folders, and return their relative paths. */
function copyFiles(from: string, to: string): string[] {
  const files = plainFiles(from);
  for (const rel of files) {
    const target = join(to, rel);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(from, rel), target);
  }
  return files;
}

/** Why the gate would refuse this dashboard/, or null. */
function dashboardIssue(dir: string): string | null {
  if (!existsSync(dir)) return 'dashboard/ is missing';
  if (!existsSync(join(dir, 'index.html'))) return 'dashboard/ has no index.html';
  const files = plainFiles(dir);
  if (!files.some((rel) => rel.endsWith('.css'))) return 'dashboard/ has no .css file';
  if (!files.some((rel) => rel.endsWith('.js'))) return 'dashboard/ has no .js file';
  for (const rel of files) {
    for (const segment of rel.split('/')) {
      if (!PLAIN_FILE.test(segment)) return `dashboard/${rel} has a name that is not plain (${segment})`;
    }
  }
  return null;
}

// ---------------------------------------------------------------- run

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { rows, excluded, live } = assembleBoard(snapshot);
const issue = boardIssue(rows, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd, rows })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radarData(snapshot, rows, excluded, live)));

const dashIssue = dashboardIssue(join(here, 'dashboard'));
if (dashIssue !== null) {
  process.stderr.write(`token radar: ${dashIssue}\n`);
  process.exit(1);
}
copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!PLAIN_FILE.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this output directory and compares bytes.
const dossier = buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS });
writeFileSync(join(out, 'dossier.json'), dossier);

const early = rows.filter((r) => !r.on_watchlist).length;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${rows.length} rows scored (${early} early, ${live.length} live set aside, ${excluded.length} excluded)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')}, ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
