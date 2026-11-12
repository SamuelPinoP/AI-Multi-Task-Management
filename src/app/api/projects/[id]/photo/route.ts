import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getProjectAccess, isProjectOwner, projectAccessWhere, unauthorizedProjectResponse } from "@/lib/project-access";
import { PROJECT_PHOTO_MAX_BYTES, PROJECT_PHOTO_TOO_LARGE, projectPhotoProblem, sniffProjectPhotoType } from "@/lib/project-photo";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit-core";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/** Every photo URL carries its version (?v=), so the current one can be kept for a year without going stale. */
const CACHE_CURRENT = "private, max-age=31536000, immutable";

/**
 * Project photos (#403). Anyone in the project can see the photo; only the
 * owner can change or remove it, like the project's name and color.
 */
export async function GET(req: Request, context: RouteContext) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { id } = await context.params;
  const photo = await prisma.projectPhoto.findFirst({
    where: { projectId: id, project: projectAccessWhere(user.id) },
    select: { contentType: true, bytes: true, updatedAt: true },
  });
  if (!photo) return NextResponse.json({ error: "Photo not found" }, { status: 404 });

  // An old or missing ?v= gets the current photo too, but must ask again next time.
  const current = new URL(req.url).searchParams.get("v") === String(photo.updatedAt.getTime());
  return new Response(photo.bytes, {
    headers: {
      "Content-Type": photo.contentType,
      "Cache-Control": current ? CACHE_CURRENT : "private, no-cache",
      // The type was read from the bytes on upload; never let a browser guess another.
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

/** Sets the photo. The body is the image itself, already cropped and shrunk by the browser. */
export async function PUT(req: Request, context: RouteContext) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { id } = await context.params;
  const access = await getProjectAccess(id, user.id);
  if (!access) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (!isProjectOwner(access)) return NextResponse.json(unauthorizedProjectResponse("change the photo"), { status: 403 });

  // Refuse an oversized upload before reading it.
  if (Number(req.headers.get("content-length")) > PROJECT_PHOTO_MAX_BYTES) {
    return NextResponse.json({ error: PROJECT_PHOTO_TOO_LARGE }, { status: 413 });
  }

  const limit = await consumeRateLimit(RATE_LIMITS.projectPhotosUser, user.id);
  if (!limit.allowed) return rateLimitedResponse("photo changes", limit);

  const bytes = new Uint8Array(await req.arrayBuffer());
  const problem = projectPhotoProblem(bytes);
  const contentType = sniffProjectPhotoType(bytes);
  if (problem || !contentType) {
    return NextResponse.json(
      { error: problem ?? "Use a PNG, JPEG or WebP image." },
      { status: bytes.length > PROJECT_PHOTO_MAX_BYTES ? 413 : 400 },
    );
  }

  const photo = await prisma.projectPhoto.upsert({
    where: { projectId: id },
    create: { projectId: id, contentType, bytes },
    update: { contentType, bytes },
    select: { updatedAt: true },
  });
  return NextResponse.json({ photoUpdatedAt: photo.updatedAt.toISOString() });
}

/** Removes the photo; the project's letter tile shows again. */
export async function DELETE(_req: Request, context: RouteContext) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { id } = await context.params;
  const access = await getProjectAccess(id, user.id);
  if (!access) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (!isProjectOwner(access)) return NextResponse.json(unauthorizedProjectResponse("remove the photo"), { status: 403 });

  await prisma.projectPhoto.deleteMany({ where: { projectId: id } });
  return NextResponse.json({ photoUpdatedAt: null });
}
