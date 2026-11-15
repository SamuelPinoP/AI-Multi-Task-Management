-- CreateTable
CREATE TABLE "EmailHourlyCount" (
    "hour" TIMESTAMP(3) NOT NULL,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EmailHourlyCount_pkey" PRIMARY KEY ("hour")
);
