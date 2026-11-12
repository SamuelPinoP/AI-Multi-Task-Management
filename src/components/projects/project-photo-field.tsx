"use client";

import { Camera } from "lucide-react";
import { useId, useRef, useState } from "react";
import { ProjectAvatar } from "@/components/projects/project-avatar";
import { uiButtonClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { photoPreviewUrl, prepareProjectPhoto, ProjectPhotoError, type ProjectPhotoChange } from "@/lib/project-photo-client";

/**
 * The optional photo in New project and Edit project (#403). The image is
 * cropped and shrunk as soon as it's picked; the sheet saves it with the
 * project.
 */
export function ProjectPhotoField({
  project,
  name,
  color,
  value,
  onChange,
}: {
  /** The project being edited, for its current photo; none for a new project. */
  project?: { id: string; photoUpdatedAt?: string | null } | null;
  name: string;
  color: string;
  value: ProjectPhotoChange;
  onChange: (change: ProjectPhotoChange) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existing = value.kind === "keep" && project?.photoUpdatedAt ? project.photoUpdatedAt : null;
  const hasPhoto = value.kind === "set" || Boolean(existing);
  const tile = { id: project?.id ?? "new", name: name.trim() || "?", color: color || null, photoUpdatedAt: existing };

  async function pick(file: File | undefined) {
    if (!file) return;
    setPreparing(true);
    setError(null);
    try {
      const blob = await prepareProjectPhoto(file);
      onChange({ kind: "set", blob, preview: await photoPreviewUrl(blob) });
    } catch (problem) {
      setError(problem instanceof ProjectPhotoError ? problem.message : "Couldn't read that image. Try a JPG or PNG.");
    } finally {
      setPreparing(false);
    }
  }

  return (
    <fieldset className="grid gap-1.5" aria-describedby={hintId}>
      <legend className="mb-1.5 text-sm font-medium">
        Photo <span className="font-normal text-muted">(optional)</span>
      </legend>
      <div className="flex items-center gap-3.5">
        {hasPhoto ? (
          <ProjectAvatar project={tile} src={value.kind === "set" ? value.preview : undefined} className="h-16 w-16 rounded-2xl text-2xl" />
        ) : (
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={preparing}
            aria-label="Add a photo"
            className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border-[1.5px] border-dashed border-muted bg-canvas text-muted transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Camera aria-hidden="true" className="h-5 w-5" />
          </button>
        )}
        <div className="grid gap-1.5">
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={preparing}
              className={cn(uiButtonClass, "px-2.5 py-1.5 text-xs")}
            >
              {preparing ? "Preparing..." : hasPhoto ? "Change" : "Add photo"}
            </button>
            {hasPhoto ? (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  // A photo picked just now is simply dropped; a saved one is removed on save.
                  onChange(value.kind === "set" && !project?.photoUpdatedAt ? { kind: "keep" } : { kind: "remove" });
                }}
                disabled={preparing}
                className={cn(uiButtonClass, "px-2.5 py-1.5 text-xs")}
              >
                Remove
              </button>
            ) : null}
          </div>
          <p id={hintId} className="text-xs text-muted">Shows in Chats. Without one, the project&rsquo;s first letter shows.</p>
        </div>
      </div>
      {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        aria-label="Project photo"
        onChange={(event) => {
          void pick(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </fieldset>
  );
}
