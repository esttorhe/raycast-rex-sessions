// ABOUTME: Focused tests for checking This Mac and configured Rex hosts without touching them.
// ABOUTME: Rex is always mocked; no test starts a server, changes a host, or reads a real session.
import { describe, expect, it } from "vitest";
import type { Run } from "./cli";
import {
  checkHostConnection,
  hostCheckReducer,
  hostKey,
  hostOptions,
  initialHostCheckState,
  selectedHostKey,
  type HostConnectionResult,
} from "./host-connection";

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
const LOCAL_ARGS = ["--autostart=false", "server", "status", "--json"];
const remoteArgs = (label: string) => ["--autostart=false", "--timeout", "5s", "hosts", "check", label, "--json"];

describe("checkHostConnection on a remote host", () => {
  it("uses the read-only hosts check flags and reads a reachable result", async () => {
    const response = {
      hosts: [
        {
          label: "pi",
          id: "host:9013d1f8",
          status: "reachable",
          endpoint: "https://rex.tail80a5cb.ts.net",
          attempts: [{ endpoint: "https://rex.tail80a5cb.ts.net" }],
        },
      ],
    };
    const { run, calls } = fakeRun((program) => {
      expect(program).toBe("rex");
      return json(response);
    });

    const result = await checkHostConnection(run, "pi");

    expect(calls).toEqual([{ program: "rex", args: remoteArgs("pi") }]);
    expect(result).toMatchObject({
      server: "pi",
      status: "reachable",
      endpoint: "https://rex.tail80a5cb.ts.net",
      attempts: ["https://rex.tail80a5cb.ts.net"],
    });
    expect(result.detail).toContain("Rex host pi answered");
    expect(result.error).toBeUndefined();
  });

  it("matches a label without regard to case and picks the intended entry", async () => {
    const { run } = fakeRun(() =>
      json({
        hosts: [
          { label: "infravm", status: "down", endpoint: "https://other.example" },
          { label: "PI", status: "reachable", endpoint: "https://pi.example" },
        ],
      }),
    );

    const result = await checkHostConnection(run, "  pi  ");

    expect(result.server).toBe("pi");
    expect(result.status).toBe("reachable");
    expect(result.endpoint).toBe("https://pi.example");
  });

  it("reports a machine that answered but is not a Rex server", async () => {
    const { run } = fakeRun(() =>
      json({
        hosts: [
          {
            label: "pi",
            status: "down",
            endpoint: "https://pi.example",
            attempts: [{ endpoint: "https://pi.example", error: "not a Rex server" }],
          },
        ],
      }),
    );

    const result = await checkHostConnection(run, "pi");

    expect(result.status).toBe("down");
    expect(result.detail).toContain("not a Rex server");
    expect(result.attempts).toEqual(["https://pi.example: not a Rex server"]);
  });

  it("keeps an unreachable-from-here result distinct from down", async () => {
    const { run } = fakeRun(() =>
      json({
        hosts: [
          {
            label: "pi",
            status: "not reachable from here",
            attempts: [{ endpoint: "https://pi.example", error: "connection refused" }],
          },
        ],
      }),
    );

    const result = await checkHostConnection(run, "pi");

    expect(result.status).toBe("not reachable from here");
    expect(result.detail).toContain("may work from another network");
    expect(result.attempts).toEqual(["https://pi.example: connection refused"]);
  });

  it("does not treat CLI exit 0 as reachable when Rex reports down", async () => {
    const { run } = fakeRun(() => json({ hosts: [{ label: "pi", status: "down", endpoint: "https://pi.example" }] }));

    const result = await checkHostConnection(run, "pi");

    expect(result.status).toBe("down");
    expect(result.status).not.toBe("reachable");
  });

  it.each<[string, string]>([
    ["empty output", ""],
    ["invalid JSON", "{"],
    ["null", "null"],
    ["an object without hosts", "{}"],
    ["hosts as an object", '{"hosts":{}}'],
    ["no hosts", '{"hosts":[]}'],
    ["a different host", '{"hosts":[{"label":"other","status":"reachable"}]}'],
    ["a host without a status", '{"hosts":[{"label":"pi"}]}'],
    ["an unsupported status", '{"hosts":[{"label":"pi","status":"maybe"}]}'],
    ["a non-string status", '{"hosts":[{"label":"pi","status":42}]}'],
  ])("reports an unverified result for %s", async (_case, response) => {
    const { run } = fakeRun(() => response);

    const result = await checkHostConnection(run, "pi");

    expect(result.status).toBe("unknown");
    expect(result.error).toBeTruthy();
    expect(result.detail).not.toBe("");
  });

  it("reports an older Rex that cannot check hosts instead of an empty success", async () => {
    const { run } = fakeRun(() => {
      throw new Error('unknown command "hosts" for "rex"');
    });

    const result = await checkHostConnection(run, "pi");

    expect(result.status).toBe("unknown");
    expect(result.detail).toContain("does not support checking hosts");
    expect(result.error).toContain("unknown command");
  });

  it("keeps a thrown check failure visible", async () => {
    const { run } = fakeRun(() => {
      throw new Error('Error: no host has that label: "nope"');
    });

    const result = await checkHostConnection(run, "nope");

    expect(result.status).toBe("unknown");
    expect(result.detail).toContain("Could not check nope");
    expect(result.error).toContain("no host has that label");
  });

  it("renders richer attempt details without dropping their reason", async () => {
    const { run } = fakeRun(() =>
      json({
        hosts: [
          {
            label: "pi",
            status: "not reachable from here",
            attempts: [
              { endpoint: "https://pi.example", detail: { message: "timed out" } },
              { endpoint: "ssh://pi.example", status: "refused" },
            ],
          },
        ],
      }),
    );

    const result = await checkHostConnection(run, "pi");

    expect(result.attempts).toEqual(["https://pi.example: timed out", "ssh://pi.example: refused"]);
  });
});

