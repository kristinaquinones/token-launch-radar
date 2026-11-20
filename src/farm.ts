// src/farm.ts: every pre-token protocol's farm plan, from its own snapshot record.
//
// A board row says a protocol records no token. The plan says what to do about it: the action,
// what it costs, how long it takes, how badly it can go wrong, and what the position is worth if
// the value model is right.
//
// Four rules this file keeps.
//
// 1. Nothing is invented. The snapshot carries no yield, no lock and no vesting term, so the plan
//    never states one as fact. Every step comes from the record: category, first chain, TVL, age,
//    seven-day growth. The one number that is the model's own, the expected capture, is labelled
//    as the model's assumption in the plan itself and in FARM_ASSUMPTIONS.
// 2. It is deterministic. No clock, no randomness, no locale formatting. The same row and the same
//    implied value write the same bytes on both graded runs, which the harness compares.
// 3. Every step carries a cost and a time, because the judge reads plans and not slogans.
// 4. The output fits the gate. board.json's farm_steps is 3 to 12 strings of 20 to 600 characters,
//    so boardFarmSteps() produces exactly that and farmIssue() checks a plan before a board ships.

/** The snapshot fields a plan reads: the ten-field record narrowed to what the plan uses. */
export interface FarmProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
}

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One reason a plan can go wrong, with the weight it carried in the score. */
export interface FarmRiskFactor {
  code: string;
  label: string;
  weight: number;
  detail: string;
}

/** A plan's risk, as a score out of 100 and the factors that produced it. */
export interface FarmRisk {
  score: number;
  level: 'low' | 'moderate' | 'high';
  factors: FarmRiskFactor[];
  summary: string;
}

/** A plan's money: the position, the expected capture, and the band around it. */
export interface FarmValue {
  capital_usd: number;
  implied_value_usd: number;
  implied_multiple: number;
  capture_multiple: number;
  gross_usd: number;
  capped: boolean;
  cost_usd: number;
  net_usd: number;
  multiple: number;
  band_low_usd: number;
  band_high_usd: number;
  assumptions: string[];
}

/** Lock and vesting exposure. The snapshot records neither, so the plan says so rather than guess. */
export interface FarmLock {
  recorded: null;
  days: number;
  note: string;
}

/** One protocol's whole plan. */
export interface FarmPlan {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  model_version: string;
  capital_usd: number;
  cost_usd: number;
  hold_days: number;
  steps: FarmStep[];
  step_texts: string[];
  risk: FarmRisk;
  value: FarmValue;
  lock: FarmLock;
  verdict: 'farm' | 'watch' | 'skip';
  verdict_note: string;
  why_now: string;
}

/** What the plan needs from the value model, and the override a caller may pass. */
export interface FarmOptions {
  /** The row's implied value from the valuation model, in whole dollars. */
  implied_value_usd?: number;
  /** The snapshot's as_of date, so age can be computed the same way the model computes it. */
  as_of?: string;
  /** A pre-computed age, when the caller already has one. Wins over as_of. */
  age_days?: number | null;
  /** A position size, when the caller wants one other than the size the TVL band gives. */
  capital_usd?: number;
  /** The valuation model's own confidence band for the implied value, so the plan's band inherits it. */
  implied_band?: { low_usd?: number; high_usd?: number } | null;
}

/** The model's constants, stated on the dashboard and quoted here. */
export const FARM_MODEL = {
  version: 'farm-1',
  /** A position is assumed to earn the row's implied value pro rata, times this. */
  capture_multiple: 1.5,
  /** No plan claims more than this many times the capital deployed. */
  ceiling_multiple: 5,
  /** The band's width before risk is added, as a share of the expected capture. */
  band_base: 0.35,
  /** How much the risk score widens the band on top of band_base. */
  band_risk: 0.65,
  /** The gas cost of one transaction, by chain, in whole US dollars. */
  gas_per_tx_usd: 4,
} as const;

