// ABOUTME: Creates a Rex session on this Mac or a configured host and returns it as a picker item.
// ABOUTME: Validation happens before Rex runs; every argument is passed as its own word.
import type { Run } from "./cli";
import { Item, toRexItem } from "./items";

export interface CreateSessionOptions {
  label: string;
  /** Rex host label. Omit to create the session on this Mac. */
  server?: string;
  /** Working directory on the machine that runs the session. */
  cwd?: string;
  /** Shell command that runs on that machine before its interactive shell. */
  startup?: string;
}

export const SESSION_NAME_REQUIRED = "A session name is required.";

const INVALID_RESPONSE = "Invalid Rex session response";

/** Global Rex flags that keep a missing local server from being started. */
function serverArgs(server?: string): string[] {
  return server ? ["--server", server, "--autostart=false"] : ["--autostart=false"];
}

/**
 * Keep the session open for the user's real shell after the startup command exits.
 * `SHELL` is expanded by the selected host, so this never assumes the local zsh path
 * or any other shell path that only exists on this Mac.
 */
function startupScript(startup: string): string {
  return `${startup}\nexec "\${SHELL:-sh}" -l`;
}

/**
 * Create a session with `rex new` without selecting it in an app.
 * The caller decides whether to show it, so a failed open never hides a created session.
 */
export async function createSession(run: Run, options: CreateSessionOptions): Promise<Item> {
  const label = options.label.trim();
  if (!label) throw new Error(SESSION_NAME_REQUIRED);
  if (label.startsWith("-")) throw new Error("Session names must not start with a hyphen.");

  const server = options.server?.trim() || undefined;
  const cwd = options.cwd?.trim() || undefined;
  const startup = options.startup?.trim() || undefined;

  const args = [...serverArgs(server), "new", label];
  if (cwd) args.push("-c", cwd);
  args.push("--json");
  if (startup) {
    // `sh` is resolved on the selected host. The startup command is shell code passed as one
    // argument; it is not interpolated into a command run on this Mac.
    args.push("--", "sh", "-lc", startupScript(startup));
  }

  const output = await run("rex", args);
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error(INVALID_RESPONSE);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(INVALID_RESPONSE);
  }
  const response = parsed as { session_id?: unknown };
  const sessionId = typeof response.session_id === "string" ? response.session_id.trim() : "";
  if (!sessionId) throw new Error(INVALID_RESPONSE);

  const item = toRexItem({ session_id: sessionId, label }, undefined, server);
  return {
    ...item,
    ...(cwd ? { path: cwd } : {}),
    ...(startup ? { startup } : {}),
  };
}
