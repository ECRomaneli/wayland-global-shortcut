import { once } from 'node:events';
import { MessageBus, messageType, sessionBus } from 'dbus-native';

/**
 * A method call. Values are plain JavaScript: dicts are objects, structs are arrays, and
 * variants inside an `a{sv}` have their type inferred (strings become `s`).
 */
export type DBusMethodCall = {
  destination: string,
  path: string,
  interface: string,
  member: string,
  signature?: string,
  body?: unknown[],
};

export type DBusSignal = { path: string, interface: string, member: string, body: unknown[] };

/** Thin session bus client, isolating the D-Bus library from the portal logic. */
export class DBusClient {
  private signalListener?: (signal: DBusSignal) => void;
  private disconnectListener?: (error: Error) => void;
  private closed = false;

  private constructor(private readonly bus: MessageBus) {
    const connection = bus.connection;
    connection.on('message', (msg) => {
      if (msg.type !== messageType.signal) { return; }
      this.signalListener?.({
        path: msg.path ?? '',
        interface: msg.interface ?? '',
        member: msg.member ?? '',
        body: msg.body ?? [],
      });
    });
    connection.on('error', (e) => this.notifyDisconnect(e));
    connection.on('close', (cause) => this.notifyDisconnect(cause ?? new Error('D-Bus connection closed')));
  }

  /** Connects to the session bus, resolving once the bus has assigned a unique name. */
  public static async connect(): Promise<DBusClient> {
    const bus = sessionBus();
    const client = new DBusClient(bus);
    try {
      await once(bus.connection, 'connect');
      // Hello is the first message sent, so its reply (which sets the unique name) arrives before this one.
      await bus.getId();
      if (!bus.name) { throw new Error('D-Bus did not assign a unique name'); }
    } catch (e) {
      client.close();
      throw e;
    }
    return client;
  }

  /** Unique connection name assigned by the bus (e.g. `:1.42`). */
  public get uniqueName(): string {
    return this.bus.name!;
  }

  /** @returns The reply body. */
  public call(msg: DBusMethodCall): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
      this.bus.invoke({ ...msg }, (err, ...body) => err ? reject(err) : resolve(body));
    });
  }

  public onSignal(listener: (signal: DBusSignal) => void): void {
    this.signalListener = listener;
  }

  /** Called when the connection fails or closes, unless closed through {@link close}. */
  public onDisconnect(listener: (error: Error) => void): void {
    this.disconnectListener = listener;
  }

  public close(): void {
    if (this.closed) { return; }
    this.closed = true;
    this.bus.close().catch(() => { /* already closed */ });
  }

  private notifyDisconnect(error: Error): void {
    if (this.closed) { return; }
    this.closed = true;
    this.disconnectListener?.(error);
    this.bus.close().catch(() => { /* already closed */ });
  }
}
