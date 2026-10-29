// ABOUTME: Raycast command listing local and remote Rex sessions, sesh entries and zoxide directories.
// ABOUTME: Enter shows the session in the Rex app, creating local sessions first when needed.
import { useState } from "react";
import { homedir, userInfo } from "node:os";
import {
  Action,
  ActionPanel,
  Alert,
  Color,
  Icon,
  Image,
  Keyboard,
  List,
  closeMainWindow,
  confirmAlert,
  getPreferenceValues,
  open,
  showToast,
  Toast,
} from "@raycast/api";
import { showFailureToast, useCachedPromise } from "@raycast/utils";
import { connect, killSession, loadItems, runner } from "./cli";
import RenameSessionForm from "./rename-session-form";
import NewSessionForm from "./new-session-form";
import HostConnectionView from "./host-connection-view";
import SessionDetailsView from "./session-details-view";
import { useFavorites } from "./use-favorites";
import { isFavorite, partitionFavorites } from "./favorites";
import { expandPath, filterItemsByHost, Item } from "./items";

interface Preferences {
  rexPath: string;
  rexApp: string;
  searchPath: string;
  includeZoxide: boolean;
  includeRemote: boolean;
  includeSesh: boolean;
}

// Matches the sesh extension: a bolt for open sessions, a gear for config, a folder for directories.
const ICONS: Record<Item["kind"], Image.ImageLike> = {
  rex: { source: Icon.Bolt, tintColor: Color.Blue },
  sesh: Icon.Gear,
  dir: Icon.Folder,
};

const LOCAL_GROUP = "This Mac";

function hostName(item: Item): string {
  return item.server ?? LOCAL_GROUP;
}

/** Open sessions from every host come before entries that would create a session. */
function sections(items: Item[], favoriteIds: string[]): { id: string; title: string; items: Item[] }[] {
  const { favorites, others } = partitionFavorites(items, favoriteIds);
  return [
    { id: "favorites", title: "Favorites", items: favorites },
    { id: "sessions", title: "Open Sessions", items: others.filter((item) => item.kind === "rex") },
    { id: "sesh", title: "Sesh Config", items: items.filter((item) => item.kind === "sesh") },
    { id: "dirs", title: "Directories", items: items.filter((item) => item.kind === "dir") },
  ].filter((section) => section.items.length > 0);
}