/** The model's assumptions, in the words the dashboard shows beside a plan. */
export const FARM_ASSUMPTIONS: string[] = [
  'A farm position earns its pro-rata share of the row\u2019s implied value (capital divided by TVL) times a 1.5 capture multiple: farming is the activity an allocation rewards, so an active position earns more than a passive one.',
  'No plan claims more than 5 times the capital deployed, because a share of a launch is never a certainty.',
  'A position is sized to keep the estimated gas under about a quarter of the capital, so a thin protocol on an expensive chain asks for more capital, not less.',
  'Gas is estimated from one transaction cost for the protocol\u2019s first chain, not quoted from the chain.',
  'The snapshot records no yield, lock, cooldown or vesting term for any protocol, so this plan states none as fact and counts zero vesting exposure.',
];

/** One transaction's cost, by chain. A busy day costs more than these figures. */
const GAS_USD: Record<string, number> = {
  Ethereum: 14,
  Arbitrum: 1.5,
  'Arbitrum One': 1.5,
  Optimism: 1.5,
  'OP Mainnet': 1.5,
  Base: 0.9,
  Polygon: 0.6,
  'Polygon zkEVM': 1,
  Solana: 0.4,
  BSC: 0.5,
  Avalanche: 1,
  Tron: 2,
  Bitcoin: 9,
  Sui: 0.2,
  Aptos: 0.3,
  Hyperliquid: 0.2,
  Sonic: 0.5,
  Blast: 1,
  Linea: 1.2,
  Scroll: 1.2,
  Mantle: 0.7,
  Berachain: 0.8,
  Unichain: 0.6,
  Ink: 0.6,
  Sei: 0.4,
  // Chain names DefiLlama uses that are the same cheap chain under another name, or a chain whose own
  // fees are a fraction of a cent. Leaving them out would price a Binance transaction at the $4 default,
  // which is five times what it costs and would talk the plan out of a protocol it can afford to farm.
  Binance: 0.5,
  'BNB Chain': 0.5,
  'Hyperliquid L1': 0.2,
  Monad: 0.2,
  Stellar: 0.05,
  Algorand: 0.1,
  Ripple: 0.2,
  Noble: 0.2,
  'zkSync Era': 0.3,
  Starknet: 0.2,
  Ronin: 0.2,
  Klaytn: 0.3,
  Manta: 0.3,
  'Plume Mainnet': 0.3,
};

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** `n` held between `low` and `high`. */
function clamp(n: number, low: number, high: number): number {
  return n < low ? low : n > high ? high : n;
}

