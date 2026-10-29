// ABOUTME: Focused tests for discovering local and remote sessions and targeting the right server.
// ABOUTME: Every Rex call is mocked; no test touches a real session or host.
import { describe, expect, it } from "vitest";
import { connect, killSession, loadItems, Run } from "./cli";
import { toRexItem, toSeshItems } from "./items";

interface Call {
  program: string;
  args: string[];
}

function fakeRun(handler: (program: string, args: string[]) => string | Promise<string>): {
  run: Run;
  calls: Call[];
} {
  const calls: Call[] = [];
  const run: Run = async (program, args) => {
    calls.push({ program, args });
    return handler(program, args);
  };
  return { run, calls };
}

const json = (value: unknown) => JSON.stringify(value);
const isLocalLs = (args: string[]) => args.join(" ") === "--autostart=false ls --json";
const isHostLs = (args: string[], host: string) => args.join(" ") === `--server ${host} --autostart=false ls --json`;

function emptyOptional(program: string): string {
  if (program === "sesh") return "[]";
  if (program === "zoxide") return "";
  throw new Error(`unexpected ${program}`);
}

describe("loadItems", () => {
  it("lists local and remote sessions with their own tab counts and host labels", async () => {
    const { run, calls } = fakeRun((program, args) => {
      if (program !== "rex") {
        if (program === "sesh") {
          return json([
            { Name: "same", Path: "/work/same" },
            { Name: "only-sesh", Path: "/work/only" },
          ]);
        }
        if (program === "zoxide") return "/work/only\n/work/app\n";
        return emptyOptional(program);
      }
      if (args[0] === "hosts") {
        return json({ hosts: [{ host: { label: "alpha" } }, { host: { label: "beta" } }], warnings: [] });
      }
      if (args.includes("session.view")) {
        const id = JSON.parse(args[args.length - 1]).session_id;
        return json({ windows: id === "session:alpha" ? [{}, {}, {}] : [{}, {}] });
      }
      if (isLocalLs(args)) return json({ sessions: [{ session_id: "session:local", label: "same" }] });
      if (isHostLs(args, "alpha")) return json({ sessions: [{ session_id: "session:alpha", label: "same" }] });
      if (isHostLs(args, "beta")) return json({ sessions: [{ session_id: "session:beta", label: "beta" }] });
      throw new Error(`unexpected rex ${args.join(" ")}`);
    });

    const { items, warnings } = await loadItems(run, "/work", true, true, true);

    expect(warnings).toEqual([]);
    expect(items.filter((i) => i.kind === "rex").map((i) => [i.label, i.server, i.windows])).toEqual([
      ["same", undefined, 2],
      ["same", "alpha", 3],
      ["beta", "beta", 2],
    ]);
    expect(items.filter((i) => i.kind === "sesh").map((i) => i.title)).toEqual(["only-sesh"]);
    expect(items.filter((i) => i.kind === "dir").map((i) => i.title)).toEqual(["~/app"]);
    expect(calls.some((c) => c.args.includes("session.view") && c.args.includes("alpha"))).toBe(true);
    expect(calls.some((c) => c.args.includes("session.view") && c.args.includes("beta"))).toBe(true);
  });

  it("keeps other hosts and local sessions when one host is unavailable", async () => {
    const { run } = fakeRun((program, args) => {
      if (program !== "rex") return emptyOptional(program);
      if (args[0] === "hosts") return json({ hosts: [{ host: { label: "alpha" } }, { host: { label: "beta" } }] });
      if (isLocalLs(args)) return json({ sessions: [{ session_id: "session:local", label: "mine" }] });
      if (isHostLs(args, "alpha")) throw new Error("connection refused");
      if (isHostLs(args, "beta")) return json({ sessions: [{ session_id: "session:beta", label: "theirs" }] });
      if (args.includes("session.view")) return json({ windows: [{}] });
      throw new Error(`unexpected rex ${args.join(" ")}`);
    });

    const { items, warnings } = await loadItems(run, "/home/me", false);

    expect(items.map((i) => i.title)).toEqual(["mine", "theirs"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("alpha");
    expect(warnings[0]).toContain("connection refused");
  });

  it("keeps remote sessions when the local server is unavailable", async () => {
    const { run } = fakeRun((program, args) => {
      if (program !== "rex") return emptyOptional(program);
      if (args[0] === "hosts") return json({ hosts: [{ host: { label: "alpha" } }] });
      if (isLocalLs(args)) throw new Error("no local server");
      if (isHostLs(args, "alpha")) return json({ sessions: [{ session_id: "session:alpha", label: "remote" }] });
      if (args.includes("session.view")) return json({ windows: [{}] });
      throw new Error(`unexpected rex ${args.join(" ")}`);
    });

    const { items, warnings } = await loadItems(run, "/home/me", false);

    expect(items.map((i) => [i.title, i.server])).toEqual([["remote", "alpha"]]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("local");
  });

  it("still lists local sessions when the Rex version has no hosts command", async () => {
    const { run, calls } = fakeRun((program, args) => {
      if (program !== "rex") return emptyOptional(program);
      if (args[0] === "hosts") throw new Error('unknown command "hosts" for "rex"');
      if (isLocalLs(args)) return json({ sessions: [{ session_id: "session:local", label: "mine" }] });
      if (args.includes("session.view")) return json({ windows: [{}] });
      throw new Error(`unexpected rex ${args.join(" ")}`);
    });

    const { items, warnings } = await loadItems(run, "/home/me", false);

    expect(items.map((i) => i.title)).toEqual(["mine"]);
    expect(warnings).toEqual([]);
    expect(calls.some((c) => c.args.includes("--server"))).toBe(false);
  });

  it.each(["connection timed out", "malformed JSON"])("reports host discovery failure: %s", async (failure) => {
    const { run } = fakeRun((program, args) => {
      if (program !== "rex") return emptyOptional(program);
      if (args[0] === "hosts") {
        if (failure === "malformed JSON") return "{";
        throw new Error(failure);
      }
      if (isLocalLs(args)) return json({ sessions: [{ session_id: "session:local", label: "mine" }] });
      if (args.includes("session.view")) return json({ windows: [] });
      throw new Error(`unexpected rex ${args.join(" ")}`);
    });
    const { items, warnings } = await loadItems(run, "/home/me", false);
    expect(items.map((item) => item.title)).toEqual(["mine"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Couldn't discover Rex hosts");
  });

  it("reports malformed remote session lists instead of treating them as empty", async () => {
    const { run } = fakeRun((program, args) => {
      if (program !== "rex") return emptyOptional(program);
      if (args[0] === "hosts") return json({ hosts: [{ host: { label: "alpha" } }] });
      if (isLocalLs(args)) return json({ sessions: [] });
      if (isHostLs(args, "alpha")) return "{}";
      throw new Error(`unexpected rex ${args.join(" ")}`);
    });
    const { warnings } = await loadItems(run, "/home/me", false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("alpha");
    expect(warnings[0]).toContain("Invalid Rex session list response");
  });

  it("does not query sesh by default or hide its directories", async () => {
    const { run, calls } = fakeRun((program, args) => {
      if (program === "zoxide") return "/work/project\n";
      if (program === "rex" && isLocalLs(args)) return json({ sessions: [] });
      throw new Error(`unexpected ${program} ${args.join(" ")}`);
    });
    const { items } = await loadItems(run, "/work", true, false);
    expect(calls.some((call) => call.program === "sesh")).toBe(false);
    expect(items.map((item) => [item.kind, item.path])).toEqual([["dir", "/work/project"]]);
  });

  it("does not ask for hosts when remote sessions are turned off", async () => {
    const { run, calls } = fakeRun((program, args) => {
      if (program !== "rex") return emptyOptional(program);
      if (isLocalLs(args)) return json({ sessions: [] });
      throw new Error(`unexpected rex ${args.join(" ")}`);
    });

    await loadItems(run, "/home/me", false, false);

    expect(calls.some((c) => c.args[0] === "hosts")).toBe(false);
    expect(calls.some((c) => c.args.includes("--server"))).toBe(false);
  });

  it("surfaces host list warnings without discarding local sessions", async () => {
    const { run } = fakeRun((program, args) => {
      if (program !== "rex") return emptyOptional(program);
      if (args[0] === "hosts") return json({ hosts: [], warnings: ["home is away"] });
      if (isLocalLs(args)) return json({ sessions: [{ session_id: "session:local", label: "mine" }] });
      if (args.includes("session.view")) return json({ windows: [{}] });
      throw new Error(`unexpected rex ${args.join(" ")}`);
    });

    const { items, warnings } = await loadItems(run, "/home/me", false);

    expect(items.map((i) => i.title)).toEqual(["mine"]);
    expect(warnings).toEqual(["home is away"]);
  });
});

describe("connect", () => {
  it("selects a remote session through the local app instead of the remote server", async () => {
    const { run, calls } = fakeRun((_program, args) => {
      if (args.join(" ") !== "do session.select session_id=session:remote") {
        throw new Error(`unexpected rex ${args.join(" ")}`);
      }
      return "";
    });
    const remote = toRexItem({ session_id: "session:remote", label: "api" }, 2, "alpha");

    await connect(run, remote, "/bin/zsh");

    expect(calls).toEqual([{ program: "rex", args: ["do", "session.select", "session_id=session:remote"] }]);
  });

  it("reuses an open local session with the item's label", async () => {
    const { run, calls } = fakeRun((program, args) => {
      if (program === "rex" && isLocalLs(args)) {
        return json({ sessions: [{ session_id: "session:local", label: "files" }] });
      }
      if (program === "rex" && args[0] === "do") return "";
      throw new Error(`unexpected ${program} ${args.join(" ")}`);
    });
    const [entry] = toSeshItems([{ Name: "files", Path: "/work/files" }]);

    await connect(run, entry, "/bin/zsh");

    expect(calls.map((c) => c.args)).toEqual([
      ["--autostart=false", "ls", "--json"],
      ["do", "session.select", "session_id=session:local"],
    ]);
  });

  it("creates a sesh entry on the local server, never a remote host", async () => {
    const { run, calls } = fakeRun((program, args) => {
      if (program === "rex" && isLocalLs(args)) return json({ sessions: [] });
      if (program === "rex" && args[0] === "new") return json({ session_id: "session:new" });
      if (program === "rex" && args[0] === "do") return "";
      throw new Error(`unexpected ${program} ${args.join(" ")}`);
    });
    const [entry] = toSeshItems([{ Name: "shared", Path: "/work/shared" }]);

    await connect(run, entry, "/bin/zsh");

    expect(calls.some((c) => c.args[0] === "new" && c.args[1] === "shared")).toBe(true);
    expect(calls.some((c) => c.args.includes("--server"))).toBe(false);
  });
});

describe("killSession", () => {
  it("targets the remote host that owns the session", async () => {
    const { run, calls } = fakeRun(() => "");
    const remote = toRexItem({ session_id: "session:remote", label: "api" }, 1, "alpha");

    await killSession(run, remote);

    expect(calls).toEqual([
      { program: "rex", args: ["--server", "alpha", "--autostart=false", "kill", "session:remote"] },
    ]);
  });

  it("keeps local kills on the local server", async () => {
    const { run, calls } = fakeRun(() => "");
    const local = toRexItem({ session_id: "session:local", label: "api" }, 1);

    await killSession(run, local);

    expect(calls).toEqual([{ program: "rex", args: ["kill", "session:local"] }]);
  });
});
