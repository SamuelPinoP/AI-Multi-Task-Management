# Database

PostgreSQL through Prisma. Setup is in [development.md](development.md#setup); where the production and preview databases live is in [ci-and-deploys.md](ci-and-deploys.md#where-things-run).

## The shared local database

A checkout's `.env` usually points at one local database that the owner migrates. Never run `prisma migrate deploy` against a database you don't own: use your own (below).

## A throwaway database

For tests, or when the shared local database must stay untouched, use your own cluster on a free port:

1. `initdb -U app --pwfile=<file holding "app"> -A scram-sha-256 <pgdata>` in a scratch folder.
2. `pg_ctl -D <pgdata> -o "-p <port> -c listen_addresses=localhost" start` (in the background: it keeps the shell attached), then `createdb -h localhost -p <port> -U app app_test`.
3. Point `DATABASE_URL` at it with CI's user and password, run `npx prisma migrate deploy`.
4. Stop it with `pg_ctl -D <pgdata> -m fast stop`. If every e2e test times out at the first heading, the cluster stopped (Prisma "P1001"): check `pg_isready -h localhost -p <port>`.

Never run `prisma migrate deploy` against a database you don't own: the shared local one is migrated by the owner.

## Migrations

1. Bring your database up to date (`npx prisma migrate deploy`).
2. Edit `prisma/schema.prisma`.
3. Create `prisma/migrations/<YYYYMMDDHHMMSS>_<name>/` and write its SQL with `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script -o prisma/migrations/<folder>/migration.sql`. Check that the file holds only SQL.
4. Deploy again, then `npx prisma generate`.

- Migrations stay additive (new tables, nullable columns, indexes). Anything that drops or rewrites data needs the owner's OK.
- Use a timestamp later than the newest migration on `main`, and check again after merging `main` in: collisions happened twice.
- Dropping a column, table or enum value takes two deploys. First stop using it (`@ignore` a column's field, or Prisma keeps selecting it), then drop it in a later PR.
- CI fails if `schema.prisma` and the migrations disagree.

## Times in the database

- Prisma stores UTC in `timestamp without time zone`. In raw SQL use `now() AT TIME ZONE 'utc'`, never a Date parameter.
- `timestamptz` columns (such as `RateLimit.expiresAt`) compare with SQL `now()`; Prisma's `lt: new Date()` shifts by the database's zone there.
- On a Neon cold start, Prisma's 5-second interactive-transaction default can be too short.