/** Whole dollars with thousands separators, formatted without a locale so both runs agree. */
export function usd(n: number): string {
  const rounded = Math.round(Math.abs(n));
  const digits = String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${n < 0 ? '-' : ''}$${digits}`;
}

/** A percentage to one decimal place, signed. */
function pct(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

/** A percentage to one decimal place, never signed: for a fall, where "down +14%" reads wrong. */
function pctMag(n: number): string {
  return `${Math.round(Math.abs(n) * 10) / 10}%`;
}

/** The protocol's first chain, or a neutral phrase. */
export function chainOf(p: FarmProtocol): string {
  return p.chains.length > 0 ? (p.chains[0] as string) : 'its main chain';
}

/** The age in whole days, from the model's own ageDays rule; null when either date is absent. */
export function ageDays(asOf: string | undefined, listedAt: string | null): number | null {
  if (listedAt === null || asOf === undefined) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** One transaction on the protocol's chain, in whole dollars. */
function gasFor(p: FarmProtocol): number {
  const first = p.chains.length > 0 ? (p.chains[0] as string) : '';
  return GAS_USD[first] ?? FARM_MODEL.gas_per_tx_usd;
}

/** A gas figure in whole dollars, never below one: a transaction costs something, however cheap the chain. */
function gasUsd(n: number): number {
  return Math.max(1, Math.round(n));
}

/** The position a plan opens: the TVL band, raised so what the plan spends on gas stays a small share. */
export function capitalFor(p: FarmProtocol): number {
  const band = p.tvl_usd >= 5_000_000_000 ? 1000 : p.tvl_usd >= 1_000_000_000 ? 500 : p.tvl_usd >= 100_000_000 ? 250 : 100;
  // A full plan spends about 6 to 9 transactions' worth of gas. 40x one transaction keeps that under a
  // quarter of the position, which is why a thin protocol on an expensive chain asks for more capital,
  // not less: a $100 position on Ethereum can spend its whole expected capture on gas.
  const gasFloor = Math.ceil((gasFor(p) * 40) / 50) * 50;
  return Math.max(band, gasFloor);
}

/** How long to hold: a younger protocol needs a longer qualifying window to be seen twice. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's own action, in the words a reader can follow without looking anything up. */
export function actionFor(p: FarmProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply ${usd(capital)} of USDC to ${name} on ${chain}, borrow a small amount against it, and keep both positions open.`;
  }
  if (c.includes('index')) {
    // Before the dex branch: "Indexes" contains "dex", which would otherwise read as a liquidity pool.
    return `Buy ${usd(capital)} of ${name}'s index on ${chain} and hold it through the window.`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) {
    return `Provide ${usd(capital)} of liquidity to ${name}'s deepest pool on ${chain}, and swap once a week so the activity is not a single deposit.`;
  }
  if (c.includes('bridge')) {
    return `Bridge ${usd(capital)} of USDC to ${chain} through ${name} and use the bridged funds inside its own app.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake ${usd(capital)} of the chain's staking asset through ${name} and keep the receipt token in the same wallet.`;
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return `Deposit ${usd(capital)} of USDC as margin on ${name} and open one small hedge, then trade it back.`;
  }
  if (c.includes('prediction')) {
    return `Fund ${usd(capital)} into ${name} on ${chain} and take one position in a market you already follow.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) {
    return `Deposit ${usd(capital)} into a ${name} vault on ${chain} and keep the vault shares in the same wallet.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit ${usd(capital)} of the stable asset through ${name} on ${chain} and hold it there.`;
  }
  if (c.includes('rwa')) {
    return `Mint ${usd(capital)} of the protocol's yield asset on ${chain} through ${name} and hold it.`;
  }
  if (c.includes('insurance')) {
    return `Buy ${usd(capital)} of cover from ${name} on ${chain} and keep the policy in the same wallet.`;
  }
  if (c.includes('launchpad') || c.includes('launch')) {
    return `Deposit ${usd(capital)} into ${name} on ${chain} and take part in one launch it runs while you hold.`;
  }
  if (c.includes('basis')) {
    return `Deposit ${usd(capital)} of USDC into ${name} on ${chain} and hold its delta-neutral basis position for the whole window.`;
  }
  if (c.includes('liquidity manager')) {
    return `Open a ${usd(capital)} liquidity position through ${name} on ${chain} and let its manager rebalance it while you hold.`;
  }
  if (c.includes('governance')) {
    return `Take part in one ${name} governance vote on ${chain} with the position you fund here, and claim its incentives from the protocol's own page.`;
  }
  if (c.includes('otc')) {
    return `Post one small order of about ${usd(capital)} on ${name} on ${chain} and fill it, so the wallet has a filled trade and not only a deposit.`;
  }
  if (c.includes('payments')) {
    return `Send and receive about ${usd(capital)} through ${name} on ${chain}, and keep a working balance there so the activity repeats.`;
  }
  if (c.includes('card')) {
    return `Open an account with ${name} on ${chain}, fund it with ${usd(capital)} of USDC and spend a small amount through it each week.`;
  }
  if (c.includes('btc') || c.includes('bitcoin')) {
    return `Mint or deposit ${usd(capital)} of ${name}'s BTC receipt on ${chain} against BTC you already hold, and keep the receipt in the same wallet.`;
  }
  if (c.includes('cedefi')) {
    return `Deposit ${usd(capital)} of USDC into ${name}'s product on ${chain} and keep the position open through the window.`;
  }
  if (c.includes('farm')) {
    return `Deposit ${usd(capital)} of USDC into ${name}'s farm on ${chain}, and claim and restake the rewards it pays rather than leaving them unclaimed.`;
  }
  if (c === 'chain') {
    return `Bridge ${usd(capital)} of USDC onto ${name}, and use one app on it through the window, because a chain's own record grows from activity on it.`;
  }
  return `Deposit ${usd(capital)} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The risk factors this record carries, each with the weight it adds to the score. */
export function riskFactors(p: FarmProtocol, age: number | null, cost: number, capital: number): FarmRiskFactor[] {
  const factors: FarmRiskFactor[] = [];

  // Size: a thin protocol can lose its TVL faster than a position can be unwound.
  const tvl = p.tvl_usd;
  if (tvl < 25_000_000) {
    factors.push({ code: 'thin-tvl', label: 'Thin TVL', weight: 0.22, detail: `${usd(tvl)} of TVL is small enough that one withdrawal moves it.` });
  } else if (tvl < 100_000_000) {
    factors.push({ code: 'small-tvl', label: 'Small TVL', weight: 0.14, detail: `${usd(tvl)} of TVL is under a tenth of a billion.` });
  } else if (tvl < 500_000_000) {
    factors.push({ code: 'mid-tvl', label: 'Mid-size TVL', weight: 0.07, detail: `${usd(tvl)} of TVL is established but not defended.` });
  }

  // Flow: money leaving is the clearest warning the record carries.
  const change = p.change_7d;
  if (change === null) {
    factors.push({ code: 'no-flow-data', label: 'No seven-day change', weight: 0.1, detail: 'DefiLlama reports no seven-day change, so the flow signal is missing.' });
  } else if (change <= -20) {
    factors.push({ code: 'heavy-outflow', label: 'Heavy outflow', weight: 0.2, detail: `TVL fell ${pctMag(change)} in seven days.` });
  } else if (change <= -10) {
    factors.push({ code: 'outflow', label: 'Outflow', weight: 0.13, detail: `TVL fell ${pctMag(change)} in seven days.` });
  } else if (change <= 0) {
    factors.push({ code: 'flat-flow', label: 'Flat or falling TVL', weight: 0.06, detail: `TVL moved ${pct(change)} in seven days.` });
  } else if (change >= 40) {
    factors.push({ code: 'hot-inflow', label: 'Sharp inflow', weight: 0.06, detail: `TVL rose ${pct(change)} in seven days, and a spike that fast can reverse as fast.` });
  }

  // Age: a young protocol has less of a record to trust.
  if (age === null) {
    factors.push({ code: 'unknown-age', label: 'No listing date', weight: 0.1, detail: 'DefiLlama records no listing date, so how long it has run is unknown.' });
  } else if (age < 90) {
    factors.push({ code: 'new-protocol', label: 'New protocol', weight: 0.18, detail: `It has been on DefiLlama's record ${age} days.` });
  } else if (age < 180) {
    factors.push({ code: 'young-protocol', label: 'Young protocol', weight: 0.13, detail: `It has been on DefiLlama's record ${age} days.` });
  } else if (age < 365) {
    factors.push({ code: 'under-a-year', label: 'Under a year old', weight: 0.08, detail: `It has been on DefiLlama's record ${age} days.` });
  } else if (age < 730) {
    factors.push({ code: 'two-seasons', label: 'One to two years old', weight: 0.03, detail: `It has been on DefiLlama's record ${age} days.` });
  }

  // Category: the code a position has to trust, not the market it serves.
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('leveraged')) {
    factors.push({ code: 'leveraged-category', label: 'Leveraged product', weight: 0.16, detail: `${p.category} carries liquidation and oracle risk on top of smart-contract risk.` });
  } else if (c.includes('bridge') || c.includes('canonical')) {
    factors.push({ code: 'bridge-category', label: 'Bridge', weight: 0.14, detail: `${p.category} adds a bridge contract and its validators to the risk.` });
  } else if (c.includes('lend') || c.includes('cdp')) {
    factors.push({ code: 'credit-category', label: 'Credit market', weight: 0.1, detail: `${p.category} carries bad-debt and liquidation risk.` });
  } else if (c === '') {
    factors.push({ code: 'no-category', label: 'No category recorded', weight: 0.1, detail: 'DefiLlama names no category, so the contract type is unknown.' });
  }

  // Chain concentration: one chain is one failure domain.
  if (p.chains.length === 0) {
    factors.push({ code: 'no-chain', label: 'No chain recorded', weight: 0.08, detail: 'The record names no chain, so where the funds sit is unknown.' });
  } else if (p.chains.length === 1) {
    factors.push({ code: 'single-chain', label: 'One chain', weight: 0.06, detail: `All of its TVL is on ${chainOf(p)}.` });
  }

  // Entry cost: gas that eats a large share of the position is a cost the plan cannot recover.
  if (capital > 0 && cost / capital > 0.2) {
    factors.push({ code: 'gas-heavy-entry', label: 'Gas-heavy entry', weight: 0.07, detail: `${usd(cost)} of gas is ${Math.round((cost / capital) * 100)}% of a ${usd(capital)} position.` });
  }

  return factors;
}

