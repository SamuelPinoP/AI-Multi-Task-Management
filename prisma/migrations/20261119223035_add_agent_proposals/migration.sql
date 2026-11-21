-- CreateEnum
CREATE TYPE "AgentProposalStatus" AS ENUM ('PENDING', 'APPLIED', 'CANCELLED', 'FAILED');

-- AlterEnum
ALTER TYPE "ActivityAction" ADD VALUE 'UPDATED_TASK';

-- CreateTable
CREATE TABLE "AgentProposal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" TEXT,
    "steps" JSONB NOT NULL,
    "status" "AgentProposalStatus" NOT NULL DEFAULT 'PENDING',
    "applied" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "links" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "AgentProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentProposal_messageId_key" ON "AgentProposal"("messageId");

-- CreateIndex
CREATE INDEX "AgentProposal_userId_createdAt_idx" ON "AgentProposal"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentProposal_createdAt_idx" ON "AgentProposal"("createdAt");

-- AddForeignKey
ALTER TABLE "AgentProposal" ADD CONSTRAINT "AgentProposal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentProposal" ADD CONSTRAINT "AgentProposal_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AgentChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
