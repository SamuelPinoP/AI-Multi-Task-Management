-- Add a durable marker for database-backed guest workspaces.
ALTER TABLE "User" ADD COLUMN "isGuest" BOOLEAN NOT NULL DEFAULT false;