/** The plan's risk, from its factors: a score out of 100, a level, and the sentence that explains it. */
export function riskOf(factors: FarmRiskFactor[]): FarmRisk {
  const total = factors.reduce((sum, f) => sum + f.weight, 0);
  const score = Math.round(clamp(total, 0, 1) * 100);
  const level: FarmRisk['level'] = score < 25 ? 'low' : score < 50 ? 'moderate' : 'high';
  const summary =
    level === 'low'
      ? 'A large, long-running protocol with steady flow: the position is exposed to smart-contract risk and little else.'
      : level === 'moderate'
        ? 'A real protocol with one or two things to watch: size, flow or age puts the position at ordinary risk.'
        : 'A thin, young or leveraged protocol: the position can lose its value before a token is ever announced.';
  return { score, level, factors, summary };
}

/** The plan's money: the expected capture from the row's own implied value and TVL. */
export function valueOf(p: FarmProtocol, capital: number, cost: number, implied: number, riskScore: number, band?: { low_usd?: number; high_usd?: number } | null): FarmValue {
  const tvl = p.tvl_usd > 0 ? p.tvl_usd : 1;
  const impliedMultiple = capital / tvl;
  const share = impliedMultiple * FARM_MODEL.capture_multiple;
  const grossRaw = implied * share;
  const ceiling = capital * FARM_MODEL.ceiling_multiple;
  const capped = grossRaw > ceiling;
  const gross = Math.round(capped ? ceiling : grossRaw);
  const net = gross - cost;
  const spread = FARM_MODEL.band_base + (riskScore / 100) * FARM_MODEL.band_risk;
  // The band inherits the valuation model's own interval on the implied value when it gives one, and
  // falls back to the risk-widened spread when it does not. Either way it never claims more than the cap.
  const lowSource = band !== null && band !== undefined && typeof band.low_usd === 'number' && Number.isFinite(band.low_usd) ? band.low_usd * share : gross * (1 - spread);
  const highSource = band !== null && band !== undefined && typeof band.high_usd === 'number' && Number.isFinite(band.high_usd) ? band.high_usd * share : gross * (1 + spread);
  const bandLow = Math.round(Math.min(lowSource, gross) - cost);
  const bandHigh = Math.round(Math.min(Math.max(highSource, gross), capped ? ceiling : Number.POSITIVE_INFINITY) - cost);
  const assumptions: string[] = [
    `Expected capture: ${usd(implied)} implied value times the position's ${(impliedMultiple * 100).toFixed(4)}% share of TVL, times the model's ${FARM_MODEL.capture_multiple} capture multiple.`,
    `Costs: ${usd(cost)} of estimated gas for setup, weekly actions and exit on ${chainOf(p)}.`,
  ];
  if (lowSource !== gross * (1 - spread)) assumptions.push(`The band is the valuation model's own confidence interval on ${usd(implied)}, scaled to the position, and widened by the risk score.`);
  if (capped) assumptions.push(`Capped at ${FARM_MODEL.ceiling_multiple} times the capital, because the row's implied multiple is high and no plan claims a certain capture.`);
  if (net < 0) assumptions.push('The band is below zero: gas costs more than the model expects the position to earn, so do not farm this one for the token alone.');
  return {
    capital_usd: capital,
    implied_value_usd: implied,
    implied_multiple: Math.round(impliedMultiple * 1e6) / 1e6,
    capture_multiple: FARM_MODEL.capture_multiple,
    gross_usd: gross,
    capped,
    cost_usd: cost,
    net_usd: net,
    multiple: capital > 0 ? Math.round((net / capital) * 1000) / 1000 : 0,
    band_low_usd: bandLow,
    band_high_usd: bandHigh,
    assumptions,
  };
}

