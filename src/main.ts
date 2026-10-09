import { DBusClient, DBusMethodCall, DBusSignal } from './DBusClient';
import { toXdgTrigger } from './XdgTrigger';

type PortalResults = Record<string, unknown>;
type PortalResponse = { code: number, results: PortalResults };
type PendingRequest = { resolve: (response: PortalResponse) => void, reject: (error: Error) => void };
type Shortcut = { id: string, description: string, trigger: ShortcutTrigger, callback: () => void };

/** When the shortcut callback is called: when the keys are pressed or released. */
export type ShortcutTrigger = 'press' | 'release';

/** Options for {@link WaylandGlobalShortcut}. */
export interface WaylandGlobalShortcutOptions {
  /**
   * Reverse-DNS app ID matching the installed `.desktop` file (e.g. `com.example.MyApp`).
   * Required by recent portals for unsandboxed apps. Defaults to the `CHROME_DESKTOP`
   * environment variable (set by Electron from `desktopName`) without the `.desktop` suffix.
   */
  appId?: string;
  /** Timeout, in milliseconds, to connect and create the portal session. Defaults to `10000`. */
  timeout?: number;
}

/** Options for a shortcut registration. */
export interface ShortcutOptions {
  /** Human readable description shown by the desktop. Defaults to the accelerator. */
  description?: string;
  /**
   * When the callback is called. Defaults to `release`.
   *
   * The compositor keeps the key events of an active shortcut, so a window focused while the
   * keys are still held down may never receive the key release and the last key gets stuck
   * (e.g. the `W` of `Ctrl+W` repeating in a text field). Use `press` only when the callback
   * does not change the focus.
   */
  trigger?: ShortcutTrigger;
}

const DBUS_NAME = 'org.freedesktop.DBus';
const DBUS_PATH = '/org/freedesktop/DBus';
const PORTAL_NAME = 'org.freedesktop.portal.Desktop';
const PORTAL_PATH = '/org/freedesktop/portal/desktop';
const SHORTCUTS_IFACE = 'org.freedesktop.portal.GlobalShortcuts';
const REQUEST_IFACE = 'org.freedesktop.portal.Request';
const SESSION_IFACE = 'org.freedesktop.portal.Session';
const REGISTRY_IFACE = 'org.freedesktop.host.portal.Registry';
const LOG_PREFIX = '[WaylandGlobalShortcut]';

/**
 * Global shortcuts through the `org.freedesktop.portal.GlobalShortcuts` D-Bus portal.
 *
 * Works for any process in a Wayland session, including X11 apps running under XWayland,
 * where X11 key grabs only receive events while an X11 window is focused.
 *
 * The portal allows a single bind per session, so every change recreates the session and
 * binds the whole set again. The desktop may show a consent dialog, and the returned
 * promises only settle after the user answers it.
 */
export class WaylandGlobalShortcut {
  private readonly appId: string;
  private readonly timeout: number;
  private readonly shortcuts = new Map<string, Shortcut>();
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private queue: Promise<unknown> = Promise.resolve();
  private bus?: DBusClient;
  private sessionPath?: string;
  private tokenCounter = 0;

  constructor(options: WaylandGlobalShortcutOptions = {}) {
    this.appId = options.appId ?? (process.env.CHROME_DESKTOP ?? '').replace(/\.desktop$/, '');
    this.timeout = options.timeout ?? 10_000;
  }

  /**
   * Registers a global shortcut.
   * @param accelerator Accelerator string (e.g. `CmdOrCtrl+Shift+H`).
   * @param callback Called when the shortcut is activated.
   * @param options Registration options.
   * @returns Whether the shortcut was bound by the portal.
   * @throws {TypeError} When the accelerator is invalid.
   */
  public register(accelerator: string, callback: () => void, options: ShortcutOptions = {}): Promise<boolean> {
    return this.registerAll([accelerator], callback, options);
  }

