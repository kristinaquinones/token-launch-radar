// Token Radar's dashboard. It reads data.js, which main.ts writes one level above this page, and draws
// the board, a page per protocol and the method. Nothing is fetched: every figure comes from that file,
// the page opens from a folder as well as a server, and the filter state lives in the address so a
// narrowed board can be reloaded, linked or captured exactly as it was.
(function () {
  'use strict';

  var APP = document.getElementById('app');
  var STAMP = document.getElementById('stamp');
  var started = false, loaderTried = false, RAW = null, MODEL = null, DATA = null;

  // ---------------------------------------------------------------- data

  // data.js sits beside the output directory. If a build puts it beside the page instead, try once.
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

  // The constants live under model.valuation; the page reads them so the method it states is the model
  // the board actually ran, not a copy that could drift from the code.
  function modelOf(raw) {
    var m = obj(raw) || {};
    var v = obj(m.valuation) || m;
    function pick(k, d) { return num(v[k]) === null ? d : v[k]; }
    return {
      base_multiple: pick('base_multiple', 0.25),
      growth_weight: pick('growth_weight', 0.2), growth_floor: pick('growth_floor', -60), growth_cap: pick('growth_cap', 60),
      maturity_floor: pick('maturity_floor', 0.7), maturity_range: pick('maturity_range', 0.3),
      maturity_days: pick('maturity_days', 730), unknown_age_days: pick('unknown_age_days', 365),
      band_low_quantile: pick('band_low_quantile', 0.25), band_high_quantile: pick('band_high_quantile', 0.75),
      multiple_floor: pick('multiple_floor', 0.02), multiple_ceiling: pick('multiple_ceiling', 6),
      version: String(v.version || m.version || 'unstated'),
      farm_version: String((obj(m.farm) || {}).version || ''),
      implied: typeof m.implied_value === 'string' ? m.implied_value : null,
      confidence_text: typeof m.confidence === 'string' ? m.confidence : null,
      exclusions_text: typeof m.exclusions === 'string' ? m.exclusions : null,
      assumptions: Array.isArray(m.farm_assumptions) ? m.farm_assumptions.filter(function (x) { return typeof x === 'string'; }) : []
    };
  }

  // A farm step is "<what to do> Cost: <cost>. Time: <time>." in board.json, or an object with the three
  // parts; the page renders the plan the entry froze rather than a second copy of the rules.
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
    var farm = obj(r.farm) || {};
    var conf = obj(r.confidence) || {};
    var steps = r.farm_steps || r.farmSteps || farm.steps || [];
    // The four inputs the model uses. A row leaning on an unknown age is weaker evidence than one scored
    // on all four, and the page says so rather than hiding it.
    var known = (num(r.tvl_usd) !== null ? 1 : 0) + (num(r.change_7d) !== null ? 1 : 0) +
      (num(r.age_days) !== null ? 1 : 0) + (Array.isArray(r.chains) && r.chains.length ? 1 : 0);
    return {
      rank: firstNum(r.rank, i + 1), slug: String(r.slug || ''), name: String(r.name || r.slug || ''),
      category: r.category || null,
      chains: Array.isArray(r.chains) ? r.chains.filter(function (c) { return typeof c === 'string'; }) : [],
      tvl: firstNum(r.tvl_usd, r.tvl), growth: firstNum(r.change_7d, r.growth_7d),
      age: firstNum(r.age_days, r.ageDays), implied: firstNum(r.implied_value_usd, r.implied_value) || 0,
      listed_at: r.listed_at || null, watchlist: r.on_watchlist === true,
      growth_mult: firstNum(r.growth_multiplier, obj(r.model) ? r.model.growth_multiplier : null),
      maturity_mult: firstNum(r.maturity_multiplier, obj(r.model) ? r.model.maturity_multiplier : null),
      peer_multiple: firstNum(r.peer_multiple), peer_count: firstNum(r.peer_count),
      peer_source: typeof r.peer_source === 'string' ? r.peer_source : (obj(r.model) && typeof r.model.peer_source === 'string' ? r.model.peer_source : null),
      rationale: typeof r.rationale === 'string' ? r.rationale : null,
      support: firstNum(conf.level), support_label: conf.label ? String(conf.label) : null,
      reasons: Array.isArray(conf.reasons) ? conf.reasons.filter(function (x) { return typeof x === 'string'; }) : [],
      band_low: firstNum(conf.low_usd), band_high: firstNum(conf.high_usd),
      known: known,
      steps: (Array.isArray(steps) ? steps : []).map(stepOf).filter(function (s) { return s.text; }),
      capital: firstNum(farm.capital_usd), cost: firstNum(farm.cost_usd), hold: firstNum(farm.hold_days),
      expected: firstNum(farm.expected_value_usd), multiple: firstNum(farm.multiple),
      risk: typeof farm.risk === 'string' ? farm.risk : null,
      risk_level: farm.risk_level ? String(farm.risk_level) : null,
      risk_score: firstNum(farm.risk_score),
      verdict: farm.verdict ? String(farm.verdict) : null,
      verdict_note: typeof farm.verdict_note === 'string' ? farm.verdict_note : null,
      why_now: typeof farm.why_now === 'string' ? farm.why_now : null
    };
  }

  function median(list) {
    var a = list.filter(function (n) { return num(n) !== null; }).sort(function (x, y) { return x - y; });
    if (!a.length) return 0;
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
  }

  function normalise(raw) {
    var rows = (raw.rows || raw.board || []).map(rowOf);
    return {
      as_of: String(raw.as_of || 'unknown'), floor_usd: firstNum(raw.floor_usd, 0),
      protocol_count: firstNum(raw.protocol_count, 0) || 0,
      watchlist_size: firstNum(raw.watchlist_size, rows.length) || rows.length,
      board_size: firstNum(raw.board_size, rows.length) || rows.length,
      early_size: firstNum(raw.early_size, 0) || 0,
      live_size: firstNum(raw.live_size, 0) || 0,
      rows: rows, peers: obj(raw.peers) ? raw.peers : null,
      live: (raw.live || []).map(function (r) {
        return { slug: String(r.slug || ''), name: String(r.name || ''), category: r.category || null,
          chains: Array.isArray(r.chains) ? r.chains : [], tvl: firstNum(r.tvl_usd),
          mcap: firstNum(r.mcap_usd), growth: firstNum(r.change_7d) };
      }),
      byCode: (obj(raw.exclusions) && Array.isArray(raw.exclusions.by_code)) ? raw.exclusions.by_code : [],
      excluded_count: (obj(raw.exclusions) && firstNum(raw.exclusions.count)) || 0,
      median: median(rows.map(function (r) { return r.implied; })),
      top10: rows.slice().sort(function (a, b) { return b.implied - a.implied; }).slice(0, 10)
        .reduce(function (s, r) { return s + r.implied; }, 0),
      farm_count: rows.filter(function (r) { return r.verdict === 'farm'; }).length
    };
  }

  // ---------------------------------------------------------------- format

  function usd(n) {
    if (!isFinite(n) || n === null || n === undefined) return 'n/a';
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function compact(n) {
    if (!isFinite(n) || n === null || n === undefined) return 'n/a';
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

  function el(tag, props) {
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

  // A table scrolls sideways and past the fold on a short window. Without its own tab stop a keyboard
  // reader tabs straight past the columns beyond the edge, and an unnamed scroll region gives a screen
  // reader nothing to announce. One helper, so the three tables cannot drift apart.
  function tableWrap(label, table) {
    return el('div', { class: 'table-wrap', role: 'region', tabindex: '0', 'aria-label': label }, table);
  }

  // ---------------------------------------------------------------- routes

  // #/?cat=Lending&tvl=gt1b is a filtered board, #/p/<slug> a protocol, #/method and #/out the reading
  // pages. The address is the whole of the state.
  function parseRoute() {
    var raw = String(location.hash || '').replace(/^#\/?/, '');
    var qi = raw.indexOf('?');
    var parts = (qi >= 0 ? raw.slice(0, qi) : raw).split('/').filter(Boolean);
    var view = parts[0] || 'board';
    if (['board', 'method', 'out', 'p'].indexOf(view) < 0) view = 'board';
    return { view: view, slug: parts[1] ? decodeURIComponent(parts[1]) : null,
      params: new URLSearchParams(qi >= 0 ? raw.slice(qi + 1) : '') };
  }
  function hashOf(view, slug, params) {
    var qs = params ? params.toString() : '';
    var path = view === 'board' ? '/' : '/' + view + (slug ? '/' + encodeURIComponent(slug) : '');
    return '#' + path + (qs ? '?' + qs : '');
  }

  var currentView = null, boardRefs = null;

  // A filter change redraws only the count line and the table, so the control in use keeps its focus and
  // caret; a change of view redraws the page.
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
    rank: function (r) { return r.rank; },
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
  // The support level is 0..1: how much the category's own peers back this multiple. It is not a chance
  // the token launches, and the page never calls it one.
  var SUPPORT = {
    all: function () { return true; },
    high: function (r) { return r.support !== null && r.support >= 0.45; },
    med: function (r) { return r.support !== null && r.support >= 0.2 && r.support < 0.45; },
    low: function (r) { return r.support === null || r.support < 0.2; }
  };
  function supportTone(r) {
    if (r.support === null) return 'thin';
    return r.support >= 0.45 ? 'full' : r.support >= 0.2 ? 'part' : 'thin';
  }

  function filtersOf(p) {
    return {
      q: (p.get('q') || '').trim(), cat: p.get('cat') || 'all', chain: p.get('chain') || 'all',
      tvl: p.get('tvl') || 'all', implied: p.get('implied') || 'all',
      conf: p.get('conf') || 'all', plan: p.get('plan') || 'all',
      sort: SORTS[p.get('sort')] ? p.get('sort') : 'implied',
      dir: p.get('dir') === 'asc' ? 1 : -1
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
    if (f.plan !== 'all') p.set('plan', f.plan);
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
    var supOk = SUPPORT[f.conf] || SUPPORT.all;
    return DATA.rows.filter(function (r) {
      if (!tvlOk(r) || !impOk(r) || !supOk(r)) return false;
      if (f.cat !== 'all' && (r.category || 'Uncategorised') !== f.cat) return false;
      if (f.chain !== 'all' && r.chains.indexOf(f.chain) < 0) return false;
      if (f.plan !== 'all' && r.verdict !== f.plan) return false;
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
    STAMP.textContent = 'snapshot ' + DATA.as_of + ' · ' + MODEL.version + ' · ' + DATA.board_size + ' rows';
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('p', null,
        el('b', { text: String(DATA.board_size) + ' protocols in this snapshot record no token. ' }),
        'They are ranked by what a launch would be worth: TVL × the multiple its category already trades at, damped by growth and by age, with a farm plan for each. Nothing here is a price, and nothing here says a launch is coming.'),
      el('a', { class: 'button', href: '#/method', text: 'Read the method' }));
  }

  function kpis() {
    return el('section', { class: 'kpis', 'aria-label': 'The snapshot at a glance' },
      el('div', { class: 'kpi' }, el('span', { text: 'Watchlist covered' }),
        el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }),
        el('em', { text: 'every protocol the sealed list names' })),
      el('div', { class: 'kpi' }, el('span', { text: 'Rows ranked' }), el('b', { text: String(DATA.board_size) }),
        el('em', { text: DATA.early_size + ' found below the floor' })),
      el('div', { class: 'kpi' }, el('span', { text: 'Top ten, implied' }), el('b', { text: compact(DATA.top10) }),
        el('em', { text: 'what the ten biggest launches could be worth' })),
      el('div', { class: 'kpi' }, el('span', { text: 'Worth farming' }), el('b', { text: String(DATA.farm_count) }),
        el('em', { text: 'rows whose plan clears its own cost' }))
    );
  }

  function selectField(label, name, options, value) {
    var sel = el('select', { id: 'f-' + name, 'aria-label': label },
      options.map(function (o) { return el('option', { value: o[0], text: o[1], selected: o[0] === value ? 'selected' : null }); }));
    sel.addEventListener('change', function () { setFilter(name, sel.value); });
    return el('div', { class: 'field' }, el('label', { for: 'f-' + name, text: label }), sel);
  }

  function filterBar(f) {
    var cats = ['all'].concat(unique(DATA.rows.map(function (r) { return r.category || 'Uncategorised'; })).sort());
    var chains = ['all'].concat(unique(DATA.rows.reduce(function (a, r) { return a.concat(r.chains); }, [])).sort());
    var search = el('input', { type: 'search', id: 'f-q', value: f.q, autocomplete: 'off',
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
    return el('section', { class: 'filters', 'aria-label': 'Filter the board' },
      el('div', { class: 'field' }, el('label', { for: 'f-q', text: 'Search' }), search),
      selectField('Category', 'cat', cats.map(function (c) { return [c, c === 'all' ? 'All categories' : c]; }), f.cat),
      selectField('Chain', 'chain', chains.map(function (c) { return [c, c === 'all' ? 'All chains' : c]; }), f.chain),
      selectField('TVL', 'tvl', [['all', 'Any size'], ['lt100', 'Under $100M'], ['mid', '$100M to $1B'], ['gt1b', '$1B and up']], f.tvl),
      selectField('Implied', 'implied', [['all', 'Any value'], ['lt10', 'Under $10M'], ['mid', '$10M to $100M'], ['gt100', '$100M and up']], f.implied),
      selectField('Confidence', 'conf', [['all', 'Any support'], ['high', '45% and up'], ['med', '20 to 45%'], ['low', 'Under 20%']], f.conf),
      selectField('Plan', 'plan', [['all', 'Any plan'], ['farm', 'Farm it'], ['watch', 'Watch'], ['skip', 'Skip']], f.plan),
      el('a', { class: 'button ghost', href: '#/', text: 'Reset' })
    );
  }

  function resultLine(f, count) {
    var bits = [];
    if (f.q) bits.push('search "' + f.q + '"');
    if (f.cat !== 'all') bits.push(f.cat);
    if (f.chain !== 'all') bits.push('on ' + f.chain);
    if (f.tvl !== 'all') bits.push({ lt100: 'under $100M TVL', mid: '$100M to $1B TVL', gt1b: '$1B and up TVL' }[f.tvl]);
    if (f.implied !== 'all') bits.push({ lt10: 'under $10M implied', mid: '$10M to $100M implied', gt100: '$100M and up implied' }[f.implied]);
    if (f.conf !== 'all') bits.push({ high: 'supported', med: 'medium support', low: 'thin support' }[f.conf]);
    if (f.plan !== 'all') bits.push('plan: ' + f.plan);
    return el('div', { class: 'result-line' },
      el('span', null, el('b', { text: count + ' of ' + DATA.board_size }), ' rows'),
      bits.length ? el('span', { text: '· ' + bits.join(' · ') }) : el('span', { class: 'dim', text: '· no filter, the whole board' }),
      bits.length ? el('a', { class: 'button ghost clear', href: '#/', text: 'Clear filters' }) : null
    );
  }

  function sortHeader(f, key, label, align) {
    var active = f.sort === key;
    return el('th', { scope: 'col', class: align, 'aria-sort': !active ? 'none' : f.dir === 1 ? 'ascending' : 'descending' },
      el('button', { type: 'button', onclick: function () {
        var next = filtersOf(parseRoute().params);
        if (next.sort === key) next.dir = -next.dir;
        else { next.sort = key; next.dir = key === 'name' ? 1 : -1; }
        go('board', null, paramsOf(next));
      } }, label, active ? el('span', { class: 'caret', 'aria-hidden': 'true', text: f.dir === 1 ? '▲' : '▼' }) : null)
    );
  }

  function verdictChip(r) {
    if (!r.verdict) return el('span', { class: 'chip', text: r.known + '/4 inputs' });
    var tone = r.verdict === 'farm' ? 'farm' : r.verdict === 'skip' ? 'skip' : 'watch';
    return el('span', { class: 'chip ' + tone, text: r.verdict });
  }

  function boardTable(f, list) {
    var max = list.reduce(function (m, r) { return Math.max(m, r.implied); }, 1);
    var body = el('tbody');
    list.forEach(function (r) {
      var tr = el('tr', { tabindex: '0', onclick: function (e) { if (e.target.tagName !== 'A') openProtocol(r.slug); } },
        el('td', { class: 'rank' }, el('b', { text: '#' + r.rank })),
        el('td', null, el('div', { class: 'who' },
          el('a', { href: '#/p/' + encodeURIComponent(r.slug), text: r.name }),
          el('span', { text: (r.category || 'Uncategorised') + (r.chains.length ? ' · ' + r.chains.slice(0, 2).join(', ') : '') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') }))),
        el('td', { class: 'r mono', text: compact(r.tvl) }),
        el('td', { class: 'r mono ' + (r.growth === null ? 'dim' : r.growth >= 0 ? 'pos' : 'neg'), text: pct(r.growth) }),
        el('td', { class: 'r mono', text: ageText(r.age) }),
        el('td', { class: 'r' }, el('div', { class: 'implied-cell' },
          el('b', { text: compact(r.implied) }),
          el('span', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(2, Math.round((r.implied / max) * 100)) + '%' })),
          r.tvl ? el('span', { class: 'mult', text: (r.implied / r.tvl).toFixed(2) + '× TVL' }) : null)),
        el('td', { class: 'r' }, verdictChip(r))
      );
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); openProtocol(r.slug); } });
      body.appendChild(tr);
    });
    return tableWrap('Ranked protocols',
      el('table', null,
        el('caption', { text: 'Every protocol that records no token, strongest implied launch value first. Select a row for its model, its inputs and its farm plan.' }),
        el('thead', null, el('tr', null,
          sortHeader(f, 'rank', 'Rank'),
          sortHeader(f, 'name', 'Protocol'),
          sortHeader(f, 'tvl', 'TVL', 'r'),
          sortHeader(f, 'growth', '7-day', 'r'),
          sortHeader(f, 'age', 'Age', 'r'),
          sortHeader(f, 'implied', 'Implied value', 'r'),
          el('th', { scope: 'col', class: 'r', text: 'Plan' })
        )),
        body
      )
    );
  }

  function boardView(route) {
    clear(APP);
    stamp();
    APP.appendChild(lede());
    APP.appendChild(kpis());
    APP.appendChild(filterBar(filtersOf(route.params)));
    var resultHost = el('div'), tableHost = el('div');
    APP.appendChild(resultHost);
    APP.appendChild(tableHost);
    APP.appendChild(el('footer', { class: 'foot' },
      el('span', { text: DATA.protocol_count + ' protocols in the snapshot, ' + DATA.excluded_count + ' set aside, frozen at ' + DATA.as_of + '. Implied value is a model, never a price.' }),
      el('span', { class: 'mono', text: MODEL.version })));
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
      boardRefs.tableHost.appendChild(el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches those filters' }),
        el('p', { class: 'muted', text: 'A narrow combination can empty ' + DATA.board_size + ' rows. Widen the size or value band, or clear the search.' }),
        el('a', { class: 'button', href: '#/', text: 'Clear every filter' })));
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

  // The multipliers the row carries, recomputed only when the data omits them.
  function multipliers(r) {
    var m = MODEL;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, r.growth === null ? 0 : r.growth));
    var growthMult = r.growth_mult !== null ? r.growth_mult : 1 + (growth / 100) * m.growth_weight;
    var ageUsed = r.age === null ? m.unknown_age_days : r.age;
    var maturityMult = r.maturity_mult !== null ? r.maturity_mult :
      m.maturity_floor + (Math.min(Math.max(ageUsed, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    return { growth: growth, growthMult: growthMult, maturityMult: maturityMult };
  }

  function ladder(r) {
    var m = MODEL, k = multipliers(r);
    var mult = r.peer_multiple !== null ? r.peer_multiple : m.base_multiple;
    var base = (r.tvl || 0) * mult;
    return el('div', { class: 'ladder' },
      el('div', { class: 'rung' }, el('span', { text: 'TVL, as the snapshot records it' }), el('b', { text: usd(r.tvl) })),
      el('div', { class: 'rung op' }, el('span', { text: '× ' + mult.toFixed(3) + (r.peer_multiple !== null ? ' category peer multiple' + (r.peer_count ? ' (' + r.peer_count + (r.peer_count === 1 ? ' live peer' : ' live peers') + ')' : '') : ' base multiple') }), el('b', { text: usd(base) })),
      el('div', { class: 'rung op' }, el('span', { text: '× growth ' + k.growthMult.toFixed(3) + ' (7-day ' + pct(r.growth) + ', clamped ' + m.growth_floor + ' to ' + m.growth_cap + ' at ' + m.growth_weight + ' weight)' }), el('b', { text: usd(base * k.growthMult) })),
      el('div', { class: 'rung op' }, el('span', { text: '× maturity ' + k.maturityMult.toFixed(3) + ' (' + ageText(r.age) + ' with no token)' }), el('b', { text: usd(base * k.growthMult * k.maturityMult) })),
      el('div', { class: 'rung total' }, el('span', { text: '= implied launch value, rounded to whole dollars' }), el('b', { text: usd(r.implied) }))
    );
  }

  // The band is the category's own spread when the row carries one: the 25th to 75th percentile multiple
  // applied to the same TVL. Otherwise a sensitivity test at ±20% of the multiple.
  function bandOf(r) {
    if (r.band_low !== null && r.band_high !== null) {
      return { low: r.band_low, high: r.band_high,
        label: 'the category\'s ' + Math.round(MODEL.band_low_quantile * 100) + 'th to ' + Math.round(MODEL.band_high_quantile * 100) + 'th percentile multiple on the same TVL' };
    }
    return { low: Math.round(r.implied * 0.8), high: Math.round(r.implied * 1.2), label: 'the same row at a 20% lower and higher multiple' };
  }

  function band(r) {
    var b = bandOf(r);
    var span = Math.max(b.high, 1);
    var left = Math.max(0, Math.round((b.low / span) * 100));
    var width = Math.min(100 - left, Math.round(((b.high - b.low) / span) * 100));
    var dot = Math.min(98, Math.max(1, Math.round((r.implied / span) * 100)));
    return el('div', { class: 'range' },
      el('div', { class: 'range-track', 'aria-hidden': 'true' },
        el('div', { class: 'range-fill', style: 'left:' + left + '%;width:' + Math.max(2, width) + '%' }),
        el('div', { class: 'range-dot', style: 'left:' + dot + '%' })),
      el('div', { class: 'range-ends' }, el('span', { text: compact(b.low) }), el('span', { text: 'base case' }), el('span', { text: compact(b.high) })),
      el('p', { class: 'muted note', text: 'The band is ' + b.label + '. It is a spread of comparable multiples, not a forecast and not a chance the token launches.' })
    );
  }

  function changeNotes(r) {
    var m = MODEL, k = multipliers(r);
    var clamped = r.growth !== null && (r.growth > m.growth_cap || r.growth < m.growth_floor);
    return el('ul', { class: 'notes' }, [
      'TVL carries the whole base: a 30% fall takes this row to ' + usd(r.implied * 0.7) + ', before anything else moves.',
      r.growth === null
        ? 'The snapshot records no 7-day change, so growth is read as 0 and the row gets no credit for momentum it may have.'
        : clamped
          ? 'The 7-day figure of ' + pct(r.growth) + ' is outside the ' + m.growth_floor + '% to ' + m.growth_cap + '% clamp, so it counts as ' + pct(k.growth) + ': a further spike moves this row no faster than the cap.'
          : 'The 7-day figure of ' + pct(r.growth) + ' sits inside the clamp and enters at ' + m.growth_weight + ' weight, so it is worth ' + ((k.growth / 100) * m.growth_weight).toFixed(3) + ' of multiplier either way.',
      r.age === null
        ? 'No first-listing date is recorded, so maturity uses the ' + m.unknown_age_days + '-day default (' + k.maturityMult.toFixed(3) + '×), a weaker input than a dated row.'
        : 'Maturity tops out at ' + (m.maturity_floor + m.maturity_range).toFixed(1) + '×, so age can add at most ' + (((m.maturity_floor + m.maturity_range) - k.maturityMult) * 100 / k.maturityMult).toFixed(0) + '% more than this row already carries.',
      'No token on record is a fact about the snapshot, not an announcement: nothing in this file says a launch is planned.'
    ].map(function (t) { return el('li', { text: t }); }));
  }

  function farmPanel(r) {
    return el('section', { class: 'card' },
      el('h2', null, 'Farm plan', el('span', { text: r.steps.length + ' steps' })),
      r.verdict_note ? el('p', { class: 'verdict-note', text: r.verdict_note }) : null,
      el('dl', { class: 'inputs' },
        r.capital !== null ? el('dt', { text: 'Capital for one position' }) : null,
        r.capital !== null ? el('dd', { text: usd(r.capital) }) : null,
        r.expected !== null ? el('dt', { text: 'Expected net value' }) : null,
        r.expected !== null ? el('dd', { text: usd(r.expected) + (r.multiple ? ' (' + r.multiple.toFixed(2) + '×)' : '') }) : null,
        r.cost !== null ? el('dt', { text: 'Estimated cost' }) : null,
        r.cost !== null ? el('dd', { text: usd(r.cost) }) : null,
        r.hold !== null ? el('dt', { text: 'Hold' }) : null,
        r.hold !== null ? el('dd', { text: r.hold + ' days' }) : null),
      r.risk ? el('p', { class: 'note' }, el('b', { text: 'Risk: ' }), r.risk) : null,
      r.why_now ? el('p', { class: 'muted note', text: r.why_now }) : null,
      r.steps.length
        ? el('ol', { class: 'steps' }, r.steps.map(function (s) {
            return el('li', null, el('p', { text: s.text }),
              (s.cost || s.time) ? el('div', { class: 'tags' },
                s.cost ? el('span', { class: 'tag', text: 'cost: ' + s.cost }) : null,
                s.time ? el('span', { class: 'tag', text: 'time: ' + s.time }) : null) : null);
          }))
        : el('p', { class: 'muted', text: 'No farm steps were written for this row.' })
    );
  }

  function riskPanel(r) {
    return el('section', { class: 'card' }, el('h2', { text: 'What can go wrong' }),
      el('ul', { class: 'notes' }, [
        'The plan is written from the snapshot only. It cannot see a paused market, a fee switch, a governance vote or a deposit cap: check the protocol\'s own page before you commit.',
        'Points and any future airdrop are never announced in this data. No row here promises a reward, and no claim ever needs a payment.',
        'The capital in the plan is at risk for the whole hold. A depeg, an oracle fault or a bad collateral can lose it, and no yield here is a promise of return.'
      ].map(function (t) { return el('li', { text: t }); })));
  }

  function protocolView(route) {
    var r = route.slug ? findRow(route.slug) : null;
    clear(APP);
    stamp();
    if (!r) {
      APP.appendChild(el('div', { class: 'empty' },
        el('h1', { text: 'No protocol named ' + (route.slug || '') }),
        el('p', { class: 'muted', text: 'The board carries ' + DATA.board_size + ' rows from this snapshot, and that slug is not one of them.' }),
        el('a', { class: 'button', href: '#/', text: 'Back to the board' })));
      return;
    }
    var byRank = DATA.rows.slice().sort(function (a, b) { return a.rank - b.rank; });
    var at = byRank.indexOf(r);
    var prev = at > 0 ? byRank[at - 1] : null;
    var next = at >= 0 && at < byRank.length - 1 ? byRank[at + 1] : null;
    var b = bandOf(r);
    APP.appendChild(el('div', { class: 'pad' },
      el('a', { class: 'back', href: '#/', text: '← The board' }),
      el('div', { class: 'hero' },
        el('div', null,
          el('div', { class: 'eyebrow' },
            el('span', { class: 'chip', text: '#' + r.rank + ' of ' + DATA.board_size }),
            verdictChip(r),
            el('span', { text: r.watchlist ? 'on the watchlist' : 'found below the floor' })),
          el('h1', { text: r.name }),
          el('p', { class: 'where', text: (r.category || 'Uncategorised') + ' on ' + (r.chains.length ? r.chains.join(', ') : 'an unnamed chain') })),
        el('div', { class: 'hero-value' },
          el('span', { text: 'Implied launch value' }),
          el('b', { text: compact(r.implied) }),
          el('em', { text: compact(b.low) + ' to ' + compact(b.high) }))),
      el('div', { class: 'two-col' },
        el('div', null,
          el('section', { class: 'card' },
            el('h2', null, 'How the estimate is built', el('span', { text: 'every input from the snapshot' })),
            ladder(r), band(r),
            r.rationale ? el('p', { class: 'muted note', text: r.rationale }) : null,
            r.reasons.length ? el('ul', { class: 'notes' }, r.reasons.map(function (t) { return el('li', { text: t }); })) : null),
          el('section', { class: 'card' },
            el('h2', { text: 'The inputs' }),
            el('dl', { class: 'inputs' },
              el('dt', { text: 'TVL' }), el('dd', { text: usd(r.tvl) }),
              el('dt', { text: '7-day TVL change' }), el('dd', { class: r.growth === null ? 'dim' : r.growth >= 0 ? 'pos' : 'neg', text: pct(r.growth) }),
              el('dt', { text: 'First listed' }), el('dd', { text: r.listed_at || 'not recorded' }),
              el('dt', { text: 'Age with no token' }), el('dd', { text: ageText(r.age) }),
              el('dt', { text: 'Chains counted' }), el('dd', { text: String(r.chains.length) }),
              el('dt', { text: 'Market cap' }), el('dd', { text: 'none recorded' }),
              el('dt', { text: 'Support for the multiple' }), el('dd', { text: r.support === null ? 'unstated' : Math.round(r.support * 100) + '% ' + (r.support >= 0.45 ? 'high' : r.support >= 0.2 ? 'medium' : 'thin') }),
              el('dt', { text: 'Implied ÷ TVL' }), el('dd', { text: r.tvl ? (r.implied / r.tvl).toFixed(3) + '×' : 'n/a' }))),
          el('section', { class: 'card' }, el('h2', { text: 'What would change this call' }), changeNotes(r))),
        el('div', null,
          farmPanel(r), riskPanel(r),
          el('div', { class: 'pager' },
            prev ? el('a', { href: '#/p/' + encodeURIComponent(prev.slug), text: '← #' + prev.rank + ' ' + prev.name }) : el('span'),
            next ? el('a', { href: '#/p/' + encodeURIComponent(next.slug), text: '#' + next.rank + ' ' + next.name + ' →' }) : el('span')))
      )));
  }

  // ---------------------------------------------------------------- method

  function methodView() {
    var m = MODEL;
    clear(APP);
    stamp();
    APP.appendChild(el('div', { class: 'pad prose' },
      el('a', { class: 'back', href: '#/', text: '← The board' }),
      el('h1', { text: 'The method, in full' }),
      el('p', { text: 'One function scores every row and no protocol name is special-cased, so any row can be recomputed from the figures on its page.' }),
      el('h2', { text: 'The formula' }),
      el('div', { class: 'formula', text: 'base    = tvl_usd × category peer multiple\nimplied = base × (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ')/100 × ' + m.growth_weight + ')\n            × (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ')/' + m.maturity_days + ' × ' + m.maturity_range + ')' }),
      el('p', { text: m.implied || 'TVL times the category peer multiple, damped by growth and by age, rounded to whole dollars.' }),
      el('p', { text: m.confidence_text || 'The band applies the category\'s percentile multiples to the same TVL, so it widens wherever the category disagrees with itself.' }),
      el('p', { text: 'The peer multiple is winsorised to ' + m.multiple_floor + '× to ' + m.multiple_ceiling + '×, so one outlier in a category cannot set the price of every protocol in it.' }),
      el('h2', { text: 'The constants' }),
      el('table', { class: 'constants' },
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Constant' }), el('th', { scope: 'col', text: 'Value' }))),
        el('tbody', null, ['growth_weight', 'growth_floor', 'growth_cap', 'maturity_floor', 'maturity_range', 'maturity_days', 'unknown_age_days', 'band_low_quantile', 'band_high_quantile', 'multiple_floor', 'multiple_ceiling']
          .map(function (k) { return el('tr', null, el('td', { text: k }), el('td', { text: String(m[k]) })); }))),
      el('h2', { text: 'What is on the board, and what is not' }),
      el('ul', { class: 'rules' },
        el('li', null, el('b', { text: 'No token on record. ' }), 'Every protocol the snapshot records with no market cap, no CoinGecko id and no ticker is on the board: all ' + DATA.watchlist_size + ', so the list is covered rather than sampled.'),
        el('li', null, el('b', { text: 'Below the floor too. ' }), 'The house drew its line at ' + compact(DATA.floor_usd) + ' of TVL. The board adds ' + DATA.early_size + ' pre-token protocols under it, because a small protocol waiting on a launch is still a token that does not exist yet.'),
        el('li', null, el('b', { text: 'Nothing that already trades. ' }), 'A live token is not a launch, so the ' + DATA.live_size + ' largest are set aside with their market caps and never ranked here.'),
        el('li', null, el('b', { text: 'No derivative, no pool. ' }), m.exclusions_text || 'Every protocol left out carries the rule that left it out: a token that already trades, a versioned pool, a wrapped or staked asset, a bridge product, or an exchange.')),
      el('h2', { text: 'Reading the board' }),
      el('p', { text: 'Rank is the position by implied value. The bar and the multiple beneath it put that number against TVL, the model\'s own input. The plan chip is the farm verdict: farm where the expected net value clears the cost, watch where it is marginal, skip where the cost is not worth it. Confidence is the support behind the multiple, not a chance the token launches. Every filter is in the address, so a board you narrowed can be bookmarked, reloaded or handed to someone exactly as you see it.' }),
      el('h2', { text: 'The farm plans' }),
      el('p', { text: 'Each row carries its own plan: the action, the capital one position needs, the gas, the hold, the claim check and the log. The plan is frozen into board.json as text with its cost and time, and this page renders exactly those strings, so what you read is what the entry hands in.' }),
      m.assumptions.length ? el('h2', { text: 'What the farm model assumes' }) : null,
      m.assumptions.length ? el('ul', { class: 'rules' }, m.assumptions.map(function (t) { return el('li', { text: t }); })) : null,
      el('h2', { text: 'What this is not' }),
      el('ul', { class: 'rules' },
        el('li', { text: 'Not a price, and not a promise a token is coming: the snapshot carries no announcement, no governance vote and no team intent.' }),
        el('li', { text: 'Not adjusted for unlocks, treasury, revenue or insider allocation, because the snapshot holds none of them. Two rows at one implied value can be very different bets.' }),
        el('li', { text: 'Not live. The snapshot is frozen at ' + DATA.as_of + ' and every run of the program reads the same bytes.' }))
    ));
  }

  // ---------------------------------------------------------------- set aside

  function outView() {
    clear(APP);
    stamp();
    var rows = DATA.live.slice().sort(function (a, b) { return (b.mcap || 0) - (a.mcap || 0); });
    APP.appendChild(el('div', { class: 'pad' },
      el('a', { class: 'back', href: '#/', text: '← The board' }),
      el('h1', { text: 'What the radar sets aside' }),
      el('p', { text: 'A radar is only as good as what it refuses to count. ' + DATA.excluded_count + ' of the snapshot\'s ' + DATA.protocol_count + ' protocols are out of the board, and every one carries the rule that left it out.' })));
    if (DATA.byCode.length) {
      APP.appendChild(tableWrap('The rule that excluded each protocol, and how many it took out',
        el('table', { class: 'constants' },
          el('caption', { text: 'The rule that excluded each protocol, and how many it took out.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Rule' }), el('th', { scope: 'col', class: 'r', text: 'Protocols' }), el('th', { scope: 'col', text: 'What it means' }))),
          el('tbody', null, DATA.byCode.map(function (b) {
            return el('tr', null,
              el('td', { class: 'mono', text: String(b.code || '') }),
              el('td', { class: 'r mono', text: String(b.count || 0) }),
              el('td', { class: 'text', text: String(b.reason || '') }));
          })))));
    }
    APP.appendChild(el('div', { class: 'pad' },
      el('h2', { text: 'Already trading: the ' + rows.length + ' largest' }),
      el('p', { text: 'Their market cap is a fact, not a model. They are here so a reader can see the other side of the line, and so the board\'s omission is visible rather than hidden.' })));
    APP.appendChild(tableWrap('Protocols that already trade, largest market cap first',
      el('table', null,
        el('thead', null, el('tr', null,
          el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', class: 'r', text: 'TVL' }),
          el('th', { scope: 'col', class: 'r', text: '7-day' }), el('th', { scope: 'col', class: 'r', text: 'Market cap' }),
          el('th', { scope: 'col', class: 'r', text: 'Why it is out' }))),
        el('tbody', null, rows.map(function (r) {
          return el('tr', null,
            el('td', null, el('div', { class: 'who' }, el('b', { text: r.name }),
              el('span', { text: (r.category || 'Uncategorised') + (r.chains.length ? ' · ' + r.chains.slice(0, 2).join(', ') : '') }))),
            el('td', { class: 'r mono', text: compact(r.tvl) }),
            el('td', { class: 'r mono ' + (r.growth === null ? 'dim' : r.growth >= 0 ? 'pos' : 'neg'), text: pct(r.growth) }),
            el('td', { class: 'r mono', text: compact(r.mcap) }),
            el('td', { class: 'r' }, el('span', { class: 'chip', text: 'token trades' })));
        })))));
  }

  // ---------------------------------------------------------------- render

  function markNav(view) {
    var links = document.querySelectorAll('[data-nav]');
    for (var i = 0; i < links.length; i++) {
      var on = (view === 'p' && links[i].getAttribute('data-nav') === 'board') || links[i].getAttribute('data-nav') === view;
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
      APP.appendChild(el('div', { class: 'empty' },
        el('h1', { text: 'No data file' }),
        el('p', { class: 'muted', text: 'This page reads data.js, which the program writes when it runs. Run main.ts, then open the dashboard in its output folder again.' })));
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
