// ABOUTME: Pure helpers for remembering and cycling a session's Rex tabs inline in the picker.
// ABOUTME: Resolution prefers a remembered window id, then Rex's active tab, then the nearest index.
import type { SessionTabSummary } from "./items";

export interface TabChoice {
  windowId: string;
  /** Fallback position when the remembered window no longer exists. */
  lastKnownIndex: number;
}

export interface TabResolution {
  tabs: SessionTabSummary[];
  /** The resolved index, or -1 when the session has no readable tabs. */
  index: number;
  tab?: SessionTabSummary;
}

/** Rex names new windows "Window <suffix>"; a tab position plus pane names reads better. */
const AUTO_TAB_LABEL = /^Window [0-9a-f]{8}$/i;

const PROCESS_LABELS: Record<string, string> = {
  bash: "bash",
  btop: "btop",
  bun: "Bun",
  cargo: "Cargo",
  deno: "Deno",
  docker: "Docker",
  emacs: "Emacs",
  fish: "fish",
  git: "Git",
  go: "Go",
  htop: "htop",
  nano: "nano",
  node: "Node",
  nvim: "Neovim",
  python: "Python",
  python3: "Python",
  ruby: "Ruby",
  rustc: "Rust",
  sh: "sh",
  ssh: "SSH",
  tmux: "tmux",
  top: "top",
  vim: "Vim",
  zsh: "zsh",
};

/** Friendly names for common foreground programs; unknown commands stay as reported. */
export function displayProcessName(name: string): string {
  const command = name.trim().split("/").pop() || name.trim();
  return PROCESS_LABELS[command.toLowerCase()] ?? command;
}

export function displayTabLabel(tab: SessionTabSummary, index: number, cwd?: string, processName?: string): string {
  const automatic = AUTO_TAB_LABEL.test(tab.label.trim());
  const label = automatic ? `Tab ${index + 1}` : tab.label.trim();
  const detail = [processName ? displayProcessName(processName) : undefined, cwd].filter(Boolean).join(" ");
  if (detail) return `${label} · ${detail}`;
  const shown = tab.paneLabels.slice(0, 2);
  const extra = tab.paneLabels.length - shown.length;
  const panes = shown.length ? ` · ${shown.join(" · ")}${extra > 0 ? ` +${extra}` : ""}` : "";
  return `${label}${panes}`;
}

/** Shorten a path under the home directory for a compact picker subtitle. */
export function displayPath(path: string, home: string): string {
  if (path === home) return "~";
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), length - 1);
}

/**
 * Pick the tab a session row should show. A remembered window survives reordering and renames;
 * if it disappears, prefer Rex's active tab and only then the last known position.
 */
export function resolveTab(tabs: SessionTabSummary[] | undefined, choice?: TabChoice): TabResolution {
  const available = tabs ?? [];
  if (available.length === 0) return { tabs: available, index: -1 };

  if (choice) {
    const remembered = available.findIndex((tab) => tab.windowId === choice.windowId);
    if (remembered >= 0) return { tabs: available, index: remembered, tab: available[remembered] };
  }

  const active = available.findIndex((tab) => tab.active);
  if (active >= 0) return { tabs: available, index: active, tab: available[active] };

  const index = choice ? clampIndex(choice.lastKnownIndex, available.length) : 0;
  return { tabs: available, index, tab: available[index] };
}

/** Move through Rex's tab order with wraparound; -1 starts at the first or last tab. */
export function cycleTabIndex(length: number, index: number, step: number): number {
  if (length <= 0) return -1;
  const current = index < 0 ? (step > 0 ? -1 : 0) : index;
  return (current + step + length) % length;
}
