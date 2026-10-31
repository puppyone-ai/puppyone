import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * Returns a function whose identity is stable for the component lifetime while
 * every call is routed to the latest implementation. This is the React 18
 * command-port boundary: render-time state may change without turning an event
 * handler into semantic data for downstream consumers.
 */
export function useStableEventCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): (...args: Args) => Result {
  const callbackRef = useRef(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  return useCallback((...args: Args) => callbackRef.current(...args), []);
}
