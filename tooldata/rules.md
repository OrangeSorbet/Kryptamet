1. No deviation from checklist.md roadmap order.
2. Strict modularity: colors.*, fonts.*, and each UI component live in their own file. app.py/interface layer only imports and composes — no inline styling, no inline component definitions.
3. No placeholder/dummy code. No TODOs left unresolved in committed files.
4. Every crypto operation (keygen, encrypt, decrypt, transport) isolated in hecrypto/ — never inlined in inference or interface code.
5. Every model type gets its own train/infer module — no shared "god" file.
6. Benchmarks logged per model per dataset — no ad hoc timing prints.
7. Real datasets only — no synthetic stand-ins unless explicitly marked as synthetic in filename/config. Dataset choice is flexible, not fixed to any named list.
8. Each phase ends with a working, testable checkpoint before moving to the next.
9. Rewriter edits: "find" must be the shortest substring that is still unique in the file — a few words is enough, no need for full lines/blocks/sentences.
10. Every action taken (commands run, files created/edited, results) is logged in docs/logs.md immediately, phase-tagged.
11. No multiple-choice questions or options presented back to the user. Proceed with the most reasonable next step directly.
