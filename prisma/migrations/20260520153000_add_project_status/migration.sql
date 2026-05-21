-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE';
