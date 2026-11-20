// scripts/gate-check.mjs: the seven gate rows of RULES.txt, run against a built output directory.
//
// The sealed scorer is not published in the entrant kit, so `grade-local` cannot grade a program/v1
// entry here (it says so and points at the house competition directory). This script is the same seven
// checks the rules publish, read off the rules themselves, so the entry can be verified before it is
// submitted: dashboard_files, board_file, sorted_by_value, coverage, farm_steps, screenshots and
// dossier_matches. It is a local reproduction, not the house scorer: the house's copy stays sealed.
//
// Run it from the repository root after `node main.ts --input <snapshot> --output out`:
//   node scripts/gate-check.mjs --out out --input <kit>/input/snapshot.json

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildDossier } from '../vendor/makefun-board.ts';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && at + 1 < args.length ? args[at + 1] : fallback;
};

const outDir = argOf('out', 'out');
const inputFile = argOf('input', '/input/snapshot.json');
const rows = [];
const fail = (row, detail) => rows.push({ row, ok: false, detail });
const pass = (row, detail) => rows.push({ row, ok: true, detail });

const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MiB`;
const kb = (n) => `${(n / 1024).toFixed(0)} KiB`;

/** Every regular file under `dir`, as paths relative to it. */
function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

const PLAIN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

// ---------------------------------------------------------------- 1. dashboard_files
{
  const dir = join(outDir, 'dashboard');
  const problems = [];
  if (!existsSync(dir)) problems.push('dashboard/ is missing');
  else {
    const files = walk(dir);
    const bytes = files.reduce((s, f) => s + statSync(f).size, 0);
    const rels = files.map((f) => relative(dir, f));
    if (!rels.includes('index.html')) problems.push('no index.html');
    if (!rels.some((r) => r.endsWith('.css'))) problems.push('no .css file');
    if (!rels.some((r) => r.endsWith('.js'))) problems.push('no .js file');
    if (files.length > 400) problems.push(`${files.length} files, over 400`);
    if (bytes > 4 * 1024 * 1024) problems.push(`${mb(bytes)}, over 4 MiB`);
    for (const rel of rels) {
      for (const segment of rel.split('/')) if (!PLAIN.test(segment)) problems.push(`not a plain name: ${rel}`);
    }
    for (const file of files) {
      const rel = relative(dir, file);
      const text = readFileSync(file, 'utf8');
      const isHtml = rel.endsWith('.html');
      const isCss = rel.endsWith('.css');
      const isJs = rel.endsWith('.mjs') || rel.endsWith('.js');
      if (isHtml) {
        for (const m of text.matchAll(/\s(?:href|src|action|data|poster|srcset)\s*=\s*"([^"]*)"/gi)) {
          if (/https?:\/\//i.test(m[1])) problems.push(`${rel} attribute: ${m[1].slice(0, 60)}`);
        }
        for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
          if (/https?:\/\//i.test(m[1])) problems.push(`${rel} <style> body`);
        }
      }
      if (isCss && /https?:\/\//i.test(text)) problems.push(`${rel} names a network address`);
      if (isJs) {
        for (const m of text.matchAll(/(?:import\s[^'"]*from\s*|import\s*|export\s[^'"]*from\s*|require\s*\(\s*|import\s*\(\s*)['"]([^'"]+)['"]/g)) {
          if (/https?:\/\//i.test(m[1])) problems.push(`${rel} import specifier: ${m[1]}`);
        }
      }
    }
    if (problems.length === 0) pass('dashboard_files', `${files.length} files, ${mb(bytes)}, names plain, no network address`);
  }
  for (const p of problems) fail('dashboard_files', p);
}

// ---------------------------------------------------------------- 2. board_file
const snapshot = JSON.parse(readFileSync(inputFile, 'utf8'));
const known = new Set(snapshot.protocols.map((p) => p.slug));
let board = null;
{
  const file = join(outDir, 'board.json');
  if (!existsSync(file)) fail('board_file', 'board.json is missing');
  else {
    const bytes = statSync(file).size;
    if (bytes > 8 * 1024 * 1024) fail('board_file', `${mb(bytes)}, over 8 MiB`);
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      board = Array.isArray(raw) ? raw : raw.rows;
      if (!Array.isArray(board)) fail('board_file', 'no rows array');
      else {
        const problems = [];
        if (board.length < 100) problems.push(`${board.length} rows, under 100`);
        if (board.length > 4000) problems.push(`${board.length} rows, over 4000`);
        const seen = new Set();
        for (const row of board) {
          if (!known.has(row.slug)) problems.push(`unknown slug ${row.slug}`);
          if (typeof row.name !== 'string' || row.name.trim() === '') problems.push(`${row.slug} has no name`);
          if (!Number.isInteger(row.rank) || row.rank <= 0) problems.push(`${row.slug} rank ${row.rank}`);
          if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) problems.push(`${row.slug} implied ${row.implied_value_usd}`);
          if (row.implied_value_usd > 100_000_000_000_000) problems.push(`${row.slug} implied over 1e14`);
          if (!Array.isArray(row.farm_steps)) problems.push(`${row.slug} has no farm_steps array`);
          if (seen.has(row.slug)) problems.push(`${row.slug} appears twice`);
          seen.add(row.slug);
        }
        if (board.length >= 2 && new Set(board.map((r) => r.implied_value_usd)).size === 1) problems.push('every row shares one implied value');
        if (problems.length === 0) pass('board_file', `${board.length} rows, ${mb(bytes)}, every row a known protocol with a rank, a name, a value and farm steps`);
        for (const p of problems.slice(0, 8)) fail('board_file', p);
      }
    } catch (err) {
      fail('board_file', `not JSON: ${err.message}`);
    }
  }
}

// ---------------------------------------------------------------- 3. sorted_by_value
if (Array.isArray(board)) {
  const problems = [];
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) { problems.push(`ranks are not 1..${board.length}`); break; }
  for (let i = 1; i < board.length; i++) {
    if (board[i].implied_value_usd > board[i - 1].implied_value_usd) { problems.push(`row ${i + 1} outranks row ${i} on value`); break; }
  }
  if (problems.length === 0) pass('sorted_by_value', `ranks 1..${board.length} once each, value never rises`);
  for (const p of problems) fail('sorted_by_value', p);
} else fail('sorted_by_value', 'no board to read');

// ---------------------------------------------------------------- 4. coverage
if (Array.isArray(board)) {
  const onBoard = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !onBoard.has(s));
  if (missing.length === 0) pass('coverage', `all ${snapshot.watchlist.length} watchlist slugs on the board`);
  else fail('coverage', `${missing.length} watchlist slugs missing: ${missing.slice(0, 5).join(', ')}`);
} else fail('coverage', 'no board to read');

// ---------------------------------------------------------------- 5. farm_steps
if (Array.isArray(board)) {
  const problems = [];
  for (const row of board) {
    const steps = row.farm_steps;
    if (!Array.isArray(steps) || steps.length < 3 || steps.length > 12) { problems.push(`${row.slug} has ${Array.isArray(steps) ? steps.length : 'no'} steps`); continue; }
    for (const step of steps) {
      if (typeof step !== 'string') { problems.push(`${row.slug} has a non-string step`); break; }
      const n = step.trim().length;
      if (n < 20 || n > 600) { problems.push(`${row.slug} has a ${n}-character step`); break; }
    }
    if (problems.length >= 5) break;
  }
  if (problems.length === 0) pass('farm_steps', `every row has 3 to 12 steps of 20 to 600 characters`);
  for (const p of problems) fail('farm_steps', p);
} else fail('farm_steps', 'no board to read');

// ---------------------------------------------------------------- 6. screenshots
{
  const dir = join(outDir, 'screenshots');
  const problems = [];
  const notes = [];
  if (!existsSync(dir)) problems.push('screenshots/ is missing');
  else {
    const files = readdirSync(dir).filter((n) => !n.startsWith('.')).map((n) => join(dir, n)).filter((f) => statSync(f).isFile());
    if (files.length < 3) problems.push(`${files.length} images, needs 3 or 4`);
    if (files.length > 4) problems.push(`${files.length} images, needs 3 or 4`);
    for (const file of files) {
      const name = file.split('/').pop();
      const bytes = statSync(file).size;
      if (!PLAIN.test(name)) problems.push(`${name}: name`);
      if (bytes > 512 * 1024) problems.push(`${name}: ${kb(bytes)}, over 512 KiB`);
      const buf = readFileSync(file);
      let w = 0, h = 0, whole = false;
      if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG' && buf.toString('ascii', 12, 16) === 'IHDR') {
        w = buf.readUInt32BE(16); h = buf.readUInt32BE(20);
        whole = buf.includes(Buffer.from('IEND'));
      } else if (buf[0] === 0xff && buf[1] === 0xd8) {
        whole = buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9;
        for (let i = 2; i < buf.length - 9;) {
          if (buf[i] !== 0xff) { i++; continue; }
          const marker = buf[i + 1];
          const len = buf.readUInt16BE(i + 2);
          if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            h = buf.readUInt16BE(i + 5); w = buf.readUInt16BE(i + 7); break;
          }
          i += 2 + len;
        }
      } else problems.push(`${name}: not a PNG or JPEG`);
      const long = Math.max(w, h), short = Math.min(w, h);
      if (w && h) {
        if (long > 1440) problems.push(`${name}: long side ${long}, over 1440`);
        if (short < 800) problems.push(`${name}: short side ${short}, under 800`);
      }
      if (!whole) problems.push(`${name}: not a whole image`);
      if (bytes < 300 * 1024) notes.push(`${name} is ${kb(bytes)}, under the 300 KiB the rules suggest so three fit the dossier (the cap is 512 KiB)`);
    }
    if (problems.length === 0) pass('screenshots', `${files.length} images, each a whole PNG/JPEG within 512 KiB at 1440 or less by 800 or more${notes.length ? '; ' + notes.join('; ') : ''}`);
  }
  for (const p of problems) fail('screenshots', p);
}

// ---------------------------------------------------------------- 7. dossier_matches
{
  const file = join(outDir, 'dossier.json');
  if (!existsSync(file)) fail('dossier_matches', 'dossier.json is missing');
  else {
    const bytes = statSync(file).size;
    if (bytes > 1.5 * 1024 * 1024) fail('dossier_matches', `${mb(bytes)}, over 1.5 MiB`);
    let rebuilt;
    try {
      rebuilt = buildDossier(outDir, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } });
    } catch (err) {
      fail('dossier_matches', `buildDossier refused the output: ${err.message}`);
    }
    if (rebuilt) {
      const same = Buffer.compare(Buffer.from(rebuilt), readFileSync(file)) === 0;
      if (same) pass('dossier_matches', `${kb(bytes)}, byte for byte what buildDossier writes`);
      else fail('dossier_matches', 'the dossier on disk is not what buildDossier writes from this output');
    }
  }
}

// ---------------------------------------------------------------- report
const width = Math.max(...rows.map((r) => r.row.length));
let failures = 0;
for (const r of rows) {
  if (!r.ok) failures += 1;
  process.stdout.write(`${r.ok ? 'PASS' : 'FAIL'}  ${r.row.padEnd(width)}  ${r.detail}\n`);
}
const rowsSeen = new Set(rows.map((r) => r.row));
for (const required of ['dashboard_files', 'board_file', 'sorted_by_value', 'coverage', 'farm_steps', 'screenshots', 'dossier_matches']) {
  if (!rowsSeen.has(required)) { failures += 1; process.stdout.write(`FAIL  ${required.padEnd(width)}  no result\n`); }
}
process.stdout.write(`\n${failures === 0 ? 'all seven gate rows pass' : `${failures} gate problem${failures === 1 ? '' : 's'}`}\n`);
process.exit(failures === 0 ? 0 : 1);
