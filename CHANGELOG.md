# Rex Sessions Changelog

## [Initial Version] - {PR_MERGE_DATE}

- Connect to Rex Session: open local and remote Rex sessions, sesh entries and zoxide directories from one list.
- Open sessions from all hosts appear first and are searchable by their Rex host label; an unreachable host is reported without hiding the rest of the list.

- Create local or remote sessions with a host selector, optional directory and startup command.
- Rename sessions on their owning host and filter the picker by host.
- Disable sesh entries by default and use stable list IDs for keyboard navigation.

- Pin open sessions as persistent favorites above other sessions.
- Inspect tabs, panes, and working directories on demand, including directory provenance.
- Check host reachability and retry session listing, preserving visible partial failures.
