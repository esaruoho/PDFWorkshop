# Session — ocr-worker restart recovery

## How to get back
- Transcript: [8e489c04-0f53-4c8c-877a-b36fc1407f95.jsonl](file:///Users/esaruoho/.claude/projects/-Users-esaruoho-work-apple/8e489c04-0f53-4c8c-877a-b36fc1407f95.jsonl)
- Session ID: `8e489c04-0f53-4c8c-877a-b36fc1407f95`
- Resume: `cd ~/work/apple && claude --resume 8e489c04-0f53-4c8c-877a-b36fc1407f95`
- Span: 2026-11-24T10:07:35Z → 17:41:43Z (verified from transcript timestamps)
- Sibling cards from the same session: convey `features/ocr-ledger-shards.feature`, `features/ocr-collect-prune.feature`; pakettibot-agent `features/file-command-bridge-stale.feature`; PDFWorkshop `features/ocr-restart-recovery.feature`

## What happened
Esa: "if a OCR has been started, and you restart, does the OCR get cancelled … a PDF that was being OCR'd just vanished"; later "how do we know from ocr-logs, which ones were interrupted? … one really important one, long one, was cut off and never resumed. please fix".

- adams.pdf (bumped) was interrupted by my 13:52 Cloudcity restart; old recover_stuck put it into FIFO pending behind 431 jobs.
- a6842cc: interrupted jobs go to priority/ and are touched → resume first.
- Worker only logged to its iTerm pane, so interruptions left no record. Audit of ocr-guardian.log (job sampled every 10 min) against done/failed dirs found colville-1894 "Dashed Against the Rock", seen running 2026-11-18 18:10, stranded in pending at #317/407. Bumped 2026-11-24.
- 3fbe808: recover_stuck stamps `interrupted:` into the job and appends to comms/queue/ocr-interrupted.jsonl (backfilled with colville). Tested in scratchpad (@sim-verified); live after next Cloudcity restart.

## RESULT
- Commits: a6842cc, 3fbe808 (pushed, direct-push, no PR) — ocr-worker, features/ocr-restart-recovery.feature.