describe("checkHostConnection on This Mac", () => {
  it("checks the local server without a host and without starting it", async () => {
    const { run, calls } = fakeRun((program) => {
      expect(program).toBe("rex");
      return json({ endpoint: "unix:///Users/me/Library/Application Support/rex/server.sock", pid: 92694 });
    });

    const result = await checkHostConnection(run);

    expect(calls).toEqual([{ program: "rex", args: LOCAL_ARGS }]);
    expect(calls[0].args).not.toContain("--server");
    expect(calls[0].args).not.toContain("start");
    expect(result.server).toBeUndefined();
    expect(result.status).toBe("reachable");
    expect(result.endpoint).toBe("unix:///Users/me/Library/Application Support/rex/server.sock");
    expect(result.attempts).toEqual(["unix:///Users/me/Library/Application Support/rex/server.sock"]);
    expect(result.detail).toContain("This Mac");
  });

  it("treats a blank host as This Mac", async () => {
    const { run, calls } = fakeRun(() => json({ endpoint: "unix:///tmp/rex.sock" }));

    const result = await checkHostConnection(run, "   ");

    expect(calls).toEqual([{ program: "rex", args: LOCAL_ARGS }]);
    expect(result.status).toBe("reachable");
  });

  it("reports no local server as not reachable from here", async () => {
    const { run } = fakeRun(() => {
      throw new Error(
        "Command failed: rex --autostart=false server status --json\nError: connect: no such file or directory",
      );
    });

    const result = await checkHostConnection(run);

    expect(result.status).toBe("not reachable from here");
    expect(result.detail).toContain("No Rex server answered on This Mac");
    expect(result.error).toContain("no such file or directory");
  });

  it("reports a local server that Rex says is not running", async () => {
    const { run } = fakeRun(() => json({ running: false, endpoint: "unix:///tmp/rex.sock" }));

    const result = await checkHostConnection(run);

    expect(result.status).toBe("not reachable from here");
    expect(result.endpoint).toBe("unix:///tmp/rex.sock");
    expect(result.detail).toContain("not running");
  });

  it.each<[string, string]>([
    ["invalid JSON", "{"],
    ["null", "null"],
    ["an array", "[]"],
    ["no endpoint", "{}"],
    ["a blank endpoint", '{"endpoint":"   "}'],
  ])("reports an unverified local result for %s", async (_case, response) => {
    const { run } = fakeRun(() => response);

    const result = await checkHostConnection(run);

    expect(result.status).toBe("unknown");
    expect(result.error).toBeTruthy();
    expect(result.detail).not.toBe("");
  });

  it("reports an older Rex that cannot check the local server", async () => {
    const { run } = fakeRun(() => {
      throw new Error('unknown command "server" for "rex"');
    });

    const result = await checkHostConnection(run);

    expect(result.status).toBe("unknown");
    expect(result.detail).toContain("does not support checking the local server");
    expect(result.error).toContain("unknown command");
  });
});

