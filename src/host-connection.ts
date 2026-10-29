// ABOUTME: Checks whether This Mac or a configured Rex host is reachable right now.
// ABOUTME: Reads status output only; it never starts a server, changes hosts, or signs in.
import type { Run } from "./cli";

/** What Rex actually reported, or "unknown" when the answer could not be read. */
export type HostConnectionStatus = "reachable" | "not reachable from here" | "down" | "unknown";

export interface HostConnectionResult {
  /** The configured host label; absent for This Mac. */
  server?: string;
  /** The status Rex reported. This is never inferred from the CLI exit code. */
  status: HostConnectionStatus;
  /** One human-readable line explaining the status. */
  detail: string;
  /** The endpoint Rex reported, when it named one. */
  endpoint?: string;
  /** Each endpoint Rex tried, with its reason when Rex gave one. */
  attempts: string[];
  /** The underlying failure when the check could not produce a usable status. */
  error?: string;
}

export const THIS_MAC = "This Mac";

const REMOTE_TIMEOUT = "5s";
const UNSUPPORTED =
  /unknown (?:command|flag|subcommand)|unrecognized (?:command|flag|option)|not supported|unsupported|invalid choice/i;

function errorText(error: unknown): string {
  let message: string;
  if (error instanceof Error) message = error.message.trim() || error.name || "Unknown error";
  else if (typeof error === "string") message = error.trim() || "Unknown error";
  else {
    try {
      message = JSON.stringify(error) || String(error);
    } catch {
      message = String(error);
    }
  }

  // execFile prefixes its message with the full command. Keep the useful stderr instead.
  const lines = message.split(/\r?\n/);
  if (lines.length > 1 && /^Command failed:/i.test(lines[0])) lines.shift();
  return (
    lines
      .join("\n")
      .replace(/^Error:\s*/i, "")
      .trim() || message
  );
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function unknownResult(
  server: string | undefined,
  detail: string,
  error: string,
  endpoint?: string,
  attempts: string[] = [],
): HostConnectionResult {
  return {
    ...(server ? { server } : {}),
    status: "unknown",
    detail,
    ...(endpoint ? { endpoint } : {}),
    attempts,
    error,
  };
}

function reasonText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const record = asRecord(value);
  if (!record) return "";
  return text(record.message) || text(record.detail) || text(record.error);
}

function attemptText(attempt: unknown): string {
  if (typeof attempt === "string") return attempt.trim();
  const value = asRecord(attempt);
  if (!value) return "";
  const endpoint = text(value.endpoint);
  const reason = reasonText(value.detail) || reasonText(value.error) || reasonText(value.message) || text(value.status);
  if (endpoint && reason) return `${endpoint}: ${reason}`;
  if (endpoint) return endpoint;
  if (reason) return reason;
  try {
    const serialized = JSON.stringify(value);
    return serialized && serialized !== "{}" ? serialized : "";
  } catch {
    return "";
  }
}

const KNOWN_STATUSES: HostConnectionStatus[] = ["reachable", "not reachable from here", "down"];

function knownStatus(value: string): HostConnectionStatus | undefined {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  return KNOWN_STATUSES.find((status) => status === normalized);
}

function remoteDetail(status: HostConnectionStatus, server: string, endpoint?: string): string {
  const where = endpoint ? ` at ${endpoint}` : "";
  switch (status) {
    case "reachable":
      return `Rex host ${server} answered${where}.`;
    case "not reachable from here":
      return `Nothing answered for ${server}${where}. The host may work from another network.`;
    case "down":
      return `A machine answered for ${server}${where}, but it is not a Rex server.`;
    default:
      return `Rex could not report a status for ${server}.`;
  }
}

function parseRemote(output: string, server: string): HostConnectionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return unknownResult(
      server,
      `Rex returned unreadable host check output for ${server}.`,
      "Invalid JSON from rex hosts check",
    );
  }

  const response = asRecord(parsed);
  if (!response || !Array.isArray(response.hosts)) {
    return unknownResult(
      server,
      `Rex returned an unreadable host check for ${server}.`,
      "Invalid rex hosts check response",
    );
  }
  if (response.hosts.length === 0) {
    return unknownResult(server, `Rex returned no host check result for ${server}.`, "Empty rex hosts check response");
  }

  const wanted = server.toLowerCase();
  const entry = response.hosts
    .map(asRecord)
    .find((host): host is Record<string, unknown> => host !== undefined && text(host.label).toLowerCase() === wanted);
  if (!entry) {
    return unknownResult(
      server,
      `Rex did not return a check result for ${server}.`,
      `No host check result matched ${server}`,
    );
  }

  const endpoint = text(entry.endpoint) || undefined;
  const attempts = Array.isArray(entry.attempts) ? entry.attempts.map(attemptText).filter(Boolean) : [];
  if (attempts.length === 0 && endpoint) attempts.push(endpoint);

  const reported = text(entry.status);
  const status = knownStatus(reported);
  if (!status) {
    const shown = reported ? `"${reported}"` : "no status";
    return unknownResult(
      server,
      `Rex returned an unsupported status for ${server} (${shown}).`,
      `Unsupported host status from Rex: ${reported || "missing"}`,
      endpoint,
      attempts,
    );
  }

  return {
    server,
    status,
    detail: [remoteDetail(status, server, endpoint), reasonText(entry.detail), reasonText(entry.error)]
      .filter(Boolean)
      .join(" "),
    ...(endpoint ? { endpoint } : {}),
    attempts,
  };
}

