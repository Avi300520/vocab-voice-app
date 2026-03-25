# Migration Ledger

All migrations for the VocabVoice application database (Supabase/Postgres).

## Migration Sequence

| # | File | Description | Status |
|---|------|-------------|--------|
| 001 | `001_initial_schema.sql` | Initial schema: profiles, words, sessions, session_messages, session_words, RLS policies, triggers | Applied |
| 002 | `002_atomic_turn_insert.sql` | Atomic turn insertion RPC | Applied |
| 003 | `003_fix_turn_unique_constraint.sql` | Fix unique constraint on session_messages turns | Applied |
| 004 | `004_enable_pgmq.sql` | Enable pgmq, create semantic_evaluation_queue, semantic_failures table, pg_cron job | Applied |
| 005 | `005_atomic_enqueue_and_timestamps.sql` | Atomic enqueue helper and timestamp columns | Applied |
| 006 | `006_pgmq_rpc_wrappers.sql` | RPC wrappers for pgmq operations | Applied |
| 007 | `007_fix_pgmq_permissions.sql` | Fix pgmq permission grants | Applied |
| 008 | _(not on disk)_ | Applied manually via Supabase SQL Editor. Content not preserved in version control. | Applied (manual) |
| 009 | _(not on disk)_ | Applied manually via Supabase SQL Editor. Content not preserved in version control. | Applied (manual) |
| 010 | `010_semantic_evaluator_schema.sql` | Semantic evaluation schema: semantic_evaluations table, word_mastery table, process_evaluation_result RPC, FSRS scheduling | Applied |
| 011 | `011_words_unique_constraint.sql` | Replace functional index on words with named UNIQUE constraint for Supabase upsert compatibility | Applied |
| 012 | `012_fix_cron_auth_header.sql` | Fix cron ↔ Edge Function auth mismatch: drop X-Internal-Secret cron job, recreate sending Authorization: Bearer from vault.decrypted_secrets('service_role_key') | Applied |

## Notes

- **Migrations 008 and 009** were applied directly via the Supabase SQL Editor during development and their SQL was not saved to files. They are confirmed applied in the production database.
- **Migration 001** was originally located in `supabase/migrations/` and has been copied here for colocation with the rest of the ledger.
- Migrations are applied manually via the Supabase SQL Editor or MCP `execute_sql` — there is no automated migration runner in this project.
- Always verify applied state via `SELECT * FROM pg_catalog.pg_tables WHERE schemaname = 'public';` or constraint/function queries before re-running.
