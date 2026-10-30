// ABOUTME: Loads one session's tabs and panes, plus each terminal's working directory, on demand.
// ABOUTME: One unreadable pane becomes a pane error; a malformed session view rejects the whole load.
import type { Run } from "./cli";
import type { Item } from "./items";

const TERMINAL_CREATOR = "com.superlogical.terminal";
/** Terminal lookups are fast; four keeps a big session from flooding the Rex server. */
const PANE_LOOKUPS_IN_FLIGHT = 4;

export type CwdSource = "process" | "pwd";

export interface SessionPane {
  /** The Rex block ID, absent only when the session view omitted it. */
  blockId?: string;
  label: string;
  /** True for the focused pane in its tab. */
  active: boolean;
  /** True for terminal blocks; other block types have no working directory. */
  terminal: boolean;
  /** An absolute working directory, when Rex reported one. */
  cwd?: string;
  /** Which read produced cwd: the live process table, or the directory the program last reported. */
  cwdSource?: CwdSource;
  /** Why a terminal pane has no working directory. Other panes still load. */
  cwdError?: string;
}

export interface SessionTab {
  /** The Rex window ID. */
  windowId: string;
  label: string;
  /** True for the tab Rex currently shows for the session. */
  active: boolean;
  panes: SessionPane[];
}

export interface SessionDetails {
  sessionId: string;
  /** The session's current label, which may differ from a stale list item. */
  label: string;
  /** The Rex host label; absent for a session on this Mac. */
  server?: string;
  activeWindowId?: string;
  /** Windows in the order Rex shows them as tabs. */
  tabs: SessionTab[];
}

