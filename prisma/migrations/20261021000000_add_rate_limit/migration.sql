-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "window" INTEGER NOT NULL,
    "count" INTEGER NOT NULL,
    "previousCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "RateLimit_expiresAt_idx" ON "RateLimit"("expiresAt");
