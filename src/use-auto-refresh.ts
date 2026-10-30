// ABOUTME: Periodically revalidates a picker while its command is open.
// ABOUTME: Skips ticks during a running load so slow Rex calls never pile up.
import { useEffect, useRef } from "react";

/** A low-frequency refresh that stays silent when cached data is already on screen. */
export function useAutoRefresh(revalidate: () => void, isLoading: boolean, intervalMs = 30_000): void {
  const loading = useRef(isLoading);
  const revalidateLatest = useRef(revalidate);
  loading.current = isLoading;
  revalidateLatest.current = revalidate;

  useEffect(() => {
    const timer = setInterval(() => {
      if (!loading.current) revalidateLatest.current();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
}
