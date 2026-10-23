-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "skippedDates" DATE[] DEFAULT ARRAY[]::DATE[];
