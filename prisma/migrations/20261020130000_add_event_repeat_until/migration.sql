-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "repeatUntil" DATE;

-- Until now a repeating event's end date was also the end of its series.
-- Keep those series ending where they did: their end date becomes the new
-- "repeat until" date. No existing column changes.
UPDATE "Event"
SET "repeatUntil" = "endTime"::date
WHERE "recurrence" <> 'NONE'
  AND "endTime" IS NOT NULL
  AND "endTime"::date > "startTime"::date;