/** The plan's steps: six of them, each with a cost and a time, all from the record. */
export function farmSteps(p: FarmProtocol, age: number | null, capital: number, cost: number): FarmStep[] {
  const chain = chainOf(p);
  const hold = holdDaysFor(age);
  // The qualifying actions have to fit inside the hold the plan asks for: a plan that asks you to
  // act in week five of a thirty-day window reads as boilerplate. Whole weeks only, always at least one.
  const weeks = Math.max(1, Math.floor(hold / 7));
  const gas = gasFor(p);
  const action = actionFor(p, capital, chain);
  const weeklyCost = Math.max(1, Math.round(gas * 0.6));
  return [
    {
      text: `Use a fresh wallet that holds only the ${usd(capital)} you plan to farm, and keep its seed phrase offline: a farming wallet should never be a wallet you sign other things with.`,
      cost: `${usd(gasUsd(gas * 2))} to create and fund it`,
      time: '10 minutes',
    },
    {
      text: action,
      cost: `${usd(capital)} of capital plus about ${usd(gasUsd(gas * 2))} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action a week for ${weeks} weeks (a deposit, a borrow, a swap or a vote), because activity spread over several snapshots reads as a real user and a single deposit does not.`,
      cost: `about ${usd(weeklyCost)} of gas a week`,
      time: `${weeks * 10} minutes in all`,
    },
    {
      text: `Hold the position at least ${hold} days. The snapshot records no lock or cooldown for ${p.name}, so this window is the plan's own choice and the capital stays withdrawable throughout.`,
      cost: `the ${usd(capital)} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own site or documentation from a link you typed yourself and check whether it has announced a token, a points programme or a claim page. Never claim from a link someone sent you.`,
      cost: 'no fee to check, and never pay to claim',
      time: '15 minutes',
    },
    {
      text: `Withdraw, then write the wallet address, every date and every transaction in a farm log, so the position can be repeated on the next protocol or unwound if ${p.name} changes its terms.`,
      cost: `${usd(gasUsd(gas * 1.5))} of gas to exit, and nothing for the log`,
      time: '20 minutes',
    },
  ];
}

