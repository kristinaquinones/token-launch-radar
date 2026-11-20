# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/kristinaquinones/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/kristinaquinones/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar over one sealed DefiLlama snapshot: it finds the protocols whose record carries no token, puts a number on what a launch could be worth if the record stayed as it is, and says what a reader would do to farm each one before or after it issues.

Everything here is computed from `input/snapshot.json`. There is no hardcoded list of names, no network call, and no dependency past the Node standard library.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

(`--output out` works too; the snapshot is the kit's `input/snapshot.json`, not committed here.)

At grade time the program reads `/input/snapshot.json` and writes `/output`; `--input` and `--output` (or `MAKEFUN_OUTPUT_DIR`) exist so it can be run by hand. Node 22.18 or later runs the TypeScript as it is.

It writes `out/board.json` (the ranked board), `out/dossier.json` (the dashboard dossier the judge reads), `out/data.js` (the board as a plain script, so the page also opens from `file://`), and copies `dashboard/` and `screenshots/` into `out/`. Two runs write the same bytes.

## The model

1. **Eligibility** (`src/eligibility.ts`). A protocol counts as pre-token when its DefiLlama record carries no token. Wrapped, staked, restaked and bridged products are excluded as derivatives of a token that already trades, by category, by parent record and by name, and every exclusion keeps its reason so the page can show why a row is out.
2. **Valuation** (`src/valuation.ts`). Each category's multiple is read off the protocols in that same category that already trade, as market cap over TVL, winsorized at the 10th and 90th percentile. Implied value is TVL times that multiple, lifted or cut by seven-day TVL growth and damped by how long the protocol has run with no token, with a confidence band from the spread of its peers.
3. **Farm plan** (`src/farm.ts`). Each protocol gets concrete steps, the capital they tie up, the exposure they create, and a reason to act now, all derived from snapshot fields.

The implied value is this entry's own claim about a hypothetical launch. It is not a prediction that a token gets issued, and it is not advice.

## What is in here

| Path | What it is |
| --- | --- |
| `main.ts` | Reads the snapshot, runs the three modules, writes the board, the data file and the dossier |
| `src/eligibility.ts` | Tokenless classification, derivative exclusions and their reasons |
| `src/valuation.ts` | Peer multiples, growth and age damping, implied value and confidence band |
| `src/farm.ts` | Per-protocol farm plans: steps, capital, risk, expected value |
| `dashboard/` | Static board, per-protocol detail view, filters, methodology page. No network |
| `screenshots/` | Board, detail view and filtered view |
| `vendor/makefun-board.ts` | make.fun's dossier library, copied byte for byte from the kit |

## The dashboard

`dashboard/` is plain HTML, CSS and JavaScript. It reads `data.js` from its parent directory, keeps filters and the open protocol in the URL, and never reaches the network. Open `out/index.html` from the output directory, or serve `out/` statically.

## License

MIT, see [LICENSE](LICENSE).

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