/** Global Rex flags that keep remote work from starting a local server. */
function serverArgs(server?: string): string[] {
  return server ? ["--server", server, "--autostart=false"] : ["--autostart=false"];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidView(message: string): Error {
  return new Error(`Invalid session.view response: ${message}`);
}

/** Check the picker entry before any Rex call, so a directory or sesh entry never looks like a session. */
function sessionTarget(item: Item): { sessionId: string; server?: string } {
  if (item.kind !== "rex") {
    throw new Error(`Only Rex sessions have details; ${item.label} is a ${item.kind} entry`);
  }
  const sessionId = item.sessionId?.trim();
  if (!sessionId) {
    throw new Error(`Rex session ${item.label} has no session ID`);
  }
  const server = item.server?.trim();
  if (item.server !== undefined && !server) {
    throw new Error(`Rex session ${item.label} has an invalid host`);
  }
  return { sessionId, server };
}

function parsePane(
  raw: unknown,
  index: number,
  tabIndex: number,
  blockIndex: number,
  focusedBlockId: string | undefined,
): SessionPane {
  if (!isRecord(raw)) {
    throw invalidView(`window ${tabIndex + 1} block ${blockIndex + 1} isn't an object`);
  }
  const blockId = typeof raw.block_id === "string" && raw.block_id ? raw.block_id : undefined;
  const creator = typeof raw.creator_name === "string" ? raw.creator_name : "";
  const flavor = typeof raw.flavor === "string" ? raw.flavor : "";
  const terminal = creator === TERMINAL_CREATOR || flavor.startsWith(`${TERMINAL_CREATOR}.`);
  const label = typeof raw.label === "string" && raw.label.trim() ? raw.label : `Pane ${index + 1}`;
  const pane: SessionPane = {
    blockId,
    label,
    active: blockId !== undefined && blockId === focusedBlockId,
    terminal,
  };
  if (terminal && !blockId) {
    pane.cwdError = "This terminal has no block ID, so its working directory can't be read";
  }
  return pane;
}

function parseTab(raw: unknown, index: number, activeWindowId: string | undefined): SessionTab {
  if (!isRecord(raw)) {
    throw invalidView(`window ${index + 1} isn't an object`);
  }
  if (typeof raw.window_id !== "string" || !raw.window_id) {
    throw invalidView(`window ${index + 1} has no ID`);
  }
  if (raw.layers !== undefined && raw.layers !== null && !Array.isArray(raw.layers)) {
    throw invalidView(`window ${index + 1} has invalid layers`);
  }
  const focusedBlockId = typeof raw.focused_block_id === "string" ? raw.focused_block_id : undefined;
  const panes: SessionPane[] = [];
  const layers = Array.isArray(raw.layers) ? raw.layers : [];
  layers.forEach((layer, layerIndex) => {
    if (!isRecord(layer)) {
      throw invalidView(`window ${index + 1} layer ${layerIndex + 1} isn't an object`);
    }
    if (layer.blocks !== undefined && layer.blocks !== null && !Array.isArray(layer.blocks)) {
      throw invalidView(`window ${index + 1} layer ${layerIndex + 1} has invalid blocks`);
    }
    const blocks = Array.isArray(layer.blocks) ? layer.blocks : [];
    blocks.forEach((block, blockIndex) => {
      panes.push(parsePane(block, panes.length, index, blockIndex, focusedBlockId));
    });
  });
  const label = typeof raw.label === "string" && raw.label.trim() ? raw.label : `Tab ${index + 1}`;
  return {
    windowId: raw.window_id,
    label,
    active: raw.window_id === activeWindowId,
    panes,
  };
}

function parseSessionView(raw: unknown, target: { sessionId: string; server?: string }): SessionDetails {
  if (!isRecord(raw)) {
    throw invalidView("not a JSON object");
  }
  if (typeof raw.label !== "string" || !raw.label.trim()) {
    throw invalidView("missing the session label");
  }
  if (raw.session_id !== undefined && raw.session_id !== null && raw.session_id !== target.sessionId) {
    throw invalidView("the session ID doesn't match the requested session");
  }
  if (raw.windows !== undefined && raw.windows !== null && !Array.isArray(raw.windows)) {
    throw invalidView("windows isn't an array");
  }
  const activeWindowId = typeof raw.active_window_id === "string" ? raw.active_window_id : undefined;
  const windows = Array.isArray(raw.windows) ? raw.windows : [];
  const tabs = windows.map((window, index) => parseTab(window, index, activeWindowId));
  return {
    sessionId: target.sessionId,
    label: raw.label,
    server: target.server,
    activeWindowId,
    tabs,
  };
}

/** The server user's home directory, used to shorten paths in the picker. */
function reportedHome(raw: unknown): string | undefined {
  if (!isRecord(raw) || typeof raw.home !== "string") return undefined;
  const home = raw.home.trim();
  return home || undefined;
}

/** The foreground program first, then its child or ancestors as a graceful fallback. */
function foregroundProcessName(raw: unknown): string | undefined {
  if (!isRecord(raw)) return undefined;
  const ancestors = Array.isArray(raw.ancestors) ? raw.ancestors : [];
  for (const process of [raw.foreground, ...ancestors, raw.child]) {
    if (isRecord(process) && typeof process.name === "string" && process.name.trim()) {
      return process.name.trim();
    }
  }
  return undefined;
}

/** The live foreground command's directory first, then its child or ancestors when one reports it. */
function processWorkingDirectory(raw: unknown): string | undefined {
  if (!isRecord(raw)) return undefined;
  const ancestors = Array.isArray(raw.ancestors) ? raw.ancestors : [];
  // Ancestors are nearest first and end with the child, so follow them before the child itself.
  const processes = [raw.foreground, ...ancestors, raw.child];
  for (const process of processes) {
    if (isRecord(process) && typeof process.cwd === "string" && process.cwd.trim()) {
      return process.cwd;
    }
  }
  return undefined;
}

/** `pwd` can be a plain path or an OSC 7 file URL, and may be stale. */
function reportedWorkingDirectory(raw: unknown): string | undefined {
  if (!isRecord(raw) || typeof raw.pwd !== "string") return undefined;
  const value = raw.pwd.trim();
  if (!value) return undefined;
  if (!value.startsWith("file://")) return value;
  const rest = value.slice("file://".length);
  const pathStart = rest.indexOf("/");
  if (pathStart < 0) return undefined;
  const pathname = rest.slice(pathStart);
  try {
    return decodeURIComponent(pathname) || undefined;
  } catch {
    return pathname || undefined;
  }
}

export interface PaneWorkingDirectory {
  cwd?: string;
  /** The server user's home, when the process table reported it. */
  home?: string;
  /** The foreground program's name, such as nvim or zsh. */
  process?: string;
  source?: CwdSource;
  error?: string;
}

/** Read one terminal pane's directory: the live process first, then its last reported pwd. */
export async function readWorkingDirectory(
  run: Run,
  server: string | undefined,
  sessionId: string,
  blockId: string,
): Promise<PaneWorkingDirectory> {
  const baseArgs = [...serverArgs(server), "block", "call", "-s", sessionId, "-b", blockId];

  let processFailure: unknown;
  let home: string | undefined;
  let processName: string | undefined;
  try {
    const process = JSON.parse(await run("rex", [...baseArgs, "process"])) as unknown;
    home = reportedHome(process);
    processName = foregroundProcessName(process);
    const cwd = processWorkingDirectory(process);
    if (cwd) return { cwd, home, process: processName, source: "process" };
  } catch (error) {
    processFailure = error;
  }

  let pwdFailure: unknown;
  try {
    const reported = JSON.parse(await run("rex", [...baseArgs, "pwd"])) as unknown;
    const cwd = reportedWorkingDirectory(reported);
    if (cwd) return { cwd, home, process: processName, source: "pwd" };
  } catch (error) {
    pwdFailure = error;
  }

  const failure = pwdFailure ?? processFailure;
  return {
    home,
    process: processName,
    error: failure
      ? `Couldn't read the working directory: ${errorText(failure)}`
      : "No working directory was reported for this pane",
  };
}

async function readPaneCwd(run: Run, server: string | undefined, sessionId: string, pane: SessionPane): Promise<void> {
  if (!pane.terminal || !pane.blockId) return;
  const result = await readWorkingDirectory(run, server, sessionId, pane.blockId);
  pane.cwd = result.cwd;
  pane.cwdSource = result.source;
  pane.cwdError = result.error;
}

/** Run at most `limit` visits at once, preserving one result per item and no extra ordering guarantees. */
async function forEachLimited<T>(items: T[], limit: number, visit: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await visit(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Read a session's current tabs and the working directory of every terminal pane.
 * `session.view` is read once; pane lookups are bounded so a session with many panes stays responsive.
 * A failed pane lookup is recorded on that pane and never hides the other tabs.
 */
export async function loadSessionDetails(run: Run, item: Item): Promise<SessionDetails> {
  const target = sessionTarget(item);
  const output = await run("rex", [
    ...serverArgs(target.server),
    "api",
    "call",
    "session.view",
    JSON.stringify({ session_id: target.sessionId }),
  ]);

  let raw: unknown;
  try {
    raw = JSON.parse(output) as unknown;
  } catch {
    throw invalidView("malformed JSON");
  }
  const details = parseSessionView(raw, target);
  const terminals = details.tabs.flatMap((tab) => tab.panes).filter((pane) => pane.terminal && pane.blockId);
  await forEachLimited(terminals, PANE_LOOKUPS_IN_FLIGHT, (pane) =>
    readPaneCwd(run, target.server, target.sessionId, pane),
  );
  return details;
}
