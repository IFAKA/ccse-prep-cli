# CCSE CLI Verification

Audit date: 2026-09-22. Official rules are specified in [OFFICIAL-GROUND-TRUTH.md](OFFICIAL-GROUND-TRUTH.md).

## Official ground truth

Implemented rules: 25 questions, 45 minutes, fixed task quotas 10/3/2/3/7, three-choice or true/false items, one point for each correct answer, zero for wrong answers, no penalty for wrong or blank answers, and a pass mark of 15/25. The current-year 2026 manual applies to 2026 sittings. Instituto Cervantes describes the 2026 manual questions as included in tests from January 2026 and says the official app's practice set corresponds to official test questions. An older official announcement explicitly says exams draw 25 from a 300-question temario. Cervantes does not publish the current random generator; this tool uses uniform random sampling within each official task quota.

Sources and the limits of what can be asserted are listed in [OFFICIAL-GROUND-TRUTH.md](OFFICIAL-GROUND-TRUTH.md).

## Current architecture

```text
                       ┌─────────────────────────────────────┐
                       │ data/ccse-2026-questions.json       │
                       │ 300 manual items + local explanations│
                       └─────────────────┬───────────────────┘
                                         │ bundled fallback
┌───────────────┐     ┌──────────────────▼──────────────┐
│ bin/ccse.mjs  ├────►│ questionBank.mjs                │
│ args + session│     │ validate remote/cache/bundled   │
└───────┬───────┘     └──────────────────┬──────────────┘
        │                                 │ active bank
        │                                 ▼
        │                    ┌───────────────────────────┐
        │                    │ terminalQuiz.mjs          │
        │                    │ validation, exam plans,  │
        │                    │ score, learning, readiness│
        │                    └───────┬───────────┬───────┘
        │                            │           │
        │                  training  │           │ unbiased mock
        │                            ▼           ▼
        │                 weak/unseen order   shuffled by task
        │                            └─────┬─────┘
        │                                  ▼
        │                    ┌───────────────────────────┐
        └───────────────────►│ terminalTui.mjs (Ink)     │
                             │ J/K/L input, timer, review│
                             └─────────────┬─────────────┘
                                           │ answer/completion events
                                           ▼
                              ┌────────────────────────┐
                              │ eventStore.mjs         │
                              │ validated atomic log   │
                              └────────────┬───────────┘
                                           │
                     ┌─────────────────────┴──────────────────┐
                     ▼                                        ▼
              reducer/scheduler                         mock-only
              current-bank state                         readiness evidence
```

Normal startup validates/loads the current bank, filters answer history to the active bank fingerprint, chooses the date-based training plan, records a session with its question IDs, and starts Ink. `--mock` builds a fresh random plan independent of history. `--practice` uses the adaptive plan and immediate correction. Answers are persisted before becoming visible as accepted answers. Completion events carry the score and bank fingerprint. `--readiness` only counts complete, timed mock records from the current fingerprint.

## Question-bank audit

`npm run audit:bank` inspected all bundled records:

- 300 records and 300 unique IDs; no duplicate question text.
- Counts: Task 1: 120; Task 2: 36; Task 3: 24; Task 4: 36; Task 5: 84.
- IDs occupy all intended task ranges: 1001–1120, 2001–2036, 3001–3024, 4001–4036, and 5001–5084.
- No malformed records, missing answers/explanations, duplicate choices, empty choices, invalid answer keys, suspicious footer/encoding strings, or missing manual page references after correction.
- Task 2 has two true/false choices; other tasks have three options.

Five transcription artifacts were detected and corrected: the word `PREGUNTAS` was appended to one last choice each in questions 1008, 2008, 3008, 4008, and 5007. The official 2026 PDF web text shows the clean choice at each item; the full local PDF download failed TLS certificate validation, so a complete automated 300-record comparison against the PDF and its answer key was not possible. Shape integrity is verified; full semantic correctness of every answer is not.

## Exam-generation invariants

Every mock is constructed by independently shuffling each task's eligible bank and taking exactly that task's quota. This makes each eligible question in a task equally likely, independent of practice state, with no duplicate possible because each task sample is without replacement and task ID ranges do not overlap. Input bank validation requires 300 items, the official task sizes, unique text and IDs, task-valid ID ranges, valid single answer keys, complete distinct options, and required metadata.

Tests verify the quotas and no duplicates. The simulation uses a deterministic LCG seed and generated 100,000 exams. It found 0 invariant errors, all 300 questions reachable, and maximum deviations from expected per-question frequency between 1.60σ and 2.78σ across tasks; the configured rejection limit is 5σ. Seeded sampling reproduces plans for an identical source and seed.

## Scoring verification

The score is the count of correct recorded answers; wrong and blank responses contribute zero. Passing requires a complete 25-question session and at least 15 correct. Regression cases cover 0, 14, 15, 16, and 25 correct, 11 unanswered with 14 correct, and timed-out incomplete work. The exact 14/15 boundary test would fail if the threshold moved by one. Wrong and blank cases cannot increase the correct count.

## Statistical simulation

Command: `npm run simulate:exams -- 100000`.

Results: 100,000 exams; exact 25-item length and quota checks passed for each; no intra-exam repeats; all 300 bank records sampled. Expected appearances were 8,333.33 per question. Observed min–max by task and largest standardized deviation:

| Task | Expected per question | Observed min–max | Max deviation |
| --- | ---: | ---: | ---: |
| 1 | 8,333.3 | 8,091–8,558 | 2.773σ |
| 2 | 8,333.3 | 8,184–8,517 | 2.101σ |
| 3 | 8,333.3 | 8,189–8,474 | 1.651σ |
| 4 | 8,333.3 | 8,201–8,473 | 1.598σ |
| 5 | 8,333.3 | 8,165–8,538 | 2.342σ |

