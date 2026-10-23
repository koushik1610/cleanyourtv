// Launcher configuration. Edit this file, then run webos-launcher/install.sh.
// App ids: run `python3 sync-apps.py --list` (or look in app/apps.js after a sync).
window.CONFIG = {
  // Apps pinned to the dock row at the bottom, in this order. Missing apps are skipped.
  dockApps: ['netflix', 'amazon', 'youtube.leanback.v4', 'com.disney.disneyplus-prod', 'com.vibehack.photos'],

  // Apps never shown as tiles (inputs and Live TV are already in the Inputs menu).
  hiddenApps: [
    'com.gathin.tvhome',
    'com.webos.app.livetv',
    'com.webos.app.hdmi1', 'com.webos.app.hdmi2', 'com.webos.app.hdmi3', 'com.webos.app.hdmi4'
  ],

  // The Live TV app, offered at the end of the Inputs menu. Leave empty to omit.
  liveTvApp: 'com.webos.app.livetv',

  // Tiles per row in the grid; the dock always has this many slots.
  columns: 8,

  // Home opens the launcher, through the service that comes with it (press Home twice to stay on
  // LG's home). false leaves Home to LG. The first start asks on screen to allow it.
  takeOverHome: true,

  // A frosted glass plate behind each dock tile. false shows them on the bare wallpaper.
  dockGlass: true,

  // Sections below the dock, in order. Each app shows once: dock apps are left out of these.
  // Apps not listed here (new installs too) land in a "More" section at the end.
  categories: [
    { title: 'Movies & TV', apps: [
      'com.wbd.stream', 'hulu', 'com.peacock.tv', 'com.cbs-all-access.webapp.prod', 'aha',
      'com.zee5.app', 'com.lgtvod.us.app'] },
    { title: 'Live & Free TV', apps: [
      'com.movenetworks.app.sling-tv-sling-production', 'com.fubotv.app', 'com.plutotv.app',
      'com.webos.app.lgchannels', 'webos.day'] },
    { title: 'Sports', apps: [
      'com.espn.espnplus-prod', 'fox.sports-v1.0', 'dazn', 'tv.fifaplus.app', 'com.mutv.manutd',
      'com.webos.app.sportsteamsettings', 'epoxyaisports'] },
    { title: 'Games', apps: [
      'tv.twitch.tv.starshot.lg', 'com.twin.app.gamingportal', 'com.volley.lgshell',
      'com.miniclip.eightballpool'] },
    { title: 'Music & Ambient', apps: [
      'com.twin.app.audiochannel', 'com.webos.app.lifeonscreen', 'com.lgtravel.app'] },
    { title: 'Utilities', apps: [
      'com.webos.app.discovery', 'com.webos.app.browser', 'com.webos.app.mediadiscovery',
      'com.webos.app.camera', 'com.webos.app.homeconnect', 'amazon.alexa.view', 'shortcutcopilot',
      'com.webos.app.multiviewsettings', 'com.lgb.beta.program.app', 'com.palmdts.devmode'] }
  ]
};
