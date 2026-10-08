<p align='center'>
    Global shortcuts on Wayland and XWayland through the XDG Desktop Portal
</p>
<p align='center'>
    <a href="https://github.com/ECRomaneli/wayland-global-shortcut/tags"><img src="https://img.shields.io/github/v/tag/ecromaneli/wayland-global-shortcut?label=version&sort=semver&style=for-the-badge" alt="Version"></a>
    <a href="https://github.com/ECRomaneli/wayland-global-shortcut/commits/master"><img src="https://img.shields.io/github/last-commit/ecromaneli/wayland-global-shortcut?style=for-the-badge" alt="Last Commit"></a>
    <a href="https://github.com/ECRomaneli/wayland-global-shortcut/blob/master/LICENSE"><img src="https://img.shields.io/github/license/ecromaneli/wayland-global-shortcut?style=for-the-badge" alt="License"></a>
    <a href="https://github.com/ECRomaneli/wayland-global-shortcut/issues"><img src="https://img.shields.io/badge/contributions-welcome-brightgreen.svg?style=for-the-badge" alt="Contributions Welcome"></a>
</p>

## Installation

Install the `wayland-global-shortcut` package via [npm](https://www.npmjs.com/package/wayland-global-shortcut):

```sh
npm install wayland-global-shortcut
```

## Overview

Wayland compositors do not allow applications to grab keys directly. Apps running under **XWayland** are affected too: X11 key grabs only receive events while an X11 window is focused, so "global" shortcuts silently become "focused-only" shortcuts.

The `wayland-global-shortcut` package registers shortcuts through the [`org.freedesktop.portal.GlobalShortcuts`](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.GlobalShortcuts.html) D-Bus portal, which is the standard way for any Wayland client (native or XWayland) to receive shortcuts regardless of focus.

### Highlights

- **Pure JavaScript** — talks to D-Bus through [`dbus-native`](https://www.npmjs.com/package/dbus-native), no native build required.
- **Framework agnostic** — works with Electron, NW.js or plain Node.js processes.
- **Accelerator syntax** — uses the familiar `CmdOrCtrl+Shift+H` syntax (the same as Electron) and converts it to the [XDG shortcuts spec](https://specifications.freedesktop.org/shortcuts-spec/latest/).
- **Promise based** — every registration resolves after the portal (and the user) answers.

## Requirements

- A Wayland session with an `xdg-desktop-portal` backend implementing `GlobalShortcuts` (e.g. GNOME, KDE Plasma 6, Hyprland).
- A **valid app ID**. Recent portals (`xdg-desktop-portal` 1.21+, GNOME 50+) refuse unsandboxed apps that cannot be resolved to an installed `.desktop` file:
  - The app ID must be a reverse-DNS name, e.g. `com.example.MyApp`.
  - A `com.example.MyApp.desktop` file must be installed (e.g. in `/usr/share/applications` or `~/.local/share/applications`).
  - **Electron**: set `"desktopName": "com.example.MyApp.desktop"` in `package.json`. The app ID is then read from the `CHROME_DESKTOP` environment variable automatically. With `electron-builder`, also set `linux.syncDesktopName: true` so the installed `.desktop` file matches.

## Usage

All public methods are documented with JSDoc and can be referenced during import.

### Importing

```js
const { WaylandGlobalShortcut } = require('wayland-global-shortcut')
```

### Creating an Instance

```js
const shortcuts = new WaylandGlobalShortcut({ appId: 'com.example.MyApp' })
```

| Option    | Type     | Default                              | Description                                                        |
|-----------|----------|--------------------------------------|--------------------------------------------------------------------|
| `appId`   | `string` | `CHROME_DESKTOP` without `.desktop`  | Reverse-DNS app ID matching the installed `.desktop` file.         |
| `timeout` | `number` | `10000`                              | Timeout (ms) to connect to D-Bus and create the portal session.    |

### Registering Shortcuts

```js
const ok = await shortcuts.register('CmdOrCtrl+Shift+H', () => {
  console.log('Toggled!')
}, { description: 'Toggle window' })
```

The `description` is shown by the desktop in the consent dialog and in the system shortcut settings. If not specified, the accelerator is used.

To register multiple shortcuts with a **single consent dialog**, use `registerAll`:

```js
await shortcuts.registerAll(['CmdOrCtrl+Shift+H', 'CmdOrCtrl+Shift+J'], callback, { description: 'Toggle window' })
```

### Unregistering Shortcuts

```js
await shortcuts.unregister('CmdOrCtrl+Shift+H')
await shortcuts.unregisterAll()

// Unregister everything and close the D-Bus connection
await shortcuts.destroy()
```

### Using with Electron under XWayland

Electron's `globalShortcut` already uses the portal on **native** Wayland. When the app is forced to run under XWayland (`--ozone-platform=x11`, usually to keep window positioning and always-on-top working), use this package instead:

```js
const { app, globalShortcut } = require('electron')
const { WaylandGlobalShortcut } = require('wayland-global-shortcut')

const isXWayland = process.platform === 'linux'
  && process.argv.includes('--ozone-platform=x11')
  && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY)

app.whenReady().then(async () => {
  const toggle = () => { /* ... */ }
  if (isXWayland) {
    await new WaylandGlobalShortcut().register('CmdOrCtrl+Shift+H', toggle, { description: 'Toggle window' })
  } else {
    globalShortcut.register('CmdOrCtrl+Shift+H', toggle)
  }
})
```

### Converting Accelerators

The accelerator conversion is also exported:

```js
const { toXdgTrigger } = require('wayland-global-shortcut')

toXdgTrigger('CmdOrCtrl+Shift+H') // 'CTRL+SHIFT+h'
toXdgTrigger('Alt+Plus')          // 'ALT+SHIFT+equal'
toXdgTrigger('Super+num5')        // 'LOGO+KP_5'
toXdgTrigger('AltGr+A')           // null (not representable)
toXdgTrigger('Ctrl+Foo')          // throws TypeError
```

### How It Works

1. On the first registration, a D-Bus session bus connection is opened and the app ID is registered through `org.freedesktop.host.portal.Registry`.
2. A portal session is created and all shortcuts are bound with a single `BindShortcuts` call, using the XDG trigger as both the shortcut ID and the `preferred_trigger`.
3. The desktop may show a consent dialog. The returned promise resolves only after the user accepts or dismisses it.
4. The portal allows a single bind per session, so every change (register/unregister) closes the session and binds the full set again. If a bind fails, the previous set is restored.
5. `Activated` signals from the current session call the matching callback.

### Limitations

- The user can choose a different key combination in the consent dialog or in the system settings. The callback still fires, but the key may differ from the requested accelerator.
- `AltGr` combinations cannot be represented by the XDG shortcuts spec and are rejected.
- Behavior varies by desktop: GNOME shows a consent dialog on the first bind; KDE binds silently and lists the shortcuts in System Settings.

## API Reference

```js
/**
 * Registers a global shortcut.
 * @param {string} accelerator - Accelerator string (e.g. `CmdOrCtrl+Shift+H`).
 * @param {() => void} callback - Called when the shortcut is activated.
 * @param {ShortcutOptions} [options] - Registration options.
 * @returns {Promise<boolean>} Whether the shortcut was bound by the portal.
 */
register(accelerator, callback, options)

/**
 * Registers multiple global shortcuts with a single portal bind.
 * If any shortcut fails, none of them are registered.
 * @returns {Promise<boolean>} Whether all shortcuts were bound by the portal.
 */
registerAll(accelerators, callback, options)

/**
 * @returns {boolean} Whether the accelerator is registered by this instance.
 */
isRegistered(accelerator)

/**
 * Unregisters a global shortcut.
 * @returns {Promise<void>}
 */
unregister(accelerator)

/**
 * Unregisters all global shortcuts. The D-Bus connection is kept open.
 * @returns {Promise<void>}
 */
unregisterAll()

/**
 * Unregisters all global shortcuts and closes the D-Bus connection.
 * @returns {Promise<void>}
 */
destroy()
```

## Author

Created by [Emerson Capuchi Romaneli](https://github.com/ECRomaneli) (@ECRomaneli).

## License

This project is licensed under the [MIT License](https://github.com/ECRomaneli/wayland-global-shortcut/blob/master/LICENSE).
