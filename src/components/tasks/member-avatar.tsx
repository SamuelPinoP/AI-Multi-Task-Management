import { paletteColor } from "@/lib/project-color";

/** A project member's initial on their color, for the assignee pickers and buttons. */
export function MemberAvatar({ id, name }: { id: string; name: string }) {
  return (
    <span aria-hidden="true" className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-2xs font-bold text-white" style={{ backgroundColor: paletteColor(id) }}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