The simulation establishes the generator's distribution, not Cervantes' private algorithm.

## Training algorithm

Training prioritizes weak answers, then unseen/due learning items and other due items; the existing scheduler reduces the next interval after incorrect answers and lengthens it after repeated correct retrievals. `--practice` supplies immediate explanation. States amount to unseen/unknown, weak/wrong, learning/uncertain, and mastered/known. No confidence input is collected, so guessed correct answers cannot be distinguished from confident correct answers; no extra confidence UI was added without evidence it would repay the interaction cost before the exam. Practice scores are excluded from mock readiness.

## Readiness measurement

`ccse --readiness` reports up to the last five complete mock scores, minimum and arithmetic mean correct, unique questions encountered in training, remaining training-unseen questions, unique questions appearing in mocks, mock-bank coverage remaining, and counts of weak, uncertain, and mastered items. Mock evidence is filtered to the active bank fingerprint; old or stale-bank records do not count. A readiness flag requires the last three complete mocks to each score at least 20/25. It is an observable margin rule, not a probability estimate. Random mock samples may overlap between sessions, and the CLI reports that coverage instead of pretending each mock is wholly new.

## Bugs discovered

1. **Mock selection was deterministic and biased.** The mock builder sorted by training priority and question ID, so the same early item subset repeatedly appeared and training history changed the score meaning. It now shuffles independently within task quotas. Regression and 100,000-exam tests fail on biased/constant selection.
2. **Bank validation was shallow.** It checked only a few fields and counts. It now rejects malformed shapes, duplicate text/choices, invalid keys, missing explanation/page, impossible task IDs/ranges, task option-type mismatches, and suspicious extraction artifacts. Mutation-style tests alter choices, IDs, and text.
3. **Five answer choices contained PDF page-footer text.** Removed only the footer suffix from the five records listed above; added suspicious-text detection and regression coverage.
4. **Corrupt progress could be silently erased.** Read failures were swallowed and append rewrote an empty log. Reads now distinguish missing files from malformed logs, validate event envelopes, validate answers against a resumed question sequence, and append through an atomic rename. Tests cover missing, corrupt, malformed, and duplicate-event cases.
5. **Repeated sessions on the same day reused an ID.** This caused start/completion event deduplication and cross-session answer association. New sessions now use UUIDs.
6. **Bank updates could silently shrink a resumed session.** Missing question IDs were filtered out. Resume now requires an exact active-bank fingerprint and 25 valid distinct IDs; otherwise it starts a new session.
7. **Rapid key input could race persistence.** The TUI accepted successive key events before the preceding event write completed. It now guards answer writes and only advances after persistence succeeds.
8. **True/false questions advertised a third key.** The answer handler ignored `L` when option C was absent, but the footer still claimed J/K/L were available. It now shows only J/K for two-choice items.
9. **The existing developer `node_modules` tree contained a second untracked React/reconciler tree.** The first actual TTY run reproduced an invalid-hook-call crash. It is absent from the lockfile. OS-level `EPERM` prevented npm from cleaning this generated directory, so tests and the fresh runtime smoke were executed from a clean lockfile install in `/tmp/ccse-run-final`; the installed CLI will also be recreated from a clean release by the requested reinstall.

## Remaining uncertainties

- The current Cervantes source does not disclose the actual exam randomization algorithm; uniform sampling within task quotas is a justified mock, not proof of internal implementation equivalence.
- Full automated matching of all question wording, options, and answer keys against the official PDF remains unverified because the local PDF download failed TLS validation. Five parser artifacts were verified and fixed from official PDF text.
- Confidence calibration is not measured.
- Small-terminal resize, physical Ctrl-C/EOF sequences, and every terminal emulator were not exhaustively automated. Ctrl-C exits leave an incomplete started session for resume; malformed event storage fails loudly.
- This JavaScript project has no formatter, ESLint configuration, or static type checker. `check:syntax` runs Node parser checks; formatting and typecheck are not applicable as configured.

## Commands

Run from the repository root with dependencies installed:

```sh
npm test
npm run check:syntax
npm run audit:bank
npm run simulate:exams -- 100000
node bin/ccse.mjs --validate-bank
node bin/ccse.mjs --help
node bin/ccse.mjs --version
```

An interactive smoke used a clean lockfile install in `/tmp/ccse-run-final` with `CCSE_DATA_DIR=/tmp/ccse-tty-final node bin/ccse.mjs --mock`; it rendered a 45:00 mock, showed only J/K for a true/false item, accepted and persisted 25 consecutive keypresses, scored 12/25, showed the complete task breakdown and corrections, and exited. `--readiness` then reported one complete mock, 25 unique questions seen, and excluded practice from the metric. The storage log contained 25 unique answer events and one completion event.

## Final status

- **OFFICIAL-RULE FIDELITY:** verified for published count, time, format, scoring, pass mark, and task quotas.
- **QUESTION-BANK INTEGRITY:** partially verified; complete structural audit passed, five visible defects were fixed, but every answer key was not machine-compared to the official manual.
- **SCORING:** verified, including the exact pass boundary and unanswered behavior.
- **SAMPLING:** verified against implemented invariants and 100,000 simulated exams; the official private RNG remains undocumented.
- **TRAINING LOGIC:** verified for adaptive ordering, immediate correction flow, and isolation from mock readiness; confidence is not measured.
- **CLI ROBUSTNESS:** partially verified; event corruption, invalid cache/bank fallback, clean TTY launch, full 25-answer persistence, scoring, and resume fingerprint handling have executable checks, but terminal resize/EOF/Ctrl-C matrix is not fully automated.
