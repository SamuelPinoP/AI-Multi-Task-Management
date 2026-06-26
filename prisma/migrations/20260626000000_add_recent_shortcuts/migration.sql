-- Track each user's most recently opened project and note for dashboard shortcuts.
CREATE TABLE "RecentShortcut" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "noteId" TEXT,
    "projectOpenedAt" TIMESTAMP(3),
    "noteOpenedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecentShortcut_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecentShortcut_userId_key" ON "RecentShortcut"("userId");
CREATE INDEX "RecentShortcut_projectId_idx" ON "RecentShortcut"("projectId");
CREATE INDEX "RecentShortcut_noteId_idx" ON "RecentShortcut"("noteId");

ALTER TABLE "RecentShortcut" ADD CONSTRAINT "RecentShortcut_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecentShortcut" ADD CONSTRAINT "RecentShortcut_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecentShortcut" ADD CONSTRAINT "RecentShortcut_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE SET NULL ON UPDATE CASCADE;
