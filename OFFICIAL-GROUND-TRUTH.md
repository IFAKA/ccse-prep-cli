# CCSE 2026 ground truth

Checked against official Instituto Cervantes material on 2026-09-22.

## Rules implemented

- The 2026 manual applies to every CCSE sitting from January 2026 through the 2026 cycle. The Instituto Cervantes preparation page says the manual's contents and questions are those included in tests from January 2026, and notes a 25% question refresh against 2025.
- An exam has 25 questions, five tasks, and a maximum duration of 45 minutes.
- Task quotas are fixed: Task 1: 10; Task 2: 3; Task 3: 2; Task 4: 3; Task 5: 7. Tasks 1–3 are 60% of the exam; Tasks 4–5 are 40%.
- Items use three-option selection or true/false. Exactly one answer is correct.
- A correct answer earns one point. An incorrect answer earns zero. Wrong and blank answers are not penalized.
- Passing requires 15 correct answers out of 25 (60%).
- The 2026 manual contains 300 numbered questions across those five tasks. The official preparation page says its 2026 questions are included in all tests from January 2026; the official app page says its practice questions correspond to those in official CCSE tests. An older Cervantes announcement explicitly describes 25 questions randomly drawn from a 300-question temario. The current public specification gives fixed task quotas but does not document the current randomization algorithm. This CLI therefore samples uniformly within each task quota and labels that as a faithful, unbiased mock method rather than a claim about Cervantes' private generator.

## Authoritative sources

1. [Cómo es la prueba CCSE](https://examenes.cervantes.es/es/ccse/como) — format, duration, counts, task quotas, scoring and pass threshold.
2. [Preparar la prueba CCSE](https://examenes.cervantes.es/es/ccse/preparar-prueba) — 2026 manual and effective date; official app correspondence statement.
3. [Manual de preparación de la prueba CCSE 2026 (PDF)](https://examenes.cervantes.es/sites/default/files/manual-ccse-2026-def.pdf) — current year's content, 300 numbered questions, task-specific item formats and answer key.
4. [Calificaciones de la prueba CCSE](https://examenes.cervantes.es/es/ccse/calificaciones) — independent official confirmation of one point per correct response, no penalty, and 15/25 pass requirement.
5. [Instituto Cervantes 2017 announcement](https://examenes.cervantes.es/es/node/4591721) — historical statement that 25 questions are drawn randomly from a 300-question temario. Current quotas are taken from the current format page, not inferred from that older announcement.

## Scope and limits

The rules and question/task totals above are supported by current official material. The bundled dataset's structure and all five previously detected PDF footer artifacts were audited. The official PDF was readable through Cervantes' web copy, but local download failed TLS certificate validation, so a full machine-to-machine comparison of all 300 prompt/choice/answer tuples could not be performed. Five sampled records were compared against the official PDF and corrected; remaining content-level transcription or answer-key errors are not ruled out.
