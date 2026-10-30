// ABOUTME: Focused tests for building a rex session rename call on the right host.
// ABOUTME: Every Rex call is mocked; no test renames a real session.
import { describe, expect, it } from "vitest";
import type { Run } from "./cli";
import { Item, toRexItem, toSeshItems } from "./items";
import { renameSession } from "./rename-session";

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

const rexItem = (label: string, sessionId = "session:local", server?: string): Item =>
  toRexItem({ session_id: sessionId, label }, 1, server);

describe("renameSession", () => {
  it("renames a local session with the full ID and a trimmed label", async () => {
    const { run, calls } = fakeRun(() => "");
    const item = rexItem("old", "session:01JLOCALFULLID");

    await renameSession(run, item, "  New Name  ");

    expect(calls).toEqual([
      {
        program: "rex",
        args: ["--autostart=false", "session", "rename", "--", "session:01JLOCALFULLID", "New Name"],
      },
    ]);
  });

  it("targets the remote host that owns the session", async () => {
    const { run, calls } = fakeRun(() => "");
    const item = rexItem("old", "session:01JREMOTEFULLID", "studio");

    await renameSession(run, item, "Remote Name");

    expect(calls).toEqual([
      {
        program: "rex",
        args: [
          "--server",
          "studio",
          "--autostart=false",
          "session",
          "rename",
          "--",
          "session:01JREMOTEFULLID",
          "Remote Name",
        ],
      },
    ]);
  });

  it("keeps spaces, quotes, unicode and shell syntax in one literal argument", async () => {
    const { run, calls } = fakeRun(() => "");
    const label = `  fix $(rm -rf ~) "quotes" 'single' ; & | 中文  `;

    await renameSession(run, rexItem("old"), label);

    expect(calls).toHaveLength(1);
    expect(calls[0].program).toBe("rex");
    expect(calls[0].args[calls[0].args.length - 1]).toBe(`fix $(rm -rf ~) "quotes" 'single' ; & | 中文`);
    expect(calls[0].args.filter((arg) => arg.includes("rm -rf"))).toHaveLength(1);
  });

  it.each(["-draft", "--server", "--autostart=false", "-h"])(
    "passes an option-like label %s after the -- terminator",
    async (label) => {
      const { run, calls } = fakeRun(() => "");

      await renameSession(run, rexItem("old", "session:flag"), label);

      expect(calls).toHaveLength(1);
      const { args } = calls[0];
      expect(args.slice(0, 5)).toEqual(["--autostart=false", "session", "rename", "--", "session:flag"]);
      expect(args[5]).toBe(label);
      expect(args).toHaveLength(6);
    },
  );

  it.each(["", "   ", "\t\n"])("rejects a blank name %j without calling Rex", async (label) => {
    const { run, calls } = fakeRun(() => "");

    await expect(renameSession(run, rexItem("old"), label)).rejects.toThrow(/empty/i);

    expect(calls).toEqual([]);
  });

  it.each([undefined, "", "   "])("rejects a Rex item without a usable session ID %j", async (sessionId) => {
    const { run, calls } = fakeRun(() => "");
    const item = { ...rexItem("old"), sessionId };

    await expect(renameSession(run, item, "New Name")).rejects.toThrow(/session ID/i);

    expect(calls).toEqual([]);
  });

  it("rejects a non-Rex item even when it carries a session ID", async () => {
    const { run, calls } = fakeRun(() => "");
    const [entry] = toSeshItems([{ Name: "files", Path: "/work/files" }]);
    const item = { ...entry, sessionId: "session:not-rex" };

    await expect(renameSession(run, item, "New Name")).rejects.toThrow(/Only Rex sessions/i);

    expect(calls).toEqual([]);
  });

  it("propagates a failure from Rex after targeting the right session", async () => {
    const failure = new Error("host unreachable");
    const { run, calls } = fakeRun(() => {
      throw failure;
    });

    await expect(renameSession(run, rexItem("old", "session:remote", "laptop"), "New Name")).rejects.toBe(failure);

    expect(calls).toEqual([
      {
        program: "rex",
        args: ["--server", "laptop", "--autostart=false", "session", "rename", "--", "session:remote", "New Name"],
      },
    ]);
  });
});
