import type {
  ModifiedResponse,
  ServerStatus,
  TracerEvent,
  TracerRequest,
  TracerResponse,
} from '../../shared/tracer';
import { bodySize } from '../lib/format';

/**
 * - pending: request seen, no response yet
 * - paused: response intercepted, the app is waiting for our reply
 * - forwarded: we replied with a modified_response
 * - released: the app stopped waiting before we replied
 * - completed: response was report-only
 */
export type FlowState =
  | 'pending'
  | 'paused'
  | 'forwarded'
  | 'released'
  | 'completed';

/** A request and its response, matched by id. */
export interface Flow {
  key: string;
  seq: number;
  clientId: string;
  id: string;
  request?: TracerRequest;
  response?: TracerResponse;
  state: FlowState;
  /** The modified_response we sent, when it changed anything. */
  modification?: ModifiedResponse;
  /** When the response was intercepted, in epoch ms. */
  heldSince?: number;
  durationMs?: number;
  size?: number;
}

export interface TracerState {
  status: ServerStatus | null;
  /** Newest first. */
  flows: Flow[];
  nextSeq: number;
  selectedKey: string | null;
}

export type TracerAction =
  | { type: 'event'; event: TracerEvent; now: number }
  | { type: 'forwarded'; key: string; modification: ModifiedResponse }
  | { type: 'released'; keys: string[] }
  | { type: 'select'; key: string | null }
  | { type: 'clear' };

export const MAX_FLOWS = 2000;

export const initialTracerState: TracerState = {
  status: null,
  flows: [],
  nextSeq: 1,
  selectedKey: null,
};

export function flowKey(clientId: string, id: string) {
  return `${clientId}/${id}`;
}

function duration(request?: TracerRequest, response?: TracerResponse) {
  if (!request || !response) return undefined;
  const ms = Date.parse(response.timestamp) - Date.parse(request.timestamp);
  return Number.isFinite(ms) ? ms : undefined;
}

function upsert(
  state: TracerState,
  clientId: string,
  id: string,
  update: (flow: Flow) => Flow,
): TracerState {
  const key = flowKey(clientId, id);
  const index = state.flows.findIndex((flow) => flow.key === key);
  if (index >= 0) {
    const flows = [...state.flows];
    flows[index] = update(flows[index]);
    return { ...state, flows };
  }

  const created = update({
    key,
    seq: state.nextSeq,
    clientId,
    id,
    state: 'pending',
  });
  let flows = [created, ...state.flows];
  if (flows.length > MAX_FLOWS) {
    // Never evict a held response: the app is still waiting on it.
    let budget =
      MAX_FLOWS - flows.filter((flow) => flow.state === 'paused').length;
    flows = flows.filter((flow) => {
      if (flow.state === 'paused') return true;
      budget -= 1;
      return budget >= 0;
    });
  }
  return { ...state, flows, nextSeq: state.nextSeq + 1 };
}

function release(state: TracerState, shouldRelease: (flow: Flow) => boolean) {
  if (!state.flows.some((flow) => flow.state === 'paused' && shouldRelease(flow))) {
    return state;
  }
  return {
    ...state,
    flows: state.flows.map((flow) =>
      flow.state === 'paused' && shouldRelease(flow)
        ? { ...flow, state: 'released' as const }
        : flow,
    ),
  };
}

function applyStatus(state: TracerState, status: ServerStatus): TracerState {
  const next = { ...state, status };
  // The app releases every held response when interception turns off or the socket closes.
  if (!status.listening || !status.interception) return release(next, () => true);
  const connected = new Set(status.clients.map((client) => client.id));
  return release(next, (flow) => !connected.has(flow.clientId));
}

export function tracerReducer(
  state: TracerState,
  action: TracerAction,
): TracerState {
  switch (action.type) {
    case 'event': {
      const { event, now } = action;
      if (event.type === 'status') return applyStatus(state, event.status);

      if (event.type === 'request') {
        const request = event.payload;
        return upsert(state, event.clientId, request.id, (flow) => ({
          ...flow,
          request,
          durationMs: duration(request, flow.response),
        }));
      }

      const response = event.payload;
      const next = upsert(state, event.clientId, response.id, (flow) => ({
        ...flow,
        response,
        state: response.intercepted ? 'paused' : 'completed',
        heldSince: response.intercepted ? now : undefined,
        durationMs: duration(flow.request, response),
        size: bodySize(response.data, response.responseType),
      }));
      // Jump to a newly held response unless another held one is being edited.
      const selected = state.flows.find((flow) => flow.key === state.selectedKey);
      if (response.intercepted && selected?.state !== 'paused') {
        return { ...next, selectedKey: flowKey(event.clientId, response.id) };
      }
      return next;
    }

    case 'forwarded':
      return {
        ...state,
        flows: state.flows.map((flow) =>
          flow.key === action.key
            ? {
                ...flow,
                state: 'forwarded',
                modification:
                  Object.keys(action.modification).length > 1
                    ? action.modification
                    : undefined,
                size:
                  'data' in action.modification
                    ? bodySize(
                        action.modification.data,
                        flow.response?.responseType,
                      )
                    : flow.size,
              }
            : flow,
        ),
      };

    case 'released':
      return release(state, (flow) => action.keys.includes(flow.key));

    case 'select':
      return { ...state, selectedKey: action.key };

    case 'clear': {
      const flows = state.flows.filter((flow) => flow.state === 'paused');
      return {
        ...state,
        flows,
        selectedKey: flows.some((flow) => flow.key === state.selectedKey)
          ? state.selectedKey
          : null,
      };
    }

    default:
      return state;
  }
}