describe("host selection helpers", () => {
  it("lists This Mac's configured hosts once and keeps a requested host", () => {
    expect(hostOptions(["pi", "PI", " studio ", ""], "infravm")).toEqual(["pi", "studio", "infravm"]);
    expect(hostOptions(["pi"], "PI")).toEqual(["pi"]);
    expect(hostOptions([], "  ")).toEqual([]);
  });

  it("selects a host without regard to case, or This Mac by default", () => {
    const labels = hostOptions(["pi", "studio"], "PI");

    expect(selectedHostKey(labels, "PI")).toBe("host:pi");
    expect(selectedHostKey(labels, "new-host")).toBe("host:new-host");
    expect(selectedHostKey(labels)).toBe("local");
    expect(hostKey(" Pi ")).toBe("host:pi");
    expect(hostKey()).toBe("local");
  });
});

describe("hostCheckReducer", () => {
  const reachable: HostConnectionResult = {
    server: "pi",
    status: "reachable",
    detail: "Rex host pi answered at https://pi.example.",
    endpoint: "https://pi.example",
    attempts: ["https://pi.example"],
  };

  it("keeps check results and listing retries independent", () => {
    let state = initialHostCheckState();
    expect(state.retrying).toBe(false);

    state = hostCheckReducer(state, { type: "checkStarted", key: "host:pi" });
    expect(state.checking).toBe("host:pi");

    state = hostCheckReducer(state, { type: "checked", key: "host:pi", result: reachable });
    expect(state.checking).toBeUndefined();
    expect(state.results["host:pi"]).toBe(reachable);

    state = hostCheckReducer(state, { type: "retryStarted" });
    expect(state.retrying).toBe(true);
    expect(state.results["host:pi"]).toBe(reachable);

    state = hostCheckReducer(state, { type: "retrySucceeded" });
    expect(state.retrying).toBe(false);
    expect(state.listing).toBe("refreshed");
    expect(state.results["host:pi"].status).toBe("reachable");
  });

  it("keeps a previous result when a later check fails", () => {
    let state = hostCheckReducer(initialHostCheckState(), {
      type: "checked",
      key: "host:pi",
      result: reachable,
    });

    state = hostCheckReducer(state, { type: "checkFailed", key: "host:pi", error: "timed out" });

    expect(state.checkError).toBe("timed out");
    expect(state.results["host:pi"].status).toBe("reachable");
  });

  it("does not turn a failed listing retry into success after a good connection check", () => {
    let state = hostCheckReducer(initialHostCheckState(), {
      type: "retryFailed",
      error: "home was away",
    });

    expect(state.listing).toBe("failed");
    expect(state.listingError).toBe("home was away");

    state = hostCheckReducer(state, {
      type: "checked",
      key: "host:pi",
      result: reachable,
    });

    expect(state.listing).toBe("failed");
    expect(state.listingError).toBe("home was away");
    expect(state.results["host:pi"].status).toBe("reachable");
  });

  it("clears a check error only when another check starts", () => {
    let state = hostCheckReducer(initialHostCheckState(), {
      type: "checkFailed",
      key: "host:pi",
      error: "timed out",
    });

    state = hostCheckReducer(state, { type: "checkStarted", key: "host:pi" });
    expect(state.checkError).toBeUndefined();
    expect(state.checking).toBe("host:pi");
  });
});
