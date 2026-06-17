CREATE TABLE "NotificationState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationState_userId_sourceKey_key" ON "NotificationState"("userId", "sourceKey");
CREATE INDEX "NotificationState_userId_readAt_idx" ON "NotificationState"("userId", "readAt");
CREATE INDEX "NotificationState_userId_dismissedAt_idx" ON "NotificationState"("userId", "dismissedAt");

ALTER TABLE "NotificationState" ADD CONSTRAINT "NotificationState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
