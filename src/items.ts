// ABOUTME: Pure helpers that turn Rex sessions, sesh entries and zoxide directories into picker items.
// ABOUTME: Also builds the rex new arguments for an item and expands ~ in a PATH preference.
import { basename } from "node:path";

export type Kind = "rex" | "sesh" | "dir";

/** A pane inside a tab, kept so the picker can read its working directory on demand. */
export interface SessionPaneSummary {
  blockId?: string;
  label: string;
  /** True for terminal blocks; other block types have no working directory. */
  terminal: boolean;
}

/** A window from a session view, which Rex.app shows as a tab. */
export interface SessionTabSummary {
  windowId: string;
  label: string;
  /** True when this is the tab the session currently shows. */
  active: boolean;
  /** Labels of the blocks in this tab, in Rex's layout order. */
  paneLabels: string[];
  /** Includes panes that have no label. Optional for older cached summaries. */
  paneCount?: number;
  /** Pane details for lazy working-directory reads. Optional for older cached summaries. */
  panes?: SessionPaneSummary[];
}

export interface Item {
  id: string;
  kind: Kind;
  title: string;
  /** The label a new session gets, and how an open session is matched. */
  label: string;
  path?: string;
  sessionId?: string;
  startup?: string;
  windows?: number;
  /** The session's tabs, or absent when its view could not be read. */
  tabs?: SessionTabSummary[];
  /** The Rex host label; absent for sessions on this Mac. */
  server?: string;
}

export interface RexSession {
  session_id: string;
  label: string;
  /** Set only when the session came from a remote host. */
  server?: string;
}

/** One entry from `rex hosts --json`; only the label is needed to list its sessions. */
export interface RexHost {
  host?: {
    id?: string;
    label?: string;
    endpoints?: string[];
  };
  from?: string;
  held?: boolean;
}

export interface RexHosts {
  home?: unknown;
  hosts?: RexHost[];
  warnings?: unknown[];
}

/** Items plus the hosts or local server that could not be reached. */
export interface LoadedItems {
  /** Configured remote host labels, including empty or unreachable hosts. */
  hosts: string[];
  items: Item[];
  warnings: string[];
}

export interface SeshEntry {
  Name: string;
  Path: string;
  StartupCommand?: string;
}

export function toRexItem(session: RexSession, windows?: number, server?: string, tabs?: SessionTabSummary[]): Item {
  return {
    id: server ? `rex:${server}:${session.session_id}` : `rex:${session.session_id}`,
    kind: "rex",
    title: session.label,
    label: session.label,
    sessionId: session.session_id,
    windows,
    tabs,
    server,
  };
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** Keep the tab labels and pane labels a session view already returned, ignoring malformed windows. */
export function toTabSummaries(windows: unknown, activeWindowId?: unknown): SessionTabSummary[] {
  if (!Array.isArray(windows)) return [];
  const active = typeof activeWindowId === "string" ? activeWindowId : undefined;
  const tabs: SessionTabSummary[] = [];
  const seen = new Set<string>();
  windows.forEach((rawWindow, index) => {
    const window = objectRecord(rawWindow);
    if (!window || typeof window.window_id !== "string" || !window.window_id) return;
    if (seen.has(window.window_id)) return;
    seen.add(window.window_id);
    const paneLabels: string[] = [];
    const panes: SessionPaneSummary[] = [];
    const layers = Array.isArray(window.layers) ? window.layers : [];
    for (const rawLayer of layers) {
      const layer = objectRecord(rawLayer);
      const blocks = layer && Array.isArray(layer.blocks) ? layer.blocks : [];
      for (const rawBlock of blocks) {
        const block = objectRecord(rawBlock);
        if (!block) continue;
        const blockId = typeof block.block_id === "string" && block.block_id ? block.block_id : undefined;
        const label = typeof block.label === "string" && block.label.trim() ? block.label : `Pane ${panes.length + 1}`;
        const creator = typeof block.creator_name === "string" ? block.creator_name : "";
        const flavor = typeof block.flavor === "string" ? block.flavor : "";
        panes.push({
          blockId,
          label,
          terminal: creator === "com.superlogical.terminal" || flavor.startsWith("com.superlogical.terminal."),
        });
        paneLabels.push(label);
      }
    }
    const label = typeof window.label === "string" && window.label.trim() ? window.label : `Tab ${index + 1}`;
    tabs.push({
      windowId: window.window_id,
      label,
      active: window.window_id === active,
      paneLabels,
      paneCount: panes.length,
      panes,
    });
  });
  return tabs;
}

export function toSeshItems(entries: SeshEntry[]): Item[] {
  return entries.map((entry) => ({
    id: `sesh:${entry.Name}`,
    kind: "sesh",
    title: entry.Name,
    label: entry.Name,
    path: entry.Path,
    startup: entry.StartupCommand || undefined,
  }));
}

export function toZoxideItems(dirs: string[], home: string): Item[] {
  return dirs.map((dir) => ({
    id: `dir:${dir}`,
    kind: "dir",
    title: dir === home || dir.startsWith(`${home}/`) ? `~${dir.slice(home.length)}` : dir,
    label: basename(dir) || dir,
    path: dir,
  }));
}

const trimSlash = (path?: string) => path?.replace(/\/+$/, "");

/**
 * Open sessions first; sesh entries and directories that would duplicate them are left out.
 * Only local sessions hide a sesh entry: sesh and zoxide create sessions on this Mac, so a
 * remote session is never the session those entries would open.
 */
export function mergeItems(rex: Item[], sesh: Item[], dirs: Item[]): Item[] {
  const localLabels = new Set(rex.filter((i) => !i.server).map((i) => i.label));
  const visibleSesh = sesh.filter((i) => !localLabels.has(i.label));
  const seshPaths = new Set(sesh.map((i) => trimSlash(i.path)));
  const visibleDirs = dirs.filter((i) => !seshPaths.has(trimSlash(i.path)));
  const seen = new Set<string>();
  return [...rex, ...visibleSesh, ...visibleDirs].filter((i) => !seen.has(i.id) && seen.add(i.id));
}

/** The open session an item refers to: its own, or a local session already created with its label. */
export function existingSessionId(item: Item, open: RexSession[]): string | undefined {
  if (item.sessionId) return item.sessionId;
  if (item.server) return undefined;
  return open.find((session) => !session.server && session.label === item.label)?.session_id;
}

/** Arguments for `rex new`; a startup command runs first and then leaves an interactive shell. */
export function newSessionArgs(item: Item, shell: string): string[] {
  const args = ["new", item.label, "-c", item.path ?? "", "--json"];
  if (item.startup) {
    args.push("--", shell, "-c", `${item.startup}; exec ${shell} -l`);
  }
  return args;
}

export function expandPath(searchPath: string, home: string): string {
  return searchPath
    .split(":")
    .map((entry) => (entry === "~" || entry.startsWith("~/") ? home + entry.slice(1) : entry))
    .join(":");
}

/** Host filters keep local creation entries off remote hosts while preserving session order. */
export function filterItemsByHost(items: Item[], filter: string): Item[] {
  return items.filter((item) =>
    filter === "all" ? true : filter === "local" ? !item.server : `remote:${item.server}` === filter,
  );
}
