# CCSE CLI

Standalone terminal CCSE 2026 preparation sprint using the official Instituto Cervantes question bank.

Sessions use the official 25-question distribution (10 / 3 / 2 / 3 / 7) and 45-minute duration. The CLI reports the official 15/25 pass mark and uses a safer preparation target of 20/25. Progress is written as append-only answer/session events, so an interrupted session resumes instead of losing completed answers.

## Install

```bash
npm install
npm link
```

Then run `ccse` from any interactive terminal. Use `CCSE_DATA_DIR` to override the default local event directory (`~/.local/share/ccse-prep`).

To install the start-of-day hook, source `scripts/ccse-shell-gate.zsh` from `.zshrc`. Inside tmux it opens one temporary `ccse-prep` window and leaves the current window untouched; the temporary window closes when `ccse` exits. On 24 September the automatic hook skips preparation.

## Verify

```bash
npm test
node bin/ccse.mjs --validate-bank
```

The CLI ships with its own immutable copy of the official 300-question bank and does not import code from the web app. The source standard is the [Instituto Cervantes CCSE 2026 manual](https://examenes.cervantes.es/sites/default/files/manual-ccse-2026-def.pdf); the official format is documented at [Cómo es la prueba CCSE](https://examenes.cervantes.es/es/ccse/como).
