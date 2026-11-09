-- Direct messages between people who share a project (#387). Additive: three
-- tables (chats, their messages, and each person's read mark) and their indexes.

-- CreateTable
CREATE TABLE "DirectChat" (
    "id" TEXT NOT NULL,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DirectChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectMessage" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DirectMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectChatRead" (
    "userId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DirectChatRead_pkey" PRIMARY KEY ("userId","chatId")
);

-- CreateIndex
CREATE INDEX "DirectChat_userBId_idx" ON "DirectChat"("userBId");

-- CreateIndex
CREATE UNIQUE INDEX "DirectChat_userAId_userBId_key" ON "DirectChat"("userAId", "userBId");

-- CreateIndex
CREATE INDEX "DirectMessage_chatId_createdAt_idx" ON "DirectMessage"("chatId", "createdAt");

-- CreateIndex
CREATE INDEX "DirectMessage_userId_idx" ON "DirectMessage"("userId");

-- CreateIndex
CREATE INDEX "DirectChatRead_chatId_idx" ON "DirectChatRead"("chatId");

-- AddForeignKey
ALTER TABLE "DirectChat" ADD CONSTRAINT "DirectChat_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectChat" ADD CONSTRAINT "DirectChat_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectMessage" ADD CONSTRAINT "DirectMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "DirectChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectMessage" ADD CONSTRAINT "DirectMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectChatRead" ADD CONSTRAINT "DirectChatRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectChatRead" ADD CONSTRAINT "DirectChatRead_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "DirectChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
