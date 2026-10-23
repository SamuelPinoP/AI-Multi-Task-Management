"use client";

import { Trash2, TriangleAlert } from "lucide-react";
import { uiButtonClass } from "@/components/ui";
import { DeleteButton } from "@/components/ui/delete-button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  /** "delete" (default) shows the trash icon; "confirm" a warning, for actions that don't delete anything. */
  kind?: "delete" | "confirm";
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({ open, title, message, confirmLabel = "Delete", cancelLabel = "Cancel", loading = false, kind = "delete", onConfirm, onCancel }: ConfirmDialogProps) {
  const Icon = kind === "delete" ? Trash2 : TriangleAlert;
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !loading) onCancel(); }}>
      <DialogContent className="max-w-md" hideClose>
        <div className="flex items-start gap-4">
          <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-danger-soft text-danger ring-4 ring-danger-soft/50">
            <Icon className="h-5 w-5" />
          </span>
          <DialogHeader className="pr-0 pt-0.5">
            <DialogTitle className="text-xl">{title}</DialogTitle>
            <DialogDescription>{message}</DialogDescription>
          </DialogHeader>
        </div>
        <DialogFooter className="mt-2">
          <button type="button" onClick={onCancel} disabled={loading} className={uiButtonClass}>{cancelLabel}</button>
          <DeleteButton variant="solid" icon={kind === "delete"} onClick={onConfirm} loading={loading} loadingLabel="Working...">
            {confirmLabel}
          </DeleteButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