  /**
   * Registers multiple global shortcuts with a single portal bind (and a single consent dialog).
   * If any shortcut fails, none of them are registered.
   * @param accelerators Accelerator strings.
   * @param callback Called when any of the shortcuts is activated.
   * @param options Registration options.
   * @returns Whether all shortcuts were bound by the portal.
   * @throws {TypeError} When an accelerator is invalid.
   */
  public registerAll(accelerators: string[], callback: () => void, options: ShortcutOptions = {}): Promise<boolean> {
    return this.enqueue(async () => {
      const next = [...this.shortcuts.values()];
      for (const accelerator of accelerators) {
        const id = toXdgTrigger(accelerator);
        if (!id || next.some((s) => s.id === id)) { return false; }
        const { description = accelerator, trigger = 'release' } = options;
        next.push({ id, description: description || accelerator, trigger, callback });
      }
      return this.commit(next);
    });
  }

  /**
   * @param accelerator Accelerator string.
   * @returns Whether the accelerator is registered by this instance.
   */
  public isRegistered(accelerator: string): boolean {
    const id = toXdgTrigger(accelerator);
    return !!id && this.shortcuts.has(id);
  }

  /**
   * Unregisters a global shortcut.
   * @param accelerator Accelerator string.
   */
  public unregister(accelerator: string): Promise<void> {
    return this.enqueue(async () => {
      const id = toXdgTrigger(accelerator);
      if (!id || !this.shortcuts.has(id)) { return; }
      const next = [...this.shortcuts.values()].filter((s) => s.id !== id);
      this.setShortcuts(next);
      if (!(await this.bind(next))) { this.setShortcuts([]); }
    });
  }

  /** Unregisters all global shortcuts. The D-Bus connection is kept open for future registrations. */
  public unregisterAll(): Promise<void> {
    return this.enqueue(async () => {
      this.setShortcuts([]);
      await this.closeSession();
    });
  }

