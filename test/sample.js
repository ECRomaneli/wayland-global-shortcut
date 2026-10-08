/**
 * Sample usage with Electron. On a Wayland session, run with `npm run sample` (forces XWayland).
 * A `.desktop` file matching the app ID must be installed for the portal to accept the shortcuts:
 * ~/.local/share/applications/com.github.ecromaneli.wayland-global-shortcuts.desktop
 */
const { app, BrowserWindow } = require('electron');
const { WaylandGlobalShortcuts, toXdgTrigger } = require('wayland-global-shortcuts');

const APP_ID = 'com.github.ecromaneli.wayland-global-shortcuts';
const shortcuts = new WaylandGlobalShortcuts({ appId: APP_ID });

app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 400, height: 200 });
  window.loadURL('data:text/html,<h3>Focus another app and press Ctrl+Shift+H or Ctrl+Shift+J</h3>');

  for (const accelerator of ['CmdOrCtrl+Shift+H', 'Alt+Plus', 'Super+num5', 'AltGr+A']) {
    console.log(`${accelerator} => ${toXdgTrigger(accelerator)}`);
  }

  const ok = await shortcuts.register('CmdOrCtrl+Shift+H', () => {
    window.isVisible() ? window.hide() : window.show();
  }, { description: 'Toggle sample window' });
  console.log('Ctrl+Shift+H registered:', ok, shortcuts.isRegistered('CmdOrCtrl+Shift+H'));

  const okAll = await shortcuts.registerAll(['CmdOrCtrl+Shift+J'], () => {
    console.log('Ctrl+Shift+J activated');
  }, { description: 'Log to console' });
  console.log('Ctrl+Shift+J registered:', okAll);
});

app.on('will-quit', (e) => {
  e.preventDefault();
  shortcuts.destroy().finally(() => app.exit(0));
});
