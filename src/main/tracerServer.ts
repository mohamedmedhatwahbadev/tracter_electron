/**
 * WebSocket server the Tracer Flutter package connects to.
 * See WEBSOCKET_MESSAGES.md for the protocol.
 */
import os from 'node:os';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket, RawData } from 'ws';
import {
  DEFAULT_TRACER_PORT,
  ModifiedResponse,
  ServerStatus,
  TracerClient,
  TracerEvent,
  TracerRequest,
  TracerResponse,
} from '../shared/tracer';

type Emit = (event: TracerEvent) => void;

function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(
      (info): info is os.NetworkInterfaceInfo =>
        !!info && info.family === 'IPv4' && !info.internal,
    )
    .map((info) => info.address);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasId(value: unknown): value is { id: string } {
  return isRecord(value) && typeof value.id === 'string';
}

export default class TracerServer {
  private server: WebSocketServer | null = null;

  private listening = false;

  private port = DEFAULT_TRACER_PORT;

  private error: string | null = null;

  private interception = false;

  private nextClientId = 1;

  private readonly sockets = new Map<string, WebSocket>();

  private readonly clients = new Map<string, TracerClient>();

  constructor(private readonly emit: Emit) {}

  listen(port: number = this.port): Promise<ServerStatus> {
    this.shutdown();
    this.port = port;
    this.error = null;

    return new Promise((resolve) => {
      const server = new WebSocketServer({ port });
      this.server = server;

      server.on('listening', () => {
        this.listening = true;
        this.port = (server.address() as AddressInfo).port;
        this.emitStatus();
        resolve(this.status());
      });

      server.on('error', (error: Error) => {
        this.shutdown();
        this.error = error.message;
        this.emitStatus();
        resolve(this.status());
      });

      server.on('connection', (socket, request) => {
        this.accept(socket, request.socket.remoteAddress ?? 'unknown');
      });
    });
  }

  close() {
    this.shutdown();
    this.emitStatus();
  }

  status(): ServerStatus {
    return {
      listening: this.listening,
      port: this.port,
      addresses: lanAddresses(),
      clients: [...this.clients.values()],
      interception: this.interception,
      error: this.error,
    };
  }

  setInterception(enabled: boolean): ServerStatus {
    this.interception = enabled;
    this.sockets.forEach((socket) => this.sendInterception(socket));
    this.emitStatus();
    return this.status();
  }

  /** Replies to an intercepted `response`. Returns false if its app is gone. */
  modifyResponse(clientId: string, response: ModifiedResponse): boolean {
    const socket = this.sockets.get(clientId);
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ action: 'modified_response', data: response }));
    return true;
  }

  private shutdown() {
    this.sockets.forEach((socket) => socket.terminate());
    this.sockets.clear();
    this.clients.clear();
    this.server?.removeAllListeners();
    // Keep a no-op handler so a late socket error cannot crash the main process.
    this.server?.on('error', () => {});
    this.server?.close();
    this.server = null;
    this.listening = false;
  }

  private accept(socket: WebSocket, remoteAddress: string) {
    const id = String(this.nextClientId);
    this.nextClientId += 1;
    this.sockets.set(id, socket);
    this.clients.set(id, {
      id,
      address: remoteAddress.replace(/^::ffff:/, ''),
      connectedAt: new Date().toISOString(),
    });

    // The app starts with interception off, so sync it on connect.
    if (this.interception) this.sendInterception(socket);

    socket.on('message', (raw, isBinary) => {
      if (!isBinary) this.handleMessage(id, raw);
    });
    socket.on('close', () => {
      this.sockets.delete(id);
      this.clients.delete(id);
      this.emitStatus();
    });
    socket.on('error', () => socket.terminate());

    this.emitStatus();
  }

  private handleMessage(clientId: string, raw: RawData) {
    let message: unknown;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!isRecord(message) || !hasId(message.data)) return;

    if (message.action === 'request') {
      this.emit({
        type: 'request',
        clientId,
        payload: message.data as TracerRequest,
      });
    } else if (message.action === 'response') {
      this.emit({
        type: 'response',
        clientId,
        payload: message.data as TracerResponse,
      });
    }
  }

  private sendInterception(socket: WebSocket) {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        action: 'interception',
        data: String(this.interception),
      }),
    );
  }

  private emitStatus() {
    this.emit({ type: 'status', status: this.status() });
  }
}