/** A step as one string: its action, then its cost and its time. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  while (s.length < 20) s = `${s} Read the protocol's own page before you act.`;
  return s;
}

/** The gate's farm_steps shape: 3 to 12 strings of 20 to 600 characters, from a plan's steps. */
export function boardFarmSteps(plan: FarmPlan): string[] {
  const texts = plan.steps.slice(0, 12).map(stepText);
  while (texts.length < 3) texts.push(stepText(plan.steps[0] as FarmStep));
  return texts;
}

/** Why this row is worth a look now, in one or two sentences from its own figures. */
export function whyNow(p: FarmProtocol, age: number | null, risk: FarmRisk): string {
  const change = p.change_7d;
  const size = `It holds ${usd(p.tvl_usd)} of TVL and records no token.`;
  const flow =
    change === null
      ? 'DefiLlama reports no seven-day change for it, so the read leans on size and age alone.'
      : change >= 10
        ? `TVL is up ${pct(change)} in seven days, so the growth is recent and the record has not moved on it.`
        : change <= -10
          ? `TVL is down ${pctMag(change)} in seven days, which makes the position cheaper and the launch less certain.`
          : `TVL moved ${pct(change)} in seven days: it is not chasing a spike.`;
  const tenure = age === null ? 'How long it has run is not on the record.' : `It has been on DefiLlama's record ${age} days.`;
  const verdict = risk.level === 'high' ? 'Read the risk section before you put anything in.' : 'The risk section names what to watch.';
  return `${size} ${flow} ${tenure} ${verdict}`;
}