export default function ConnectCommand() {
  const prefs = getPreferenceValues<Preferences>();
  const { favoriteIds, isLoading: favoritesLoading, toggleFavorite } = useFavorites();
  const [hostFilter, setHostFilter] = useState("all");
  const home = homedir();
  const run = runner(expandPath(prefs.searchPath, home), prefs.rexPath);
  const shell = userInfo().shell || "/bin/sh";

  const { data, isLoading, revalidate, mutate } = useCachedPromise(
    (includeZoxide: boolean, includeRemote: boolean, includeSesh: boolean) =>
      loadItems(run, home, includeZoxide, includeRemote, includeSesh),
    [prefs.includeZoxide, prefs.includeRemote, prefs.includeSesh],
    {
      keepPreviousData: true,
      onError: (error) => {
        showFailureToast(error, { title: "Couldn't list Rex sessions. Is Rex running?" });
      },
    },
  );

  const items = data?.items ?? [];
  const warnings = data?.warnings ?? [];
  const hosts = data?.hosts ?? [];
  const visibleItems = filterItemsByHost(items, hostFilter);

  async function onConnect(item: Item) {
    const where = item.server ? ` on ${item.server}` : "";
    const toast = await showToast({ style: Toast.Style.Animated, title: `Opening ${item.label}${where}` });
    try {
      await connect(run, item, shell);
      await open(prefs.rexApp);
      await toast.hide();
      await closeMainWindow({ clearRootSearch: true });
    } catch (error) {
      await showFailureToast(error, { title: `Couldn't open ${item.label}${where}` });
    }
  }

  async function onKill(item: Item) {
    const where = item.server ? ` on ${item.server}` : "";
    const confirmed = await confirmAlert({
      title: `Close ${item.label}${where}?`,
      message: "Every tab and program in this session ends.",
      primaryAction: { title: "Close Session", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    try {
      await killSession(run, item);
      revalidate();
    } catch (error) {
      await showFailureToast(error, { title: `Couldn't close ${item.label}${where}` });
    }
  }

  const refresh = (
    <Action
      title="Refresh"
      icon={Icon.ArrowClockwise}
      shortcut={Keyboard.Shortcut.Common.Refresh}
      onAction={revalidate}
    />
  );

  function newSessionAction(server?: string) {
    return (
      <Action.Push
        title="New Session"
        icon={Icon.Plus}
        shortcut={Keyboard.Shortcut.Common.New}
        target={
          <NewSessionForm
            run={run}
            hosts={hosts}
            rexApp={prefs.rexApp}
            initialServer={hostFilter.startsWith("remote:") ? hostFilter.slice(7) : server}
            onCreated={revalidate}
          />
        }
      />
    );
  }

  function hostConnectionAction(server?: string) {
    return (
      <Action.Push
        title="Check Host Connection"
        icon={Icon.Network}
        shortcut={{ modifiers: ["cmd", "shift"], key: "h" }}
        target={
          <HostConnectionView
            run={run}
            hosts={hosts}
            initialServer={hostFilter.startsWith("remote:") ? hostFilter.slice(7) : server}
            onRetry={async () => {
              const result = await loadItems(run, home, prefs.includeZoxide, prefs.includeRemote, prefs.includeSesh);
              await mutate(Promise.resolve(result), { optimisticUpdate: () => result, shouldRevalidateAfter: false });
              if (result.warnings.length) throw new Error(result.warnings.join("\n"));
            }}
          />
        }
      />
    );
  }

  const warningItems = warnings.map((warning, index) => (
    <List.Item
      key={`warning:${index}`}
      id={`warning:${index}`}
      title={warning}
      icon={Icon.Warning}
      actions={
        <ActionPanel>
          {hostConnectionAction()}
          {newSessionAction()}
          <Action.CopyToClipboard title="Copy Warning" content={warning} />
          {refresh}
        </ActionPanel>
      }
    />
  ));

  return (
    <List
      isLoading={isLoading || favoritesLoading}
      searchBarPlaceholder="Search local and remote sessions..."
      searchBarAccessory={
        <List.Dropdown tooltip="Filter by host" value={hostFilter} onChange={setHostFilter}>
          <List.Dropdown.Item value="all" title="All Hosts" />
          <List.Dropdown.Item value="local" title="This Mac" />
          {hosts.map((host) => (
            <List.Dropdown.Item key={host} value={`remote:${host}`} title={host} />
          ))}
        </List.Dropdown>
      }
    >
      <List.EmptyView
        icon={warnings.length ? Icon.Warning : Icon.Bolt}
        title={warnings.length ? "Some sessions couldn't be listed" : "Nothing to show"}
        description={warnings.length ? warnings.join("\n") : "Create a session with ⌘N or refresh with ⌘R."}
        actions={
          <ActionPanel>
            {newSessionAction()}
            {hostConnectionAction()}
            {refresh}
          </ActionPanel>
        }
      />
      {sections(visibleItems, favoriteIds).map((group) => (
        <List.Section key={group.id} id={group.id} title={group.title}>
          {group.items.map((item) => (
            <List.Item
              key={item.id}
              id={item.id}
              title={item.title}
              icon={ICONS[item.kind]}
              keywords={[item.label, hostName(item), ...(item.path ? [item.path] : [])]}
              accessories={[
                ...(isFavorite(favoriteIds, item.id) ? [{ icon: Icon.Star, tooltip: "Favorite session" }] : []),
                ...(item.windows !== undefined
                  ? [{ icon: Icon.AppWindow, text: String(item.windows), tooltip: item.windows === 1 ? "Tab" : "Tabs" }]
                  : []),
                ...(item.kind === "rex" ? [{ icon: Icon.Globe, text: hostName(item), tooltip: "Rex host" }] : []),
              ]}
              actions={
                <ActionPanel>
                  <Action title="Connect to Session" onAction={() => onConnect(item)} />
                  {item.path && <Action.CopyToClipboard title="Copy Path" content={item.path} />}
                  {item.kind === "rex" && (
                    <Action
                      title={isFavorite(favoriteIds, item.id) ? "Unpin Session" : "Pin Session"}
                      icon={Icon.Star}
                      shortcut={{ modifiers: ["cmd", "shift"], key: "f" }}
                      onAction={async () => {
                        try {
                          await toggleFavorite(item);
                        } catch (error) {
                          await showFailureToast(error, { title: "Couldn't save favorites" });
                        }
                      }}
                    />
                  )}
                  {item.kind === "rex" && (
                    <Action.Push
                      title="Session Details"
                      icon={Icon.Info}
                      shortcut={{ modifiers: ["cmd"], key: "i" }}
                      target={<SessionDetailsView run={run} item={item} />}
                    />
                  )}
                  {item.kind === "rex" && (
                    <Action.Push
                      title="Rename Session"
                      icon={Icon.Pencil}
                      shortcut={Keyboard.Shortcut.Common.Edit}
                      target={<RenameSessionForm run={run} item={item} onRenamed={revalidate} />}
                    />
                  )}
                  {item.kind === "rex" && (
                    <Action
                      title="Close Session"
                      icon={Icon.XMarkCircle}
                      style={Action.Style.Destructive}
                      shortcut={{ modifiers: ["ctrl"], key: "x" }}
                      onAction={() => onKill(item)}
                    />
                  )}
                  {hostConnectionAction(item.server)}
                  {newSessionAction(item.server)}
                  {refresh}
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      ))}
      {warningItems.length > 0 && <List.Section title="Couldn't Load">{warningItems}</List.Section>}
    </List>
  );
}
