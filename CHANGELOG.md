# Changelog

## 0.7.3 — 2026-09-04

- Release idle per-secret consume queues by comparing the promise actually
  stored in the map. Completed operations no longer retain a queue forever.
- Queue tails discard results and recover after rejection without deleting a
  later operation's queue.
- Add regression coverage for 1,000 unknown IDs, storage failures and recovery.
- Isolate unit-test storage in temporary directories, cleaned up after the run.

No configuration or data migration is needed. One-time consumption and
encryption semantics are unchanged.
