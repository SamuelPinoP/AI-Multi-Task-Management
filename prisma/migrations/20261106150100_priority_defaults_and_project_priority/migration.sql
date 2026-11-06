-- New tasks start with no priority, and projects get a priority of their own
-- (#361). Existing tasks keep theirs.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "priority" "Priority" NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "Task" ALTER COLUMN "priority" SET DEFAULT 'NONE';
