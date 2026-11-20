// Token Radar's dashboard. It reads the data file main.ts writes beside dashboard/ (window.RADAR, or
// window.RADAR_DATA) and renders three views from it: the ranked board, a page for every protocol, and
// the method. Every figure on the page is in that file: the page makes no request of any kind, so it
// opens from a folder as readily as from a server, and the filter state lives in the URL hash.
(function () {
  'use strict';

  var APP = document.getElementById('app');
  var STAMP = document.getElementById('stamp');
  var started = false;
  var loaderTried = false;

  // ---------------------------------------------------------------- data

  // main.ts may write its data beside the page (dashboard/data.js) instead of beside the output
  // directory (data.js); try the second place once before giving up.
  function boot() {
    if (window.RADAR || window.RADAR_DATA) { start(); return; }
    if (loaderTried) { start(); return; }
    loaderTried = true;
    var s = document.createElement('script');
    s.src = 'data.js';
    s.onload = boot;
    s.onerror = boot;
    document.body.appendChild(s);
  }

  var RAW = null;
  var MODEL = null;
  var DATA = null;

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function firstNum() {
    for (var i = 0; i < arguments.length; i++) { var n = num(arguments[i]); if (n !== null) return n; }
    return null;
  }

  function normaliseModel(m) {
    m = m || {};
    return {
      base_multiple: num(m.base_multiple) === null ? 0.25 : m.base_multiple,
      growth_weight: num(m.growth_weight) === null ? 0.5 : m.growth_weight,
      growth_floor: num(m.growth_floor) === null ? -60 : m.growth_floor,
      growth_cap: num(m.growth_cap) === null ? 120 : m.growth_cap,
      maturity_floor: num(m.maturity_floor) === null ? 0.6 : m.maturity_floor,
      maturity_range: num(m.maturity_range) === null ? 0.4 : m.maturity_range,
      maturity_days: num(m.maturity_days) === null ? 1095 : m.maturity_days,
      unknown_age_days: num(m.unknown_age_days) === null ? 365 : m.unknown_age_days
    };
  }

  // A farm step is one string in board.json ("<what to do> Cost: <cost>. Time: <time>.") or an object
  // with the three parts; the page shows whichever the data carries, so the plan the reader sees is the
  // plan the board froze, never a second copy of the rules that could drift from it.
  function parseStep(s) {
    if (s && typeof s === 'object') {
      return { text: s.text || s.action || '', cost: s.cost || '', time: s.time || '' };
    }
    var text = String(s || '');
    var cost = '';
    var time = '';
    var ci = text.indexOf(' Cost: ');
    if (ci >= 0) {
      var tail = text.slice(ci + 7);
      text = text.slice(0, ci);
      var ti = tail.indexOf('. Time: ');
      if (ti >= 0) { cost = tail.slice(0, ti); time = tail.slice(ti + 8).replace(/\.$/, ''); }
      else { cost = tail.replace(/\.$/, ''); }
    }
    return { text: text, cost: cost, time: time };
  }

  function normaliseRow(r, i) {
    var tvl = firstNum(r.tvl_usd, r.tvl, r.tvlUsd);
    var implied = firstNum(r.implied_value_usd, r.implied_value, r.implied, r.value_usd) || 0;
    var growth = firstNum(r.change_7d, r.growth_7d, r.growth_pct, r.change7d, r.growth);
    var age = firstNum(r.age_days, r.ageDays);
    var rawSteps = r.farm_steps || r.farmSteps ||
      (r.farm_plan && (Array.isArray(r.farm_plan) ? r.farm_plan : r.farm_plan.steps)) || [];
    var steps = (Array.isArray(rawSteps) ? rawSteps : []).map(parseStep).filter(function (s) { return s.text; });
    // How many of the four inputs the model uses are actually recorded for this row. A reader can weigh
    // a row scored on four real inputs differently from one leaning on an unknown age.
    var known = (tvl !== null ? 1 : 0) + (growth !== null ? 1 : 0) + (age !== null ? 1 : 0) +
      (r.chains && r.chains.length ? 1 : 0);
    return {
      rank: firstNum(r.rank, i + 1),
      slug: String(r.slug || ''),
      name: String(r.name || r.slug || ''),
      category: r.category || null,
      chains: Array.isArray(r.chains) ? r.chains.filter(function (c) { return typeof c === 'string'; }) : [],
      tvl: tvl,
      growth: growth,
      age: age,
      implied: implied,
      listed_at: r.listed_at || null,
      known: known,
      steps: steps,
      confidence: r.confidence && r.confidence.label ? String(r.confidence.label) : null,
      risk: Array.isArray(r.risks) ? r.risks : (Array.isArray(r.risk) ? r.risk : null)
    };
  }

  function normalise(raw) {
    var rows = (raw.rows || raw.board || []).map(normaliseRow);
    var live = (raw.live || []).map(function (r) {
      return {
        slug: String(r.slug || ''), name: String(r.name || r.slug || ''),
        category: r.category || null,
        chains: Array.isArray(r.chains) ? r.chains : [],
        tvl: firstNum(r.tvl_usd, r.tvl), mcap: firstNum(r.mcap_usd, r.mcap),
        growth: firstNum(r.change_7d, r.growth_7d)
      };
    });
    var excluded = (raw.excluded || []).map(function (r) {
      return {
        slug: String(r.slug || ''), name: String(r.name || r.slug || ''),
        category: r.category || null, tvl: firstNum(r.tvl_usd, r.tvl),
        reason: String(r.reason || r.exclusion_reason || 'no reason recorded')
      };
    });
    var med = median(rows.map(function (r) { return r.implied; }));
    var top10 = rows.slice(0, 10).reduce(function (s, r) { return s + r.implied; }, 0);
    return {
      as_of: String(raw.as_of || 'unknown'),
      model_version: String(raw.model_version || 'unstated'),
      floor_usd: firstNum(raw.floor_usd, 0),
      watchlist_size: firstNum(raw.watchlist_size, rows.length) || 0,
      board_size: firstNum(raw.board_size, rows.length) || rows.length,
      early_size: firstNum(raw.early_size, 0) || 0,
      live_size: firstNum(raw.live_size, live.length) || live.length,
      tracked: firstNum(raw.protocol_count, raw.tracked, 0) || 0,
      rows: rows, live: live, excluded: excluded,
      median: med, top10: top10
    };
  }

  function median(list) {
    var a = list.filter(function (n) { return typeof n === 'number' && isFinite(n); }).sort(function (x, y) { return x - y; });
    if (!a.length) return 0;
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
  }

  // ---------------------------------------------------------------- format

  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function compact(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(abs >= 1e10 ? 1 : 2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(abs >= 1e7 ? 1 : 2) + 'M';
    if (abs >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function ageText(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 730) return (days / 365).toFixed(1) + 'y';
    if (days >= 60) return Math.round(days / 30) + 'mo';
    return Math.round(days) + 'd';
  }
  function multiple(row) {
    if (!row.tvl) return null;
    return row.implied / row.tvl;
  }

  // ---------------------------------------------------------------- dom

  function h(tag, props) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'href') node.setAttribute('href', v);
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else if (k === 'style') node.setAttribute('style', v);
        else node.setAttribute(k, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined || child === false) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  // ---------------------------------------------------------------- routes

  // One route per view, with the board's filters in the query: #/?cat=Lending&tvl=gt1b and
  // #/p/<slug> for a protocol. The state is the URL, so a filtered board or a protocol page can be
  // linked, reloaded or captured exactly as it was.
  function parseRoute() {
    var raw = String(location.hash || '').replace(/^#\/?/, '');
    var qi = raw.indexOf('?');
    var path = qi >= 0 ? raw.slice(0, qi) : raw;
    var qs = qi >= 0 ? raw.slice(qi + 1) : '';
    var parts = path.split('/').filter(Boolean);
    var view = parts[0] || 'board';
    if (['board', 'method', 'out'].indexOf(view) < 0 && view !== 'p') view = 'board';
    return {
      view: view,
      slug: parts[1] ? decodeURIComponent(parts[1]) : null,
      params: new URLSearchParams(qs)
    };
  }

  function routeHash(view, slug, params) {
    var path = view === 'board' ? '/' : '/' + view + (slug ? '/' + encodeURIComponent(slug) : '');
    var qs = params ? params.toString() : '';
    return '#' + path + (qs ? '?' + qs : '');
  }

  // A filter change redraws only the result line and the table, so the control the reader is using
  // keeps its focus and its caret; a change of view redraws the page.
  var currentView = null;
  var boardRefs = null;

  function go(view, slug, params) {
    var hash = routeHash(view, slug, params);
    if (hash !== location.hash) {
      try { history.replaceState(null, '', hash); }
      catch (e) { location.hash = hash; }
    }
    if (view === 'board' && currentView === 'board' && boardRefs) { refreshBoard(); return; }
    render();
  }

  // ---------------------------------------------------------------- filters

  var SORTS = {
    implied: function (r) { return r.implied; },
    tvl: function (r) { return r.tvl === null ? -Infinity : r.tvl; },
    growth: function (r) { return r.growth === null ? -Infinity : r.growth; },
    age: function (r) { return r.age === null ? -Infinity : r.age; },
    name: function (r) { return r.name.toLowerCase(); }
  };

  function readFilters(params) {
    return {
      q: (params.get('q') || '').trim(),
      cat: params.get('cat') || 'all',
      chain: params.get('chain') || 'all',
      tvl: params.get('tvl') || 'all',
      implied: params.get('implied') || 'all',
      inputs: params.get('inputs') || 'all',
      sort: SORTS[params.get('sort')] ? params.get('sort') : 'implied',
      dir: params.get('dir') === 'asc' ? 1 : -1
    };
  }

  function writeFilters(f) {
    var p = new URLSearchParams();
    if (f.q) p.set('q', f.q);
    if (f.cat !== 'all') p.set('cat', f.cat);
    if (f.chain !== 'all') p.set('chain', f.chain);
    if (f.tvl !== 'all') p.set('tvl', f.tvl);
    if (f.implied !== 'all') p.set('implied', f.implied);
    if (f.inputs !== 'all') p.set('inputs', f.inputs);
    if (f.sort !== 'implied') p.set('sort', f.sort);
    if (f.dir !== -1) p.set('dir', 'asc');
    return p;
  }

  var TVL_BANDS = {
    all: function () { return true; },
    lt100: function (r) { return r.tvl !== null && r.tvl < 1e8; },
    mid: function (r) { return r.tvl !== null && r.tvl >= 1e8 && r.tvl < 1e9; },
    gt1b: function (r) { return r.tvl !== null && r.tvl >= 1e9; }
  };
  var IMPLIED_BANDS = {
    all: function () { return true; },
    lt10: function (r) { return r.implied < 1e7; },
    mid: function (r) { return r.implied >= 1e7 && r.implied < 1e8; },
    gt100: function (r) { return r.implied >= 1e8; }
  };

  function filtered(f) {
    var q = f.q.toLowerCase();
    var tvlOk = TVL_BANDS[f.tvl] || TVL_BANDS.all;
    var impOk = IMPLIED_BANDS[f.implied] || IMPLIED_BANDS.all;
    return DATA.rows.filter(function (r) {
      if (!tvlOk(r) || !impOk(r)) return false;
      if (f.cat !== 'all' && (r.category || 'Uncategorised') !== f.cat) return false;
      if (f.chain !== 'all' && r.chains.indexOf(f.chain) < 0) return false;
      if (f.inputs === 'full' && r.known < 4) return false;
      if (f.inputs === 'partial' && r.known >= 4) return false;
      if (!q) return true;
      return (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase().indexOf(q) >= 0;
    });
  }

  function sorted(list, f) {
    var key = SORTS[f.sort];
    return list.slice().sort(function (a, b) {
      var av = key(a), bv = key(b);
      if (av < bv) return -f.dir;
      if (av > bv) return f.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // ---------------------------------------------------------------- board view

  function stamp() {
    STAMP.textContent = 'snapshot ' + DATA.as_of + ' · ' + DATA.model_version + ' · ' + DATA.board_size + ' rows';
  }

  function kpis() {
    return h('section', { class: 'kpis', 'aria-label': 'Snapshot at a glance' },
      h('div', { class: 'kpi' },
        h('span', { text: 'Watchlist covered' }),
        h('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }),
        h('em', { text: 'every slug the sealed snapshot names' })
      ),
      h('div', { class: 'kpi' },
        h('span', { text: 'Rows ranked' }),
        h('b', { text: String(DATA.board_size) }),
        h('em', { text: DATA.early_size + ' found below the floor' })
      ),
      h('div', { class: 'kpi' },
        h('span', { text: 'Top ten, implied' }),
        h('b', { text: compact(DATA.top10) }),
        h('em', { text: 'what the ten biggest launches could be worth' })
      ),
      h('div', { class: 'kpi' },
        h('span', { text: 'Median row' }),
        h('b', { text: compact(DATA.median) }),
        h('em', { text: 'the middle of the board, not a typical bet' })
      )
    );
  }

  function selectField(label, name, options, value) {
    var sel = h('select', { id: 'f-' + name, 'aria-label': label },
      options.map(function (o) {
        return h('option', { value: o[0], text: o[1], selected: o[0] === value ? 'selected' : null });
      })
    );
    sel.addEventListener('change', function () { setFilter(name, sel.value); });
    return h('div', { class: 'field' }, h('label', { for: 'f-' + name, text: label }), sel);
  }

  function setFilter(name, value) {
    var route = parseRoute();
    var f = readFilters(route.params);
    f[name] = value;
    go('board', null, writeFilters(f));
  }

  function filtersBar(f) {
    var cats = ['all'].concat(unique(DATA.rows.map(function (r) { return r.category || 'Uncategorised'; })).sort());
    var chains = ['all'].concat(unique(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains); }, [])).sort());
    var search = h('input', {
      type: 'search', id: 'f-q', value: f.q, placeholder: 'Name, category or chain',
      'aria-label': 'Search the board', autocomplete: 'off'
    });
    var t = null;
    search.addEventListener('input', function () {
      clearTimeout(t);
      var value = search.value;
      t = setTimeout(function () {
        var route = parseRoute();
        var next = readFilters(route.params);
        next.q = value.trim();
        go('board', null, writeFilters(next));
      }, 180);
    });
    search.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { search.value = ''; setFilter('q', ''); }
    });

    return h('section', { class: 'filters', 'aria-label': 'Filter the board' },
      h('div', { class: 'field' }, h('label', { for: 'f-q', text: 'Search' }), search),
      selectField('Category', 'cat', cats.map(function (c) { return [c, c === 'all' ? 'All categories' : c]; }), f.cat),
      selectField('Chain', 'chain', chains.map(function (c) { return [c, c === 'all' ? 'All chains' : c]; }), f.chain),
      selectField('TVL', 'tvl', [['all', 'Any size'], ['lt100', 'Under $100M'], ['mid', '$100M to $1B'], ['gt1b', '$1B and up']], f.tvl),
      selectField('Implied value', 'implied', [['all', 'Any value'], ['lt10', 'Under $10M'], ['mid', '$10M to $100M'], ['gt100', '$100M and up']], f.implied),
      selectField('Inputs known', 'inputs', [['all', 'Any coverage'], ['full', 'All four inputs'], ['partial', 'One or more unknown']], f.inputs),
      h('span', { class: 'spacer' }),
      h('a', { class: 'button ghost', href: '#/', text: 'Reset' })
    );
  }

  function unique(list) {
    var seen = {};
    return list.filter(function (v) { if (!v || seen[v]) return false; seen[v] = 1; return true; });
  }

  function resultLine(f, count) {
    var bits = [];
    if (f.q) bits.push('search "' + f.q + '"');
    if (f.cat !== 'all') bits.push(f.cat);
    if (f.chain !== 'all') bits.push('on ' + f.chain);
    if (f.tvl !== 'all') bits.push({ lt100: 'under $100M TVL', mid: '$100M to $1B TVL', gt1b: '$1B and up TVL' }[f.tvl]);
    if (f.implied !== 'all') bits.push({ lt10: 'under $10M implied', mid: '$10M to $100M implied', gt100: '$100M and up implied' }[f.implied]);
    if (f.inputs !== 'all') bits.push(f.inputs === 'full' ? 'all inputs known' : 'an input unknown');
    return h('div', { class: 'result-line' },
      h('span', null, h('b', { text: count + ' of ' + DATA.board_size }), ' rows'),
      bits.length ? h('span', { text: '· ' + bits.join(' · ') }) : h('span', { class: 'dim', text: '· no filter, the whole board' }),
      bits.length ? h('a', { class: 'button ghost clear', href: '#/', text: 'Clear filters' }) : null
    );
  }

  function sortHeader(f, key, label, align) {
    var active = f.sort === key;
    var dir = !active ? 'none' : (f.dir === 1 ? 'ascending' : 'descending');
    return h('th', { scope: 'col', class: align === 'r' ? 'r' : null, 'aria-sort': dir },
      h('button', {
        type: 'button',
        onclick: function () {
          var route = parseRoute();
          var next = readFilters(route.params);
          if (next.sort === key) next.dir = -next.dir;
          else { next.sort = key; next.dir = key === 'name' ? 1 : -1; }
          go('board', null, writeFilters(next));
        }
      }, label, active ? h('span', { class: 'caret', 'aria-hidden': 'true', text: f.dir === 1 ? '▲' : '▼' }) : null)
    );
  }

  function inputsChip(row) {
    if (row.confidence) return h('span', { class: 'chip solid', text: row.confidence });
    var cls = row.known >= 4 ? 'full' : row.known === 3 ? 'part' : 'thin';
    return h('span', { class: 'chip ' + cls, title: 'Of TVL, 7-day growth, age and chain, how many the snapshot records', text: row.known + '/4' });
  }

  function boardTable(f, list) {
    var max = list.length ? list[0].implied : 1;
    var body = h('tbody');
    list.forEach(function (r) {
      var tr = h('tr', { tabindex: '0', onclick: function (e) { if (e.target.tagName !== 'A') openProtocol(r.slug); } },
        h('td', { class: 'rank' }, h('b', { text: '#' + r.rank })),
        h('td', null, h('div', { class: 'who' },
          h('a', { href: '#/p/' + encodeURIComponent(r.slug), text: r.name }),
          h('span', { text: (r.category || 'Uncategorised') + (r.chains.length ? ' · ' + r.chains.slice(0, 2).join(', ') : '') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') })
        )),
        h('td', { class: 'r mono', text: compact(r.tvl) }),
        h('td', { class: 'r mono ' + (r.growth === null ? 'dim' : r.growth >= 0 ? 'pos' : 'neg'), text: pct(r.growth) }),
        h('td', { class: 'r mono', text: ageText(r.age) }),
        h('td', { class: 'r' }, h('div', { class: 'implied-cell' },
          h('b', { text: compact(r.implied) }),
          h('span', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.max(2, Math.round((r.implied / max) * 100)) + '%' })),
          multiple(r) === null ? null : h('span', { class: 'mult', text: multiple(r).toFixed(2) + '× TVL' })
        )),
        h('td', { class: 'r' }, inputsChip(r))
      );
      tr.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); openProtocol(r.slug); }
      });
      body.appendChild(tr);
    });

    return h('div', { class: 'table-wrap' },
      h('table', null,
        h('caption', { text: 'Every protocol that records no token, strongest implied launch value first. Select a row for its model, its inputs and its farm plan.' }),
        h('thead', null, h('tr', null,
          sortHeader(f, 'implied', 'Rank'),
          sortHeader(f, 'name', 'Protocol'),
          sortHeader(f, 'tvl', 'TVL', 'r'),
          sortHeader(f, 'growth', '7-day', 'r'),
          sortHeader(f, 'age', 'Age', 'r'),
          sortHeader(f, 'implied', 'Implied value', 'r'),
          h('th', { scope: 'col', class: 'r', text: 'Inputs' })
        )),
        body
      )
    );
  }

  function boardView(route) {
    var f = readFilters(route.params);
    var list = sorted(filtered(f), f);
    clear(APP);
    APP.appendChild(stamp());
    APP.appendChild(kpis());
    APP.appendChild(filtersBar(f));
    APP.appendChild(resultLine(f, list.length));
    if (!list.length) {
      APP.appendChild(h('div', { class: 'empty' },
        h('h2', { text: 'No protocol matches those filters' }),
        h('p', { class: 'muted', text: 'The board is 200 rows of the snapshot, so a narrow combination can empty it. Widen the size or value band, or clear the search.' }),
        h('a', { class: 'button', href: '#/', text: 'Clear every filter' })
      ));
      return;
    }
    APP.appendChild(boardTable(f, list));
    APP.appendChild(h('footer', { class: 'foot' },
      h('span', { text: 'DefiLlama protocol index, fetched once and frozen at ' + DATA.as_of + '. Implied value is a model of a launch, never a price.' }),
      h('span', { class: 'mono', text: DATA.model_version })
    ));
  }

  // ---------------------------------------------------------------- protocol view

  function findRow(slug) {
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) return DATA.rows[i];
    return null;
  }

  function openProtocol(slug) {
    go('p', slug, null);
  }

  function ladder(row) {
    var m = MODEL;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.growth === null ? 0 : row.growth));
    var base = (row.tvl || 0) * m.base_multiple;
    var growthMult = 1 + (growth / 100) * m.growth_weight;
    var ageUsed = row.age === null ? m.unknown_age_days : row.age;
    var maturity = m.maturity_floor + (Math.min(Math.max(ageUsed, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    return h('div', { class: 'ladder' },
      h('div', { class: 'rung' }, h('span', { text: 'TVL, as the snapshot records it' }), h('b', { text: usd(row.tvl) })),
      h('div', { class: 'rung op' }, h('span', { text: '× base multiple ' + m.base_multiple }), h('b', { text: usd(base) })),
      h('div', { class: 'rung op' }, h('span', { text: '× growth ' + growthMult.toFixed(3) + ' (7-day ' + pct(row.growth) + ', clamped to ' + m.growth_floor + ' to ' + m.growth_cap + ', at ' + m.growth_weight + ' weight)' }), h('b', { text: usd(base * growthMult) })),
      h('div', { class: 'rung op' }, h('span', { text: '× maturity ' + maturity.toFixed(3) + ' (' + ageText(row.age) + ' since first listing)' }), h('b', { text: usd(base * growthMult * maturity) })),
      h('div', { class: 'rung total' }, h('span', { text: '= implied launch value' }), h('b', { text: usd(row.implied) }))
    );
  }

  function rangeBlock(row) {
    var low = Math.round(row.implied * 0.8);
    var high = Math.round(row.implied * 1.2);
    return h('div', { class: 'range' },
      h('div', { class: 'range-track', 'aria-hidden': 'true' },
        h('div', { class: 'range-fill', style: 'left:10%;right:10%' }),
        h('div', { class: 'range-dot', style: 'left:50%' })
      ),
      h('div', { class: 'range-ends' }, h('span', { text: compact(low) }), h('span', { text: 'base case' }), h('span', { text: compact(high) }))
    );
  }

  function changeNotes(row) {
    var m = MODEL;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.growth === null ? 0 : row.growth));
    var clamped = row.growth !== null && (row.growth > m.growth_cap || row.growth < m.growth_floor);
    var ageUsed = row.age === null ? m.unknown_age_days : row.age;
    var maturity = m.maturity_floor + (Math.min(Math.max(ageUsed, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var headroom = m.maturity_floor + m.maturity_range;
    var notes = [
      'TVL carries the whole base of the estimate: a 30% fall in TVL moves the implied value to ' + usd(row.implied * 0.7) + ', before anything else changes.',
      clamped
        ? 'The 7-day figure of ' + pct(row.growth) + ' is outside the model\'s ' + m.growth_floor + '% to ' + m.growth_cap + '% clamp, so it is read as ' + pct(growth) + ': a further spike moves this row no faster than the cap allows.'
        : 'The 7-day figure of ' + pct(row.growth) + ' sits inside the ' + m.growth_floor + '% to ' + m.growth_cap + '% clamp, and enters at half weight, so it is worth ' + (growth / 100 * m.growth_weight).toFixed(3) + ' of multiplier either way.',
      row.age === null
        ? 'The snapshot records no first-listing date, so maturity is scored at the unknown-age default of ' + m.unknown_age_days + ' days (' + maturity.toFixed(3) + '×), which is a weaker input than a dated row.'
        : 'Maturity has a ceiling of ' + headroom.toFixed(1) + '×, so age can add at most ' + ((headroom - maturity) * 100 / maturity).toFixed(0) + '% more than this row already carries.',
      'A protocol with no token on record is a snapshot fact, not an announcement: nothing in this file says a launch is planned.'
    ];
    return h('ul', { class: 'notes' }, notes.map(function (n) { return h('li', { text: n }); }));
  }

  function farmPanel(row) {
    if (!row.steps.length) {
      return h('section', { class: 'card' }, h('h2', { text: 'Farm plan' }),
        h('p', { class: 'muted', text: 'No farm steps were written for this row. Open the board to see the rows that carry a plan.' }));
    }
    return h('section', { class: 'card' },
      h('h2', null, 'Farm plan', h('span', { text: row.steps.length + ' steps' })),
      h('ol', { class: 'steps' }, row.steps.map(function (s) {
        return h('li', null,
          h('p', { text: s.text }),
          (s.cost || s.time) ? h('div', { class: 'tags' },
            s.cost ? h('span', { class: 'tag', text: 'cost: ' + s.cost }) : null,
            s.time ? h('span', { class: 'tag', text: 'time: ' + s.time }) : null
          ) : null
        );
      }))
    );
  }

  function riskPanel(row) {
    var out = (row.risk || []).map(function (r) { return h('li', { text: String(r) }); });
    if (!out.length) {
      out = [
        h('li', { text: 'The plan is written from the snapshot only. It cannot see a paused market, a fee switch, a governance vote or a deposit cap, so check the protocol\'s own page before you commit.' }),
        h('li', { text: 'Points and airdrops are never announced in this data: no row here promises a reward, and any page that asks you to pay to claim one is not this one.' }),
        h('li', { text: 'The capital named in step two is at risk for the whole hold. A stablecoin depeg, an oracle fault or a bad collateral can lose it, and no yield shown here is a promise of return.' }),
        h('li', { text: 'A farm position with no token is a bet on the team\'s future decision. Keep it a size you would not mind holding through a launch that never comes.' })
      ];
    }
    return h('section', { class: 'card' }, h('h2', { text: 'What can go wrong' }), h('ul', { class: 'notes' }, out));
  }

  function protocolView(route) {
    var row = route.slug ? findRow(route.slug) : null;
    clear(APP);
    APP.appendChild(stamp());
    if (!row) {
      APP.appendChild(h('div', { class: 'empty' },
        h('h1', { text: 'No protocol named ' + (route.slug || '') }),
        h('p', { class: 'muted', text: 'The board carries 200 rows from this snapshot, and that slug is not one of them.' }),
        h('a', { class: 'button', href: '#/', text: 'Back to the board' })
      ));
      return;
    }
    var byRank = DATA.rows.slice().sort(function (a, b) { return a.rank - b.rank; });
    var at = byRank.indexOf(row);
    var prev = at > 0 ? byRank[at - 1] : null;
    var next = at >= 0 && at < byRank.length - 1 ? byRank[at + 1] : null;

    APP.appendChild(h('div', { class: 'pad' },
      h('a', { class: 'back', href: '#/', text: '← The board' }),
      h('div', { class: 'hero' },
        h('div', null,
          h('div', { class: 'eyebrow' }, h('span', { class: 'chip', text: '#' + row.rank + ' of ' + DATA.board_size }), h('span', { text: 'no token on record' })),
          h('h1', { text: row.name }),
          h('p', { class: 'where', text: (row.category || 'Uncategorised') + ' on ' + (row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
        ),
        h('div', { class: 'hero-value' },
          h('span', { text: 'Implied launch value' }),
          h('b', { text: compact(row.implied) }),
          h('em', { text: compact(row.implied * 0.8) + ' to ' + compact(row.implied * 1.2) + ' on a 20% multiple swing' })
        )
      ),
      h('div', { class: 'two-col' },
        h('div', null,
          h('section', { class: 'card' },
            h('h2', null, 'How the estimate is built', h('span', { text: 'every input from the snapshot' })),
            ladder(row),
            rangeBlock(row),
            h('p', { class: 'muted', style: 'margin-top:12px;font-size:12px', text: 'The band is a sensitivity test, not a forecast: it is the same row at a 20% lower and a 20% higher base multiple. Nothing else about the protocol changes in it.' })
          ),
          h('section', { class: 'card' },
            h('h2', { text: 'The inputs' }),
            h('dl', { class: 'inputs' },
              h('dt', { text: 'TVL' }), h('dd', { text: usd(row.tvl) }),
              h('dt', { text: '7-day TVL change' }), h('dd', { class: row.growth === null ? 'dim' : row.growth >= 0 ? 'pos' : 'neg', text: pct(row.growth) }),
              h('dt', { text: 'First listed' }), h('dd', { text: row.listed_at || 'not recorded' }),
              h('dt', { text: 'Age with no token' }), h('dd', { text: ageText(row.age) }),
              h('dt', { text: 'Chains counted' }), h('dd', { text: String(row.chains.length) }),
              h('dt', { text: 'Market cap' }), h('dd', { text: 'none recorded' }),
              h('dt', { text: 'Implied value ÷ TVL' }), h('dd', { text: multiple(row) === null ? 'n/a' : multiple(row).toFixed(3) + '×' })
            )
          ),
          h('section', { class: 'card' },
            h('h2', { text: 'What would change this call' }),
            changeNotes(row)
          )
        ),
        h('div', null,
          farmPanel(row),
          riskPanel(row),
          h('div', { class: 'pager' },
            prev ? h('a', { href: '#/p/' + encodeURIComponent(prev.slug), text: '← #' + prev.rank + ' ' + prev.name }) : h('span'),
            next ? h('a', { href: '#/p/' + encodeURIComponent(next.slug), text: '#' + next.rank + ' ' + next.name + ' →' }) : h('span')
          )
        )
      )
    ));
  }

  // ---------------------------------------------------------------- method view

  function methodView() {
    var m = MODEL;
    clear(APP);
    APP.appendChild(stamp());
    APP.appendChild(h('div', { class: 'pad prose' },
      h('a', { class: 'back', href: '#/', text: '← The board' }),
      h('h1', { text: 'The method, in full' }),
      h('p', { text: 'One function scores every row, and no protocol name is special-cased. A reader can recompute any row on this page from the figures on it and get the number the board carries.' }),
      h('h2', { text: 'The formula' }),
      h('div', { class: 'formula', text: 'base    = tvl_usd × ' + m.base_multiple + '\ngrowth  = clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ')\nimplied = base × (1 + growth/100 × ' + m.growth_weight + ') × (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ')/' + m.maturity_days + ' × ' + m.maturity_range + ')' }),
      h('p', { text: 'TVL sets the size. Seven-day growth says whether capital is arriving now, at half weight so a single week cannot dominate. Maturity says how long the protocol has run with no token, which is the best record in this data of a team that has shipped and stayed; it starts at ' + m.maturity_floor + ' and reaches ' + (m.maturity_floor + m.maturity_range).toFixed(1) + ' after ' + (m.maturity_days / 365).toFixed(0) + ' years. No row scores below 1.' }),
      h('h2', { text: 'The constants' }),
      h('table', { class: 'constants' },
        h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Constant' }), h('th', { scope: 'col', text: 'Value' }))),
        h('tbody', null,
          Object.keys(m).map(function (k) {
            return h('tr', null, h('td', { text: k }), h('td', { text: String(m[k]) }));
          })
        )
      ),
      h('h2', { text: 'What is on the board, and what is not' }),
      h('ul', { class: 'rules' },
        h('li', null, h('b', { text: 'No token on record. ' }), 'The watchlist holds every protocol the snapshot records with no market cap, no CoinGecko id and no ticker. All ' + DATA.watchlist_size + ' are on the board, so the list is covered rather than sampled.'),
        h('li', null, h('b', { text: 'Below the floor too. ' }), 'The house drew its line at ' + compact(DATA.floor_usd) + ' of TVL. The board adds ' + DATA.early_size + ' pre-token protocols under that line, because a small protocol waiting on a launch is still a token that does not exist yet.'),
        h('li', null, h('b', { text: 'Nothing that already trades. ' }), 'A protocol with a live token is not a launch, so the ' + DATA.live_size + ' largest are set aside with their market caps on the Set aside page and never ranked here.'),
        h('li', null, h('b', { text: 'No wrapped, staked or bridged product. ' }), 'WBTC is Bitcoin, and staked ETH is ETH in a wrapper. A product of another protocol is that protocol\'s value, counted twice, so the board leaves out bridged, staked, restaked and exchange-issued products and every name that says so.'),
        h('li', null, h('b', { text: 'No version marker. ' }), 'A name that ends in V2, v3 or 2.0 is a pool of a protocol that is already on the board, not a second protocol.')
      ),
      h('h2', { text: 'Reading the board' }),
      h('p', { text: 'Rank is the position by implied value. The bar and the multiple under it show the same number against TVL, which is the model\'s own input: a row at 0.4× TVL has earned more than the ' + m.base_multiple + '× base through growth and age. The inputs chip counts the four fields the model uses that the snapshot actually records, so a row scored on three real inputs is visibly weaker evidence than one scored on four. The filters carry TVL, implied value, category, chain and input coverage, and every one of them is written into the address, so a board you narrowed can be bookmarked, reloaded or handed to someone else exactly as you see it.' }),
      h('h2', { text: 'What this is not' }),
      h('ul', { class: 'rules' },
        h('li', { text: 'It is not a price. It is what a launch would be worth if this category\'s protocol traded near this multiple of its TVL, which is a comparison, not a valuation.' }),
        h('li', { text: 'It is not a launch date, and not a promise one is coming. The snapshot records no announcement, no governance vote and no team intent.' }),
        h('li', { text: 'It is not adjusted for unlocks, treasury size, revenue or insider allocation, because the snapshot carries none of those. Two protocols at the same implied value can be very different bets.' }),
        h('li', { text: 'It is not live. The snapshot is frozen at ' + DATA.as_of + ', and every run of the program reads the same bytes.' })
      ),
      h('h2', { text: 'The farm plans' }),
      h('p', { text: 'Each row carries its own plan, derived from the protocol\'s category, chains, TVL and age: the action, the capital it needs, the hold that spans more than one snapshot, the claim check and the log. The plan is written into board.json as text with its cost and time, and this page renders exactly those strings, so what you read here is what the entry hands in rather than a second copy of the rules that could drift from it.' })
    ));
  }

  // ---------------------------------------------------------------- set-aside view

  function outView() {
    clear(APP);
    APP.appendChild(stamp());
    var rows = DATA.live.slice().sort(function (a, b) { return (b.mcap || 0) - (a.mcap || 0); });
    var excluded = DATA.excluded;
    APP.appendChild(h('div', { class: 'pad prose' },
      h('a', { class: 'back', href: '#/', text: '← The board' }),
      h('h1', { text: 'What the radar sets aside' }),
      h('p', { text: 'A token radar is only as good as what it refuses to count. These are the protocols in the same snapshot that look like launches and are not, with the reason each one is out.' }),
      h('h2', { text: 'The five rules' }),
      h('ul', { class: 'rules' },
        h('li', null, h('b', { text: 'It already trades. ' }), 'A market cap or a ticker means the token exists, so there is no launch to price. ' + DATA.live_size + ' of the largest are listed below.'),
        h('li', null, h('b', { text: 'It is a product of another protocol. ' }), 'A wrapped, staked, restaked, bridged or exchange-issued asset is the underlying protocol\'s value in another form. Counting it would price the same TVL twice.'),
        h('li', null, h('b', { text: 'It is a versioned pool. ' }), 'A name ending in V2, v3 or 2.0 is a later pool of a protocol already counted, not a separate launch.'),
        h('li', null, h('b', { text: 'It is an exchange. ' }), 'A centralised exchange\'s TVL is customer custody, not a protocol waiting on a token.'),
        h('li', null, h('b', { text: 'It is too small to read. ' }), 'Under $5M of TVL the snapshot does not carry the protocol at all, so nothing here is scored on a record the data does not hold.')
      ),
      h('h2', { text: 'Already trading: the ' + rows.length + ' largest' }),
      h('p', { text: 'Their market cap is a fact, not a model. They are here so a reader can see the other side of the line, and so the board\'s omission is visible rather than hidden.' })
    ));
    APP.appendChild(h('div', { class: 'table-wrap' },
      h('table', null,
        h('thead', null, h('tr', null,
          h('th', { scope: 'col', text: 'Protocol' }),
          h('th', { scope: 'col', class: 'r', text: 'TVL' }),
          h('th', { scope: 'col', class: 'r', text: '7-day' }),
          h('th', { scope: 'col', class: 'r', text: 'Market cap' }),
          h('th', { scope: 'col', class: 'r', text: 'Why it is out' })
        )),
        h('tbody', null, rows.map(function (r) {
          return h('tr', null,
            h('td', null, h('div', { class: 'who' }, h('b', { text: r.name }), h('span', { text: (r.category || 'Uncategorised') + (r.chains.length ? ' · ' + r.chains.slice(0, 2).join(', ') : '') }))),
            h('td', { class: 'r mono', text: compact(r.tvl) }),
            h('td', { class: 'r mono ' + (r.growth === null ? 'dim' : r.growth >= 0 ? 'pos' : 'neg'), text: pct(r.growth) }),
            h('td', { class: 'r mono', text: compact(r.mcap) }),
            h('td', { class: 'r' }, h('span', { class: 'chip', text: 'token trades' }))
          );
        }))
      )
    ));
    if (excluded.length) {
      var byReason = {};
      excluded.forEach(function (r) { byReason[r.reason] = (byReason[r.reason] || 0) + 1; });
      APP.appendChild(h('div', { class: 'pad prose' },
        h('h2', { text: 'Excluded protocols, by reason' }),
        h('p', { text: excluded.length + ' protocols were classified out before scoring. Each keeps the reason it was dropped, so the decision can be checked rather than trusted.' }),
        h('table', { class: 'constants' },
          h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Reason' }), h('th', { scope: 'col', text: 'Protocols' }))),
          h('tbody', null, Object.keys(byReason).sort().map(function (k) {
            return h('tr', null, h('td', { text: k }), h('td', { text: String(byReason[k]) }));
          }))
        ),
        h('table', { class: 'constants' },
          h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Protocol' }), h('th', { scope: 'col', text: 'Reason' }))),
          h('tbody', null, excluded.slice(0, 40).map(function (r) {
            return h('tr', null, h('td', { text: r.name }), h('td', { text: r.reason }));
          }))
        )
      ));
    }
  }

  // ---------------------------------------------------------------- render

  function markNav(view) {
    var links = document.querySelectorAll('[data-nav]');
    for (var i = 0; i < links.length; i++) {
      var name = links[i].getAttribute('data-nav');
      var on = (view === 'p' && name === 'board') || name === view;
      if (on) links[i].setAttribute('aria-current', 'page');
      else links[i].removeAttribute('aria-current');
    }
  }

  function render() {
    if (!started) return;
    var route = parseRoute();
    if (route.view === 'board' || route.view === 'p') document.title = 'Token Radar: pre-token protocols ranked by implied launch value';
    if (route.view === 'method') document.title = 'Token Radar: the method';
    if (route.view === 'out') document.title = 'Token Radar: what it sets aside';
    if (route.view === 'p') {
      var row = route.slug ? findRow(route.slug) : null;
      if (row) document.title = row.name + ' · Token Radar';
    }
    markNav(route.view);
    if (route.view === 'p') protocolView(route);
    else if (route.view === 'method') methodView();
    else if (route.view === 'out') outView();
    else boardView(route);
    APP.setAttribute('aria-busy', 'false');
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- boot

  function start() {
    started = true;
    RAW = window.RADAR || window.RADAR_DATA;
    if (!RAW) {
      clear(APP);
      APP.appendChild(h('div', { class: 'empty' },
        h('h1', { text: 'No data file' }),
        h('p', { class: 'muted', text: 'This page reads data.js, which the program writes when it runs. Run main.ts, then open the dashboard in the output directory again.' })
      ));
      APP.setAttribute('aria-busy', 'false');
      return;
    }
    MODEL = normaliseModel(RAW.model);
    DATA = normalise(RAW);
    window.addEventListener('hashchange', render);
    window.addEventListener('keydown', function (e) {
      if (e.key === '/' && document.activeElement !== document.getElementById('f-q')) {
        var box = document.getElementById('f-q');
        if (box) { e.preventDefault(); box.focus(); box.select(); }
      }
    });
    render();
  }

  boot();
})();
