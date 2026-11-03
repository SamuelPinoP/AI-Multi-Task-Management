-- DropIndex
DROP INDEX "Project_shareToken_key";

-- AlterTable
ALTER TABLE "Project" DROP COLUMN "shareToken",
DROP COLUMN "sharedAt";
