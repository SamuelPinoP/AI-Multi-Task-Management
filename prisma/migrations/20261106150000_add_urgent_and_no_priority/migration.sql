-- Two more priorities (#361). Postgres sorts enum values by their position, so
-- they go at the ends: NONE < LOW < MEDIUM < HIGH < URGENT. A new enum value
-- can't be used in the transaction that adds it, so the defaults that use
-- NONE are in the next migration.
ALTER TYPE "Priority" ADD VALUE IF NOT EXISTS 'NONE' BEFORE 'LOW';
ALTER TYPE "Priority" ADD VALUE IF NOT EXISTS 'URGENT' AFTER 'HIGH';
