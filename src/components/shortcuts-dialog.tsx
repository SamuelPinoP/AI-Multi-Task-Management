"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { goTargets } from "@/lib/shortcuts";

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {keys.map((key, index) => (
        <span key={index} className="flex items-center gap-1">
          {index ? <span className="text-xs text-muted">then</span> : null}
          <kbd className="min-w-6 rounded border border-line bg-canvas px-1.5 py-0.5 text-center font-sans text-xs font-semibold">{key}</kbd>
        </span>
      ))}
    </span>
  );
}

const general: Array<{ label: string; keys: string[] }> = [
  { label: "Search or run a command", keys: ["Ctrl K"] },
  { label: "Search", keys: ["/"] },
  { label: "New task", keys: ["N"] },
  { label: "Close a dialog or panel", keys: ["Esc"] },
  { label: "Show these shortcuts", keys: ["?"] },
];

/** The list of keyboard shortcuts (press ? anywhere outside a text field). */
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>They work anywhere except while you type in a field. On a Mac, use Cmd instead of Ctrl.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 text-sm">
          <ul className="grid gap-2">
            {general.map((item) => (
              <li key={item.label} className="flex items-center justify-between gap-3">
                {item.label}
                <Keys keys={item.keys} />
              </li>
            ))}
          </ul>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Go to</h3>
            <ul className="grid gap-2">
              {Object.entries(goTargets).map(([key, target]) => (
                <li key={key} className="flex items-center justify-between gap-3">
                  {target.label}
                  <Keys keys={["G", key.toUpperCase()]} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