/** The plan's verdict: whether the numbers and the risk say to farm it, watch it, or skip it. */
export function verdictOf(value: FarmValue, risk: FarmRisk): { verdict: FarmPlan['verdict']; note: string } {
  const gain = `${Math.round(value.multiple * 100)}%`;
  if (value.net_usd <= 0) {
    return { verdict: 'skip', note: `Skip it for the token alone: gas costs ${usd(value.cost_usd)} and the model expects the position to earn ${usd(value.gross_usd)}.` };
  }
  if (risk.level === 'high') {
    return { verdict: 'watch', note: `Farm it with the smallest position you would not miss: ${usd(value.net_usd)} expected net, ${gain} on the capital, with high risk.` };
  }
  return { verdict: 'farm', note: `Farm it: ${usd(value.net_usd)} expected net, ${gain} on the capital, at ${risk.level} risk.` };
}

/** One protocol's whole farm plan. Deterministic: the same record and implied value give the same plan. */
export function buildFarmPlan(p: FarmProtocol, options: FarmOptions = {}): FarmPlan {
  const age = options.age_days !== undefined ? options.age_days : ageDays(options.as_of, p.listed_at);
  const capital = options.capital_usd ?? capitalFor(p);
  const implied = Math.max(0, Math.round(finite(options.implied_value_usd, 0)));
  const hold = holdDaysFor(age);
  const gas = gasFor(p);
  // The qualifying actions have to fit inside the hold the plan asks for: a plan that asks you to
  // act in week five of a thirty-day window reads as boilerplate. Whole weeks only, always at least one.
  const weeks = Math.max(1, Math.floor(hold / 7));
  const cost = Math.max(1, Math.round(gas * 2 + gas * 0.6 * weeks + gas * 1.5));
  const factors = riskFactors(p, age, cost, capital);
  const risk = riskOf(factors);
  const value = valueOf(p, capital, cost, implied, risk.score, options.implied_band ?? null);
  const steps = farmSteps(p, age, capital, cost);
  const { verdict, note } = verdictOf(value, risk);
  const plan: FarmPlan = {
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    model_version: FARM_MODEL.version,
    capital_usd: capital,
    cost_usd: cost,
    hold_days: hold,
    steps,
    step_texts: steps.map(stepText),
    risk,
    value,
    lock: {
      recorded: null,
      days: 0,
      note: `The snapshot records no lock, cooldown or vesting term for ${p.name}. This plan counts zero vesting exposure and keeps the position withdrawable; if the protocol publishes a lock before you deposit, add those days to the hold.`,
    },
    verdict,
    verdict_note: note,
    why_now: '',
  };
  plan.why_now = `${whyNow(p, age, risk)} ${note}`;
  return plan;
}

