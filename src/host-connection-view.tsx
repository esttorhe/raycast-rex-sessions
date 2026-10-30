// ABOUTME: Picker view for checking This Mac and configured Rex hosts without changing them.
// ABOUTME: Connection checks and session-listing retries stay independent and failures remain visible.
import { useReducer, useRef, useState } from "react";
import { Action, ActionPanel, Color, Icon, Image, Keyboard, List } from "@raycast/api";
import type { Run } from "./cli";
import {
  checkHostConnection,
  hostCheckReducer,
  hostKey,
  hostOptions,
  initialHostCheckState,
  selectedHostKey,
  THIS_MAC,
  type HostConnectionResult,
  type HostConnectionStatus,
} from "./host-connection";

export interface HostConnectionViewProps {
  run: Run;
  /** Configured Rex hosts, including empty or currently unreachable ones. */
  hosts: string[];
  /** The host the view opens on, for example the one from a session row or filter. */
  initialServer?: string;
  /** Refresh the picker's session listing; this may load every host. */
  onRetry: () => void | Promise<unknown>;
}

const STATUS_ICONS: Record<HostConnectionStatus, Image.ImageLike> = {
  reachable: { source: Icon.CheckCircle, tintColor: Color.Green },
  "not reachable from here": { source: Icon.Warning, tintColor: Color.Orange },
  down: { source: Icon.XMarkCircle, tintColor: Color.Red },
  unknown: { source: Icon.QuestionMarkCircle, tintColor: Color.SecondaryText },
};

function statusLabel(result?: HostConnectionResult, checking = false): string {
  if (checking) return "Checking…";
  if (!result) return "Not checked";
  switch (result.status) {
    case "reachable":
      return "Reachable";
    case "not reachable from here":
      return "Not reachable";
    case "down":
      return "Down";
    case "unknown":
      return "Unknown";
  }
}

function statusIcon(result?: HostConnectionResult, checking = false): Image.ImageLike {
  if (checking) return { source: Icon.ArrowClockwise, tintColor: Color.Blue };
  if (!result) return { source: Icon.Circle, tintColor: Color.SecondaryText };
  return STATUS_ICONS[result.status];
}

function resultTooltip(result: HostConnectionResult): string {
  return [result.detail, ...result.attempts, ...(result.error ? [result.error] : [])].join("\n");
}

