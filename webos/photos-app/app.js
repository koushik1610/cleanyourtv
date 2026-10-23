/*
 * Photos for the TV: the Apple Photos Favorites album, synced by sync-photos.py.
 * Two modes: All Photos (a thumbnail grid) and Slideshow (shuffled; each photo for a few seconds,
 * each video played to the end, a random transition between them).
 */
(function () {
  'use strict';

  var COLUMNS = 6, TILE = 258;
  var CELL = (1920 - 2 * 112) / COLUMNS;
  var GRID_TOP = 260, ROW_PITCH = TILE + 32;
  var VIEW_TOP = 60, VIEW_BOTTOM = 1040;
  var PHOTO_MS = 4000;          // how long a photo stays once its transition is done
  var TRANSITION_MS = 900;
  var HINT_MS = 2500;

  // Only opacity and transform, which the TV's GPU animates without repainting.
  var EASE = 'cubic-bezier(0.3, 0.8, 0.3, 1)';
  var SLIDE_LEFT = {
    in: [{ transform: 'translateX(100%)' }, { transform: 'none' }],
    out: [{ transform: 'none' }, { transform: 'translateX(-100%)' }]
  };
  var SLIDE_RIGHT = {
    in: [{ transform: 'translateX(-100%)' }, { transform: 'none' }],
    out: [{ transform: 'none' }, { transform: 'translateX(100%)' }]
  };
  var FADE = { in: [{ opacity: 0 }, { opacity: 1 }], out: [{ opacity: 1 }, { opacity: 0 }] };
  var TRANSITIONS = [
    FADE, SLIDE_LEFT, SLIDE_RIGHT,
    { in: [{ transform: 'translateY(100%)' }, { transform: 'none' }],
      out: [{ transform: 'none' }, { transform: 'translateY(-100%)' }] },
    { in: [{ transform: 'translateY(-100%)' }, { transform: 'none' }],
      out: [{ transform: 'none' }, { transform: 'translateY(100%)' }] },
    { in: [{ opacity: 0, transform: 'scale(1.25)' }, { opacity: 1, transform: 'none' }],   // zoom in
      out: [{ opacity: 1 }, { opacity: 0 }] },
    { in: [{ opacity: 0, transform: 'scale(0.8)' }, { opacity: 1, transform: 'none' }],    // zoom out
      out: [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(1.15)' }] }
  ];

  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 461, ESC: 27, PLAY: 415, PAUSE: 19 };

  var $ = function (id) { return document.getElementById(id); };
  var photos = window.TV_PHOTOS || [];   // "UUID.jpg" a photo, "UUID.mp4" a video shown on UUID.jpg
  var tiles = [];
  var mode = 'grid';            // 'grid' | 'viewer'
  var focused = -1;             // -1: the Slideshow pill
  var order = [], pos = 0;      // viewer: photo indices in viewing order, and where we are in it
  var playing = false, slideTimer = null, hintTimer = null;
  var layers = [$('layerA'), $('layerB')], front = 0, loading = 0;

  function isVideo(name) { return /\.mp4$/.test(name); }
  function still(name) { return name.replace(/\.mp4$/, '.jpg'); }

  // ---- grid ----------------------------------------------------------------------------------

  function build() {
    var videos = photos.filter(isVideo).length, pics = photos.length - videos;
    $('count').textContent = pics + (pics === 1 ? ' photo' : ' photos') +
      (videos ? '  ·  ' + videos + (videos === 1 ? ' video' : ' videos') : '');
    $('empty').classList.toggle('hidden', photos.length > 0);
    photos.forEach(function (name, i) {
      var el = document.createElement('div');
      el.className = 'thumb';
      el.style.left = (112 + (i % COLUMNS) * CELL + (CELL - TILE) / 2) + 'px';
      el.style.top = (GRID_TOP + Math.floor(i / COLUMNS) * ROW_PITCH) + 'px';
      var img = document.createElement('img');
      img.decoding = 'async';
      img.src = 'thumbs/' + still(name);
      el.appendChild(img);
      if (isVideo(name)) {
        el.insertAdjacentHTML('beforeend', '<svg class="badge" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>');
      }
      el.addEventListener('mouseover', function () { if (mode === 'grid') focusTile(i); });
      el.addEventListener('click', function () { openViewer(i, false); });
      $('wall').appendChild(el);
      tiles.push(el);
    });
  }

  function focusTile(i) {
    $('btnSlideshow').classList.toggle('focused', i < 0);
    if (tiles[focused]) tiles[focused].classList.remove('focused');
    focused = Math.max(-1, Math.min(i, tiles.length - 1));
    if (focused < 0) {
      $('wall').style.transform = 'none';
      $('wall').dataset.offset = 0;
      document.body.classList.remove('scrolled');
      return;
    }
    tiles[focused].classList.add('focused');
    // Scroll just enough to keep the focused row on screen.
    var top = GRID_TOP + Math.floor(focused / COLUMNS) * ROW_PITCH;
    var offset = parseFloat($('wall').dataset.offset || 0);
    if (top - offset + TILE + 40 > VIEW_BOTTOM) offset = top + TILE + 40 - VIEW_BOTTOM;
    if (top - offset - 40 < VIEW_TOP) offset = Math.max(0, top - 40 - VIEW_TOP);
    if (top < VIEW_BOTTOM - TILE - 40) offset = 0;   // first screenful: keep the title visible
    $('wall').dataset.offset = offset;
    $('wall').style.transform = 'translateY(' + (-offset) + 'px)';
    document.body.classList.toggle('scrolled', offset > 0);
  }

  // ---- viewer --------------------------------------------------------------------------------

  /** From a tile: the album in order, starting there. Slideshow: everything, shuffled. */
  function openViewer(start, shuffle) {
    if (!photos.length) return;
    order = photos.map(function (_, i) { return i; });
    if (shuffle) {
      for (var i = order.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1)), t = order[i];
        order[i] = order[j];
        order[j] = t;
      }
      pos = 0;
    } else {
      pos = start;
    }
    mode = 'viewer';
    $('viewer').classList.remove('hidden');
    playing = shuffle;
    show(pos, FADE);
    hintPlaying();
  }

  function closeViewer() {
    playing = false;
    clearTimeout(slideTimer);
    loading++;   // drop a photo still loading
    mode = 'grid';
    $('viewer').classList.add('hidden');
    layers.forEach(clear);   // frees the bitmaps and the video decoder
    focusTile(order[pos]);
  }

  /** Loads the slide (decoded off screen, so it never shows half drawn), then transitions to it. */
  function show(p, effect) {
    pos = (p + order.length) % order.length;
    clearTimeout(slideTimer);
    var name = photos[order[pos]], ticket = ++loading;
    var img = new Image();
    img.onload = function () {
      if (ticket !== loading || mode !== 'viewer') return;
      var incoming = layers[1 - front], outgoing = layers[front];
      freeze(outgoing);   // its video stops before the next one starts: the TV may have one decoder
      clear(incoming);
      incoming.style.backgroundImage = 'url("photos/' + still(name) + '")';
      if (isVideo(name)) playVideo(incoming, name, ticket);
      transition(incoming, outgoing, effect || TRANSITIONS[Math.floor(Math.random() * TRANSITIONS.length)]);
      front = 1 - front;
      if (playing && !isVideo(name)) schedule(TRANSITION_MS + PHOTO_MS);
    };
    img.onerror = function () { if (ticket === loading && playing) schedule(500); };
    img.src = 'photos/' + still(name);
  }

  /** A video plays to its end, with sound; in a slideshow the next item follows. */
  function playVideo(layer, name, ticket) {
    var v = document.createElement('video');
    v.src = 'photos/' + name;
    v.addEventListener('ended', function () { if (ticket === loading && playing) show(pos + 1); });
    v.addEventListener('error', function () { if (ticket === loading && playing) schedule(500); });
    layer.appendChild(v);
    var started = v.play();
    if (started && started.catch) started.catch(function () { /* the error event moves on */ });
  }

  function transition(incoming, outgoing, effect) {
    var opts = { duration: TRANSITION_MS, easing: EASE };
    incoming.style.zIndex = 2;
    outgoing.style.zIndex = 1;
    incoming.style.opacity = '1';
    incoming.anims = [incoming.animate(effect.in, opts)];
    var out = outgoing.animate(effect.out, opts);
    outgoing.anims = [out];
    out.onfinish = function () { clear(outgoing); };   // off screen: free its bitmap now
  }

  /** Swaps a playing video for a still of its current frame, and lets the decoder go. */
  function freeze(layer) {
    var v = layer.querySelector('video');
    if (!v) return;
    if (v.videoWidth) {
      var c = document.createElement('canvas');
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      layer.appendChild(c);
    }
    release(v);
  }

  function release(v) {
    v.pause();
    v.removeAttribute('src');
    v.load();
    v.remove();
  }

  function clear(layer) {
    (layer.anims || []).forEach(function (a) { a.cancel(); });
    layer.anims = [];
    var v = layer.querySelector('video');
    if (v) release(v);
    layer.innerHTML = '';
    layer.style.backgroundImage = 'none';
    layer.style.opacity = '0';
  }

  function current() { return layers[front].querySelector('video'); }

  function schedule(ms) {
    clearTimeout(slideTimer);
    slideTimer = setTimeout(function () { show(pos + 1); }, ms);
  }

  function setPlaying(on) {
    playing = on;
    clearTimeout(slideTimer);
    // A photo on screen moves on after its time; a video moves on when it ends.
    if (on && !current()) schedule(PHOTO_MS);
    hintPlaying();
  }

  function hintPlaying() {
    hint(playing ? 'Slideshow  ·  OK to pause  ·  Back for all photos'
                 : '◀ ▶ to browse  ·  OK to play  ·  Back for all photos');
  }

  function hint(text) {
    var h = $('hint');
    h.textContent = text;
    h.classList.add('shown');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { h.classList.remove('shown'); }, HINT_MS);
  }

  // ---- keys ----------------------------------------------------------------------------------

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    if (mode === 'viewer') {
      var v = current();
      if (k === KEY.LEFT) { setPlaying(false); show(pos - 1, SLIDE_RIGHT); }
      else if (k === KEY.RIGHT) { setPlaying(false); show(pos + 1, SLIDE_LEFT); }
      else if (k === KEY.OK) setPlaying(!playing);
      else if (k === KEY.PLAY) { if (v) v.play(); else setPlaying(true); }
      else if (k === KEY.PAUSE) { if (v) v.pause(); else setPlaying(false); }
      else if (k === KEY.BACK || k === KEY.ESC) closeViewer();
      else return;
    } else {
      var last = tiles.length - 1;
      if (focused < 0) {
        if (k === KEY.DOWN && last >= 0) focusTile(0);
        else if (k === KEY.OK || k === KEY.PLAY) openViewer(0, true);
        else if (k === KEY.BACK || k === KEY.ESC) window.close();
        else return;
      } else {
        var col = focused % COLUMNS;
        if (k === KEY.LEFT) { if (col > 0) focusTile(focused - 1); }
        else if (k === KEY.RIGHT) { if (col < COLUMNS - 1 && focused < last) focusTile(focused + 1); }
        else if (k === KEY.UP) focusTile(focused < COLUMNS ? -1 : focused - COLUMNS);
        else if (k === KEY.DOWN) { if (focused + COLUMNS - col <= last) focusTile(Math.min(focused + COLUMNS, last)); }
        else if (k === KEY.OK) openViewer(focused, false);
        else if (k === KEY.PLAY) openViewer(0, true);
        else if (k === KEY.BACK || k === KEY.ESC) window.close();
        else return;
      }
    }
    e.preventDefault();
  });

  $('btnSlideshow').addEventListener('mouseover', function () { if (mode === 'grid') focusTile(-1); });
  $('btnSlideshow').addEventListener('click', function () { openViewer(0, true); });

  // Off screen: nothing plays or loads; back on screen, carry on.
  document.addEventListener('visibilitychange', function () {
    var v = mode === 'viewer' && current();
    if (document.hidden) {
      clearTimeout(slideTimer);
      if (v) v.pause();
    } else if (v) {
      v.play();
    } else if (mode === 'viewer' && playing) {
      schedule(PHOTO_MS);
    }
  });

  build();
  focusTile(-1);
})();
