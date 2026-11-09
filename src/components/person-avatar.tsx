import { cn } from "@/lib/cn";
import { initials } from "@/lib/direct-chats-core";
import { avatarColor } from "@/lib/project-color";

/** A person's initials on their color (#386, #387), dark enough for white text. Decorative: their name is always written beside it. */
export function PersonAvatar({ id, name, className }: { id: string; name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold text-white", className)}
      style={{ backgroundColor: avatarColor(id) }}
    >
      {initials(name)}
    </span>
  );
}
