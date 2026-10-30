// ABOUTME: Form for renaming a Rex session on this Mac or a remote host.
// ABOUTME: Refreshes the picker and returns to it after a successful rename.
import { useRef, useState } from "react";
import { Action, ActionPanel, Form, Icon, Toast, showToast, useNavigation } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import type { Run } from "./cli";
import type { Item } from "./items";
import { renameSession } from "./rename-session";

export interface RenameSessionFormProps {
  run: Run;
  item: Item;
  /** Reload the picker's items so the new name shows when this form closes. */
  onRenamed: () => void | Promise<unknown>;
}

export default function RenameSessionForm({ run, item, onRenamed }: RenameSessionFormProps) {
  const { pop } = useNavigation();
  const pending = useRef(false);
  const [name, setName] = useState(item.label);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const host = item.server ?? "This Mac";
  const nameError = name.trim() ? undefined : "Name is required";

  async function handleSubmit(values: { name: string }) {
    if (pending.current || !values.name.trim()) return false;
    pending.current = true;
    setIsSubmitting(true);
    const toast = await showToast({ style: Toast.Style.Animated, title: `Renaming ${item.label}` });
    try {
      await renameSession(run, item, values.name);
      await onRenamed();
      await toast.hide();
      await showToast({ style: Toast.Style.Success, title: `Renamed to ${values.name.trim()}` });
      pop();
    } catch (error) {
      await toast.hide();
      await showFailureToast(error, { title: `Couldn't rename ${item.label}` });
      return false;
    } finally {
      pending.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <Form
      navigationTitle={`Rename ${item.label}`}
      isLoading={isSubmitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Rename Session" icon={Icon.Pencil} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="name"
        title="Name"
        placeholder="Session name"
        value={name}
        error={nameError}
        autoFocus
        onChange={setName}
      />
      <Form.Description title="Host" text={host} />
    </Form>
  );
}
