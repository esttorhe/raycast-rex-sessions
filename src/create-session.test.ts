// ABOUTME: Focused tests for creating a Rex session on this Mac or a remote host.
// ABOUTME: Rex is always mocked; no test creates, selects or kills a real session.
import { describe, expect, it } from "vitest";
import type { Run } from "./cli";
import { createSession, SESSION_NAME_REQUIRED } from "./create-session";

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

describe("createSession", () => {
  it("creates a local session with a trimmed name and no --server or -c", async () => {
    const { run, calls } = fakeRun(() => json({ session_id: "session:new", initial_windows: [] }));

    const item = await createSession(run, { label: "  api  " });

    expect(calls).toEqual([{ program: "rex", args: ["--autostart=false", "new", "api", "--json"] }]);
    expect(item).toMatchObject({
      id: "rex:session:new",
      kind: "rex",
      title: "api",
      label: "api",
      sessionId: "session:new",
    });
    expect(item.server).toBeUndefined();
    expect(item.path).toBeUndefined();
    expect(item.startup).toBeUndefined();
  });

  it("creates a remote session with the host flag and its own working directory", async () => {
    const { run, calls } = fakeRun(() => json({ session_id: "session:remote" }));

    const item = await createSession(run, {
      label: "api",
      server: "  studio  ",
      cwd: "  /home/me/src/api  ",
    });

    expect(calls).toEqual([
      {
        program: "rex",
        args: ["--server", "studio", "--autostart=false", "new", "api", "-c", "/home/me/src/api", "--json"],
      },
    ]);
    expect(item).toMatchObject({
      id: "rex:studio:session:remote",
      label: "api",
      path: "/home/me/src/api",
      server: "studio",
      sessionId: "session:remote",
    });
  });

  it("runs a startup command through the host's sh and leaves the host's shell interactive", async () => {
    const { run, calls } = fakeRun(() => json({ session_id: "session:remote" }));

    const item = await createSession(run, {
      label: "api",
      server: "studio",
      startup: "  npm run dev  ",
    });

    const args = calls[0].args;
    expect(args.slice(0, 8)).toEqual(["--server", "studio", "--autostart=false", "new", "api", "--json", "--", "sh"]);
    // The command is one argument, not interpolated into a locally quoted shell line.
    expect(args.slice(8)).toEqual(["-lc", 'npm run dev\nexec "${SHELL:-sh}" -l']);
    expect(args).not.toContain("/bin/zsh");
    expect(args).not.toContain("/bin/sh");
    expect(item.startup).toBe("npm run dev");
  });

  it("omits blank cwd and startup values", async () => {
    const { run, calls } = fakeRun(() => json({ session_id: "session:new" }));

    await createSession(run, { label: "api", cwd: "   ", startup: "\n  " });

    expect(calls[0].args).toEqual(["--autostart=false", "new", "api", "--json"]);
  });

  it("treats a blank server as this Mac", async () => {
    const { run, calls } = fakeRun(() => json({ session_id: "session:new" }));

    const item = await createSession(run, { label: "api", server: "  " });

    expect(calls[0].args).toEqual(["--autostart=false", "new", "api", "--json"]);
    expect(item.server).toBeUndefined();
  });

  it("rejects option-like names before invoking Rex", async () => {
    const { run, calls } = fakeRun(() => json({ session_id: "never" }));
    await expect(createSession(run, { label: "--help" })).rejects.toThrow("must not start with a hyphen");
    expect(calls).toEqual([]);
  });

  it.each(["", "   ", "\n\t "])("rejects a name that trims to nothing: %j", async (label) => {
    const { run, calls } = fakeRun(() => json({ session_id: "never" }));

    await expect(createSession(run, { label })).rejects.toThrow(SESSION_NAME_REQUIRED);
    expect(calls).toEqual([]);
  });

  it.each<[string, string]>([
    ["invalid JSON", "{"],
    ["null", "null"],
    ["an array", "[]"],
    ["no session ID", json({ initial_windows: [] })],
    ["a blank session ID", json({ session_id: "   " })],
    ["a non-string session ID", json({ session_id: 42 })],
  ])("reports %s instead of returning an unusable item", async (_case, response) => {
    const { run, calls } = fakeRun(() => response);

    await expect(createSession(run, { label: "api" })).rejects.toThrow("Invalid Rex session response");
    expect(calls).toHaveLength(1);
  });
});