  /** Unregisters all global shortcuts and closes the D-Bus connection, allowing the process to exit. */
  public destroy(): Promise<void> {
    return this.enqueue(async () => {
      this.setShortcuts([]);
      await this.closeSession();
      if (this.bus) { this.disconnect(this.bus, new Error('Destroyed')); }
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private setShortcuts(list: Shortcut[]): void {
    this.shortcuts.clear();
    list.forEach((s) => this.shortcuts.set(s.id, s));
  }

  /** Binds the given set, restoring the previous one on failure. */
  private async commit(next: Shortcut[]): Promise<boolean> {
    const previous = [...this.shortcuts.values()];
    if (await this.bind(next)) {
      this.setShortcuts(next);
      return true;
    }
    if (previous.length && !(await this.bind(previous))) { this.setShortcuts([]); }
    return false;
  }

  private async bind(list: Shortcut[]): Promise<boolean> {
    await this.closeSession();
    if (!list.length) { return true; }

    try {
      this.sessionPath = await withTimeout(this.connect().then(() => this.createSession()), this.timeout);
      const bound = await this.bindShortcuts(this.sessionPath, list);
      const missing = list.filter((s) => !bound.includes(s.id)).map((s) => s.id);
      if (!missing.length) { return true; }
      console.warn(LOG_PREFIX, 'Shortcuts not bound by the portal:', missing);
    } catch (e) {
      console.error(LOG_PREFIX, 'Failed to bind shortcuts:', e);
    }

    await this.closeSession();
    return false;
  }

  private async connect(): Promise<DBusClient> {
    if (this.bus) { return this.bus; }

    const bus = await DBusClient.connect();
    bus.onDisconnect((e) => {
      console.error(LOG_PREFIX, 'D-Bus connection lost:', e);
      this.disconnect(bus, e);
    });
    bus.onSignal((signal) => this.onSignal(signal));

    try {
      await this.addMatch(bus, REQUEST_IFACE, 'Response');
      await this.addMatch(bus, SHORTCUTS_IFACE, 'Activated');
      await this.addMatch(bus, SHORTCUTS_IFACE, 'Deactivated');
      await this.registerAppId(bus);
    } catch (e) {
      this.disconnect(bus, e as Error);
      throw e;
    }

    this.bus = bus;
    return bus;
  }

  private disconnect(bus: DBusClient, error: Error): void {
    if (this.bus === bus) {
      this.bus = undefined;
      this.sessionPath = undefined;
    }
    this.pendingRequests.forEach((pending) => pending.reject(error));
    this.pendingRequests.clear();
    bus.close();
  }

  private addMatch(bus: DBusClient, iface: string, member: string): Promise<unknown[]> {
    return bus.call({
      destination: DBUS_NAME,
      path: DBUS_PATH,
      interface: DBUS_NAME,
      member: 'AddMatch',
      signature: 's',
      body: [`type='signal',sender='${PORTAL_NAME}',interface='${iface}',member='${member}'`],
    });
  }

  /** Associates this connection with the app ID. Required for unsandboxed apps on recent portals. */
  private async registerAppId(bus: DBusClient): Promise<void> {
    if (!this.appId) {
      console.warn(LOG_PREFIX, 'No app ID available, the portal may reject shortcuts.');
      return;
    }
    try {
      await bus.call(portalMessage(REGISTRY_IFACE, 'Register', 'sa{sv}', [this.appId, {}]));
    } catch (e) {
      console.warn(LOG_PREFIX, `Failed to register the app ID "${this.appId}", the portal may reject shortcuts:`, e);
    }
  }

  private async createSession(): Promise<string> {
    const results = await this.request('CreateSession', 'a{sv}', (options) => [{
      ...options,
      session_handle_token: this.nextToken(),
    }]);
    return results.session_handle as string;
  }

  /** @returns IDs of the shortcuts accepted by the portal. */
  private async bindShortcuts(sessionPath: string, list: Shortcut[]): Promise<string[]> {
    const shortcuts = list.map((s) => [s.id, {
      description: s.description,
      preferred_trigger: s.id,
    }]);
    const results = await this.request('BindShortcuts', 'oa(sa{sv})sa{sv}', (options) => [
      sessionPath, shortcuts, '', options,
    ]);
    const bound = (results.shortcuts ?? []) as [string, PortalResults][];
    return bound.map(([id]) => id);
  }

  private async closeSession(): Promise<void> {
    const sessionPath = this.sessionPath;
    this.sessionPath = undefined;
    if (!sessionPath || !this.bus) { return; }
    try {
      await this.bus.call({ destination: PORTAL_NAME, path: sessionPath, interface: SESSION_IFACE, member: 'Close' });
    } catch (e) {
      console.warn(LOG_PREFIX, 'Failed to close the portal session:', e);
    }
  }

  /** Calls a portal method that answers through an `org.freedesktop.portal.Request` object. */
  private async request(
    member: string, signature: string, body: (options: PortalResults) => unknown[],
  ): Promise<PortalResults> {
    const bus = this.bus!;
    const token = this.nextToken();
    const sender = bus.uniqueName.slice(1).replace(/\./g, '_');
    let requestPath = `${PORTAL_PATH}/request/${sender}/${token}`;

    const response = new Promise<PortalResponse>((resolve, reject) => {
      this.pendingRequests.set(requestPath, { resolve, reject });
    });

    try {
      const [handle] = await bus.call(portalMessage(SHORTCUTS_IFACE, member, signature, body({
        handle_token: token,
      }))) as [string];
      if (handle !== requestPath) {
        this.pendingRequests.set(handle, this.pendingRequests.get(requestPath)!);
        this.pendingRequests.delete(requestPath);
        requestPath = handle;
      }
      const { code, results } = await response;
      if (code !== 0) { throw new Error(`${member} failed with response code ${code}`); }
      return results;
    } finally {
      this.pendingRequests.delete(requestPath);
    }
  }

  private onSignal(msg: DBusSignal): void {
    if (msg.interface === REQUEST_IFACE && msg.member === 'Response') {
      const [code, results] = msg.body as [number, PortalResults];
      this.pendingRequests.get(msg.path)?.resolve({ code, results: results ?? {} });
      return;
    }

    if (msg.interface === SHORTCUTS_IFACE && (msg.member === 'Activated' || msg.member === 'Deactivated')) {
      const [sessionPath, id] = msg.body as [string, string];
      if (sessionPath !== this.sessionPath) { return; }
      const shortcut = this.shortcuts.get(id);
      if (!shortcut || shortcut.trigger !== (msg.member === 'Activated' ? 'press' : 'release')) { return; }
      try {
        shortcut.callback();
      } catch (e) {
        console.error(LOG_PREFIX, `Error on shortcut "${id}" callback:`, e);
      }
    }
  }

  private nextToken(): string {
    return `wgs_${process.pid}_${++this.tokenCounter}`;
  }
}

function portalMessage(iface: string, member: string, signature: string, body: unknown[]): DBusMethodCall {
  return { destination: PORTAL_NAME, path: PORTAL_PATH, interface: iface, member, signature, body };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export { toXdgTrigger };
