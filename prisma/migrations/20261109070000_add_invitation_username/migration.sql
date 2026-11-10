-- Someone invited by username (#393) shows as that username to whoever invited
-- them, never as their email. Additive: one nullable column.

-- AlterTable
ALTER TABLE "ProjectInvitation" ADD COLUMN     "invitedUsername" TEXT;
