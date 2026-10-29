# Rex Sessions

A [Raycast](https://raycast.com) extension for [Rex](https://www.superlogical.com/rex/docs),
the terminal multiplexer. It does for Rex what the
[sesh extension](https://www.raycast.com/joshmedeski/sesh) does for tmux.

**Connect to Rex Session** shows one searchable list:

- **Favorites:** pinned sessions first, saved across command launches.
- **Open Sessions:** all remaining local and remote sessions, with tab counts
  and searchable host labels.
- **Sesh Config** (off by default): optionally include entries from your [sesh](https://github.com/joshmedeski/sesh) config using **Include sesh config entries** in preferences.
- **Directories:** your [zoxide](https://github.com/ajeetdsouza/zoxide) directories.

Press <kbd>Enter</kbd> to show the session in the Rex app and bring Rex to the
front. A sesh entry or directory that isn't open yet becomes a new session
named after it, in its directory, running the entry's startup command first.
Entries and directories already open as a session are listed only once, and
sesh and zoxide always create sessions on this Mac. A remote host that can't be
reached is shown as a warning while the rest of the list stays available.

| Shortcut                               | Action                             |
| -------------------------------------- | ---------------------------------- |
| <kbd>Enter</kbd>                       | Open or create the session         |
| <kbd>⌘</kbd> <kbd>N</kbd>              | New local or remote session        |
| <kbd>⌘</kbd> <kbd>E</kbd>              | Rename the selected session        |
| <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>F</kbd> | Pin or unpin the selected session  |
| <kbd>⌘</kbd> <kbd>I</kbd>              | Session details                    |
| <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>H</kbd> | Check host connection              |
| <kbd>⌘</kbd> <kbd>R</kbd>              | Refresh                            |
| <kbd>⌃</kbd> <kbd>X</kbd>              | Close an open session (asks first) |

Use the host dropdown to show **All Hosts**, **This Mac**, or a configured remote
host. Local directory and sesh entries appear only under All Hosts or This Mac.
Empty and unreachable hosts remain available in the dropdown.

**New Session** (⌘N) asks for a name and host, with an optional working directory
and startup command. Paths and commands run on the selected machine. After the
startup command finishes, the host's interactive shell stays open. The new
session opens in Rex immediately. If opening fails after creation, retrying opens
the existing session rather than creating another one.

**Rename Session** (⌘E) changes the selected session's name on its owning host.

**Pin Session / Unpin Session** (⌘⇧F) moves open sessions into or out of Favorites.
Pins use the session ID and host, so renaming a session preserves its pin and
same-named sessions on different hosts stay separate. Favorites respect the host
filter; offline favorites are retained and reappear when their sessions return.

**Session Details** (⌘I) loads tabs, panes, and working directories on demand.
Directories marked **live** come from process information; **reported** paths are
what the terminal last reported and may be stale. Unavailable paths are shown
explicitly. Use Refresh to update the snapshot.

**Check Host Connection** (⌘⇧H) opens a host list with an explicit connection
check and **Retry Session Listing** (⌘R). It is also available from warnings and
empty views. Reachability and listing results are independent: a reachable host
can still fail to list sessions, and partial listing failures stay visible.
Checks never restart servers or change host/network configuration.

## Requirements

- Rex for macOS. The `rex` CLI ships inside the app bundle, which is the
  default **rex CLI** preference.
- Optional: `sesh` and `zoxide`. Raycast doesn't use your shell's `PATH`, so
  the extension searches the **PATH for sesh and zoxide** preference. It
  expands a leading `~`, and by default covers mise shims and Homebrew.

Switching what the app shows uses Rex's `session.select` action, which needs
**Remote Control** turned on in Rex's settings. Remote sessions use the same
action through the local app, which already knows the hosts configured in Rex.
The **Remote Hosts** preference turns remote listing off. Rex versions without
`rex hosts` still list local sessions and sesh and zoxide entries.

## Development

```sh
npm install
npm run dev     # load the extension into Raycast
npm test        # unit tests, plus an integration test when rex, sesh and zoxide are installed
npm run lint
```
