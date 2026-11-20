// Token Radar's dashboard. It reads the data file the program writes beside dashboard/ (window.RADAR)
// and draws the board, a page per protocol and the method. Every figure it shows is in that file: the
// page fetches nothing, so it opens from a folder as well as a server, and the filter state lives in
// the address, so a board you narrowed can be reloaded, linked or captured exactly as it was.
(function () {
  'use strict';

  var APP = document.getElementById('app');
  var STAMP = document.getElementById('stamp');
  var started = false;
  var loaderTried = false;
  var RAW = null, MODEL = null, DATA = null;

  // ---------------------------------------------------------------- data

  // main.ts writes data.js beside the output directory, one level above this page. If a build puts it
  // beside the page instead, try that once before reporting a missing file.
  function boot() {
    if (window.RADAR || window.RADAR_DATA || loaderTried) { start(); return; }
    loaderTried = true;
    var s = document.createElement('script');
    s.src = 'data.js';
    s.onload = boot;
    s.onerror = boot;
    document.body.appendChild(s);
  }

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function firstNum() {
    for (var i = 0; i < arguments.length; i++) { var n = num(arguments[i]); if (n !== null) return n; }
    return null;
  }
  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }

  function modelOf(m) {
    m = m || {};
    function pick(key, fallback) { return num(m[key]) === null ? fallback : m[key]; }
    return {
      base_multiple: pick('base_multiple', 0.25), growth_weight: pick('growth_weight', 0.5),
      growth_floor: pick('growth_floor', -60), growth_cap: pick('growth_cap', 120),
      maturity_floor: pick('maturity_floor', 0.6), maturity_range: pick('maturity_range', 0.4),
      maturity_days: pick('maturity_days', 1095), unknown_age_days: pick('unknown_age_days', 365)
    };
  }

  // A farm step is "<what to do> Cost: <cost>. Time: <time>." in board.json, or an object with the three
  // parts. The page renders whichever the data carries, so the plan a reader sees is the plan the entry
  // froze rather than a second copy of the rules that could drift from it.
  function stepOf(s) {
    if (s && typeof s === 'object') return { text: s.text || s.action || '', cost: s.cost || '', time: s.time || '' };
    var text = String(s || ''), cost = '', time = '';
    var ci = text.indexOf(' Cost: ');
    if (ci >= 0) {
      var tail = text.slice(ci + 7);
      text = text.slice(0, ci);
      var ti = tail.indexOf('. Time: ');
      if (ti >= 0) { cost = tail.slice(0, ti); time = tail.slice(ti + 8).replace(/\.$/, ''); }
      else cost = tail.replace(/\.$/, '');
    }
    return { text: text, cost: cost, time: time };
  }

  function rowOf(r, i) {
    var farm = obj(r.farm_plan) || {};
    var conf = obj(r.confidence) || {};
    var rawSteps = r.farm_steps || r.farmSteps || farm.steps || [];
    var risk = farm.risk !== undefined ? farm.risk : r.risk;
    // The four fields the model uses; a row leaning on an unknown age is weaker evidence than one scored
    // on all four, and the board says so rather than hiding it.
    var known = (num(r.tvl_usd) !== null ? 1 : 0) + (r.change_7d !== null && r.change_7d !== undefined ? 1 : 0) +
      (r.age_days !== null && r.age_days !== undefined ? 1 : 0) + (Array.isArray(r.chains) && r.chains.length ? 1 : 0);
    return {
      rank: firstNum(r.rank, i + 1),
      slug: String(r.slug || ''),
      name: String(r.name || r.slug || ''),
      category: r.category || null,
      chains: Array.isArray(r.chains) ? r.chains.filter(function (c) { return typeof c === 'string'; }) : [],
      tvl: firstNum(r.tvl_usd, r.tvl),
      growth: firstNum(r.change_7d, r.growth_7d, r.growth),
      age: firstNum(r.age_days, r.ageDays),
      implied: firstNum(r.implied_value_usd, r.implied_value) || 0,
      listed_at: r.listed_at || null,
      growth_mult: firstNum(r.growth_multiplier, obj(r.model) ? r.model.growth_multiplier : null),
      maturity_mult: firstNum(r.maturity_multiplier, obj(r.model) ? r.model.maturity_multiplier : null),
      peer_multiple: firstNum(r.peer_multiple, r.multiple),
      peer_count: firstNum(r.peer_count),
      rationale: typeof r.rationale === 'string' ? r.rationale : null,
      confidence: {
        low: firstNum(conf.low_usd, conf.low),
        high: firstNum(conf.high_usd, conf.high),
        level: conf.label ? String(conf.label).toLowerCase()
          : typeof conf.level === 'number' ? (conf.level >= 0.45 ? 'high' : conf.level >= 0.2 ? 'medium' : 'low')
          : conf.level ? String(conf.level).toLowerCase() : null,
        score: typeof conf.level === 'number' ? conf.level : null
      },
      known: known,
      steps: (Array.isArray(rawSteps) ? rawSteps : []).map(stepOf).filter(function (s) { return s.text; }),
      capital: firstNum(farm.capital_usd),
      expected: firstNum(farm.expected_value_usd),
      risk: typeof risk === 'string' ? [risk] : (Array.isArray(risk) ? risk.map(String) : null)
    };
  }

  function median(list) {
    var a = list.filter(function (n) { return typeof n === 'number' && isFinite(n); }).sort(function (x, y) { return x - y; });
    if (!a.length) return 0;
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
  }

  function normalise(raw) {
    var rows = (raw.rows || raw.board || []).map(rowOf);
    var live = (raw.live || []).map(function (r) {
      return { slug: String(r.slug || ''), name: String(r.name || r.slug || ''), category: r.category || null,
        chains: Array.isArray(r.chains) ? r.chains : [], tvl: firstNum(r.tvl_usd, r.tvl),
        mcap: firstNum(r.mcap_usd, r.mcap), growth: firstNum(r.change_7d, r.growth_7d) };
    });
    var excluded = (raw.excluded || []).map(function (r) {
      return { slug: String(r.slug || ''), name: String(r.name || r.slug || ''), tvl: firstNum(r.tvl_usd, r.tvl),
        reason: String(r.reason || r.exclusion_reason || 'no reason recorded') };
    });
    return {
      as_of: String(raw.as_of || 'unknown'),
      model_version: String(raw.model_version || 'unstated'),
      floor_usd: firstNum(raw.floor_usd, 0),
      watchlist_size: firstNum(raw.watchlist_size, rows.length) || rows.length,
      board_size: firstNum(raw.board_size, rows.length) || rows.length,
      early_size: firstNum(raw.early_size, 0) || 0,
      live_size: firstNum(raw.live_size, live.length) || live.length,
      rows: rows, live: live, excluded: excluded,
      median: median(rows.map(function (r) { return r.implied; })),
      top10: rows.slice().sort(function (a, b) { return b.implied - a.implied; }).slice(0, 10)
        .reduce(function (s, r) { return s + r.implied; }, 0)
    };
  }

  // ---------------------------------------------------------------- format

  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function compact(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(a >= 1e10 ? 1 : 2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function ageText(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 730) return (d / 365).toFixed(1) + 'y';
    if (d >= 60) return Math.round(d / 30) + 'mo';
    return Math.round(d) + 'd';
  }
  function unique(list) {
    var seen = {};
    return list.filter(function (v) { if (!v || seen[v]) return false; seen[v] = 1; return true; });
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
        else if (k === 'style') node.setAttribute('style', v);
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) node.appendChild(x); });
      else if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    }
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  // ---------------------------------------------------------------- routes

  // #/?cat=Lending&tvl=gt1b is a filtered board, #/p/<slug> a protocol, #/method and #/out the two
  // reading pages. The address is the whole of the state: nothing is kept anywhere the URL cannot carry.
  function parseRoute() {
    var raw = String(location.hash || '').replace(/^#\/?/, '');
    var qi = raw.indexOf('?');
    var path = qi >= 0 ? raw.slice(0, qi) : raw;
    var parts = path.split('/').filter(Boolean);
    var view = parts[0] || 'board';
    if (['board', 'method', 'out', 'p'].indexOf(view) < 0) view = 'board';
    return { view: view, slug: parts[1] ? decodeURIComponent(parts[1]) : null,
      params: new URLSearchParams(qi >= 0 ? raw.slice(qi + 1) : '') };
  }
  function hashOf(view, slug, params) {
    var path = view === 'board' ? '/' : '/' + view + (slug ? '/' + encodeURIComponent(slug) : '');
    var qs = params ? params.toString() : '';
    return '#' + path + (qs ? '?' + qs : '');
  }

  var currentView = null, boardRefs = null;

  // A filter change redraws only the count line and the table, so the control in use keeps its focus and
  // its caret; a change of view redraws the page.
  function go(view, slug, params) {
    var hash = hashOf(view, slug, params);
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

  function filtersOf(params) {
    return {
      q: (params.get('q') || '').trim(),
      cat: params.get('cat') || 'all', chain: params.get('chain') || 'all',
      tvl: params.get('tvl') || 'all', implied: params.get('implied') || 'all',
      conf: params.get('conf') || 'all', inputs: params.get('inputs') || 'all',
      sort: SORTS[params.get('sort')] ? params.get('sort') : 'implied',
      dir: params.get('dir') === 'asc' ? 1 : -1
    };
  }
  function paramsOf(f) {
    var p = new URLSearchParams();
    if (f.q) p.set('q', f.q);
    if (f.cat !== 'all') p.set('cat', f.cat);
    if (f.chain !== 'all') p.set('chain', f.chain);
    if (f.tvl !== 'all') p.set('tvl', f.tvl);
    if (f.implied !== 'all') p.set('implied', f.implied);
    if (f.conf !== 'all') p.set('conf', f.conf);
    if (f.inputs !== 'all') p.set('inputs', f.inputs);
    if (f.sort !== 'implied') p.set('sort', f.sort);
    if (f.dir !== -1) p.set('dir', 'asc');
    return p;
  }
  function setFilter(name, value) {
    var f = filtersOf(parseRoute().params);
    f[name] = value;
    go('board', null, paramsOf(f));
  }
  function filtered(f) {
    var q = f.q.toLowerCase();
    var tvlOk = TVL_BANDS[f.tvl] || TVL_BANDS.all;
    var impOk = IMPLIED_BANDS[f.implied] || IMPLIED_BANDS.all;
    return DATA.rows.filter(function (r) {
      if (!tvlOk(r) || !impOk(r)) return false;
      if (f.cat !== 'all' && (r.category || 'Uncategorised') !== f.cat) return false;
      if (f.chain !== 'all' && r.chains.indexOf(f.chain) < 0) return false;
      if (f.conf !== 'all' && (r.confidence.level || '') !== f.conf) return false;
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

  // ---------------------------------------------------------------- board

  function stamp() {
    STAMP.textContent = 'snapshot ' + DATA.as_of + ' · ' + DATA.model_version + ' · ' + DATA.board_size + ' rows';
  }

  function kpis() {
    return h('section', { class: 'kpis', 'aria-label': 'The snapshot at a glance' },
      h('div', { class: 'kpi' }, h('span', { text: 'Watchlist covered' }),
        h('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }),
        h('em', { text: 'every protocol the sealed list names' })),
      h('div', { class: 'kpi' }, h('span', { text: 'Rows ranked' }), h('b', { text: String(DATA.board_size) }),
        h('em', { text: DATA.early_size + ' found below the floor' })),
      h('div', { class: 'kpi' }, h('span', { text: 'Top ten, implied' }), h('b', { text: compact(DATA.top10) }),
        h('em', { text: 'what the ten biggest launches could be worth' })),
      h('div', { class: 'kpi' }, h('span', { text: 'Median row' }), h('b', { text: compact(DATA.median) }),
        h('em', { text: 'the middle of the board, not a typical bet' }))
    );
  }

  function selectField(label, name, options, value) {
    var sel = h('select', { id: 'f-' + name, 'aria-label': label },
      options.map(function (o) { return h('option', { value: o[0], text: o[1], selected: o[0] === value ? 'selected' : null }); }));
    sel.addEventListener('change', function () { setFilter(name, sel.value); });
    return h('div', { class: 'field' }, h('label', { for: 'f-' + name, text: label }), sel);
  }

  function filterBar(f) {
    var cats = ['all'].concat(unique(DATA.rows.map(function (r) { return r.category || 'Uncategorised'; })).sort());
    var chains = ['all'].concat(unique(DATA.rows.reduce(function (a, r) { return a.concat(r.chains); }, [])).sort());
    var search = h('input', { type: 'search', id: 'f-q', value: f.q, autocomplete: 'off',
      placeholder: 'Name, category or chain', 'aria-label': 'Search the board' });
    var timer = null;
    search.addEventListener('input', function () {
      clearTimeout(timer);
      var value = search.value;
      timer = setTimeout(function () { setFilter('q', value.trim()); }, 180);
    });
    search.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      search.value = '';
      setFilter('q', '');
      search.focus();
    });
    return h('section', { class: 'filters', 'aria-label': 'Filter the board' },
      h('div', { class: 'field' }, h('label', { for: 'f-q', text: 'Search' }), search),
      selectField('Category', 'cat', cats.map(function (c) { return [c, c === 'all' ? 'All categories' : c]; }), f.cat),
      selectField('Chain', 'chain', chains.map(function (c) { return [c, c === 'all' ? 'All chains' : c]; }), f.chain),
      selectField('TVL', 'tvl', [['all', 'Any size'], ['lt100', 'Under $100M'], ['mid', '$100M to $1B'], ['gt1b', '$1B and up']], f.tvl),
      selectField('Implied', 'implied', [['all', 'Any value'], ['lt10', 'Under $10M'], ['mid', '$10M to $100M'], ['gt100', '$100M and up']], f.implied),
      selectField('Confidence', 'conf', [['all', 'Any confidence'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']], f.conf),
      selectField('Inputs', 'inputs', [['all', 'Any coverage'], ['full', 'All four known'], ['partial', 'An input unknown']], f.inputs),
      h('span', { class: 'spacer' }),
      h('a', { class: 'button ghost', href: '#/', text: 'Reset' })
    );
  }

  function resultLine(f, count) {
    var bits = [];
    if (f.q) bits.push('search "' + f.q + '"');
    if (f.cat !== 'all') bits.push(f.cat);
    if (f.chain !== 'all') bits.push('on ' + f.chain);
    if (f.tvl !== 'all') bits.push({ lt100: 'under $100M TVL', mid: '$100M to $1B TVL', gt1b: '$1B and up TVL' }[f.tvl]);
    if (f.implied !== 'all') bits.push({ lt10: 'under $10M implied', mid: '$10M to $100M implied', gt100: '$100M and up implied' }[f.implied]);
    if (f.conf !== 'all') bits.push(f.conf + ' confidence');
    if (f.inputs !== 'all') bits.push(f.inputs === 'full' ? 'all inputs known' : 'an input unknown');
    return h('div', { class: 'result-line' },
      h('span', null, h('b', { text: count + ' of ' + DATA.board_size }), ' rows'),
      bits.length ? h('span', { text: '· ' + bits.join(' · ') }) : h('span', { class: 'dim', text: '· no filter, the whole board' }),
      bits.length ? h('a', { class: 'button ghost clear', href: '#/', text: 'Clear filters' }) : null
    );
  }

  function sortHeader(f, key, label, align) {
    var active = f.sort === key;
    return h('th', { scope: 'col', class: align, 'aria-sort': !active ? 'none' : f.dir === 1 ? 'ascending' : 'descending' },
      h('button', { type: 'button', onclick: function () {
        var next = filtersOf(parseRoute().params);
        if (next.sort === key) next.dir = -next.dir;
        else { next.sort = key; next.dir = key === 'name' ? 1 : -1; }
        go('board', null, paramsOf(next));
      } }, label, active ? h('span', { class: 'caret', 'aria-hidden': 'true', text: f.dir === 1 ? '▲' : '▼' }) : null)
    );
  }

  function confChip(r) {
    if (r.confidence.level) return h('span', { class: 'chip ' + r.confidence.level, text: r.confidence.level });
    var cls = r.known >= 4 ? 'full' : r.known === 3 ? 'part' : 'thin';
    return h('span', { class: 'chip ' + cls, title: 'Of TVL, 7-day growth, age and chain, how many the snapshot records', text: r.known + '/4' });
  }

  function boardTable(f, list) {
    var max = list.reduce(function (m, r) { return Math.max(m, r.implied); }, 1);
    var body = h('tbody');
    list.forEach(function (r) {
      var tr = h('tr', { tabindex: '0', onclick: function (e) { if (e.target.tagName !== 'A') openProtocol(r.slug); } },
        h('td', { class: 'rank' }, h('b', { text: '#' + r.rank })),
        h('td', null, h('div', { class: 'who' },
          h('a', { href: '#/p/' + encodeURIComponent(r.slug), text: r.name }),
          h('span', { text: (r.category || 'Uncategorised') + (r.chains.length ? ' · ' + r.chains.slice(0, 2).join(', ') : '') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') }))),
        h('td', { class: 'r mono', text: compact(r.tvl) }),
        h('td', { class: 'r mono ' + (r.growth === null ? 'dim' : r.growth >= 0 ? 'pos' : 'neg'), text: pct(r.growth) }),
        h('td', { class: 'r mono', text: ageText(r.age) }),
        h('td', { class: 'r' }, h('div', { class: 'implied-cell' },
          h('b', { text: compact(r.implied) }),
          h('span', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.max(2, Math.round((r.implied / max) * 100)) + '%' })),
          r.tvl ? h('span', { class: 'mult', text: (r.implied / r.tvl).toFixed(2) + '× TVL' }) : null)),
        h('td', { class: 'r' }, confChip(r))
      );
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); openProtocol(r.slug); } });
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
          h('th', { scope: 'col', class: 'r', text: 'Confidence' })
        )),
        body
      )
    );
  }

  function boardView(route) {
    var f = filtersOf(route.params);
    clear(APP);
    stamp();
    APP.appendChild(kpis());
    APP.appendChild(filterBar(f));
    var resultHost = h('div');
    var tableHost = h('div');
    APP.appendChild(resultHost);
    APP.appendChild(tableHost);
    APP.appendChild(h('footer', { class: 'foot' },
      h('span', { text: 'DefiLlama protocol index, fetched once and frozen at ' + DATA.as_of + '. Implied value is a model of a launch, never a price.' }),
      h('span', { class: 'mono', text: DATA.model_version })));
    boardRefs = { resultHost: resultHost, tableHost: tableHost };
    refreshBoard();
  }

  function refreshBoard() {
    if (!boardRefs) return;
    var f = filtersOf(parseRoute().params);
    var list = sorted(filtered(f), f);
    clear(boardRefs.resultHost);
    boardRefs.resultHost.appendChild(resultLine(f, list.length));
    clear(boardRefs.tableHost);
    if (!list.length) {
      boardRefs.tableHost.appendChild(h('div', { class: 'empty' },
        h('h2', { text: 'No protocol matches those filters' }),
        h('p', { class: 'muted', text: 'A narrow combination can empty all ' + DATA.board_size + ' rows. Widen the size or value band, or clear the search.' }),
        h('a', { class: 'button', href: '#/', text: 'Clear every filter' })));
      return;
    }
    boardRefs.tableHost.appendChild(boardTable(f, list));
  }

  // ---------------------------------------------------------------- protocol

  function findRow(slug) {
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) return DATA.rows[i];
    return null;
  }
  function openProtocol(slug) { go('p', slug, null); }

  // The two multipliers the row carries, recomputed only when the data omits them. The peer multiple is
  // the model's own calibration when the row carries it; otherwise the page falls back to the base.
  function multipliers(r) {
    var m = MODEL;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, r.growth === null ? 0 : r.growth));
    var growthMult = r.growth_mult !== null ? r.growth_mult : 1 + (growth / 100) * m.growth_weight;
    var ageUsed = r.age === null ? m.unknown_age_days : r.age;
    var maturityMult = r.maturity_mult !== null ? r.maturity_mult :
      m.maturity_floor + (Math.min(Math.max(ageUsed, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    return { growth: growth, growthMult: growthMult, maturityMult: maturityMult, ageUsed: ageUsed };
  }

  function ladder(r) {
    var m = MODEL, k = multipliers(r);
    var baseMult = r.peer_multiple !== null ? r.peer_multiple : m.base_multiple;
    var base = (r.tvl || 0) * baseMult;
    return h('div', { class: 'ladder' },
      h('div', { class: 'rung' }, h('span', { text: 'TVL, as the snapshot records it' }), h('b', { text: usd(r.tvl) })),
      h('div', { class: 'rung op' }, h('span', { text: '× ' + baseMult.toFixed(3) + (r.peer_multiple !== null ? ' category peer multiple' + (r.peer_count ? ' (' + r.peer_count + ' peers)' : '') : ' base multiple') }), h('b', { text: usd(base) })),
      h('div', { class: 'rung op' }, h('span', { text: '× growth ' + k.growthMult.toFixed(3) + ' (7-day ' + pct(r.growth) + ', damped toward no change)' }), h('b', { text: usd(base * k.growthMult) })),
      h('div', { class: 'rung op' }, h('span', { text: '× maturity ' + k.maturityMult.toFixed(3) + ' (' + ageText(r.age) + ' with no token)' }), h('b', { text: usd(base * k.growthMult * k.maturityMult) })),
      h('div', { class: 'rung total' }, h('span', { text: '= implied launch value' }), h('b', { text: usd(r.implied) }))
    );
  }

  // The band is the model's own when the row carries one; otherwise a sensitivity test at ±20% of the
  // multiple, which says how much of the number is the calibration rather than the protocol.
  function bandOf(r) {
    if (r.confidence.low !== null && r.confidence.high !== null) {
      return { low: r.confidence.low, high: r.confidence.high, label: 'the model\'s own band for this row' };
    }
    return { low: Math.round(r.implied * 0.8), high: Math.round(r.implied * 1.2), label: 'the same row at a 20% lower and higher multiple' };
  }

  function band(r) {
    var b = bandOf(r);
    var span = Math.max(b.high, 1);
    var left = Math.max(0, Math.round((b.low / span) * 100));
    var width = Math.min(100 - left, Math.round(((b.high - b.low) / span) * 100));
    var dot = Math.min(98, Math.round((r.implied / span) * 100));
    return h('div', { class: 'range' },
      h('div', { class: 'range-track', 'aria-hidden': 'true' },
        h('div', { class: 'range-fill', style: 'left:' + left + '%;width:' + Math.max(2, width) + '%' }),
        h('div', { class: 'range-dot', style: 'left:' + dot + '%' })),
      h('div', { class: 'range-ends' }, h('span', { text: compact(b.low) }), h('span', { text: 'base case' }), h('span', { text: compact(b.high) })),
      h('p', { class: 'muted', style: 'font-size:12px;margin-top:10px', text: 'The band is ' + b.label + '. It is not a forecast, and nothing else about the protocol changes inside it.' })
    );
  }

  function changeNotes(r) {
    var m = MODEL, k = multipliers(r);
    var clamped = r.growth !== null && (r.growth > m.growth_cap || r.growth < m.growth_floor);
    var notes = [
      'TVL carries the whole base: a 30% fall takes this row to ' + usd(r.implied * 0.7) + ', before anything else moves.',
      r.growth === null
        ? 'The snapshot records no 7-day change, so growth is read as 0 and the row gets no credit for momentum it may have.'
        : clamped
          ? 'The 7-day figure of ' + pct(r.growth) + ' is outside the ' + m.growth_floor + '% to ' + m.growth_cap + '% clamp, so it counts as ' + pct(k.growth) + ': a further spike moves this row no faster than the cap.'
          : 'The 7-day figure of ' + pct(r.growth) + ' sits inside the clamp and enters at half weight, so it is worth ' + ((k.growth / 100) * m.growth_weight).toFixed(3) + ' of multiplier either way.',
      r.age === null
        ? 'No first-listing date is recorded, so maturity uses the ' + m.unknown_age_days + '-day default (' + k.maturityMult.toFixed(3) + '×), a weaker input than a dated row.'
        : 'Maturity tops out at ' + (m.maturity_floor + m.maturity_range).toFixed(1) + '×, so age can add at most ' + (((m.maturity_floor + m.maturity_range) - k.maturityMult) * 100 / k.maturityMult).toFixed(0) + '% more than this row already carries.',
      'No token on record is a fact about the snapshot, not an announcement: nothing in this file says a launch is planned.'
    ];
    return h('ul', { class: 'notes' }, notes.map(function (n) { return h('li', { text: n }); }));
  }

  function farmPanel(r) {
    return h('section', { class: 'card' },
      h('h2', null, 'Farm plan', h('span', { text: r.steps.length + ' steps' })),
      r.capital !== null ? h('p', { class: 'muted', style: 'font-size:12px;margin-bottom:12px', text: 'Capital for one position: ' + usd(r.capital) + (r.expected !== null ? ' · implied value of a qualifying position: ' + usd(r.expected) : '') }) : null,
      r.steps.length
        ? h('ol', { class: 'steps' }, r.steps.map(function (s) {
            return h('li', null, h('p', { text: s.text }),
              (s.cost || s.time) ? h('div', { class: 'tags' },
                s.cost ? h('span', { class: 'tag', text: 'cost: ' + s.cost }) : null,
                s.time ? h('span', { class: 'tag', text: 'time: ' + s.time }) : null) : null);
          }))
        : h('p', { class: 'muted', text: 'No farm steps were written for this row.' })
    );
  }

  function riskPanel(r) {
    var items = r.risk && r.risk.length ? r.risk : [
      'The plan is written from the snapshot only. It cannot see a paused market, a fee switch, a governance vote or a deposit cap: check the protocol\'s own page before you commit.',
      'Points and any future airdrop are never announced in this data. No row here promises a reward, and no claim ever needs a payment.',
      'The capital in step two is at risk for the whole hold. A depeg, an oracle fault or a bad collateral can lose it, and no yield here is a promise of return.'
    ];
    return h('section', { class: 'card' }, h('h2', { text: 'What can go wrong' }),
      h('ul', { class: 'notes' }, items.map(function (t) { return h('li', { text: String(t) }); })));
  }

  function protocolView(route) {
    var r = route.slug ? findRow(route.slug) : null;
    clear(APP);
    stamp();
    if (!r) {
      APP.appendChild(h('div', { class: 'empty' },
        h('h1', { text: 'No protocol named ' + (route.slug || '') }),
        h('p', { class: 'muted', text: 'The board carries ' + DATA.board_size + ' rows from this snapshot, and that slug is not one of them.' }),
        h('a', { class: 'button', href: '#/', text: 'Back to the board' })));
      return;
    }
    var byRank = DATA.rows.slice().sort(function (a, b) { return a.rank - b.rank; });
    var at = byRank.indexOf(r);
    var prev = at > 0 ? byRank[at - 1] : null;
    var next = at >= 0 && at < byRank.length - 1 ? byRank[at + 1] : null;
    var b = bandOf(r);
    APP.appendChild(h('div', { class: 'pad' },
      h('a', { class: 'back', href: '#/', text: '← The board' }),
      h('div', { class: 'hero' },
        h('div', null,
          h('div', { class: 'eyebrow' }, h('span', { class: 'chip', text: '#' + r.rank + ' of ' + DATA.board_size }), h('span', { text: 'no token on record' })),
          h('h1', { text: r.name }),
          h('p', { class: 'where', text: (r.category || 'Uncategorised') + ' on ' + (r.chains.length ? r.chains.join(', ') : 'an unnamed chain') })),
        h('div', { class: 'hero-value' },
          h('span', { text: 'Implied launch value' }),
          h('b', { text: compact(r.implied) }),
          h('em', { text: compact(b.low) + ' to ' + compact(b.high) }))),
      h('div', { class: 'two-col' },
        h('div', null,
          h('section', { class: 'card' },
            h('h2', null, 'How the estimate is built', h('span', { text: 'every input from the snapshot' })),
            ladder(r), band(r),
            r.rationale ? h('p', { class: 'muted', style: 'font-size:12px;margin-top:12px', text: r.rationale }) : null),
          h('section', { class: 'card' },
            h('h2', { text: 'The inputs' }),
            h('dl', { class: 'inputs' },
              h('dt', { text: 'TVL' }), h('dd', { text: usd(r.tvl) }),
              h('dt', { text: '7-day TVL change' }), h('dd', { class: r.growth === null ? 'dim' : r.growth >= 0 ? 'pos' : 'neg', text: pct(r.growth) }),
              h('dt', { text: 'First listed' }), h('dd', { text: r.listed_at || 'not recorded' }),
              h('dt', { text: 'Age with no token' }), h('dd', { text: ageText(r.age) }),
              h('dt', { text: 'Chains counted' }), h('dd', { text: String(r.chains.length) }),
              h('dt', { text: 'Market cap' }), h('dd', { text: 'none recorded' }),
              h('dt', { text: 'Implied ÷ TVL' }), h('dd', { text: r.tvl ? (r.implied / r.tvl).toFixed(3) + '×' : 'n/a' }))),
          h('section', { class: 'card' }, h('h2', { text: 'What would change this call' }), changeNotes(r))),
        h('div', null,
          farmPanel(r), riskPanel(r),
          h('div', { class: 'pager' },
            prev ? h('a', { href: '#/p/' + encodeURIComponent(prev.slug), text: '← #' + prev.rank + ' ' + prev.name }) : h('span'),
            next ? h('a', { href: '#/p/' + encodeURIComponent(next.slug), text: '#' + next.rank + ' ' + next.name + ' →' }) : h('span')))
      )));
  }

  // ---------------------------------------------------------------- method

  function methodView() {
    var m = MODEL;
    clear(APP);
    stamp();
    APP.appendChild(h('div', { class: 'pad prose' },
      h('a', { class: 'back', href: '#/', text: '← The board' }),
      h('h1', { text: 'The method, in full' }),
      h('p', { text: 'One function scores every row and no protocol name is special-cased, so any row on this page can be recomputed from the figures beside it.' }),
      h('h2', { text: 'The formula' }),
      h('div', { class: 'formula', text: 'base    = tvl_usd × category peer multiple\nimplied = base × (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ')/100 × ' + m.growth_weight + ')\n            × (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ')/' + m.maturity_days + ' × ' + m.maturity_range + ')' }),
      h('p', { text: 'TVL sets the size. The multiple is what protocols in the same category trade at against their own TVL, so a lending protocol is priced like lenders, not like a chain. Seven-day growth says whether capital is arriving now, at half weight so one week cannot dominate. Maturity says how long the protocol has run with no token, the best record here of a team that shipped and stayed: it starts at ' + m.maturity_floor + ' and reaches ' + (m.maturity_floor + m.maturity_range).toFixed(1) + ' after ' + Math.round(m.maturity_days / 365) + ' years. No row scores below 1.' }),
      h('h2', { text: 'The constants' }),
      h('table', { class: 'constants' },
        h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Constant' }), h('th', { scope: 'col', text: 'Value' }))),
        h('tbody', null, Object.keys(m).map(function (k) { return h('tr', null, h('td', { text: k }), h('td', { text: String(m[k]) })); }))),
      h('h2', { text: 'What is on the board, and what is not' }),
      h('ul', { class: 'rules' },
        h('li', null, h('b', { text: 'No token on record. ' }), 'Every protocol the snapshot records with no market cap, no CoinGecko id and no ticker is on the board: all ' + DATA.watchlist_size + ', so the list is covered rather than sampled.'),
        h('li', null, h('b', { text: 'Below the floor too. ' }), 'The house drew its line at ' + compact(DATA.floor_usd) + ' of TVL. The board adds ' + DATA.early_size + ' pre-token protocols under it, because a small protocol waiting on a launch is still a token that does not exist yet.'),
        h('li', null, h('b', { text: 'Nothing that already trades. ' }), 'A live token is not a launch, so the ' + DATA.live_size + ' largest are set aside with their market caps and never ranked here.'),
        h('li', null, h('b', { text: 'No wrapped, staked or bridged product. ' }), 'WBTC is Bitcoin and staked ETH is ETH in a wrapper: a product of another protocol is that protocol\'s value counted twice, so bridged, staked, restaked and exchange-issued products are out.'),
        h('li', null, h('b', { text: 'No version marker. ' }), 'A name ending in V2, v3 or 2.0 is a later pool of a protocol already counted, not a second launch.')),
      h('h2', { text: 'Reading the board' }),
      h('p', { text: 'Rank is the position by implied value. The bar and the multiple beneath it put that number against TVL, the model\'s own input: a row at 0.4× TVL earned more than the base through growth and age. The confidence chip is the model\'s own grade for the row, and where it is absent the page shows how many of the four inputs the snapshot actually records, so a row scored on three real inputs is visibly weaker evidence than one scored on four. The filters carry category, chain, TVL band, implied band, confidence and input coverage, and every one is in the address, so a board you narrowed can be bookmarked, reloaded or handed to someone exactly as you see it.' }),
      h('h2', { text: 'What this is not' }),
      h('ul', { class: 'rules' },
        h('li', { text: 'Not a price. It is what a launch would be worth at the multiple its category already trades at, which is a comparison, not a valuation.' }),
        h('li', { text: 'Not a launch date, and not a promise one is coming: the snapshot carries no announcement, no governance vote and no team intent.' }),
        h('li', { text: 'Not adjusted for unlocks, treasury, revenue or insider allocation, because the snapshot holds none of them. Two rows at one implied value can be very different bets.' }),
        h('li', { text: 'Not live. The snapshot is frozen at ' + DATA.as_of + ' and every run of the program reads the same bytes.' })),
      h('h2', { text: 'The farm plans' }),
      h('p', { text: 'Each row carries its own plan, written from its category, chains, TVL and age: the action, the capital one position needs, the hold that spans more than one snapshot, the claim check and the log. The plan is frozen into board.json as text with its cost and time, and this page renders exactly those strings, so what you read is what the entry hands in rather than a second copy of the rules that could drift.' })
    ));
  }

  // ---------------------------------------------------------------- set aside

  function outView() {
    clear(APP);
    stamp();
    var rows = DATA.live.slice().sort(function (a, b) { return (b.mcap || 0) - (a.mcap || 0); });
    APP.appendChild(h('div', { class: 'pad prose' },
      h('a', { class: 'back', href: '#/', text: '← The board' }),
      h('h1', { text: 'What the radar sets aside' }),
      h('p', { text: 'A radar is only as good as what it refuses to count. These are the protocols in the same snapshot that look like launches and are not, with the reason each is out.' }),
      h('h2', { text: 'The five rules' }),
      h('ul', { class: 'rules' },
        h('li', null, h('b', { text: 'It already trades. ' }), 'A market cap or a ticker means the token exists, so there is no launch to price. The ' + DATA.live_size + ' largest are below.'),
        h('li', null, h('b', { text: 'It is a product of another protocol. ' }), 'A wrapped, staked, restaked, bridged or exchange-issued asset is the underlying protocol\'s value in another form. Counting it prices the same TVL twice.'),
        h('li', null, h('b', { text: 'It is a versioned pool. ' }), 'A name ending in V2, v3 or 2.0 is a later pool of a protocol already counted.'),
        h('li', null, h('b', { text: 'It is an exchange. ' }), 'A centralised exchange\'s TVL is customer custody, not a protocol waiting on a token.'),
        h('li', null, h('b', { text: 'It is too small to read. ' }), 'Under $5M of TVL the snapshot does not carry the protocol at all, so nothing here is scored on a record the data does not hold.')),
      h('h2', { text: 'Already trading: the ' + rows.length + ' largest' }),
      h('p', { text: 'Their market cap is a fact, not a model. They are here so a reader can see the other side of the line, and so the board\'s omission is visible rather than hidden.' })));
    APP.appendChild(h('div', { class: 'table-wrap' },
      h('table', null,
        h('thead', null, h('tr', null,
          h('th', { scope: 'col', text: 'Protocol' }), h('th', { scope: 'col', class: 'r', text: 'TVL' }),
          h('th', { scope: 'col', class: 'r', text: '7-day' }), h('th', { scope: 'col', class: 'r', text: 'Market cap' }),
          h('th', { scope: 'col', class: 'r', text: 'Why it is out' }))),
        h('tbody', null, rows.map(function (r) {
          return h('tr', null,
            h('td', null, h('div', { class: 'who' }, h('b', { text: r.name }),
              h('span', { text: (r.category || 'Uncategorised') + (r.chains.length ? ' · ' + r.chains.slice(0, 2).join(', ') : '') }))),
            h('td', { class: 'r mono', text: compact(r.tvl) }),
            h('td', { class: 'r mono ' + (r.growth === null ? 'dim' : r.growth >= 0 ? 'pos' : 'neg'), text: pct(r.growth) }),
            h('td', { class: 'r mono', text: compact(r.mcap) }),
            h('td', { class: 'r' }, h('span', { class: 'chip', text: 'token trades' })));
        })))));
    if (DATA.excluded.length) {
      var byReason = {};
      DATA.excluded.forEach(function (r) { byReason[r.reason] = (byReason[r.reason] || 0) + 1; });
      APP.appendChild(h('div', { class: 'pad prose' },
        h('h2', { text: 'Excluded protocols, by reason' }),
        h('p', { text: DATA.excluded.length + ' protocols were classified out before scoring. Each keeps the reason it was dropped, so the decision can be checked rather than trusted.' }),
        h('table', { class: 'constants' },
          h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Reason' }), h('th', { scope: 'col', text: 'Protocols' }))),
          h('tbody', null, Object.keys(byReason).sort().map(function (k) {
            return h('tr', null, h('td', { text: k }), h('td', { text: String(byReason[k]) }));
          })))));
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
    var titles = { board: 'Token Radar: pre-token protocols ranked by implied launch value',
      method: 'Token Radar: the method', out: 'Token Radar: what it sets aside' };
    document.title = titles[route.view] || titles.board;
    if (route.view === 'p') {
      var r = route.slug ? findRow(route.slug) : null;
      if (r) document.title = r.name + ' · Token Radar';
    }
    if (route.view !== 'board') boardRefs = null;
    markNav(route.view);
    if (route.view === 'p') protocolView(route);
    else if (route.view === 'method') methodView();
    else if (route.view === 'out') outView();
    else boardView(route);
    currentView = route.view;
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
        h('p', { class: 'muted', text: 'This page reads data.js, which the program writes when it runs. Run main.ts, then open the dashboard in its output folder again.' })));
      APP.setAttribute('aria-busy', 'false');
      return;
    }
    MODEL = modelOf(RAW.model);
    DATA = normalise(RAW);
    window.addEventListener('hashchange', render);
    window.addEventListener('keydown', function (e) {
      if (e.key !== '/') return;
      var box = document.getElementById('f-q');
      if (box && document.activeElement !== box) { e.preventDefault(); box.focus(); box.select(); }
    });
    render();
  }

  boot();
})();
