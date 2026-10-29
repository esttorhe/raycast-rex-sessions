// ABOUTME: Tests for turning Rex sessions, sesh entries and zoxide directories into one picker list.
// ABOUTME: The integration test reads the real rex, sesh and zoxide on this machine when they're installed.
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  existingSessionId,
  expandPath,
  filterItemsByHost,
  mergeItems,
  newSessionArgs,
  toRexItem,
  toSeshItems,
  toZoxideItems,
} from "./items";
import { loadItems, runner } from "./cli";

describe("mergeItems", () => {
  const rex = [toRexItem({ session_id: "session:1", label: "chezmoi" }, 3)];
  const sesh = toSeshItems([
    { Name: "chezmoi", Path: "/home/me/.local/share/chezmoi", StartupCommand: "vi ." },
    { Name: "Downloads 📥", Path: "/home/me/Downloads", StartupCommand: "yazi" },
  ]);
  const dirs = toZoxideItems(["/home/me/Downloads", "/home/me/src/app"], "/home/me");

  it("lists open sessions first, then sesh entries, then directories", () => {
    const items = mergeItems(rex, sesh, dirs);
    expect(items.map((i) => i.kind)).toEqual(["rex", "sesh", "dir"]);
  });

  it("hides a sesh entry whose session is already open", () => {
    const titles = mergeItems(rex, sesh, dirs).map((i) => i.title);
    expect(titles.filter((t) => t === "chezmoi")).toHaveLength(1);
  });

  it("hides a directory that a sesh entry already covers", () => {
    const paths = mergeItems(rex, sesh, dirs).map((i) => i.path);
    expect(paths.filter((p) => p === "/home/me/Downloads")).toHaveLength(1);
  });

  it("shows directories with ~ and names their session after the folder", () => {
    const dir = mergeItems([], [], dirs).find((i) => i.path === "/home/me/src/app");
    expect(dir?.title).toBe("~/src/app");
    expect(dir?.label).toBe("app");
  });

  it("gives every item a unique id", () => {
    const ids = mergeItems(rex, sesh, dirs).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps a remote session with the same label as a local one", () => {
    const remote = toRexItem({ session_id: "session:1", label: "chezmoi" }, 2, "studio");
    const items = mergeItems([...rex, remote], sesh, dirs);
    expect(items.filter((i) => i.title === "chezmoi").map((i) => i.server)).toEqual([undefined, "studio"]);
  });

  it("does not hide a sesh entry behind a remote session with the same label", () => {
    const remote = toRexItem({ session_id: "session:1", label: "chezmoi" }, 2, "studio");
    const items = mergeItems([remote], sesh, dirs);
    expect(items.filter((i) => i.title === "chezmoi").map((i) => i.kind)).toEqual(["rex", "sesh"]);
  });

  it("gives the same session id on different hosts a different id", () => {
    const first = toRexItem({ session_id: "session:1", label: "same" }, 1, "studio");
    const second = toRexItem({ session_id: "session:1", label: "same" }, 1, "laptop");
    const items = mergeItems([first, second], [], []);
    expect(items).toHaveLength(2);
    expect(new Set(items.map((i) => i.id)).size).toBe(2);
  });
});

describe("existingSessionId", () => {
  const open = [{ session_id: "session:1", label: "Downloads 📥" }];

  it("finds an open session with the item's label, so picking twice never duplicates", () => {
    const [entry] = toSeshItems([{ Name: "Downloads 📥", Path: "/home/me/Downloads", StartupCommand: "yazi" }]);
    expect(existingSessionId(entry, open)).toBe("session:1");
  });

  it("uses the item's own session id when it already has one", () => {
    expect(existingSessionId(toRexItem({ session_id: "session:9", label: "x" }), open)).toBe("session:9");
  });

  it("returns nothing when no session has that label", () => {
    const [dir] = toZoxideItems(["/home/me/src/app"], "/home/me");
    expect(existingSessionId(dir, open)).toBeUndefined();
  });

  it("ignores a remote session with the item's label", () => {
    const [entry] = toSeshItems([{ Name: "Downloads 📥", Path: "/home/me/Downloads" }]);
    expect(existingSessionId(entry, [{ ...open[0], server: "studio" }])).toBeUndefined();
  });

  it("keeps the item's own remote session id", () => {
    const remote = toRexItem({ session_id: "session:remote", label: "x" }, 1, "studio");
    expect(existingSessionId(remote, open)).toBe("session:remote");
  });
});

describe("newSessionArgs", () => {
  it("starts a plain shell in the directory when there is no startup command", () => {
    const [dir] = toZoxideItems(["/home/me/src/app"], "/home/me");
    expect(newSessionArgs(dir, "/opt/homebrew/bin/fish")).toEqual(["new", "app", "-c", "/home/me/src/app", "--json"]);
  });

  it("runs the startup command, then stays in an interactive shell", () => {
    const [entry] = toSeshItems([{ Name: "files", Path: "/home/me/Downloads", StartupCommand: "yazi" }]);
    expect(newSessionArgs(entry, "/bin/zsh")).toEqual([
      "new",
      "files",
      "-c",
      "/home/me/Downloads",
      "--json",
      "--",
      "/bin/zsh",
      "-c",
      "yazi; exec /bin/zsh -l",
    ]);
  });
});

describe("expandPath", () => {
  it("expands a leading ~ in each entry and keeps the order", () => {
    expect(expandPath("~/.local/share/mise/shims:/opt/homebrew/bin:/usr/bin", "/home/me")).toBe(
      "/home/me/.local/share/mise/shims:/opt/homebrew/bin:/usr/bin",
    );
  });
});

function installed(program: string): boolean {
  try {
    execFileSync("/usr/bin/which", [program], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.runIf(installed("rex") && installed("sesh") && installed("zoxide"))("on this machine", () => {
  it("loads real local sessions, sesh entries and directories", async () => {
    const run = runner(process.env.PATH ?? "", "rex");
    const { items } = await loadItems(run, homedir(), true, false, true);
    const live = JSON.parse(execFileSync("rex", ["ls", "--json"], { encoding: "utf8" })).sessions;
    expect(items.filter((i) => i.kind === "rex")).toHaveLength(live.length);
    expect(items.every((i) => i.title && i.id)).toBe(true);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });
});

describe("filterItemsByHost", () => {
  const items = [
    toRexItem({ session_id: "session:local", label: "local" }),
    toRexItem({ session_id: "session:remote", label: "remote" }, 1, "studio"),
    ...toSeshItems([{ Name: "project", Path: "/work/project" }]),
    ...toZoxideItems(["/work/dir"], "/work"),
  ];

  it("keeps all hosts in their existing order", () => {
    expect(filterItemsByHost(items, "all")).toEqual(items);
  });
  it("keeps local sessions and creation entries on This Mac", () => {
    expect(filterItemsByHost(items, "local").map((item) => item.kind)).toEqual(["rex", "sesh", "dir"]);
  });
  it("shows only sessions owned by the selected remote host", () => {
    expect(filterItemsByHost(items, "remote:studio")).toEqual([items[1]]);
    expect(filterItemsByHost(items, "remote:missing")).toEqual([]);
  });
});
