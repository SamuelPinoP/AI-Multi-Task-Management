"use client";

import { useRef, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { uiButtonClass, uiPrimaryButtonClass } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MAX_CHAT_TITLE_CHARS } from "@/lib/ai/chat-limits";

/** Renames a saved chat (#452). Its name starts selected, so typing replaces it. */
export function RenameChatDialog({
  title,
  saving,
  error,
  onCancel,
  onSave,
}: {
  title: string;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (title: string) => void;
}) {
  const [value, setValue] = useState(title);
  const input = useRef<HTMLInputElement>(null);
  const name = value.replace(/\s+/g, " ").trim();
  const canSave = name.length > 0 && !saving;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !saving) onCancel();
      }}
    >
      <DialogContent
        className="max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          input.current?.select();
        }}
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSave) onSave(name);
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-xl">Rename chat</DialogTitle>
            <DialogDescription>The name shows in your list of chats.</DialogDescription>
          </DialogHeader>
          <div>
            <input
              ref={input}
              aria-label="Chat name"
              value={value}
              maxLength={MAX_CHAT_TITLE_CHARS}
              onChange={(event) => setValue(event.target.value)}
              className="w-full rounded-xl border border-line bg-sunken px-4 py-3 text-base font-semibold text-ink outline-none transition focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/20"
            />
            {error ? (
              <p role="alert" className="mt-2 text-sm text-danger">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <button type="button" onClick={onCancel} disabled={saving} className={uiButtonClass}>
              Cancel
            </button>
            <button type="submit" disabled={!canSave} className={uiPrimaryButtonClass}>
              {saving ? "Saving…" : "Save"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Deletes one chat, or all of them (#452), for good: chats don't go to Trash. */
export function DeleteChatsDialog({
  open,
  all,
  title,
  deleting,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  /** Every chat, rather than the one named `title`. */
  all: boolean;
  title: string;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // The words stay put while the dialog fades out after closing.
  const [shown, setShown] = useState({ all, title });
  if (open && (shown.all !== all || shown.title !== title)) setShown({ all, title });
  return (
    <ConfirmDialog
      open={open}
      title={shown.all ? "Delete all chats?" : "Delete this chat?"}
      message={
        shown.all
          ? "Every chat in your list will be deleted for good. This can't be undone."
          : `“${shown.title}” and its messages will be deleted for good. This can't be undone.`
      }
      confirmLabel={shown.all ? "Delete all chats" : "Delete chat"}
      loading={deleting}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
