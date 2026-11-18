-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "isStarter" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "isStarter" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "isStarter" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "isStarter" BOOLEAN NOT NULL DEFAULT false;
