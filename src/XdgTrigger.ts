const XDG_MODIFIERS: Record<string, string> = {
  command: 'LOGO', cmd: 'LOGO', super: 'LOGO', meta: 'LOGO',
  commandorcontrol: 'CTRL', cmdorctrl: 'CTRL', control: 'CTRL', ctrl: 'CTRL',
  alt: 'ALT', option: 'ALT',
  shift: 'SHIFT',
};
const XDG_MODIFIERS_ORDER = ['CTRL', 'ALT', 'SHIFT', 'LOGO'];

// Valid accelerator modifiers that cannot be represented by the XDG shortcuts spec.
const UNSUPPORTED_MODIFIERS = new Set(['altgr']);

// Accelerator key names (lowercase) to xkbcommon keysym names.
const XDG_KEYS: Record<string, string> = {
  space: 'space', tab: 'Tab', backspace: 'BackSpace', delete: 'Delete', insert: 'Insert',
  return: 'Return', enter: 'Return', esc: 'Escape', escape: 'Escape',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  home: 'Home', end: 'End', pageup: 'Page_Up', pagedown: 'Page_Down',
  capslock: 'Caps_Lock', numlock: 'Num_Lock', scrolllock: 'Scroll_Lock', printscreen: 'Print',
  volumeup: 'XF86AudioRaiseVolume', volumedown: 'XF86AudioLowerVolume', volumemute: 'XF86AudioMute',
  medianexttrack: 'XF86AudioNext', mediaprevioustrack: 'XF86AudioPrev',
  mediastop: 'XF86AudioStop', mediaplaypause: 'XF86AudioPlay',
  numdec: 'KP_Decimal', numadd: 'KP_Add', numsub: 'KP_Subtract', nummult: 'KP_Multiply', numdiv: 'KP_Divide',
  ';': 'semicolon', '=': 'equal', ',': 'comma', '-': 'minus', '.': 'period', '/': 'slash',
  '`': 'grave', '[': 'bracketleft', '\\': 'backslash', ']': 'bracketright', '\'': 'apostrophe',
};

// Shifted characters, mapped to their base key on a US layout.
const SHIFTED_KEYS: Record<string, string> = {
  ')': '0', '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9',
  ':': ';', '+': '=', 'plus': '=', '<': ',', '_': '-', '>': '.', '?': '/', '~': '`',
  '{': '[', '|': '\\', '}': ']', '"': '\'',
};

function toXdgKey(key: string): string | undefined {
  if (/^[a-z0-9]$/.test(key)) { return key; }
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(key)) { return key.toUpperCase(); }
  if (/^num[0-9]$/.test(key)) { return `KP_${key.slice(3)}`; }
  return XDG_KEYS[key];
}

/**
 * Converts an accelerator (e.g. `CmdOrCtrl+Shift+H`) to the XDG shortcuts spec format (e.g. `CTRL+SHIFT+h`).
 * The accelerator syntax is the same used by Electron.
 * @see https://specifications.freedesktop.org/shortcuts-spec/latest/
 * @see https://www.electronjs.org/docs/latest/api/accelerator
 * @param accelerator Accelerator string.
 * @returns The trigger, or `null` when the accelerator cannot be represented by the spec (e.g. `AltGr`).
 * @throws {TypeError} When the accelerator is invalid.
 */
export function toXdgTrigger(accelerator: string): string | null {
  const invalid = () => new TypeError(`Invalid accelerator: ${accelerator}`);
  const modifiers = new Set<string>();
  let key: string | undefined;
  let unsupported = false;

  for (const token of accelerator.split('+').map((t) => t.trim().toLowerCase())) {
    if (XDG_MODIFIERS[token]) {
      modifiers.add(XDG_MODIFIERS[token]);
      continue;
    }
    if (UNSUPPORTED_MODIFIERS.has(token)) {
      unsupported = true;
      continue;
    }
    if (key !== undefined) { throw invalid(); }

    const base = SHIFTED_KEYS[token];
    if (base) { modifiers.add('SHIFT'); }
    key = toXdgKey(base ?? token);
    if (!key) { throw invalid(); }
  }

  if (key === undefined) { throw invalid(); }
  if (unsupported) { return null; }

  return [...XDG_MODIFIERS_ORDER.filter((m) => modifiers.has(m)), key].join('+');
}