function connectionDetails(result: HostConnectionResult): string {
  const lines = [`Host: ${result.server ?? THIS_MAC}`, `Status: ${statusLabel(result)}`, `Detail: ${result.detail}`];
  if (result.endpoint) lines.push(`Endpoint: ${result.endpoint}`);
  if (result.attempts.length > 0) {
    lines.push(`Attempts:\n${result.attempts.map((attempt) => `- ${attempt}`).join("\n")}`);
  }
  if (result.error) lines.push(`Error: ${result.error}`);
  return lines.join("\n");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function HostConnectionView({ run, hosts, initialServer, onRetry }: HostConnectionViewProps) {
  const labels = hostOptions(hosts, initialServer);
  const [selectedId, setSelectedId] = useState(() => selectedHostKey(labels, initialServer));
  const [state, dispatch] = useReducer(hostCheckReducer, initialHostCheckState());
  const pending = useRef(false);

  async function check(server?: string): Promise<void> {
    if (pending.current) return;
    pending.current = true;
    const key = hostKey(server);
    dispatch({ type: "checkStarted", key });
    try {
      const result = await checkHostConnection(run, server);
      dispatch({ type: "checked", key, result });
    } catch (error) {
      dispatch({ type: "checkFailed", key, error: errorMessage(error) });
    } finally {
      pending.current = false;
    }
  }

  async function retry(): Promise<void> {
    if (pending.current) return;
    pending.current = true;
    dispatch({ type: "retryStarted" });
    try {
      await onRetry();
      dispatch({ type: "retrySucceeded" });
    } catch (error) {
      dispatch({ type: "retryFailed", error: errorMessage(error) });
    } finally {
      pending.current = false;
    }
  }

  const selectedLabel = labels.find((label) => hostKey(label) === selectedId);

  function actions(server: string | undefined, result?: HostConnectionResult) {
    const checking = state.checking === hostKey(server);
    return (
      <ActionPanel>
        <Action
          title={checking ? "Checking…" : "Check Host Connection"}
          icon={Icon.Network}
          onAction={() => check(server)}
        />
        <Action
          title={state.retrying ? "Refreshing Session Listing…" : "Retry Session Listing"}
          icon={Icon.ArrowClockwise}
          shortcut={Keyboard.Shortcut.Common.Refresh}
          onAction={retry}
        />
        {result && <Action.CopyToClipboard title="Copy Connection Details" content={connectionDetails(result)} />}
      </ActionPanel>
    );
  }

  const listingNote = state.retrying
    ? "Refreshing session listing…"
    : state.listing === "refreshed"
      ? "Session listing refreshed."
      : state.listing === "failed"
        ? "Session listing could not be refreshed."
        : undefined;

  return (
    <List
      isLoading={state.checking !== undefined || state.retrying}
      navigationTitle="Check Host Connection"
      searchBarPlaceholder="Choose a host to check"
      selectedItemId={selectedId}
      onSelectionChange={(id) => {
        if (id && (id === "local" || id.startsWith("host:"))) setSelectedId(id);
      }}
    >
      <List.Section title="Hosts" subtitle={listingNote}>
        <List.Item
          id={hostKey()}
          title={THIS_MAC}
          icon={Icon.Desktop}
          subtitle={
            state.checking === hostKey()
              ? "Checking the local server…"
              : (state.results[hostKey()]?.detail ?? "Not checked yet. Choose Check Host Connection.")
          }
          keywords={[THIS_MAC, "local", statusLabel(state.results[hostKey()], state.checking === hostKey())]}
          accessories={[
            {
              icon: statusIcon(state.results[hostKey()], state.checking === hostKey()),
              text: statusLabel(state.results[hostKey()], state.checking === hostKey()),
              tooltip: state.results[hostKey()] ? resultTooltip(state.results[hostKey()]) : "No check has run yet.",
            },
          ]}
          actions={actions(undefined, state.results[hostKey()])}
        />
        {labels.map((label) => {
          const key = hostKey(label);
          const result = state.results[key];
          const checking = state.checking === key;
          return (
            <List.Item
              key={key}
              id={key}
              title={label}
              icon={Icon.Globe}
              subtitle={
                checking ? "Checking the host…" : (result?.detail ?? "Not checked yet. Choose Check Host Connection.")
              }
              keywords={[label, result?.status ?? "not checked", ...(result?.endpoint ? [result.endpoint] : [])]}
              accessories={[
                {
                  icon: statusIcon(result, checking),
                  text: statusLabel(result, checking),
                  tooltip: result ? resultTooltip(result) : "No check has run yet.",
                },
              ]}
              actions={actions(label, result)}
            />
          );
        })}
      </List.Section>
      {(state.checkError || state.listingError) && (
        <List.Section title="Problems">
          {state.checkError && (
            <List.Item
              id="check-error"
              title="Couldn't check host"
              icon={Icon.Warning}
              subtitle={state.checkError}
              actions={
                <ActionPanel>
                  <Action title="Check Host Connection" icon={Icon.Network} onAction={() => check(selectedLabel)} />
                  <Action title="Retry Session Listing" icon={Icon.ArrowClockwise} onAction={retry} />
                  <Action.CopyToClipboard title="Copy Error" content={state.checkError} />
                </ActionPanel>
              }
            />
          )}
          {state.listingError && (
            <List.Item
              id="listing-error"
              title="Couldn't refresh session listing"
              icon={Icon.Warning}
              subtitle={state.listingError}
              actions={
                <ActionPanel>
                  <Action title="Retry Session Listing" icon={Icon.ArrowClockwise} onAction={retry} />
                  <Action title="Check Host Connection" icon={Icon.Network} onAction={() => check(selectedLabel)} />
                  <Action.CopyToClipboard title="Copy Error" content={state.listingError} />
                </ActionPanel>
              }
            />
          )}
        </List.Section>
      )}
    </List>
  );
}
