// ABOUTME: Renames an open Rex session on the host that owns it, passing the label as one argument.
// ABOUTME: Rejects entries that are not Rex sessions and labels that trim to nothing.
import type { Run } from "./cli";
import type { Item } from "./items";

/** Rename the open Rex session an item points at, using the full session ID on its own host. */
export async function renameSession(run: Run, item: Item, label: string): Promise<void> {
  if (item.kind !== "rex") {
    throw new Error(`Only Rex sessions can be renamed; ${item.label} is a ${item.kind} entry`);
  }
  if (!item.sessionId?.trim()) {
    throw new Error(`Rex session ${item.label} has no session ID`);
  }
  const name = label.trim();
  if (!name) {
    throw new Error("Session name can't be empty");
  }

  // Rex accepts SESSION and LABEL as positionals. `--` keeps a label that starts with a hyphen
  // from being parsed as a flag; execFile passes every argument literally, without a shell.
  const serverArgs = item.server ? ["--server", item.server, "--autostart=false"] : ["--autostart=false"];
  await run("rex", [...serverArgs, "session", "rename", "--", item.sessionId, name]);
}
