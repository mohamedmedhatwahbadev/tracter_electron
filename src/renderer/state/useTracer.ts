import { useCallback, useEffect, useReducer } from 'react';
import type { ModifiedResponse } from '../../shared/tracer';
import { Flow, initialTracerState, tracerReducer } from './flows';

function bridge() {
  return window.electron?.tracer;
}

/** Connects the renderer to the WebSocket server in the main process. */
export default function useTracer() {
  const [state, dispatch] = useReducer(tracerReducer, initialTracerState);

  useEffect(() => {
    const tracer = bridge();
    if (!tracer) return undefined;
    const unsubscribe = tracer.onEvent((event) =>
      dispatch({ type: 'event', event, now: Date.now() }),
    );
    tracer
      .status()
      .then((status) =>
        dispatch({
          type: 'event',
          event: { type: 'status', status },
          now: Date.now(),
        }),
      )
      .catch(() => {});
    return unsubscribe;
  }, []);

  const setInterception = useCallback((enabled: boolean) => {
    void bridge()?.setInterception(enabled);
  }, []);

  const listen = useCallback((port: number) => {
    void bridge()?.listen(port);
  }, []);

  /** Replies to a held response. `modification` with only an id forwards it unchanged. */
  const forward = useCallback(
    async (flow: Flow, modification: ModifiedResponse) => {
      const sent = await bridge()?.modifyResponse(flow.clientId, modification);
      dispatch(
        sent
          ? { type: 'forwarded', key: flow.key, modification }
          : { type: 'released', keys: [flow.key] },
      );
    },
    [],
  );

  const select = useCallback(
    (key: string | null) => dispatch({ type: 'select', key }),
    [],
  );

  const clear = useCallback(() => dispatch({ type: 'clear' }), []);

  return { ...state, setInterception, listen, forward, select, clear };
}
