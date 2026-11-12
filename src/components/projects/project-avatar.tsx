"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { projectColor } from "@/lib/project-color";
import { projectPhotoUrl } from "@/lib/project-photo";

export type ProjectAvatarProject = { id: string; name: string; color: string | null; photoUpdatedAt: string | null };

/**
 * A project's tile (#403): its photo, or its first letter on a tint of its
 * color, which reads in both themes whatever the color. Projects get rounded
 * squares and people circles, as in Slack and Linear. Decorative: the
 * project's name is always written next to it.
 */
export function ProjectAvatar({ project, src, className }: { project: ProjectAvatarProject; src?: string | null; className?: string }) {
  const photo = src !== undefined ? src : project.photoUpdatedAt ? projectPhotoUrl(project.id, project.photoUpdatedAt) : null;
  // A photo that fails to load (offline, or removed a moment ago) falls back to the letter.
  const [failed, setFailed] = useState<string | null>(null);
  const tile = "h-10 w-10 shrink-0 rounded-xl border";

  if (photo && failed !== photo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- photos are stored at 256 px; next/image would only add a resize step.
      <img
        src={photo}
        alt=""
        aria-hidden="true"
        decoding="async"
        draggable={false}
        onError={() => setFailed(photo)}
        className={cn(tile, "border-line bg-surface object-cover", className)}
      />
    );
  }

  const color = projectColor(project);
  return (
    <span
      aria-hidden="true"
      className={cn(tile, "grid place-items-center text-base font-bold text-ink", className)}
      style={{
        backgroundColor: `color-mix(in srgb, ${color} 22%, var(--surface))`,
        borderColor: `color-mix(in srgb, ${color} 45%, transparent)`,
      }}
    >
      {project.name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
