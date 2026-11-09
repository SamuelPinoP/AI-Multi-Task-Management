-- There are no viewers any more: everyone in a project edits (#385). Every
-- Viewer member, and every invitation that would have made one (pending or
-- kept as history), becomes an Editor. The owner asked for it ("there is no
-- such thing as viewers"). The VIEWER value itself goes in #388, once no
-- deployed code can write it.

UPDATE "ProjectMember" SET "role" = 'EDITOR', "updatedAt" = (now() AT TIME ZONE 'utc') WHERE "role" = 'VIEWER';

UPDATE "ProjectInvitation" SET "role" = 'EDITOR', "updatedAt" = (now() AT TIME ZONE 'utc') WHERE "role" = 'VIEWER';
