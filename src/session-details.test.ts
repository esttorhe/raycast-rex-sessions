// ABOUTME: Tests for reading a session's tabs, panes and working directories without touching real sessions.
// ABOUTME: Every Rex call is mocked, covering remote hosts, pane failures, malformed views and bounded reads.
import { describe, expect, it } from "vitest";
import type { Run } from "./cli";
import { Item, toRexItem, toSeshItems } from "./items";
import { loadSessionDetails, readWorkingDirectory } from "./session-details";

interface Call {
  program: string;
  args: string[];
}

const SESSION_ID = "session:details";
const TERMINAL = "com.superlogical.terminal";

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

function prefix(server?: string): string {
  return server ? `--server ${server} --autostart=false ` : "--autostart=false ";
}

function viewCall(server?: string): string {
  return `${prefix(server)}api call session.view ${json({ session_id: SESSION_ID })}`;
}

function blockCall(blockId: string, method: string, server?: string): string {
  return `${prefix(server)}block call -s ${SESSION_ID} -b ${blockId} ${method}`;
}

function terminalBlock(blockId: string | undefined, label: string) {
  return {
    ...(blockId ? { block_id: blockId } : {}),
    label,
    creator_name: TERMINAL,
    flavor: `${TERMINAL}.shell`,
    host_id: "host:test",
  };
}

function editorBlock(blockId: string, label: string) {
  return {
    block_id: blockId,
    label,
    creator_name: "com.superlogical.editor",
    flavor: "com.superlogical.editor.code",
    host_id: "host:test",
  };
}

function viewWith(blocks: unknown[], focusedBlockId?: string) {
  return {
    revision: 1,
    session_id: SESSION_ID,
    label: "api-work",
    active_window_id: "window:one",
    windows: [
      {
        window_id: "window:one",
        label: "Server",
        ...(focusedBlockId ? { focused_block_id: focusedBlockId } : {}),
        layers: [{ layer_id: "layer:one", kind: "tiled", bounds: [0, 0, 1, 1], blocks }],
      },
    ],
  };
}

