-- CreateEnum
CREATE TYPE "AiDockState" AS ENUM ('OPEN', 'MINIMIZED', 'HIDDEN');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "aiDock" "AiDockState";
