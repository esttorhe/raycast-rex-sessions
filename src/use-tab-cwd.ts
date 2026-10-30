// ABOUTME: Lazily reads working directories for the tab selected in the Connect picker.
// ABOUTME: Debounces rapid tab cycling, caches per tab, and never blocks the list.
import { useEffect, useRef, useState } from "react";
import type { Run } from "./cli";
import type { Item, SessionTabSummary } from "./items";
import { readWorkingDirectory } from "./session-details";

export interface TabCwd {
  cwd?: string;
  /** The server user's home, so remote paths can be shortened too. */
  home?: string;
  /** The foreground program, such as nvim or zsh. */
  process?: string;
  /** Additional distinct pane directories beyond the first. */
  extra?: number;
  isLoading: boolean;
}

interface CachedCwd {
  cwd?: string;
  home?: string;
  process?: string;
  extra?: number;
}

const DEBOUNCE_MS = 200;
const MAX_PANES = 2;

/**
 * Resolve the working directory of the tab currently under the selection.
 * The first pane wins; a split tab with several directories adds a `+N` marker.
 */
export function useTabCwd(run: Run, item: Item | undefined, tab: SessionTabSummary | undefined): TabCwd {
  const cache = useRef(new Map<string, CachedCwd>());
  const latest = useRef({ item, tab });
  latest.current = { item, tab };
  const paneKey = tab?.panes?.map((pane) => pane.blockId ?? pane.label).join(",") ?? "";
  const key =
    item?.kind === "rex" && item.sessionId && tab ? `${item.id}\u0000${tab.windowId}\u0000${paneKey}` : undefined;
  const [state, setState] = useState<{
    key?: string;
    cwd?: string;
    home?: string;
    process?: string;
    extra?: number;
    isLoading: boolean;
  }>({ isLoading: false });

  useEffect(() => {
    if (!key) {
      setState({ isLoading: false });
      return;
    }
    if (cache.current.has(key)) {
      const cached = cache.current.get(key);
      setState({
        key,
        cwd: cached?.cwd,
        home: cached?.home,
        process: cached?.process,
        extra: cached?.extra,
        isLoading: false,
      });
      return;
    }

    let cancelled = false;
    setState({ key, isLoading: true });
    const timer = setTimeout(async () => {
      const target = latest.current;
      const targetItem = target.item;
      const targetTab = target.tab;
      if (!targetItem?.sessionId || !targetTab) return;

      const panes = (targetTab.panes ?? []).filter((pane) => pane.terminal && pane.blockId);
      const cwds: string[] = [];
      let home: string | undefined;
      let processName: string | undefined;
      for (const pane of panes.slice(0, MAX_PANES)) {
        try {
          const result = await readWorkingDirectory(run, targetItem.server, targetItem.sessionId, pane.blockId!);
          home ??= result.home;
          processName ??= result.process;
          if (result.cwd && !cwds.includes(result.cwd)) cwds.push(result.cwd);
        } catch {
          // A pane that cannot be read must not hide the tab or the list.
        }
      }
      const cwd = cwds[0];
      const extra = cwds.length > 1 ? cwds.length - 1 : undefined;
      cache.current.set(key, { cwd, home, process: processName, extra });
      if (!cancelled) setState({ key, cwd, home, process: processName, extra, isLoading: false });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, run]);

  return state.key === key
    ? {
        cwd: state.cwd,
        home: state.home,
        process: state.process,
        extra: state.extra,
        isLoading: state.isLoading,
      }
    : { isLoading: Boolean(key) };
}