describe("loadSessionDetails", () => {
  it("lists tabs and panes from every layer with live working directories", async () => {
    const view = {
      revision: 4,
      session_id: SESSION_ID,
      label: "api-work",
      active_window_id: "window:two",
      windows: [
        {
          window_id: "window:one",
          label: "Server",
          focused_block_id: "block:api",
          layers: [
            {
              layer_id: "layer:tiled",
              kind: "tiled",
              bounds: [0, 0, 1, 1],
              blocks: [terminalBlock("block:api", "api"), terminalBlock("block:logs", "logs")],
            },
            {
              layer_id: "layer:float",
              kind: "floating",
              bounds: [0, 0, 0.5, 0.5],
              blocks: [editorBlock("block:editor", "editor")],
            },
          ],
        },
        {
          window_id: "window:two",
          label: "Tests",
          focused_block_id: "block:test",
          layers: [
            {
              layer_id: "layer:two",
              kind: "tiled",
              bounds: [0, 0, 1, 1],
              blocks: [terminalBlock("block:test", "test")],
            },
          ],
        },
      ],
    };
    const { run, calls } = fakeRun((program, args) => {
      const joined = args.join(" ");
      if (program !== "rex") throw new Error(`unexpected ${program}`);
      if (joined === viewCall()) return json(view);
      if (joined === blockCall("block:api", "process")) {
        return json({ foreground: { pid: 1, user_id: 501, name: "zsh", cwd: "/work/api" } });
      }
      if (joined === blockCall("block:logs", "process")) {
        return json({
          foreground: { pid: 2, user_id: 501, name: "zsh" },
          child: { pid: 3, user_id: 501, name: "zsh", cwd: "/work/logs" },
        });
      }
      if (joined === blockCall("block:test", "process")) {
        return json({ foreground: { pid: 4, user_id: 501, name: "node" } });
      }
      if (joined === blockCall("block:test", "pwd")) {
        return json({ pwd: "file://MacBook-Air.local/Users/eist/My%20Project" });
      }
      throw new Error(`unexpected rex ${joined}`);
    });

    const details = await loadSessionDetails(run, toRexItem({ session_id: SESSION_ID, label: "stale" }, 2));

    expect(details).toMatchObject({
      sessionId: SESSION_ID,
      label: "api-work",
      activeWindowId: "window:two",
    });
    expect(details.server).toBeUndefined();
    expect(details.tabs.map((tab) => [tab.windowId, tab.label, tab.active])).toEqual([
      ["window:one", "Server", false],
      ["window:two", "Tests", true],
    ]);
    expect(details.tabs[0].panes).toEqual([
      { blockId: "block:api", label: "api", active: true, terminal: true, cwd: "/work/api", cwdSource: "process" },
      {
        blockId: "block:logs",
        label: "logs",
        active: false,
        terminal: true,
        cwd: "/work/logs",
        cwdSource: "process",
      },
      { blockId: "block:editor", label: "editor", active: false, terminal: false },
    ]);
    expect(details.tabs[1].panes[0]).toMatchObject({
      cwd: "/Users/eist/My Project",
      cwdSource: "pwd",
    });
    expect(calls.some((call) => call.args.join(" ").includes("block:editor"))).toBe(false);
    expect(calls.some((call) => call.args.join(" ") === blockCall("block:api", "pwd"))).toBe(false);
    expect(calls).toHaveLength(5);
  });

  it("passes the remote host to the session view and every pane read", async () => {
    const { run, calls } = fakeRun((_program, args) => {
      const joined = args.join(" ");
      if (joined === viewCall("alpha")) return json(viewWith([terminalBlock("block:api", "api")], "block:api"));
      if (joined === blockCall("block:api", "process", "alpha")) {
        return json({ foreground: { pid: 1, user_id: 501, name: "zsh", cwd: "/srv/api" } });
      }
      throw new Error(`unexpected rex ${joined}`);
    });

    const details = await loadSessionDetails(run, toRexItem({ session_id: SESSION_ID, label: "api" }, 1, "alpha"));

    expect(details.server).toBe("alpha");
    expect(details.tabs[0].panes[0].cwd).toBe("/srv/api");
    expect(calls.map((call) => call.args.join(" "))).toEqual([
      viewCall("alpha"),
      blockCall("block:api", "process", "alpha"),
    ]);
    for (const call of calls) {
      expect(call.program).toBe("rex");
      expect(call.args.slice(0, 3)).toEqual(["--server", "alpha", "--autostart=false"]);
    }
  });

  it("falls back to the reported directory when the process read fails", async () => {
    const { run } = fakeRun((_program, args) => {
      const joined = args.join(" ");
      if (joined === viewCall()) return json(viewWith([terminalBlock("block:shell", "shell")], "block:shell"));
      if (joined === blockCall("block:shell", "process")) throw new Error("process table unavailable");
      if (joined === blockCall("block:shell", "pwd")) return json({ pwd: "file:///tmp/space%20dir" });
      throw new Error(`unexpected rex ${joined}`);
    });

    const details = await loadSessionDetails(run, toRexItem({ session_id: SESSION_ID, label: "api" }));

    expect(details.tabs[0].panes[0]).toMatchObject({
      cwd: "/tmp/space dir",
      cwdSource: "pwd",
    });
    expect(details.tabs[0].panes[0].cwdError).toBeUndefined();
  });

  it("marks a terminal without any reported directory instead of inventing one", async () => {
    const { run } = fakeRun((_program, args) => {
      const joined = args.join(" ");
      if (joined === viewCall()) return json(viewWith([terminalBlock("block:shell", "shell")]));
      if (joined === blockCall("block:shell", "process")) return json({ last_exit: null });
      if (joined === blockCall("block:shell", "pwd")) return json({});
      throw new Error(`unexpected rex ${joined}`);
    });

    const details = await loadSessionDetails(run, toRexItem({ session_id: SESSION_ID, label: "api" }));
    const pane = details.tabs[0].panes[0];

    expect(pane.cwd).toBeUndefined();
    expect(pane.cwdSource).toBeUndefined();
    expect(pane.cwdError).toBe("No working directory was reported for this pane");
    expect(details.tabs[0].label).toBe("Server");
  });

  it("keeps every tab when one pane cannot be read", async () => {
    const view = {
      revision: 2,
      session_id: SESSION_ID,
      label: "api-work",
      active_window_id: "window:one",
      windows: [
        {
          window_id: "window:one",
          label: "Broken",
          focused_block_id: "block:broken",
          layers: [
            {
              layer_id: "layer:one",
              kind: "tiled",
              bounds: [0, 0, 1, 1],
              blocks: [terminalBlock("block:broken", "broken")],
            },
          ],
        },
        {
          window_id: "window:two",
          label: "Healthy",
          focused_block_id: "block:healthy",
          layers: [
            {
              layer_id: "layer:two",
              kind: "tiled",
              bounds: [0, 0, 1, 1],
              blocks: [terminalBlock("block:healthy", "healthy")],
            },
          ],
        },
      ],
    };
    const { run } = fakeRun((_program, args) => {
      const joined = args.join(" ");
      if (joined === viewCall()) return json(view);
      if (joined === blockCall("block:broken", "process") || joined === blockCall("block:broken", "pwd")) {
        throw new Error("pane went away");
      }
      if (joined === blockCall("block:healthy", "process")) {
        return json({ foreground: { pid: 9, user_id: 501, name: "zsh", cwd: "/work/healthy" } });
      }
      throw new Error(`unexpected rex ${joined}`);
    });

    const details = await loadSessionDetails(run, toRexItem({ session_id: SESSION_ID, label: "api" }));

    expect(details.tabs.map((tab) => tab.label)).toEqual(["Broken", "Healthy"]);
    expect(details.tabs[0].panes[0].cwd).toBeUndefined();
    expect(details.tabs[0].panes[0].cwdError).toContain("pane went away");
    expect(details.tabs[1].panes[0].cwd).toBe("/work/healthy");
    expect(details.tabs[1].panes[0].cwdError).toBeUndefined();
  });

  it("leaves non-terminal blocks alone and still lists their tab", async () => {
    const { run, calls } = fakeRun((_program, args) => {
      if (args.join(" ") === viewCall()) return json(viewWith([editorBlock("block:editor", "editor")]));
      throw new Error(`unexpected rex ${args.join(" ")}`);
    });

    const details = await loadSessionDetails(run, toRexItem({ session_id: SESSION_ID, label: "api" }));

    expect(details.tabs).toHaveLength(1);
    expect(details.tabs[0].panes[0]).toEqual({
      blockId: "block:editor",
      label: "editor",
      active: false,
      terminal: false,
    });
    expect(calls).toHaveLength(1);
  });

  it("reports a terminal block without an ID without calling Rex", async () => {
    const { run, calls } = fakeRun((_program, args) => {
      if (args.join(" ") === viewCall()) return json(viewWith([terminalBlock(undefined, "shell")]));
      throw new Error(`unexpected rex ${args.join(" ")}`);
    });

    const details = await loadSessionDetails(run, toRexItem({ session_id: SESSION_ID, label: "api" }));
    const pane = details.tabs[0].panes[0];

    expect(pane.terminal).toBe(true);
    expect(pane.blockId).toBeUndefined();
    expect(pane.cwd).toBeUndefined();
    expect(pane.cwdError).toContain("no block ID");
    expect(calls).toHaveLength(1);
  });

  it("accepts an empty session without windows", async () => {
    const { run } = fakeRun((_program, args) => {
      if (args.join(" ") === viewCall()) {
        return json({ revision: 0, session_id: SESSION_ID, label: "empty", windows: null });
      }
      throw new Error(`unexpected rex ${args.join(" ")}`);
    });

    const details = await loadSessionDetails(run, toRexItem({ session_id: SESSION_ID, label: "empty" }));

    expect(details.tabs).toEqual([]);
    expect(details.label).toBe("empty");
  });

  it("rejects entries that are not Rex sessions or have no session ID before calling Rex", async () => {
    const { run, calls } = fakeRun(() => {
      throw new Error("Rex should not be called");
    });
    const missingId: Item = { id: "rex:missing", kind: "rex", title: "missing", label: "missing" };
    const [sesh] = toSeshItems([{ Name: "files", Path: "/work/files" }]);

    await expect(loadSessionDetails(run, missingId)).rejects.toThrow("has no session ID");
    await expect(loadSessionDetails(run, sesh)).rejects.toThrow("Only Rex sessions have details");
    expect(calls).toEqual([]);
  });

  it.each([
    ["malformed JSON", "{"],
    ["a non-object", json([])],
    ["a missing label", json({ windows: [] })],
    ["a mismatched session ID", json({ label: "other", session_id: "session:other", windows: [] })],
    ["windows that are not an array", json({ label: "api", windows: {} })],
    ["a window without an ID", json({ label: "api", windows: [{ layers: [] }] })],
    [
      "layers whose blocks are not an array",
      json({ label: "api", windows: [{ window_id: "window:one", layers: [{ blocks: {} }] }] }),
    ],
  ])("rejects a malformed session view: %s", async (_name, response) => {
    const { run, calls } = fakeRun((_program, args) => {
      if (args.join(" ") === viewCall()) return response;
      throw new Error(`unexpected rex ${args.join(" ")}`);
    });

    await expect(loadSessionDetails(run, toRexItem({ session_id: SESSION_ID, label: "api" }))).rejects.toThrow(
      "Invalid session.view response",
    );
    expect(calls).toHaveLength(1);
  });

  it("bounds pane reads when a session has many terminals", async () => {
    const blocks = Array.from({ length: 12 }, (_, index) => terminalBlock(`block:pane-${index}`, `pane ${index}`));
    const view = viewWith(blocks, "block:pane-0");
    const calls: Call[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const run: Run = async (program, args) => {
      calls.push({ program, args });
      const joined = args.join(" ");
      if (joined === viewCall()) return json(view);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await new Promise((resolve) => setTimeout(resolve, 2));
        const blockId = args[args.indexOf("-b") + 1];
        return json({ foreground: { pid: 1, user_id: 501, name: "zsh", cwd: `/work/${blockId}` } });
      } finally {
        inFlight -= 1;
      }
    };

    const details = await loadSessionDetails(run, toRexItem({ session_id: SESSION_ID, label: "many" }));

    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(calls).toHaveLength(13);
    expect(details.tabs[0].panes.map((pane) => pane.cwd)).toEqual(blocks.map((block) => `/work/${block.block_id}`));
  });
});

