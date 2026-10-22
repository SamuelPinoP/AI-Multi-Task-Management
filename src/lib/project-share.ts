import "server-only";
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Read-only share links (SMART-12): /share/<token>. The token is 24 random
 * bytes (base64url, 32 characters), so links can't be guessed. It's stored as
 * is, so the owner can copy the link again; "New link" replaces it and the
 * old one stops working.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export function newShareToken() {
  return randomBytes(24).toString("base64url");
}

export function sharePath(token: string) {
  return `/share/${token}`;
}

/** The project a share token opens, or null; malformed tokens never reach the database. */
export async function findSharedProject<S extends Prisma.ProjectSelect>(token: string, select: S) {
  if (!TOKEN_PATTERN.test(token)) return null;
  return (await prisma.project.findUnique({ where: { shareToken: token }, select })) as Prisma.ProjectGetPayload<{
    select: S;
  }> | null;
}
