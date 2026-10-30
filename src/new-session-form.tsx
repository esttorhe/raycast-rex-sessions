// ABOUTME: Form for creating a Rex session on this Mac or a configured remote host.
// ABOUTME: Creation is kept when opening fails so retrying never makes a duplicate session.
import { useRef, useState } from "react";
import { Action, ActionPanel, Form, Icon, Toast, closeMainWindow, open, showToast } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { Run, connect } from "./cli";
import { Item } from "./items";
import { createSession, SESSION_NAME_REQUIRED } from "./create-session";

export interface NewSessionFormProps {
  run: Run;
  /** Configured Rex hosts, even those with no sessions or currently unreachable. */
  hosts: string[];
  /** The Rex app to bring forward after the session is selected. */
  rexApp: string;
  /** A host to select first, for example the host filter the form was opened from. */
  initialServer?: string;
  /** Reload the picker's items after the session exists. */
  onCreated: () => void | Promise<unknown>;
}

const THIS_MAC = "This Mac";
const LOCAL_HOST = "local";
const REMOTE_PREFIX = "host:";

function remoteValue(host: string): string {
  return `${REMOTE_PREFIX}${host}`;
}

function serverFromValue(value: string): string | undefined {
  return value.startsWith(REMOTE_PREFIX) ? value.slice(REMOTE_PREFIX.length) : undefined;
}

function hostLabel(value: string): string {
  return value === LOCAL_HOST ? THIS_MAC : value.slice(REMOTE_PREFIX.length);
}

/** This Mac first, then configured hosts; a requested host is kept even if listing it failed. */
function hostOptions(hosts: string[], initialServer?: string): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const candidate of [...hosts, initialServer ?? ""]) {
    const host = candidate.trim();
    if (host && !seen.has(host)) {
      seen.add(host);
      labels.push(host);
    }
  }
  return labels;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function where(item: Item): string {
  return item.server ? ` on ${item.server}` : "";
}

interface NewSessionValues {
  label: string;
  host: string;
  cwd: string;
  startup: string;
}

