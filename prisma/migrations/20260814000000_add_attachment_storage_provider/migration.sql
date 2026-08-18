-- Historical rows predate AWS S3 support. The legacy metadata contract makes
-- local URLs relative and Vercel Blob URLs absolute. Refuse unknown shapes
-- instead of silently assigning an incorrect provider.
CREATE TYPE "ProjectChatStorageProvider" AS ENUM ('LOCAL', 'VERCEL_BLOB', 'AWS_S3');

ALTER TABLE "ProjectCommentAttachment"
ADD COLUMN "storageProvider" "ProjectChatStorageProvider",
ADD COLUMN "storageKey" TEXT;

UPDATE "ProjectCommentAttachment"
SET
  "storageProvider" = CASE
    WHEN "url" LIKE '/uploads/project-chat/%' THEN 'LOCAL'::"ProjectChatStorageProvider"
    WHEN "url" ~ '^https?://' THEN 'VERCEL_BLOB'::"ProjectChatStorageProvider"
    ELSE NULL
  END,
  "storageKey" = "fileName";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ProjectCommentAttachment"
    WHERE "storageProvider" IS NULL OR "storageKey" IS NULL OR "storageKey" = ''
  ) THEN
    RAISE EXCEPTION 'Cannot infer attachment storage provider. Expected a local /uploads/project-chat URL or an HTTP(S) Vercel Blob URL. Audit and correct legacy metadata before retrying.';
  END IF;
END $$;

ALTER TABLE "ProjectCommentAttachment"
ALTER COLUMN "storageProvider" SET NOT NULL,
ALTER COLUMN "storageKey" SET NOT NULL;
