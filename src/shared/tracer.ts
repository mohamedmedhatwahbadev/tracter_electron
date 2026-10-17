/**
 * Types shared by the main process (WebSocket server) and the renderer.
 * Payload shapes follow WEBSOCKET_MESSAGES.md.
 */

export const DEFAULT_TRACER_PORT = 8080;

export type ResponseType = 'json' | 'plain' | 'bytes' | 'stream';

export interface TracerRequest {
  id: string;
  method: string;
  url: string;
  headers: Record<string, unknown>;
  data: unknown;
  timestamp: string;
}

export interface TracerResponse {
  id: string;
  method: string;
  url: string;
  statusCode: number;
  statusMessage: string | null;
  headers: Record<string, string[]>;
  responseType: ResponseType;
  data: unknown;
  intercepted: boolean;
  timestamp: string;
}

/** Payload of a `modified_response`. Omitted fields keep their original value. */
export interface ModifiedResponse {
  id: string;
  statusCode?: number;
  statusMessage?: string | null;
  headers?: Record<string, string | string[]>;
  data?: unknown;
}

export interface TracerClient {
  id: string;
  address: string;
  connectedAt: string;
}

export interface ServerStatus {
  listening: boolean;
  port: number;
  /** LAN IPv4 addresses the Flutter app can connect to. */
  addresses: string[];
  clients: TracerClient[];
  interception: boolean;
  error: string | null;
}

export type TracerEvent =
  | { type: 'request'; clientId: string; payload: TracerRequest }
  | { type: 'response'; clientId: string; payload: TracerResponse }
  | { type: 'status'; status: ServerStatus };
