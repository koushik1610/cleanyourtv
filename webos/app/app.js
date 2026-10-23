/*
 * tvOS style home for webOS: black, a pinned dock row, an app grid, and one glass highlight that
 * springs between tiles. A port of the Android launcher in ../../launcher.
 *
 * webOS does not let third-party apps list installed apps, so sync-apps.py writes them into apps.js.
 */
(function () {
  'use strict';

  var COLUMNS = Math.max(1, CONFIG.columns || 4);
  var CELL_W = (1920 - 2 * 112) / COLUMNS;
  // Tiles shrink to fit the column count; 4 columns gives the original 360x202.
  var TILE_W = Math.min(360, Math.floor(CELL_W - 36));
  var TILE_H = Math.round(TILE_W * 202 / 360);
  var TILE_SCALE = TILE_W / 360;
  var ROW_PITCH = TILE_H + 90;  // room for the name under the tile
  var DOCK_TOP = 708;           // tile top of the dock row: next row peeks in at the bottom
  var DOCK_GAP = 64;            // space between the dock and the first category title
  var SECTION_H = 64;           // a category title above its first row
  var FOCUS_SCALE = 1.1;
  var GLASS_PAD = 12;           // room for the glass glow around the scaled tile
  var GLASS_FILL = 'rgba(255,255,255,0.12)';   // frosted tile behind neutral system glyphs
  var VIEW_TOP = 80, VIEW_BOTTOM = 1060;    // area grid rows scroll into (the header hides below the dock)

  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 461, ESC: 27 };

  var GREETINGS = [[5, 'Good night'], [12, 'Good morning'], [17, 'Good afternoon'], [22, 'Good evening'], [24, 'Good night']];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
    'October', 'November', 'December'];

  var ICON_INPUT = 'M18,7V4c0,-1.1 -0.9,-2 -2,-2H8C6.9,2 6,2.9 6,4v3H5v6l3,6v3h8v-3l3,-6V7H18zM8,4h8v3h-2V5h-1v2h-2V5h-1v2H8V4z';
  var ICON_LIVETV = 'M21,6h-7.59l3.29,-3.29L16,2l-4,4l-4,-4l-0.71,0.71L10.59,6H3c-1.1,0 -2,0.89 -2,2v12c0,1.1 0.9,2 2,2h18c1.1,0 2,-0.89 2,-2V8C23,6.89 22.1,6 21,6zM21,20H3V8h18V20zM9,10v8l7,-4L9,10z';

  var $ = function (id) { return document.getElementById(id); };
  var stage = $('stage'), tilesEl = $('tiles'), glass = $('glass'), hero = $('hero');
  var ambients = [$('ambientA'), $('ambientB')], ambientFront = 0, ambientColor = null;
  var pills = [$('btnInputs'), $('btnWifi'), $('btnSettings')];
  var panel = $('inputsPanel');

  var groups = [];              // [{title, items}]: groups[0] is the dock, then the categories
  var items = [];               // every tile in screen order: {app, el, card, color, group}
  var slots = [], rows = [];    // per tile {row, col, top, reveal}; per row the tile indices
  var zone = 'grid';            // 'grid' | 'top' | 'inputs'
  var focused = 0, pillFocus = 0, inputFocus = 0, inputRows = [];
  var offset = 0, heroShown = false, glassShown = false;
  var editing = null;           // {item, snapshot} while a tile is being moved

  // ---- luna bus ------------------------------------------------------------------------------

  var bridges = [];   // keep a reference: a collected bridge drops its callback

  function luna(uri, params, cb) {
    try {
      var b = new PalmServiceBridge();
      b.onservicecallback = function (msg) {
        var res;
        try { res = JSON.parse(msg); } catch (e) { res = { returnValue: false }; }
        if (cb) cb(res);
        if (!params || !params.subscribe) bridges.splice(bridges.indexOf(b), 1);
      };
      bridges.push(b);
      b.call(uri, JSON.stringify(params || {}));
    } catch (e) {
      if (cb) cb({ returnValue: false, errorText: String(e) });   // not on a TV (desktop preview)
    }
  }

  function launch(id, title, params) {
    luna('luna://com.webos.applicationManager/launch', { id: id, params: params || {} }, function (res) {
      if (res.returnValue === false) toast("Can't open " + (title || id));
    });
  }

  var toastTimer;
  function toast(text) {
    var t = $('toast');
    t.textContent = text;
    t.classList.add('shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('shown'); }, 2200);
  }

  // ---- apps ----------------------------------------------------------------------------------

  /** Dock, the categories in config.js, then "More" for apps no category names. */
  function groupedApps() {
    var all = (window.TV_APPS && TV_APPS.apps) || [];
    var byId = {};
    all.forEach(function (a) { byId[a.id] = a; });
    var taken = {};
    (CONFIG.hiddenApps || []).forEach(function (id) { taken[id] = true; });
    var byTitle = function (a, b) { return a.title.toLowerCase() < b.title.toLowerCase() ? -1 : 1; };
    var take = function (ids) {
      var out = [];
      ids.forEach(function (id) {
        if (byId[id] && !taken[id]) { out.push(byId[id]); taken[id] = true; }
      });
      return out;
    };

    var defs = [{ title: '', apps: (CONFIG.dockApps || []).slice(0, COLUMNS) }]
      .concat(CONFIG.categories || [], [{ title: 'More', apps: [] }]);
    // An arrangement made on the TV wins, until the dock or categories in config.js change.
    // All saved positions go first, so an app moved to another group stays there.
    var saved = loadOrder() || {};
    var result = defs.map(function (d) { return { title: d.title, apps: take(saved[d.title] || []) }; });
    defs.forEach(function (d, k) { result[k].apps = result[k].apps.concat(take(d.apps || [])); });
    var more = result[result.length - 1].apps;
    more.push.apply(more, result[0].apps.splice(COLUMNS));
    more.push.apply(more, all.filter(function (a) { return !taken[a.id]; }).sort(byTitle));
    return result;
  }

  var ORDER_KEY = 'tvhome.groups';

  function configKey() { return JSON.stringify([CONFIG.dockApps || [], CONFIG.categories || []]); }

  function loadOrder() {
    try {
      var s = JSON.parse(localStorage.getItem(ORDER_KEY));
      return s && s.config === configKey() ? s.groups : null;
    } catch (e) {
      return null;
    }
  }

  function saveOrder() {
    var ids = {};
    groups.forEach(function (g) { ids[g.title] = g.items.map(function (it) { return it.app.id; }); });
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify({ config: configKey(), groups: ids }));
    } catch (e) { /* storage unavailable: the order lasts until the app restarts */ }
  }

  function tileLeft(col) { return 112 + col * CELL_W + (CELL_W - TILE_W) / 2; }

  function build() {
    var root = document.documentElement.style;
    root.setProperty('--tile-w', TILE_W + 'px');
    root.setProperty('--tile-h', TILE_H + 'px');
    root.setProperty('--tile-scale', TILE_SCALE);
    document.body.classList.toggle('dock-glass', CONFIG.dockGlass !== false);
    tilesEl.innerHTML = '';
    groups = groupedApps().map(function (g) { return { title: g.title, items: g.apps.map(makeItem) }; });
    layout();
  }

  function makeItem(app) {
    var el = document.createElement('div');
    el.className = 'item';
    var card = document.createElement('div');
    card.className = 'card';
    var img = document.createElement('img');
    var item = { app: app, el: el, card: card, color: null, group: null };
    img.onload = function () { paintTile(item, img); };
    img.src = app.icon;
    card.appendChild(img);
    el.appendChild(card);
    var name = document.createElement('div');
    name.className = 'name';
    name.textContent = app.title;
    el.appendChild(name);
    el.addEventListener('mouseover', function () {
      if (zone !== 'inputs' && !editing) focusTile(items.indexOf(item));
    });
    el.addEventListener('click', function () {
      if (editing) finishEdit(true);
      else launch(app.id, app.title);
    });
    tilesEl.appendChild(el);
    return item;
  }

  /**
   * Places every tile from the groups: the dock row, then each category under its title, every
   * category starting on a new row. Tiles glide when the order changes.
   */
  function layout() {
    items = [];
    slots = [];
    rows = [];
    Array.prototype.slice.call(tilesEl.querySelectorAll('.section')).forEach(function (h) { h.remove(); });
    var y = DOCK_TOP;
    groups.forEach(function (g, gi) {
      if (!g.items.length) return;
      var reveal = y;   // scrolling to a group's first row brings its title into view too
      if (gi > 0) {
        var h = document.createElement('div');
        h.className = 'section';
        h.textContent = g.title;
        h.style.left = tileLeft(0) + 'px';
        h.style.top = y + 'px';
        tilesEl.appendChild(h);
        y += SECTION_H;
      }
      g.items.forEach(function (it, k) {
        var col = k % COLUMNS;
        if (!col) {
          if (k) y += ROW_PITCH;
          rows.push([]);
        }
        rows[rows.length - 1].push(items.length);
        slots.push({ row: rows.length - 1, col: col, top: y, reveal: k < COLUMNS ? reveal : y });
        items.push(it);
        it.group = g;
        it.el.style.left = tileLeft(col) + 'px';
        it.el.style.top = y + 'px';
        it.el.classList.toggle('dock', gi === 0);   // the dock has no labels: the top shelf names it
      });
      y += gi === 0 ? TILE_H + DOCK_GAP : ROW_PITCH;
    });
  }

  function animateIn() {
    items.forEach(function (it, i) {
      it.el.classList.remove('shown');
      setTimeout(function () { it.el.classList.add('shown'); }, 60 + Math.min(i, 16) * 40);
    });
  }

  /**
   * Store icons are square logos on a solid colour: fill the wide tile with that colour so the logo
   * reads as a banner. LG's system icons are glyphs on transparent: use the app's own colour.
   */
  function paintTile(item, img) {
    var px = null, edge = null;
    try {
      var c = document.createElement('canvas');
      c.width = 12; c.height = 12;
      var g = c.getContext('2d');
      g.drawImage(img, 0, 0, 12, 12);
      px = g.getImageData(0, 0, 12, 12).data;
      edge = edgeColor(img);
    } catch (e) { /* tainted canvas: fall back to the app's colour */ }

    var glyphColor = null;
    if (edge && edge[3] > 200) {
      item.card.style.background = 'rgb(' + edge[0] + ',' + edge[1] + ',' + edge[2] + ')';
    } else {
      item.card.classList.add('glyph');
      item.card.style.background = glyphBackground(item.app.iconColor);
      glyphColor = glyphBackground(item.app.iconColor) === GLASS_FILL ? null : parseColor(item.app.iconColor);
    }
    // A white glyph says nothing about the app: glow in the tile's colour instead.
    item.color = glyphColor || (px ? vividColor(px) : parseColor(item.app.iconColor));
    if (items[focused] === item) setAmbient(item.color);
  }

  /**
   * The icon's background at full size: a corner pixel, or the middle of the left edge for rounded
   * icons whose corners are transparent. A downscaled sample would blend in the logo.
   */
  function edgeColor(img) {
    var w = img.naturalWidth, h = img.naturalHeight;
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    var corner = g.getImageData(2, 2, 1, 1).data;
    return corner[3] > 200 ? corner : g.getImageData(2, Math.floor(h / 2), 1, 1).data;
  }

  function glyphBackground(hex) {
    var c = parseColor(hex);
    if (!c) return GLASS_FILL;
    var hsv = rgbToHsv(c);
    if (hsv[1] < 0.15 && (hsv[2] > 0.85 || hsv[2] < 0.1)) return GLASS_FILL;   // white or black glyph colour
    return 'rgb(' + c.join(',') + ')';
  }

  /** A vivid colour from the icon: the most saturated, not too dark pixel, or the lifted average. */
  function vividColor(px) {
    var best = null, bestScore = -1, sum = [0, 0, 0], n = 0;
    for (var i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 128) continue;
      var p = [px[i], px[i + 1], px[i + 2]];
      sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; n++;
      var hsv = rgbToHsv(p);
      var score = hsv[1] * Math.min(1, hsv[2] * 1.4);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    if (!n) return [68, 68, 68];
    if (bestScore < 0.25) {   // nearly monochrome icon (e.g. white): its average, lifted
      var avg = rgbToHsv([sum[0] / n, sum[1] / n, sum[2] / n]);
      avg[2] = Math.max(avg[2], 0.55);
      return hsvToRgb(avg);
    }
    var h = rgbToHsv(best);
    h[1] = Math.min(1, h[1] * 1.1);
    h[2] = Math.max(0.5, h[2]);
    return hsvToRgb(h);
  }

  function parseColor(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    var v = parseInt(m[1], 16);
    return [v >> 16 & 255, v >> 8 & 255, v & 255];
  }

  function rgbToHsv(c) {
    var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return [h, max ? d / max : 0, max];
  }

  function hsvToRgb(hsv) {
    var h = hsv[0], s = hsv[1], v = hsv[2];
    var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, rgb;
    if (h < 60) rgb = [c, x, 0];
    else if (h < 120) rgb = [x, c, 0];
    else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c];
    else if (h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return rgb.map(function (k) { return Math.round((k + m) * 255); });
  }

  // ---- focus & glass -------------------------------------------------------------------------

  function focusTile(i) {
    if (!items.length) return;
    i = Math.max(0, Math.min(i, items.length - 1));
    setZone('grid');
    if (items[focused]) items[focused].el.classList.remove('focused');
    focused = i;
    items[i].el.classList.add('focused');

    var top = slots[i].top, row = slots[i].row, inDock = items[i].group === groups[0];
    if (row === 0) {
      offset = 0;
    } else {
      // Scroll just enough so the whole glass, the name below the tile and the category title show.
      if (top - offset + TILE_H + 70 > VIEW_BOTTOM) offset = top + TILE_H + 70 - VIEW_BOTTOM;
      if (slots[i].reveal - offset - 24 < VIEW_TOP) offset = slots[i].reveal - 24 - VIEW_TOP;
    }
    stage.style.transform = 'translateY(' + (-offset) + 'px)';
    // Keep the header until the content (the dock band is topmost) would run into it.
    var header = document.querySelector('header');
    var headerBottom = header.offsetTop + header.offsetHeight;   // layout box: ignores the hide slide
    document.body.classList.toggle('scrolled', DOCK_TOP - 28 - offset < headerBottom + 24);

    var w = TILE_W * FOCUS_SCALE + 2 * GLASS_PAD, h = TILE_H * FOCUS_SCALE + 2 * GLASS_PAD;
    var x = tileLeft(slots[i].col) + TILE_W / 2 - w / 2, y = top + TILE_H / 2 - h / 2;
    glass.style.width = w + 'px';
    glass.style.height = h + 'px';
    glass.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    if (!glassShown) {
      // First show: jump there without the spring, then fade in.
      glass.style.transition = 'none';
      glass.offsetWidth;   // flush the jump before restoring the transition
      glass.style.transition = '';
      glass.style.opacity = '1';
      glassShown = true;
    }

    if (inDock) showHero(items[i]);
    else hideHero();
    setAmbient(items[i].color);   // the glow follows the focused tile in every row
  }

  function hideGlass() {
    glassShown = false;
    glass.style.opacity = '0';
  }

  function showHero(item) {
    var label = item.app.title;
    hero.style.top = (DOCK_TOP - 28 - 52 - 96) + 'px';
    if (!heroShown) {
      hero.textContent = label;
      hero.style.transform = 'none';
      hero.style.opacity = '1';
      heroShown = true;
    } else if (hero.textContent !== label) {
      hero.style.opacity = '0';
      hero.style.transform = 'translateX(-24px)';
      clearTimeout(hero.swap);
      hero.swap = setTimeout(function () {
        hero.textContent = label;
        hero.style.transition = 'none';
        hero.style.transform = 'translateX(24px)';
        hero.offsetWidth;
        hero.style.transition = '';
        hero.style.transform = 'none';
        hero.style.opacity = '1';
      }, 120);
    } else {
      // Back on the shown name before a pending swap ran: cancel it.
      clearTimeout(hero.swap);
      hero.style.transform = 'none';
      hero.style.opacity = '1';
    }
    setAmbient(item.color);
  }

  function hideHero() {
    clearTimeout(hero.swap);   // a swap still pending would bring the name back
    if (!heroShown) return;
    heroShown = false;
    hero.style.opacity = '0';
  }

  /** Crossfades the glow to a new colour by swapping between two layers. */
  function setAmbient(color) {
    if (!color) return;
    var key = color.join(',');
    if (key === ambientColor) return;
    ambientColor = key;
    var back = ambients[1 - ambientFront];
    back.style.background = 'radial-gradient(circle 1190px at 32% 42%, rgba(' + key + ',0.36) 0%, rgba(' +
      key + ',0.15) 50%, rgba(' + key + ',0) 100%)';
    back.style.opacity = '1';
    ambients[ambientFront].style.opacity = '0';
    ambientFront = 1 - ambientFront;
  }

  function focusPill(i) {
    setZone('top');
    document.body.classList.remove('scrolled');
    pills[pillFocus].classList.remove('focused');
    pillFocus = Math.max(0, Math.min(i, pills.length - 1));
    pills[pillFocus].classList.add('focused');
  }

  function setZone(z) {
    if (zone === z) return;
    if (zone === 'top') pills[pillFocus].classList.remove('focused');
    if (zone === 'grid') {
      if (items[focused]) items[focused].el.classList.remove('focused');
      hideGlass();
    }
    zone = z;
  }

  /** The pill straight above a dock tile, by horizontal distance. */
  function pillAbove(i) {
    var cx = tileLeft(slots[i].col) + TILE_W / 2, best = 0, bestD = Infinity;
    pills.forEach(function (p, k) {
      var r = p.getBoundingClientRect();
      var d = Math.abs(r.left + r.width / 2 - cx);
      if (d < bestD) { bestD = d; best = k; }
    });
    return best;
  }

  /** The tile in a row closest to a column: rows at the end of a category can be short. */
  function nearestIn(r, col) { return rows[r][Math.min(col, rows[r].length - 1)]; }

  // ---- top bar -------------------------------------------------------------------------------

  function updateClock() {
    var now = new Date(), h = now.getHours();
    for (var k = 0; k < GREETINGS.length; k++) {
      if (h < GREETINGS[k][0]) { $('greeting').textContent = GREETINGS[k][1]; break; }
    }
    var m = now.getMinutes();
    $('clock').textContent = ((h % 12) || 12) + ':' + (m < 10 ? '0' : '') + m;
    $('ampm').textContent = h < 12 ? 'am' : 'pm';
    $('date').textContent = DAYS[now.getDay()] + '  ' + now.getDate() + ' ' + MONTHS[now.getMonth()];
  }

  /** Shows the Wi-Fi network name when the TV reports it, otherwise the connection type. */
  function watchNetwork() {
    luna('luna://com.palm.connectionmanager/getStatus', { subscribe: true }, function (res) {
      if (res.returnValue === false && !res.wifi && !res.wired) return;
      var text = 'Wi-Fi';
      if (res.wired && res.wired.state === 'connected') text = 'Ethernet';
      else if (res.wifi && res.wifi.state === 'connected') text = res.wifi.ssid || 'Wi-Fi';
      else if (res.isInternetConnectionAvailable === false) text = 'Offline';
      $('wifiLabel').textContent = text;
    });
  }

  function activatePill(i) {
    if (i === 0) showInputs();
    else if (i === 1) launch('com.palm.app.settings', 'Settings', { target: 'network' });
    else launch('com.palm.app.settings', 'Settings');
  }

  // ---- inputs dropdown -----------------------------------------------------------------------

  function showInputs() {
    panel.innerHTML = '';
    inputRows = [];
    var inputs = (window.TV_APPS && TV_APPS.inputs) || [];
    inputs.forEach(function (inp) { addInputRow(ICON_INPUT, inp.label, inp.appId); });
    if (CONFIG.liveTvApp) {
      if (inputRows.length) panel.appendChild(Object.assign(document.createElement('div'), { className: 'separator' }));
      addInputRow(ICON_LIVETV, 'Live TV', CONFIG.liveTvApp);
    }
    if (!inputRows.length) { toast('No inputs found'); return; }

    // Hang right below the Inputs pill, at least as wide as it.
    var r = pills[0].getBoundingClientRect();
    panel.style.left = r.left + 'px';
    panel.style.top = (r.bottom + 20) + 'px';
    panel.style.minWidth = Math.max(r.width, 300) + 'px';
    panel.classList.remove('hidden');
    pills[pillFocus].classList.remove('focused');
    zone = 'inputs';
    focusInput(0);
  }

  function addInputRow(icon, label, appId) {
    var row = document.createElement('div');
    row.className = 'inputRow';
    row.innerHTML = '<svg viewBox="0 0 24 24"><path d="' + icon + '"/></svg>';
    row.appendChild(document.createTextNode(label));
    var idx = inputRows.length;
    row.addEventListener('mouseover', function () { focusInput(idx); });
    row.addEventListener('click', function () { hideInputs(); launch(appId, label); });
    row.appId = appId;
    row.label = label;
    inputRows.push(row);
    panel.appendChild(row);
  }

  function focusInput(i) {
    if (inputRows[inputFocus]) inputRows[inputFocus].classList.remove('focused');
    inputFocus = Math.max(0, Math.min(i, inputRows.length - 1));
    inputRows[inputFocus].classList.add('focused');
  }

  function hideInputs() {
    panel.classList.add('hidden');
    zone = 'none';
    focusPill(0);
  }

  // ---- rearranging ---------------------------------------------------------------------------

  /** Hold OK on a tile: it wiggles, the arrows move it, OK places it, Back puts everything back. */
  function startEdit() {
    var it = items[focused];
    if (!it) return;
    editing = {
      item: it,
      snapshot: groups.map(function (g) { return { title: g.title, items: g.items.slice() }; })
    };
    it.el.classList.add('moving');
    document.body.classList.add('editing');
    toast('Arrows to move  ·  OK to place  ·  Back to cancel');
  }

  /** Sideways within the tile's group; up or down into the row above or below, joining its group. */
  function moveBy(dx, dy) {
    var it = items[focused], s = slots[focused], g = it.group, pos = g.items.indexOf(it);
    if (dx) {
      var to = pos + dx;
      if (s.col + dx < 0 || s.col + dx >= COLUMNS || to < 0 || to >= g.items.length) return;
      g.items.splice(to, 0, g.items.splice(pos, 1)[0]);
    } else {
      var r = s.row + dy;
      if (r < 0 || r >= rows.length) return;
      var first = items[rows[r][0]], target = first.group;
      if (target === g) {
        g.items.splice(Math.max(0, Math.min(pos + dy * COLUMNS, g.items.length - 1)), 0, g.items.splice(pos, 1)[0]);
      } else {
        var at = target.items.indexOf(first) + Math.min(s.col, rows[r].length);
        g.items.splice(pos, 1);
        if (target === groups[0] && target.items.length >= COLUMNS) {
          // Full dock: the tile it lands on takes its old place.
          g.items.splice(pos, 0, target.items.splice(Math.min(at, COLUMNS - 1), 1, it)[0]);
        } else {
          target.items.splice(at, 0, it);
        }
      }
    }
    layout();
    focusTile(items.indexOf(it));
  }

  function finishEdit(keep) {
    var it = editing.item;
    if (!keep) {
      groups = editing.snapshot;
      layout();
    }
    editing = null;
    it.el.classList.remove('moving');
    document.body.classList.remove('editing');
    if (keep) saveOrder();
    focused = items.indexOf(it);
    focusTile(focused);
  }

  // ---- keys ----------------------------------------------------------------------------------

  var LONG_PRESS_MS = 600;
  var okDown = false, okTimer = null;

  // On tiles OK acts on release, so a held OK can start rearranging instead of opening the app.
  document.addEventListener('keyup', function (e) {
    if (e.keyCode !== KEY.OK) return;
    okDown = false;
    if (!okTimer) return;
    clearTimeout(okTimer);
    okTimer = null;
    var it = items[focused];
    if (zone === 'grid' && it && !editing) launch(it.app.id, it.app.title);
  });

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    if (k === KEY.OK && okDown) { e.preventDefault(); return; }   // key repeat while held
    if (k === KEY.OK) okDown = true;
    if (editing) {
      if (k === KEY.LEFT) moveBy(-1, 0);
      else if (k === KEY.RIGHT) moveBy(1, 0);
      else if (k === KEY.UP) moveBy(0, -1);
      else if (k === KEY.DOWN) moveBy(0, 1);
      else if (k === KEY.OK) finishEdit(true);
      else if (k === KEY.BACK || k === KEY.ESC) finishEdit(false);
      else return;
    } else if (zone === 'inputs') {
      if (k === KEY.UP) focusInput(inputFocus - 1);
      else if (k === KEY.DOWN) focusInput(inputFocus + 1);
      else if (k === KEY.OK) { var row = inputRows[inputFocus]; hideInputs(); launch(row.appId, row.label); }
      else if (k === KEY.BACK || k === KEY.ESC || k === KEY.LEFT || k === KEY.RIGHT) hideInputs();
      else return;
    } else if (zone === 'top') {
      if (k === KEY.LEFT) focusPill(pillFocus - 1);
      else if (k === KEY.RIGHT) focusPill(pillFocus + 1);
      else if (k === KEY.DOWN) focusTile(slots[focused] && slots[focused].row === 0 ? focused : 0);
      else if (k === KEY.OK) activatePill(pillFocus);
      else if (k === KEY.BACK) { /* home screen: Back goes nowhere */ }
      else return;
    } else {
      var s = slots[focused];
      if (!s) return;
      if (k === KEY.LEFT) { if (s.col > 0) focusTile(focused - 1); }
      else if (k === KEY.RIGHT) { if (s.col < rows[s.row].length - 1) focusTile(focused + 1); }
      else if (k === KEY.UP) {
        if (s.row === 0) focusPill(pillAbove(focused));
        else focusTile(nearestIn(s.row - 1, s.col));
      } else if (k === KEY.DOWN) {
        if (s.row < rows.length - 1) focusTile(nearestIn(s.row + 1, s.col));
      } else if (k === KEY.OK) {
        okTimer = setTimeout(function () { okTimer = null; startEdit(); }, LONG_PRESS_MS);
      } else if (k === KEY.BACK) { /* home screen: Back goes nowhere */ }
      else return;
    }
    e.preventDefault();
  });

  pills.forEach(function (p, i) {
    p.addEventListener('mouseover', function () { if (zone !== 'inputs') focusPill(i); });
    p.addEventListener('click', function () { activatePill(i); });
  });

  // ---- lifecycle -----------------------------------------------------------------------------

  /** Back from another app (or opened again from the shortcut): replay the entrance, keep the tile. */
  function resume() {
    if (editing) finishEdit(false);
    updateClock();
    if (zone === 'inputs') panel.classList.add('hidden');
    pills.forEach(function (p) { p.classList.remove('focused'); });
    zone = 'none';
    animateIn();
    focusTile(focused);
  }

  document.addEventListener('webOSRelaunch', resume);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) resume(); });

  build();
  updateClock();
  setInterval(updateClock, 10000);
  watchNetwork();
  animateIn();
  zone = 'none';
  focusTile(0);
})();
