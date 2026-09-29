## Claude Interaction Guidelines

**CRITICAL**: Ask me any questions you have. Interview me to get clarification.
Never assume or guess about requirements. If something is ambiguous, stop and ask
before acting.

### Back up before you change anything

Before modifying any file, database, configuration, or repository state, create a
backup first and confirm it succeeded before proceeding.

- **Files**: copy the original to a timestamped backup (for example
  `filename.bak.YYYYMMDD-HHMMSS`) or to a `_backups/` folder before editing,
  overwriting, or deleting. Do the same for every file in a multi-file change.
- **Databases**: take a dump or snapshot of the affected tables (or the whole
  database if the change is broad) before any schema change, migration, bulk
  update, or delete. Where a full backup isn't practical, at minimum export the
  rows that will be touched.
- **Version control**: commit or stash uncommitted work, and create a backup
  branch or tag before any history-rewriting or branch-altering operation.
- **Infrastructure and config**: export or record the current state (env vars,
  settings, DNS records, deployment config) before changing it.

Tell me where the backup is and how to restore from it. If a backup cannot be
made, stop and ask me to confirm next steps. If GitHub has a backup you do not
need to make another backup.

## Daily Work Sessions

At the end of each working session, create or update
`docs/claude_working_session_YYYYMMDD.txt` with a summary of the day's changes.
Include: what was changed, test results, known issues, and any pending items.
This provides a daily changelog for the project.

I will manually maintain `working_session_YYYYMMDD.txt` with my notes, prompts,
etc. Claude should use these working sessions as reference of previous changes
and work with priority on the most recent ones.

Also update any skills or CLAUDE.md with any lessons learned.

## Time Log

Track daily work for billing in `docs/time_log.txt`. That file is the single
source of truth for hours — do not duplicate hours anywhere else.

- One row per working day, in the markdown table format below.
- The `Summary` should be specific enough to justify the hours to a client
  (what changed, what was tested/fixed), not just "worked on X".
- At the end of each session, update the day's row (or add it). If a row for
  today already exists, extend its summary and adjust the hours rather than
  adding a second row for the same date.
- ALWAYS ask the user how many hours to log before writing — never guess the
  number.

Template:

```
Time Log — <Project Name>
=====================================================

| Date       | Summary                                                          | Hours |
|------------|------------------------------------------------------------------|-------|
| YYYY-MM-DD | Short, specific description of the day's work                    | 0     |
```