describe("readWorkingDirectory", () => {
  it("reports the server user's home alongside a live directory", async () => {
    const { run } = fakeRun((_program, args) => {
      if (args.join(" ") === blockCall("block:api", "process", "pi")) {
        return json({ home: "/home/eist", foreground: { name: "nvim", cwd: "/home/eist/app" } });
      }
      throw new Error(`unexpected rex ${args.join(" ")}`);
    });

    await expect(readWorkingDirectory(run, "pi", SESSION_ID, "block:api")).resolves.toEqual({
      cwd: "/home/eist/app",
      home: "/home/eist",
      process: "nvim",
      source: "process",
    });
  });

  it("keeps the home when falling back to the reported directory", async () => {
    const { run } = fakeRun((_program, args) => {
      const joined = args.join(" ");
      if (joined === blockCall("block:api", "process", "pi")) return json({ home: "/home/eist" });
      if (joined === blockCall("block:api", "pwd", "pi")) return json({ pwd: "file://host/home/eist/app" });
      throw new Error(`unexpected rex ${joined}`);
    });

    await expect(readWorkingDirectory(run, "pi", SESSION_ID, "block:api")).resolves.toEqual({
      cwd: "/home/eist/app",
      home: "/home/eist",
      source: "pwd",
    });
  });
});