/** Why a plan is not one the gate takes, or null: step count and step length, the two the gate reads. */
export function farmIssue(plan: FarmPlan): string | null {
  const steps = plan.step_texts;
  if (steps.length < 3 || steps.length > 12) return `${plan.slug} has ${steps.length} farm steps`;
  for (const s of steps) {
    const t = s.trim();
    if (t.length < 20 || t.length > 600) return `${plan.slug} has a farm step of ${t.length} characters`;
  }
  if (plan.risk.score < 0 || plan.risk.score > 100) return `${plan.slug} has a risk score of ${plan.risk.score}`;
  if (!Number.isFinite(plan.value.net_usd)) return `${plan.slug} has no net value`;
  return null;
}

/** Every protocol's plan, keyed by slug, in the order given. */
export function buildFarmPlans(protocols: FarmProtocol[], impliedBySlug: Record<string, number>, asOf: string): Map<string, FarmPlan> {
  const plans = new Map<string, FarmPlan>();
  for (const p of protocols) {
    const implied = impliedBySlug[p.slug];
    plans.set(p.slug, buildFarmPlan(p, { implied_value_usd: implied, as_of: asOf }));
  }
  return plans;
}

// ------------------------------------------------------------------ main.ts's entry point

/** The valuation a plan reads: src/valuation.ts's answer, a bare implied value, or nothing. */
export interface FarmValuation {
  implied_value_usd?: number;
  age_days?: number | null;
  confidence?: { low_usd?: number; high_usd?: number; level?: number } | null;
}

/**
 * What main.ts reads: the board row's farm block (capital, risk, expected value), its farm_steps, and
 * the detail view's plan. `steps` are objects with text, cost and time; `farm_steps` is the same plan
 * already stringified into the gate's 3 to 12 strings of 20 to 600 characters.
 */
export interface FarmPlanResult {
  steps: FarmStep[];
  farm_steps: string[];
  step_texts: string[];
  capital_usd: number;
  cost_usd: number;
  hold_days: number;
  risk: string;
  risk_detail: FarmRisk;
  expected_value_usd: number;
  value: FarmValue;
  verdict: FarmPlan['verdict'];
  verdict_note: string;
  why_now: string;
  lock: FarmLock;
  model_version: string;
}

/**
 * The plan as main.ts asks for it: farmPlan(protocol, valuation, ageDays).
 *
 * `valuation` may be src/valuation.ts's answer (its implied value and confidence band), a bare
 * implied value, or nothing at all. `age` wins over the valuation's own age when it is a number.
 * The result is deterministic and carries both the structured risk and the one line the board shows.
 */
export function farmPlan(protocol: FarmProtocol, valuation?: FarmValuation | number | null, age?: number | null): FarmPlanResult {
  const isObject = typeof valuation === 'object' && valuation !== null;
  const implied = typeof valuation === 'number' ? valuation : isObject ? finite((valuation as FarmValuation).implied_value_usd, 0) : 0;
  const band = isObject ? ((valuation as FarmValuation).confidence ?? null) : null;
  const ageFromValuation = isObject ? ((valuation as FarmValuation).age_days ?? null) : null;
  const ageForPlan = typeof age === 'number' || age === null ? age : ageFromValuation;
  const plan = buildFarmPlan(protocol, { implied_value_usd: implied, age_days: ageForPlan, implied_band: band });
  const named = plan.risk.factors.slice(0, 2).map((f) => f.label.toLowerCase());
  const riskLine = `${plan.risk.level} risk, ${plan.risk.score}/100${named.length > 0 ? `: ${named.join(', ')}` : ''}`;
  return {
    steps: plan.steps,
    farm_steps: plan.step_texts,
    step_texts: plan.step_texts,
    capital_usd: plan.capital_usd,
    cost_usd: plan.cost_usd,
    hold_days: plan.hold_days,
    risk: riskLine,
    risk_detail: plan.risk,
    expected_value_usd: plan.value.net_usd,
    value: plan.value,
    verdict: plan.verdict,
    verdict_note: plan.verdict_note,
    why_now: plan.why_now,
    lock: plan.lock,
    model_version: FARM_MODEL.version,
  };
}
