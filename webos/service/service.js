/*
 * Sends the Home button to the launcher, from the TV itself.
 *
 * webOS always opens LG's home on Home, and freezes a web app's scripts soon after it leaves the
 * screen, so the launcher can't watch for Home. A JS service keeps running: it listens to the TV's
 * remote-control service (the one LG's phone app uses, on localhost) for the app in front, and
 * when LG's home comes up it opens the launcher. The first start asks on screen to allow it.
 *
 * Failsafes, so the TV always stays usable:
 * - Press Home twice within ESCAPE_MS to stay on LG's home.
 * - If the launcher doesn't come up (say it was removed), or Home bounces more than LOOP_LIMIT
 *   times in LOOP_MS, it stands down for PAUSE_MS and Home works as on a stock TV.
 * - `stop` cancels everything it set up, including the start-at-boot activity; restore.sh calls it
 *   before removing the apps, which puts the TV back exactly as it was.
 *
 * It can't close the apps you leave: the TV answers that from a client on the TV with 403, and
 * denies Dev Mode apps and services the app manager's close. home-watch.py does that from another
 * device, if you run it.
 */
var Service = require('webos-service');
var net = require('net');
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');

var ID = 'com.gathin.tvhome.service';
var LAUNCHER = 'com.gathin.tvhome';
var LG_HOME = 'com.webos.app.home';
var BOOT_ACTIVITY = 'tvhome-start-at-boot';
var KEY_FILE = path.join(__dirname, 'ssap-key');   // wiped by a reinstall, which then asks once
var ESCAPE_MS = 3000;
var LOOP_LIMIT = 4, LOOP_MS = 20000, PAUSE_MS = 10 * 60000;
var PERMISSIONS = ['LAUNCH', 'READ_RUNNING_APPS', 'READ_APP_STATUS'];

var service = new Service(ID);
var running = false, stopped = false;
var sock = null, retryMs = 3000, firstConnect = true;
var lastRedirect = 0, redirects = [], pausedUntil = 0;
var events = [];   // the last few things that happened, for `status`

function note(text) {
  events.push(new Date().toISOString() + ' ' + text);
  if (events.length > 20) events.shift();
  console.log(text);
}

// ---- start and stop ------------------------------------------------------------------------------

service.register('start', function (msg) {
  msg.respond({ returnValue: true, running: running });
  if (msg.payload && msg.payload.$activity) {
    // Started by the boot activity: tell the activity manager we're done, so it fires again later.
    service.call('luna://com.palm.activitymanager/complete',
      { activityId: msg.payload.$activity.activityId, restart: true }, function () {});
  }
  if (running) return;
  running = true;
  stopped = false;
  firstConnect = true;
  note('started');
  // Keeps this service from being stopped for idling.
  service.activityManager.create('tvhome-keepalive', function () {});
  scheduleBootStart();
  connect();
});

service.register('stop', function (msg) {
  stopped = true;
  running = false;
  if (sock) sock.destroy();
  service.call('luna://com.palm.activitymanager/cancel', { activityName: BOOT_ACTIVITY }, function (r) {
    note('stopped; start-at-boot cancelled: ' + !!(r.payload && r.payload.returnValue));
    msg.respond({ returnValue: true });
    setTimeout(function () { process.exit(0); }, 500);
  });
});

service.register('status', function (msg) {
  msg.respond({ returnValue: true, running: running, connected: !!sock, paused: Date.now() < pausedUntil,
    events: events });
});

/** A persistent activity that starts this service again after the TV boots. */
function scheduleBootStart() {
  service.call('luna://com.palm.activitymanager/create', {
    activity: {
      name: BOOT_ACTIVITY,
      description: 'Start the launcher\'s Home service after the TV boots',
      type: { background: true, persist: true, explicit: true },
      schedule: { interval: '00d00h05m00s' },
      callback: { method: 'luna://' + ID + '/start', params: {} }
    },
    start: true, replace: true, subscribe: false
  }, function (r) { note('start-at-boot: ' + !!(r.payload && r.payload.returnValue)); });
}

// ---- Home ----------------------------------------------------------------------------------------

