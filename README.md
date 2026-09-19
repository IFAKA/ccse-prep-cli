# CCSE Prep CLI

[![CI](https://github.com/IFAKA/ccse-prep-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/IFAKA/ccse-prep-cli/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A terminal-first study tool for the **CCSE 2026 Spanish citizenship exam**. It uses the official 300-question bank, realistic 25-question mock exams, spaced review, delayed recall, corrective feedback, and a 45-minute countdown.

The project is designed for people who live in the terminal and want a low-friction daily practice loop, including tmux users.

## Why this exists

The CLI combines retrieval practice, corrective feedback, spaced review, and mixed practice into a focused CCSE preparation workflow. It measures fresh-question performance separately from delayed review so a high score caused by recent repetition is not mistaken for durable readiness.

This is a practical study aid, not a claim that one exact schedule is scientifically optimal for every learner.

## Features

- Official CCSE 2026 question bank bundled locally: 300 questions across the five exam tasks.
- Official mock distribution: `10 / 3 / 2 / 3 / 7` questions across Tasks 1–5.
- 45-minute countdown matching the exam duration.
- Immediate explanations during coverage and weak-question review sessions.
- End-of-session scoring for mock exams, with no correctness feedback during the mock.
- Delayed review of questions missed in the previous completed session.
- Fresh-question, delayed-review, and overall scores in the completion summary.
- Official pass threshold (`15/25`) and conservative preparation target (`20/25`).
- Append-only local event log with safe resume after `Ctrl-C` or terminal shutdown.
- Timeout handling that records partial work and prevents a timed-out session from resuming.
- Optional start-of-day shell gate that launches one session per day, including a temporary tmux window.
- No network dependency during study sessions and no AI-generated exam content.

## Requirements

- Node.js 18 or newer
- An interactive terminal
- zsh if you want the optional shell startup gate

## Install

Install or reinstall with one command:

```bash
curl -fsSL https://raw.githubusercontent.com/IFAKA/ccse-prep-cli/refs/heads/master/scripts/ccse-installer.sh | sh
```

The installer checks Node.js 18+, downloads the project, installs runtime dependencies, refreshes the question bank, creates `~/.local/bin/ccse`, and prints the enabled features and active bank status. Open a new terminal if `~/.local/bin` was not already on your `PATH`.

Then run:

```bash
ccse
```

To uninstall the application while preserving study progress:

```bash
curl -fsSL https://raw.githubusercontent.com/IFAKA/ccse-prep-cli/refs/heads/master/scripts/ccse-installer.sh | sh -s -- uninstall
```

To inspect the installed command without starting a session:

```bash
ccse --version
ccse --help
ccse --bank-info
```

The installer keeps application files under `~/.local/share/ccse-prep-cli` and study data under `~/.local/share/ccse-prep`. Uninstalling removes only the application and command link; progress is preserved.

## Daily automatic launch

If you open a terminal every day, source the shell gate from `~/.zshrc`:

```zsh
source "/absolute/path/to/ccse-prep-cli/scripts/ccse-shell-gate.zsh"
```

The gate launches one session per day. Inside tmux it creates a temporary `ccse-prep` window and leaves your current window untouched. You can always run `ccse` manually for an additional session.

Automatic preparation is skipped on the exam date, 24 September 2026.

## Controls and session behavior

| Action | Key |
| --- | --- |
| Select option A | `J` |
| Select option B | `K` |
| Select option C | `L` |
| Finish a complete session | `Enter` |
| Leave and resume later | `Ctrl-C` |

Sessions adapt to the exam date:

- More than four days before the exam: broad coverage.
- Three or four days before: weak-question review.
- One or two days before: full mock exam.
- Exam day: no automatic preparation session.

Review sessions show the answer and explanation immediately. Mock sessions reveal scoring and explanations only after completion.

## Local data

Progress is stored locally as an append-only event log:

```text
~/.local/share/ccse-prep/events.json
```

Override the location when needed:

```bash
CCSE_DATA_DIR=/path/to/data ccse
```

Useful diagnostics:

```bash
ccse --path
ccse --validate-bank
ccse --bank-info
ccse --update-bank
```

The CLI checks the project-hosted question bank once per month during the normal year and once per day in December and January, when the annual bank is usually published. A downloaded bank is validated before activation and stored in the local data directory. If the network is unavailable or the download is invalid, the last-known-good bank—or the bundled bank on first install—is used automatically.

For testing or a controlled mirror, override the feed with `CCSE_BANK_URL`:

```bash
CCSE_BANK_URL=https://example.com/question-bank.json ccse --update-bank
```

## Verification

```bash
npm test
node bin/ccse.mjs --validate-bank
node --check bin/ccse.mjs
node --check src/terminalQuiz.mjs
node --check src/terminalTui.mjs
zsh -n scripts/ccse-shell-gate.zsh
```

## Evidence and scope

The learning workflow is informed by research on retrieval practice, corrective feedback, and distributed practice. The CLI does not claim that its exact schedule is validated as a complete educational intervention. The exam content remains limited to the bundled official question bank.

The official source for the 2026 content and exam format is the [Instituto Cervantes CCSE 2026 manual](https://examenes.cervantes.es/sites/default/files/manual-ccse-2026-def.pdf) and [official CCSE format page](https://examenes.cervantes.es/es/ccse/como).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local development and verification conventions. Please do not add unofficial questions, scraped content, secrets, or generated explanations to the repository.

## License

MIT. See [LICENSE](LICENSE).
