-- CreateTable
CREATE TABLE "ProjectCommentAttachment" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectCommentAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectCommentAttachment_commentId_idx" ON "ProjectCommentAttachment"("commentId");

-- CreateIndex
CREATE INDEX "ProjectCommentAttachment_userId_idx" ON "ProjectCommentAttachment"("userId");

-- AddForeignKey
ALTER TABLE "ProjectCommentAttachment" ADD CONSTRAINT "ProjectCommentAttachment_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "ProjectComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCommentAttachment" ADD CONSTRAINT "ProjectCommentAttachment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
