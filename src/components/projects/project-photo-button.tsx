"use client";

import { Camera, ImagePlus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ProjectAvatar, type ProjectAvatarProject } from "@/components/projects/project-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toaster";
import { prepareProjectPhoto, ProjectPhotoError, removeProjectPhoto, uploadProjectPhoto } from "@/lib/project-photo-client";

function message(error: unknown) {
  return error instanceof ProjectPhotoError ? error.message : "Couldn't save the photo. Try again.";
}

/**
 * The project's photo in a chat's header (#403). The owner clicks it to upload
 * a new one or remove it, like WhatsApp's group photo; everyone else sees it.
 */
export function ProjectPhotoButton({ project, canChange, className }: { project: ProjectAvatarProject; canChange: boolean; className?: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // The version saved here shows at once, until the page's data catches up with it.
  const [saved, setSaved] = useState<{ over: string | null; version: string | null } | null>(null);
  const photoUpdatedAt = saved && saved.over === project.photoUpdatedAt ? saved.version : project.photoUpdatedAt;
  const avatar = <ProjectAvatar project={{ ...project, photoUpdatedAt }} className={className} />;

  if (!canChange) return avatar;

  async function run(task: () => Promise<string | null>, done: string) {
    setBusy(true);
    try {
      const version = await task();
      setSaved({ over: project.photoUpdatedAt, version });
      toast.success(done, { description: project.name });
      router.refresh();
    } catch (error) {
      toast.error(message(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        aria-label={`New photo for ${project.name}`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void run(async () => uploadProjectPhoto(project.id, await prepareProjectPhoto(file)), "Photo updated");
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Change ${project.name}'s photo`}
          title="Change the project photo"
          disabled={busy}
          className="relative shrink-0 rounded-xl outline-none ring-offset-2 ring-offset-surface focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait disabled:opacity-60"
        >
          {avatar}
          <span
            aria-hidden="true"
            className="absolute -bottom-1 -right-1 grid h-4.5 w-4.5 place-items-center rounded-full border-2 border-surface bg-ink text-surface"
          >
            <Camera className="h-2.5 w-2.5" strokeWidth={2.5} />
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel>Project photo</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => input.current?.click()}>
            <ImagePlus />
            {photoUpdatedAt ? "Upload a new photo" : "Upload a photo"}
          </DropdownMenuItem>
          {photoUpdatedAt ? (
            <DropdownMenuItem
              onSelect={() =>
                void run(async () => {
                  await removeProjectPhoto(project.id);
                  return null;
                }, "Photo removed")
              }
              className="text-danger [&_svg]:text-danger"
            >
              <Trash2 />
              Remove photo
            </DropdownMenuItem>
          ) : null}
          {/* A plain div: a paragraph isn't allowed inside role="menu". */}
          <div className="px-2.5 pb-1.5 pt-1 text-xs text-muted">JPG, PNG or WebP, cropped to a square.</div>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