async function checkRemote(run: Run, server: string): Promise<HostConnectionResult> {
  let output: string;
  try {
    output = await run("rex", ["--autostart=false", "--timeout", REMOTE_TIMEOUT, "hosts", "check", server, "--json"]);
  } catch (error) {
    const message = errorText(error);
    if (UNSUPPORTED.test(message)) {
      return unknownResult(server, "This Rex version does not support checking hosts.", message);
    }
    return unknownResult(server, `Could not check ${server}: ${message}`, message);
  }
  return parseRemote(output, server);
}

async function checkLocal(run: Run): Promise<HostConnectionResult> {
  let output: string;
  try {
    output = await run("rex", ["--autostart=false", "server", "status", "--json"]);
  } catch (error) {
    const message = errorText(error);
    if (UNSUPPORTED.test(message)) {
      return unknownResult(undefined, "This Rex version does not support checking the local server.", message);
    }
    return {
      status: "not reachable from here",
      detail: "No Rex server answered on This Mac.",
      attempts: [],
      error: message,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return unknownResult(
      undefined,
      "Rex returned unreadable local server status.",
      "Invalid JSON from rex server status",
    );
  }

  const response = asRecord(parsed);
  if (!response) {
    return unknownResult(
      undefined,
      "Rex returned unreadable local server status.",
      "Invalid rex server status response",
    );
  }

  const endpoint = text(response.endpoint) || undefined;
  if (response.running === false) {
    return {
      status: "not reachable from here",
      detail: "Rex reports that its local server is not running.",
      ...(endpoint ? { endpoint, attempts: [endpoint] } : { attempts: [] }),
    };
  }
  if (!endpoint) {
    return unknownResult(
      undefined,
      "Rex returned local server status without an endpoint.",
      "Local server status has no endpoint",
    );
  }

  return {
    status: "reachable",
    detail: `Rex server answered on This Mac at ${endpoint}.`,
    endpoint,
    attempts: [endpoint],
  };
}

/**
 * Check This Mac (no server) or one configured Rex host. The result is always resolved;
 * a failed command or unreadable response becomes a visible "unknown" result instead.
 */
export async function checkHostConnection(run: Run, server?: string): Promise<HostConnectionResult> {
  const label = server?.trim();
  return label ? checkRemote(run, label) : checkLocal(run);
}

/** A stable key for a host row; labels are matched without regard to case. */
export function hostKey(server?: string): string {
  const label = server?.trim();
  return label ? `host:${label.toLowerCase()}` : "local";
}

/** This Mac is implied by the view; configured hosts and a requested host are listed once each. */
export function hostOptions(hosts: string[], initialServer?: string): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const candidate of [...hosts, initialServer ?? ""]) {
    const label = candidate.trim();
    const key = label.toLowerCase();
    if (label && !seen.has(key)) {
      seen.add(key);
      labels.push(label);
    }
  }
  return labels;
}

/** Select the configured spelling of the requested host, or the local row when none is requested. */
export function selectedHostKey(labels: string[], initialServer?: string): string {
  const wanted = initialServer?.trim();
  if (!wanted) return hostKey();
  const match = labels.find((label) => label.toLowerCase() === wanted.toLowerCase());
  return hostKey(match ?? wanted);
}

export interface HostCheckState {
  /** Results by host key, kept across session-listing retries. */
  results: Record<string, HostConnectionResult>;
  /** The host key currently being checked. */
  checking?: string;
  retrying: boolean;
  /** A check failure, visible until another check starts. */
  checkError?: string;
  /** The outcome of the last explicit session-listing retry. */
  listing?: "refreshed" | "failed";
  /** A session-listing retry failure, visible until another retry starts. */
  listingError?: string;
}

export type HostCheckAction =
  | { type: "checkStarted"; key: string }
  | { type: "checked"; key: string; result: HostConnectionResult }
  | { type: "checkFailed"; key: string; error: string }
  | { type: "retryStarted" }
  | { type: "retrySucceeded" }
  | { type: "retryFailed"; error: string };

export function initialHostCheckState(): HostCheckState {
  return { results: {}, retrying: false };
}

/**
 * Keep connection checks and session-listing refreshes independent: refreshing the listing
 * never turns an unknown connection into a success, and a successful check never claims the
 * listing was refreshed.
 */
export function hostCheckReducer(state: HostCheckState, action: HostCheckAction): HostCheckState {
  switch (action.type) {
    case "checkStarted":
      return { ...state, checking: action.key, checkError: undefined };
    case "checked":
      return {
        ...state,
        checking: undefined,
        checkError: undefined,
        results: { ...state.results, [action.key]: action.result },
      };
    case "checkFailed":
      return { ...state, checking: undefined, checkError: action.error };
    case "retryStarted":
      return { ...state, retrying: true, listing: undefined, listingError: undefined };
    case "retrySucceeded":
      return { ...state, retrying: false, listing: "refreshed", listingError: undefined };
    case "retryFailed":
      return { ...state, retrying: false, listing: "failed", listingError: action.error };
  }
}
