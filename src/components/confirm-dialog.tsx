"use client";

import { uiButtonClass, uiDangerButtonClass } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type ConfirmDialogProps = { open: boolean; title: string; message: string; confirmLabel?: string; cancelLabel?: string; loading?: boolean; onConfirm: () => void; onCancel: () => void; };

export function ConfirmDialog({ open, title, message, confirmLabel = "Delete", cancelLabel = "Cancel", loading = false, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !loading) onCancel(); }}>
      <DialogContent className="max-w-md" hideClose>
        <DialogHeader>
          <DialogTitle className="text-xl">{title}</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-2">
          <button type="button" onClick={onCancel} disabled={loading} className={uiButtonClass}>{cancelLabel}</button>
          <button type="button" onClick={onConfirm} disabled={loading} className={uiDangerButtonClass}>{loading ? "Working..." : confirmLabel}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
