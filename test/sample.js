/**
 * Sample usage with Electron. On a Wayland session, run with `npm run sample` (forces XWayland).
 * The `.desktop` file matching the app ID, required by the portal to accept the shortcuts, is
 * installed automatically in ~/.local/share/applications (see `desktop-entry.js`).
 *
 * Use the "Shortcuts" menu to unregister and register the shortcuts again, and the "Trigger"
 * select to switch between calling the callbacks on press or release.
 */
const path = require('node:path');
const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const { WaylandGlobalShortcut, toXdgTrigger } = require('wayland-global-shortcut');
const { installDesktopEntry } = require('./desktop-entry');

const APP_ID = 'com.github.ecromaneli.wayland-global-shortcut';
const shortcuts = new WaylandGlobalShortcut({ appId: APP_ID });

let window;
let trigger = 'release';

const SAMPLE_SHORTCUTS = [
  {
    accelerator: 'CmdOrCtrl+Shift+H',
    description: 'Toggle sample window',
    callback: () => window.isVisible() ? window.hide() : window.show(),
  },
  {
    accelerator: 'CmdOrCtrl+Shift+J',
    description: 'Log to console',
    callback: () => console.log('Ctrl+Shift+J activated'),
  },
];

async function register({ accelerator, description, callback }) {
  const ok = await shortcuts.register(accelerator, callback, { description, trigger });
  console.log(`${accelerator} registered on ${trigger}:`, ok, shortcuts.isRegistered(accelerator));
  updateMenu();
}

async function registerAll() {
  const missing = SAMPLE_SHORTCUTS.filter((s) => !shortcuts.isRegistered(s.accelerator));
  if (!missing.length) { return; }
  const ok = await shortcuts.registerAll(missing.map((s) => s.accelerator), () => {
    console.log('Shortcut from registerAll activated');
  }, { description: 'Registered with registerAll', trigger });
  console.log(`${missing.map((s) => s.accelerator).join(', ')} registered with registerAll on ${trigger}:`, ok);
  updateMenu();
}

async function unregister(accelerator) {
  await shortcuts.unregister(accelerator);
  console.log(`${accelerator} unregistered:`, !shortcuts.isRegistered(accelerator));
  updateMenu();
}

async function unregisterAll() {
  await shortcuts.unregisterAll();
  console.log('All shortcuts unregistered');
  updateMenu();
}

/** Registers the registered shortcuts again with the new trigger. */
async function setTrigger(value) {
  trigger = value;
  for (const shortcut of SAMPLE_SHORTCUTS.filter((s) => shortcuts.isRegistered(s.accelerator))) {
    await shortcuts.unregister(shortcut.accelerator);
    await register(shortcut);
  }
}

function updateMenu() {
  const items = SAMPLE_SHORTCUTS.map((s) => shortcuts.isRegistered(s.accelerator)
    ? { label: `Unregister ${s.accelerator}`, click: () => unregister(s.accelerator) }
    : { label: `Register ${s.accelerator}`, click: () => register(s) });

  Menu.setApplicationMenu(Menu.buildFromTemplate([{
    label: 'Shortcuts',
    submenu: [
      ...items,
      { type: 'separator' },
      { label: 'Register all (single bind)', click: registerAll },
      { label: 'Unregister all', click: unregisterAll },
      { type: 'separator' },
      { role: 'quit' },
    ],
  }]));
}

app.whenReady().then(async () => {
  ipcMain.handle('set-trigger', (_, value) => setTrigger(value));

  window = new BrowserWindow({
    width: 500,
    height: 320,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  window.loadFile(path.join(__dirname, 'sample.html'));
  updateMenu();

  for (const accelerator of ['CmdOrCtrl+Shift+H', 'Alt+Plus', 'Super+num5', 'AltGr+A']) {
    console.log(`${accelerator} => ${toXdgTrigger(accelerator)}`);
  }

  await installDesktopEntry(APP_ID, __filename);

  for (const shortcut of SAMPLE_SHORTCUTS) {
    await register(shortcut);
  }
});

app.on('will-quit', (e) => {
  e.preventDefault();
  shortcuts.destroy().finally(() => app.exit(0));
});