function onForeground(app) {
  if (app !== LG_HOME || stopped) return;
  var now = Date.now();
  if (now < pausedUntil) return;
  if (now - lastRedirect < ESCAPE_MS) {
    lastRedirect = 0;   // Home twice: stay on LG's home
    note('Home twice: staying on LG home');
    return;
  }
  redirects = redirects.filter(function (t) { return now - t < LOOP_MS; });
  if (redirects.length >= LOOP_LIMIT) {
    pausedUntil = now + PAUSE_MS;
    note('Home keeps bouncing: standing down for ' + PAUSE_MS / 60000 + ' minutes');
    return;
  }
  redirects.push(now);
  lastRedirect = now;
  service.call('luna://com.webos.applicationManager/launch', { id: LAUNCHER }, function (r) {
    if (r.payload && r.payload.returnValue) {
      note('LG home -> launcher');
    } else {
      pausedUntil = Date.now() + PAUSE_MS;   // launcher missing or refused: leave Home alone
      note('launcher did not open, standing down: ' + JSON.stringify(r.payload));
    }
  });
}

// ---- the TV's remote-control service -------------------------------------------------------------

function connect() {
  if (stopped) return;
  var key = null, initial = true;
  try { key = fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch (e) { /* first start: asks on screen */ }
  ws(function (send) {
    var payload = { forcePairing: false, pairingType: 'PROMPT',
      manifest: { manifestVersion: 1, appVersion: '1.1', permissions: PERMISSIONS } };
    if (key) payload['client-key'] = key;
    send({ type: 'register', id: 'register', payload: payload });
  }, function (msg, send) {
    if (msg.type === 'registered') {
      retryMs = 3000;
      try { fs.writeFileSync(KEY_FILE, msg.payload['client-key']); } catch (e) { note('could not keep the key: ' + e.code); }
      note('connected');
      send({ type: 'subscribe', id: 'fg', uri: 'ssap://com.webos.applicationManager/getForegroundAppInfo', payload: {} });
    } else if (msg.type === 'error' && msg.id === 'register') {
      note('not allowed on the TV prompt: ' + msg.error);
    } else if (msg.id === 'fg' && msg.payload) {
      // The first answer on a connection is the app already in front (every answer looks alike).
      // Act on it only right after the service starts (the TV just booted to LG's home), not after
      // a reconnect, when you may have chosen LG's home.
      if (!initial || firstConnect) onForeground(msg.payload.appId);
      initial = false;
      firstConnect = false;
    }
  });
}

/** A minimal WebSocket client (Node 16 has none): text frames, pings both ways, reconnects. */
function ws(onopen, onmessage) {
  var s = net.connect(3000, '127.0.0.1');
  var buf = Buffer.alloc(0), open = false;
  sock = s;
  function frame(first, data) {
    data = Buffer.from(data);
    var mask = crypto.randomBytes(4), head;
    if (data.length < 126) {
      head = Buffer.from([first, 0x80 | data.length]);
    } else {
      head = Buffer.alloc(4);
      head[0] = first;
      head[1] = 0x80 | 126;
      head.writeUInt16BE(data.length, 2);
    }
    for (var i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
    s.write(Buffer.concat([head, mask, data]));
  }
  function send(obj) { frame(0x81, JSON.stringify(obj)); }
  // The TV drops a connection that goes quiet for about 40 s.
  var pinger = setInterval(function () { if (open) frame(0x89, ''); }, 10000);

  s.on('connect', function () {
    s.write('GET / HTTP/1.1\r\nHost: 127.0.0.1:3000\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      'Sec-WebSocket-Key: ' + crypto.randomBytes(16).toString('base64') + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
  });
  s.on('data', function (d) {
    buf = Buffer.concat([buf, d]);
    if (!open) {
      var end = buf.indexOf('\r\n\r\n');
      if (end < 0) return;
      open = true;
      buf = buf.slice(end + 4);
      onopen(send);
    }
    while (buf.length >= 2) {
      var len = buf[1] & 127, off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = buf.readUInt32BE(6);
        off = 10;
      }
      if (buf.length < off + len) return;
      var op = buf[0] & 15, payload = buf.slice(off, off + len);
      buf = buf.slice(off + len);
      if (op === 1) {
        var msg;
        try { msg = JSON.parse(payload.toString()); } catch (e) { continue; }
        onmessage(msg, send);
      } else if (op === 9) {
        frame(0x8A, payload);   // ping: pong
      }
    }
  });
  s.on('error', function (e) { note('connection error: ' + e.code); });
  s.on('close', function () {
    clearInterval(pinger);
    if (sock === s) sock = null;
    if (stopped) return;
    setTimeout(connect, retryMs);   // the TV's service restarts, or isn't up yet after boot
    retryMs = Math.min(retryMs * 2, 60000);
  });
}