export default function NewSessionForm({ run, hosts, rexApp, initialServer, onCreated }: NewSessionFormProps) {
  const pending = useRef(false);
  const [label, setLabel] = useState("");
  const [host, setHost] = useState(() => {
    const requested = initialServer?.trim();
    return requested ? remoteValue(requested) : LOCAL_HOST;
  });
  const [cwd, setCwd] = useState("");
  const [startup, setStartup] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [nameError, setNameError] = useState<string | undefined>();
  const [created, setCreated] = useState<Item | undefined>();
  const [openFailed, setOpenFailed] = useState(false);

  const options = hostOptions(hosts, initialServer);
  const selectedHost = hostLabel(host);
  const onRemoteHost = host !== LOCAL_HOST;
  const actionTitle = created
    ? submitting
      ? "Opening Session…"
      : "Retry Opening Session"
    : submitting
      ? "Creating Session…"
      : "Create Session";

  /** Select the new session in the local Rex app, bring Rex forward, and leave Raycast. */
  async function showInRex(item: Item): Promise<void> {
    // The item carries its session ID, so connect selects it instead of creating another one.
    // Its shell argument is only used for sessions that do not exist yet.
    await connect(run, item, "/bin/sh");
    await open(rexApp);
    await closeMainWindow({ clearRootSearch: true });
  }

  async function retryOpen(): Promise<void> {
    if (pending.current || !created) return;
    pending.current = true;
    setSubmitting(true);
    try {
      await showInRex(created);
      setOpenFailed(false);
    } catch (error) {
      setOpenFailed(true);
      await showFailureToast(error, {
        title: `Couldn't open ${created.label}${where(created)}`,
        message: "The session already exists. Retry opening it here; creating it again would make a duplicate.",
      });
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  }

  async function handleSubmit(values: NewSessionValues): Promise<boolean | void> {
    if (pending.current || created) return false;

    const name = text(values.label).trim();
    if (!name) {
      setNameError(SESSION_NAME_REQUIRED);
      return false;
    }
    setNameError(undefined);

    const server = serverFromValue(text(values.host) || LOCAL_HOST);
    const directory = text(values.cwd).trim();
    const command = text(values.startup).trim();
    const onHost = server ? ` on ${server}` : "";

    pending.current = true;
    setSubmitting(true);
    const toast = await showToast({ style: Toast.Style.Animated, title: `Creating ${name}${onHost}` });

    let item: Item;
    try {
      item = await createSession(run, { label: name, server, cwd: directory, startup: command });
    } catch (error) {
      pending.current = false;
      setSubmitting(false);
      await toast.hide();
      await showFailureToast(error, { title: `Couldn't create ${name}${onHost}` });
      return false;
    }

    // Keep the created item before trying to display it. The picker refreshes either way, so a
    // failed open leaves a discoverable session instead of an invisible one or a duplicate.
    setCreated(item);
    await toast.hide();
    try {
      await onCreated();
    } catch {
      // A refresh failure must not stop the session from being opened or retried.
    }

    try {
      await showInRex(item);
    } catch (error) {
      setOpenFailed(true);
      await showFailureToast(error, {
        title: `Created ${item.label}${where(item)}, but couldn't open it`,
        message: "The session exists now. Use Retry Opening Session; creating it again would make a duplicate.",
      });
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Form
      navigationTitle={created ? "Session Created" : "New Rex Session"}
      isLoading={submitting}
      actions={
        <ActionPanel>
          {created ? (
            <Action title={actionTitle} icon={openFailed ? Icon.ArrowClockwise : Icon.Clock} onAction={retryOpen} />
          ) : (
            <Action.SubmitForm title={actionTitle} icon={Icon.Plus} onSubmit={handleSubmit} />
          )}
        </ActionPanel>
      }
    >
      {created && (
        <Form.Description
          title="Created"
          text={
            openFailed
              ? `${created.label}${where(created)} was created, but Raycast couldn't show it. Retry opening it from this form; no second session will be created.`
              : `${created.label}${where(created)} was created. Opening it in Rex…`
          }
        />
      )}

      <Form.TextField
        id="label"
        title="Name"
        placeholder="Session name"
        value={label}
        error={nameError}
        autoFocus
        onChange={(value) => {
          setLabel(value);
          if (nameError) setNameError(undefined);
        }}
      />

      <Form.Dropdown id="host" title="Host" value={host} onChange={setHost}>
        <Form.Dropdown.Item value={LOCAL_HOST} title={THIS_MAC} icon={Icon.Desktop} />
        {options.map((option) => (
          <Form.Dropdown.Item key={option} value={remoteValue(option)} title={option} icon={Icon.Globe} />
        ))}
      </Form.Dropdown>

      <Form.Description
        title="Starting On"
        text={
          onRemoteHost
            ? `${selectedHost}. Its working directory and startup command run on that host, not on this Mac.`
            : "This Mac. The working directory and startup command run locally."
        }
      />

      <Form.TextField
        id="cwd"
        title="Working Directory"
        placeholder={onRemoteHost ? `Path on ${selectedHost}` : "Path on this Mac"}
        info={
          onRemoteHost
            ? `Optional. Use a path that exists on ${selectedHost}; paths from this Mac are not translated.`
            : "Optional. Rex starts the session in this directory."
        }
        value={cwd}
        onChange={setCwd}
      />

      <Form.TextArea
        id="startup"
        title="Startup Command"
        placeholder="e.g. npm run dev"
        info={
          onRemoteHost
            ? `Optional. Runs on ${selectedHost} through its shell, then leaves that host's interactive shell open.`
            : "Optional. Runs before an interactive login shell is left open."
        }
        value={startup}
        onChange={setStartup}
      />
    </Form>
  );
}
