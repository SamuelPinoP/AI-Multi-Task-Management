import type { HomePerson } from "@/lib/home-data";
import { paletteColor } from "@/lib/project-color";

const nameOf = (person: HomePerson) => (person.isYou ? "You" : person.name);

/**
 * Up to `max` overlapping avatars, then "+N" for the rest (DES-11). Each shows
 * its name on hover, and the list reads as names to screen readers.
 */
export function AvatarStack({ people, label, max = 3 }: { people: HomePerson[]; label: string; max?: number }) {
  const shown = people.slice(0, max);
  const rest = people.slice(max);

  return (
    <ul aria-label={label} className="flex shrink-0 items-center">
      {shown.map((person) => (
        <li
          key={person.id}
          title={nameOf(person)}
          className="-ml-1.5 grid h-5 w-5 place-items-center rounded-full text-2xs font-bold text-white ring-2 ring-surface first:ml-0"
          style={{ backgroundColor: paletteColor(person.id) }}
        >
          <span aria-hidden="true">{person.name.charAt(0).toUpperCase()}</span>
          <span className="sr-only">{nameOf(person)}</span>
        </li>
      ))}
      {rest.length ? (
        <li
          title={rest.map(nameOf).join(", ")}
          className="-ml-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-sunken px-1 font-mono text-2xs font-semibold text-muted ring-2 ring-surface"
        >
          <span aria-hidden="true">+{rest.length}</span>
          <span className="sr-only">and {rest.length} more: {rest.map(nameOf).join(", ")}</span>
        </li>
      ) : null}
    </ul>
  );
}
