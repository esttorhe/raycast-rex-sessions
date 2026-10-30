// ABOUTME: Verifies refresh timing, current callbacks and cleanup without a Raycast runtime.
// ABOUTME: A minimal hook host retains refs across renders; Vitest drives the clock.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  refs: [] as { current: unknown }[],
  cursor: 0,
  mounted: false,
  cleanup: undefined as (() => void) | undefined,
}));
vi.mock("react", () => ({
  useRef: (value: unknown) => {
    const index = host.cursor++;
    return (host.refs[index] ??= { current: value });
  },
  useEffect: (effect: () => () => void) => {
    if (!host.mounted) {
      host.cleanup = effect();
      host.mounted = true;
    }
  },
}));
import { useAutoRefresh } from "./use-auto-refresh";

function render(callback: () => void, loading: boolean) {
  host.cursor = 0;
  useAutoRefresh(callback, loading);
}

beforeEach(() => {
  vi.useFakeTimers();
  host.refs = [];
  host.mounted = false;
});
afterEach(() => {
  host.cleanup?.();
  vi.useRealTimers();
});

describe("auto refresh", () => {
  it("waits thirty seconds and skips ticks during a slow load", () => {
    const refresh = vi.fn();
    render(refresh, true);
    vi.advanceTimersByTime(90_000);
    expect(refresh).not.toHaveBeenCalled();
    render(refresh, false);
    vi.advanceTimersByTime(29_999);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("uses the latest callback without accumulating timers on rerenders", () => {
    const oldRefresh = vi.fn();
    const newRefresh = vi.fn();
    render(oldRefresh, false);
    render(newRefresh, false);
    vi.advanceTimersByTime(60_000);
    expect(oldRefresh).not.toHaveBeenCalled();
    expect(newRefresh).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("stops refreshing after unmount", () => {
    const refresh = vi.fn();
    render(refresh, false);
    host.cleanup?.();
    vi.advanceTimersByTime(120_000);
    expect(refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
