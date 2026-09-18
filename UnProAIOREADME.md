UnPro AIO
=========

Setup:
  pip install PyQt6 pyperclip
  Drop "UnPro AIO.py" into your project's ROOT folder (it must live there).
  python "UnPro AIO.py"

First run creates a tooldata/ folder next to the script:
  tooldata/checklist.json  - phase-wise checklist data
  tooldata/rules.md        - your project rules (shown in Reader's RULES panel)
  tooldata/ignore.json     - tri-state ignore selections
  tooldata/logs.jsonl      - append-only audit log (never edited by the tool itself)
  tooldata/output.txt      - written each time you Export from Reader

Tabs: Reader | Rewriter | Checklist | Logs

Reader   - full file tree + resizable/collapsible side panels: Ignore
           (tri-state check/dot/blank), Rules, AI Instructions, How To Use.
Rewriter - paste AI-generated JSON to create/edit/delete files anywhere in
           the project, including tooldata/checklist.json, rules.md and
           ignore.json (logs.jsonl is protected/append-only). Any apply
           auto-refreshes Reader + Checklist.
Checklist- infinite nested phases/headings (bigger font = shallower depth)
           and tasks with Jira-style fields, plus a Kanban view.
Logs     - every CRUD action across the app, filterable, permanent.