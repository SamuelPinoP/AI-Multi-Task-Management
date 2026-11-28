-- Permanent task numbers, shown as AM-142 (#486). The migration runs as one transaction, and adding the column locks
-- "Task" until it ends, so no task can be created in between without a number.

-- CreateSequence: the name and type Prisma's autoincrement() expects, as SERIAL makes them.
CREATE SEQUENCE "Task_number_seq" AS INTEGER;

-- AlterTable: existing tasks are numbered in the order they were created, oldest first.
ALTER TABLE "Task" ADD COLUMN "number" INTEGER;
UPDATE "Task"
SET "number" = "ordered"."position"
FROM (SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS "position" FROM "Task") AS "ordered"
WHERE "Task"."id" = "ordered"."id";

-- New tasks take the next number. A sequence never goes back, so a number is never given out twice.
SELECT setval('"Task_number_seq"', COALESCE((SELECT max("number") FROM "Task"), 0) + 1, false);
ALTER TABLE "Task" ALTER COLUMN "number" SET DEFAULT nextval('"Task_number_seq"');
ALTER TABLE "Task" ALTER COLUMN "number" SET NOT NULL;
ALTER SEQUENCE "Task_number_seq" OWNED BY "Task"."number";

-- CreateIndex
CREATE UNIQUE INDEX "Task_number_key" ON "Task"("number");
