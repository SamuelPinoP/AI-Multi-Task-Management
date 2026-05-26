-- CreateTable
CREATE TABLE "ProjectMemberNote" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMemberNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectMemberNote_memberId_idx" ON "ProjectMemberNote"("memberId");

-- AddForeignKey
ALTER TABLE "ProjectMemberNote" ADD CONSTRAINT "ProjectMemberNote_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "ProjectMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
