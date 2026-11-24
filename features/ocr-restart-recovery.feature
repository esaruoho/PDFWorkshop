# Report card: ocr-worker restart recovery
# Implementation: ocr-worker recover_stuck() (+ INTERRUPTED_LOG)
# Commits: a6842cc (resume first), this commit (durable interrupted ledger)
# Session: ~/.claude/projects/-Users-esaruoho-work-apple/8e489c04-0f53-4c8c-877a-b36fc1407f95.jsonl

Feature: An OCR job cut off by a Cloudcity restart resumes first and leaves a record

  @hw-verified
  Scenario: interrupted job resumes before anything else
    Given a job is still in worker-status/processing/ when ocr-worker boots
    When recover_stuck runs
    Then the job moves to priority/ and is touched (newest priority wins)
    # verified 2026-11-24: adams.pdf re-bumped, Boday_4 finished after restart

  @sim-verified
  Scenario: the interruption is recorded durably
    Given the pane log is lost on restart
    When recover_stuck moves a job
    Then the job file gains "interrupted: <UTC ts>"
    And comms/queue/ocr-interrupted.jsonl gains {ts,host,job,action}
    # verified 2026-11-24 in scratchpad with a spaced filename; live after next restart

  @built
  Scenario: past interruptions can be reconstructed
    Given ocr-guardian.log logs the running job every 10 min
    When a job seen running is in none of done/, failed-resolved/, _deduped/, _skip/
    Then it was cut off (2026-11-24 audit found colville-1894, stuck in pending since 11-18; bumped)
