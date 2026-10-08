/**
 * Sample usage with Electron. On a Wayland session, run with `npm run sample` (forces XWayland).
 * A `.desktop` file matching the app ID must be installed for the portal to accept the shortcuts:
 * ~/.local/share/applications/com.github.ecromaneli.wayland-global-shortcuts.desktop
 *
 * Use the "Shortcuts" menu to unregister and register the shortcuts again.
 */
const { app, BrowserWindow, Menu } = require('electron');
const { WaylandGlobalShortcuts, toXdgTrigger } = require('wayland-global-shortcuts');

const APP_ID = 'com.github.ecromaneli.wayland-global-shortcuts';
const shortcuts = new WaylandGlobalShortcuts({ appId: APP_ID });

let window;

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
  const ok = await shortcuts.register(accelerator, callback, { description });
  console.log(`${accelerator} registered:`, ok, shortcuts.isRegistered(accelerator));
  updateMenu();
}

async function registerAll() {
  const missing = SAMPLE_SHORTCUTS.filter((s) => !shortcuts.isRegistered(s.accelerator));
  if (!missing.length) { return; }
  const ok = await shortcuts.registerAll(missing.map((s) => s.accelerator), () => {
    console.log('Shortcut from registerAll activated');
  }, { description: 'Registered with registerAll' });
  console.log(`${missing.map((s) => s.accelerator).join(', ')} registered with registerAll:`, ok);
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
  window = new BrowserWindow({ width: 400, height: 200 });
  window.loadURL('data:text/html,<h3>Focus another app and press Ctrl+Shift+H or Ctrl+Shift+J</h3>'
    + '<p>Use the Shortcuts menu to unregister or register them again.</p>');
  updateMenu();

  for (const accelerator of ['CmdOrCtrl+Shift+H', 'Alt+Plus', 'Super+num5', 'AltGr+A']) {
    console.log(`${accelerator} => ${toXdgTrigger(accelerator)}`);
  }

  for (const shortcut of SAMPLE_SHORTCUTS) {
    await register(shortcut);
  }
});

app.on('will-quit', (e) => {
  e.preventDefault();
  shortcuts.destroy().finally(() => app.exit(0));
});
