-- CreateEnum
CREATE TYPE "AgentRunOutcome" AS ENUM ('ANSWERED', 'STEP_LIMIT', 'INVALID_ARGUMENTS', 'RATE_LIMITED', 'PROVIDER_ERROR', 'TIMED_OUT', 'CANCELLED', 'USER_LIMIT', 'APP_LIMIT', 'DISABLED', 'FAILED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "aiNoticeAcceptedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider" TEXT,
    "model" TEXT,
    "outcome" "AgentRunOutcome" NOT NULL,
    "modelRequests" INTEGER NOT NULL DEFAULT 0,
    "toolCalls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "validationFailures" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentRun_userId_createdAt_idx" ON "AgentRun"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_createdAt_idx" ON "AgentRun"("createdAt");

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
