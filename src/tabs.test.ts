// ABOUTME: Tests for resolving and cycling the tab shown inline on a Connect session row.
// ABOUTME: Choices are keyed by window id so reordering, renames and refreshes stay predictable.
import { describe, expect, it } from "vitest";
import type { SessionTabSummary } from "./items";
import { cycleTabIndex, displayPath, displayProcessName, displayTabLabel, resolveTab } from "./tabs";

function tab(windowId: string, label: string, active = false, paneLabels: string[] = []): SessionTabSummary {
  return { windowId, label, active, paneLabels, paneCount: paneLabels.length };
}

const tabs = [tab("w:server", "Server"), tab("w:tests", "Tests", true), tab("w:shell", "Shell")];

describe("resolveTab", () => {
  it("uses Rex's active tab when nothing has been chosen", () => {
    expect(resolveTab(tabs)).toMatchObject({ index: 1, tab: { windowId: "w:tests" } });
  });

  it("falls back to the first tab when Rex reports no active tab", () => {
    const noneActive = [tab("w:a", "A"), tab("w:b", "B")];
    expect(resolveTab(noneActive)).toMatchObject({ index: 0, tab: { windowId: "w:a" } });
  });

  it("keeps a remembered window after tabs are reordered", () => {
    const reordered = [tab("w:shell", "Shell"), tab("w:tests", "Tests", true), tab("w:server", "Server")];
    expect(resolveTab(reordered, { windowId: "w:server", lastKnownIndex: 0 })).toMatchObject({
      index: 2,
      tab: { windowId: "w:server" },
    });
  });

  it("uses Rex's active tab when the remembered window disappeared", () => {
    expect(resolveTab(tabs, { windowId: "w:gone", lastKnownIndex: 0 })).toMatchObject({
      index: 1,
      tab: { windowId: "w:tests" },
    });
  });

  it("clamps the last known position when there is no active tab either", () => {
    const noneActive = [tab("w:a", "A"), tab("w:b", "B")];
    expect(resolveTab(noneActive, { windowId: "w:gone", lastKnownIndex: 9 })).toMatchObject({
      index: 1,
      tab: { windowId: "w:b" },
    });
  });

  it("reports no selection when tabs are unavailable or empty", () => {
    expect(resolveTab(undefined)).toEqual({ tabs: [], index: -1 });
    expect(resolveTab([], { windowId: "w:gone", lastKnownIndex: 2 })).toEqual({ tabs: [], index: -1 });
  });
});

describe("displayTabLabel", () => {
  it("turns Rex's automatic window names into position and pane names", () => {
    expect(displayTabLabel(tab("w:a", "Window 1a2b3c4d", false, ["api", "logs"]), 1)).toBe("Tab 2 · api · logs");
  });

  it("keeps a name the user chose and adds its pane names", () => {
    expect(displayTabLabel(tab("w:a", "Tests", true, ["test"]), 0)).toBe("Tests · test");
  });

  it("prefers the working directory over pane names", () => {
    expect(displayTabLabel(tab("w:a", "Window 1a2b3c4d", false, ["shell"]), 1, "~/src/app")).toBe("Tab 2 · ~/src/app");
  });

  it("puts the foreground program before the directory", () => {
    expect(displayTabLabel(tab("w:a", "Window 1a2b3c4d"), 0, "~/netbird", "nvim")).toBe("Tab 1 · Neovim ~/netbird");
    expect(displayTabLabel(tab("w:a", "Window 1a2b3c4d"), 1, undefined, "zsh")).toBe("Tab 2 · zsh");
  });

  it("limits pane names and marks the remainder", () => {
    expect(displayTabLabel(tab("w:a", "Window 1a2b3c4d", false, ["api", "logs", "shell"]), 0)).toBe(
      "Tab 1 · api · logs +1",
    );
  });

  it("uses just the position when an automatic tab has no named panes", () => {
    expect(displayTabLabel(tab("w:a", "Window 1a2b3c4d"), 0)).toBe("Tab 1");
  });
});

describe("displayProcessName", () => {
  it("uses friendly names for common programs", () => {
    expect(displayProcessName("nvim")).toBe("Neovim");
    expect(displayProcessName("/usr/bin/zsh")).toBe("zsh");
  });

  it("keeps unknown programs as reported", () => {
    expect(displayProcessName("my-tool")).toBe("my-tool");
  });
});

describe("displayPath", () => {
  it("shortens paths under the home directory", () => {
    expect(displayPath("/Users/me", "/Users/me")).toBe("~");
    expect(displayPath("/Users/me/src/app", "/Users/me")).toBe("~/src/app");
  });

  it("keeps paths outside the home directory", () => {
    expect(displayPath("/srv/app", "/Users/me")).toBe("/srv/app");
  });
});

describe("cycleTabIndex", () => {
  it("wraps forward and backward through Rex's tab order", () => {
    expect(cycleTabIndex(3, 1, 1)).toBe(2);
    expect(cycleTabIndex(3, 2, 1)).toBe(0);
    expect(cycleTabIndex(3, 0, -1)).toBe(2);
  });

  it("starts at the first or last tab when nothing is selected", () => {
    expect(cycleTabIndex(3, -1, 1)).toBe(0);
    expect(cycleTabIndex(3, -1, -1)).toBe(2);
  });

  it("returns -1 for an empty session", () => {
    expect(cycleTabIndex(0, -1, 1)).toBe(-1);
  });
});
