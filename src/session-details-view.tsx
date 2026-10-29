// ABOUTME: Raycast view for one Rex session's tabs and each terminal pane's working directory.
// ABOUTME: Loads only when opened, with refresh, pane errors and provenance for reported directories.
import { Action, ActionPanel, Color, Icon, Keyboard, List } from "@raycast/api";
import { showFailureToast, usePromise } from "@raycast/utils";
import type { Run } from "./cli";
import type { Item } from "./items";
import { loadSessionDetails } from "./session-details";
import type { SessionPane, SessionTab } from "./session-details";

export interface SessionDetailsViewProps {
  run: Run;
  item: Item;
}

function hostName(item: Item): string {
  return item.server ?? "This Mac";
}

function paneSubtitle(pane: SessionPane): string {
  if (!pane.terminal) return "Not a terminal pane";
  return pane.cwd ?? pane.cwdError ?? "Working directory unavailable";
}

function paneKeywords(tab: SessionTab, pane: SessionPane, host: string): string[] {
  return [pane.label, tab.label, host, pane.cwd, pane.blockId].filter((value): value is string => Boolean(value));
}

function paneAccessories(pane: SessionPane): List.Item.Accessory[] {
  const accessories: List.Item.Accessory[] = [];
  if (pane.active) {
    accessories.push({ icon: Icon.TextCursor, tooltip: "Focused pane in this tab" });
  }
  if (pane.cwdSource === "process") {
    accessories.push({ tag: { value: "live", color: Color.Green }, tooltip: "From the terminal's current process" });
  } else if (pane.cwdSource === "pwd") {
    accessories.push({
      tag: { value: "reported", color: Color.Orange },
      tooltip: "Last directory the program reported; it may be stale",
    });
  }
  return accessories;
}

export default function SessionDetailsView({ run, item }: SessionDetailsViewProps) {
  const { data, isLoading, error, revalidate } = usePromise(
    (run: Run, item: Item) => loadSessionDetails(run, item),
    [run, item],
    {
      onError: async (error) => {
        await showFailureToast(error, { title: `Couldn't load details for ${item.label}` });
      },
    },
  );

  const label = data?.label ?? item.label;
  const host = hostName(item);
  const refresh = (
    <Action
      title="Refresh"
      icon={Icon.ArrowClockwise}
      shortcut={Keyboard.Shortcut.Common.Refresh}
      onAction={revalidate}
    />
  );
  const actions = <ActionPanel>{refresh}</ActionPanel>;

  return (
    <List
      isLoading={isLoading}
      navigationTitle={`${label} · ${host}`}
      searchBarPlaceholder="Filter panes by tab, label, or working directory..."
      actions={actions}
    >
      {error ? (
        <List.EmptyView
          icon={Icon.Warning}
          title="Couldn't load session details"
          description={error.message}
          actions={actions}
        />
      ) : data && data.tabs.length === 0 ? (
        <List.EmptyView
          icon={Icon.AppWindow}
          title="No tabs in this session"
          description="Rex reported no tabs. Refresh if the session just changed."
          actions={actions}
        />
      ) : (
        data?.tabs.map((tab) => (
          <List.Section
            key={tab.windowId}
            id={tab.windowId}
            title={tab.label}
            subtitle={tab.active ? "Active tab" : `${tab.panes.length} ${tab.panes.length === 1 ? "pane" : "panes"}`}
          >
            {tab.panes.length === 0 ? (
              <List.Item
                key={`${tab.windowId}:empty`}
                id={`${tab.windowId}:empty`}
                title="No panes in this tab"
                icon={Icon.MinusCircle}
                actions={actions}
              />
            ) : (
              tab.panes.map((pane, index) => {
                const id = `${tab.windowId}:${pane.blockId ?? index}`;
                return (
                  <List.Item
                    key={id}
                    id={id}
                    title={pane.label}
                    subtitle={paneSubtitle(pane)}
                    icon={pane.terminal ? (pane.cwdError ? Icon.Warning : Icon.Terminal) : Icon.AppWindow}
                    keywords={paneKeywords(tab, pane, host)}
                    accessories={paneAccessories(pane)}
                    actions={
                      <ActionPanel>
                        {pane.cwd && <Action.CopyToClipboard title="Copy Working Directory" content={pane.cwd} />}
                        {pane.blockId && <Action.CopyToClipboard title="Copy Block ID" content={pane.blockId} />}
                        {item.sessionId && <Action.CopyToClipboard title="Copy Session ID" content={item.sessionId} />}
                        {refresh}
                      </ActionPanel>
                    }
                  />
                );
              })
            )}
          </List.Section>
        ))
      )}
    </List>
  );
}
