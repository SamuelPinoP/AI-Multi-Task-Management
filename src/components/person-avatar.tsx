import { cn } from "@/lib/cn";
import { initials } from "@/lib/direct-chats-core";
import { paletteColor } from "@/lib/project-color";

/** A person's initials on their color (#386, #387). Decorative: their name is always written beside it. */
export function PersonAvatar({ id, name, className }: { id: string; name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold text-white", className)}
      style={{ backgroundColor: paletteColor(id) }}
    >
      {initials(name)}
    </span>
  );
}
