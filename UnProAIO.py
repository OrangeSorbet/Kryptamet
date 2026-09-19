#!/usr/bin/env python3
"""
UnPro AIO — single-file PyQt6 desktop tool.
Always lives in the project root. All persisted data lives in tooldata/.
"""
import os
import sys
import json
import uuid
import difflib
import fnmatch
import subprocess
import datetime as _dt

from PyQt6.QtCore import Qt, QObject, pyqtSignal, QTimer, QMimeData, QByteArray, QPoint, QEvent
from PyQt6.QtGui import QFont, QColor, QIcon, QAction, QDrag, QPixmap, QPainter
from PyQt6.QtSvg import QSvgRenderer
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, QLabel,
    QPushButton, QSplitter, QTreeWidget, QTreeWidgetItem, QLineEdit,
    QPlainTextEdit, QTextEdit, QStackedWidget, QGroupBox, QScrollArea,
    QAbstractItemView, QMessageBox, QDialog, QFormLayout, QComboBox,
    QDateTimeEdit, QListWidget, QListWidgetItem, QFrame, QTableWidget,
    QTableWidgetItem, QHeaderView, QSizePolicy, QToolButton, QCheckBox,
    QMenu, QInputDialog, QGridLayout
)

try:
    import pyperclip
except Exception:
    pyperclip = None

# ─────────────────────────────────────────────────────────────────────────
# Paths — tool always lives in project root
# ─────────────────────────────────────────────────────────────────────────

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SELF_NAME = os.path.basename(os.path.abspath(__file__))
TOOLDATA = os.path.join(BASE_DIR, "tooldata")
os.makedirs(TOOLDATA, exist_ok=True)

IGNORE_JSON = os.path.join(TOOLDATA, "ignore.json")
CHECKLIST_JSON = os.path.join(TOOLDATA, "checklist.json")
LOGS_JSONL = os.path.join(TOOLDATA, "logs.jsonl")
RULES_MD = os.path.join(TOOLDATA, "rules.md")

EXCLUDE_DIRNAMES = {".git", "__pycache__", "tooldata", ".idea", ".vscode", "node_modules", ".venv", "venv"}

DEFAULT_RULES = """1. No deviation from checklist.md roadmap order.
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
"""

def now_iso():
    return _dt.datetime.now().isoformat(timespec="seconds")

def to_posix(p):
    return p.replace("\\", "/")

def ensure_file(path, default_content):
    if not os.path.exists(path):
        with open(path, "w", encoding="utf-8") as f:
            f.write(default_content)

ensure_file(RULES_MD, DEFAULT_RULES)
ensure_file(CHECKLIST_JSON, json.dumps({"nodes": []}, indent=2))
ensure_file(IGNORE_JSON, json.dumps({"ignored": []}, indent=2))

# ─────────────────────────────────────────────────────────────────────────
# Diff helpers — space-efficient snapshots for revertible log entries
# ─────────────────────────────────────────────────────────────────────────

def make_diff_ops(before, after):
    """Forward hunks (SequenceMatcher opcodes, equal spans dropped) needed to
    turn `before` INTO `after`. Positions (i1/i2) are relative to `before`,
    so replaying forward only ever needs the earlier state, never the disk's
    current state — that's what makes entry-accurate revert possible even
    when later edits happened in between."""
    b_lines = before.splitlines(keepends=True)
    a_lines = after.splitlines(keepends=True)
    sm = difflib.SequenceMatcher(None, b_lines, a_lines)
    ops = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        ops.append([tag, i1, i2, a_lines[j1:j2]])
    return ops

def reconstruct_after(before, ops):
    b_lines = before.splitlines(keepends=True)
    out = []
    cursor = 0
    for _tag, i1, i2, after_chunk in ops:
        out.append("".join(b_lines[cursor:i1]))
        out.append("".join(after_chunk))
        cursor = i2
    out.append("".join(b_lines[cursor:]))
    return "".join(out)

# ─────────────────────────────────────────────────────────────────────────
# Logger — every CRUD action, append-only
# ─────────────────────────────────────────────────────────────────────────

class Logger(QObject):
    changed = pyqtSignal()

    def __init__(self):
        super().__init__()
        self.entries = []
        self._mtime = None
        self._load()
        self._watch_timer = None  # started later via start_watching(), once QApplication exists

    def start_watching(self):
        if self._watch_timer is not None:
            return
        self._watch_timer = QTimer()
        self._watch_timer.setInterval(1000)
        self._watch_timer.timeout.connect(self._check_external_change)
        self._watch_timer.start()

    def _current_mtime(self):
        try:
            return os.path.getmtime(LOGS_JSONL)
        except Exception:
            return None

    def _check_external_change(self):
        """Polls logs.jsonl's mtime so manual edits made outside the app
        (or by another process) are picked up and the Logs tab refreshes."""
        m = self._current_mtime()
        if m != self._mtime:
            self._load()
            self.changed.emit()

    def _load(self):
        self.entries = []
        if os.path.exists(LOGS_JSONL):
            with open(LOGS_JSONL, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        e = json.loads(line)
                        e.setdefault("id", uuid.uuid4().hex[:12])
                        e.setdefault("snapshot", None)
                        e.setdefault("reverted_by", None)
                        e.setdefault("reverts_id", None)
                        self.entries.append(e)
                    except Exception:
                        pass
        self._mtime = self._current_mtime()

    def _rewrite_file(self):
        with open(LOGS_JSONL, "w", encoding="utf-8") as f:
            for e in self.entries:
                f.write(json.dumps(e) + "\n")

    def log(self, tab, action, target, details="", snapshot=None, reverts_id=None):
        entry = {
            "id": uuid.uuid4().hex[:12],
            "time": now_iso(),
            "tab": tab,
            "action": action,
            "target": target,
            "details": details,
            "snapshot": snapshot,
            "reverted_by": None,
            "reverts_id": reverts_id,
        }
        self.entries.append(entry)
        with open(LOGS_JSONL, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
        self._mtime = self._current_mtime()
        self.changed.emit()
        return entry

    def mark_reverted(self, entry_id, reverted_by_id):
        for e in self.entries:
            if e["id"] == entry_id:
                e["reverted_by"] = reverted_by_id
        self._rewrite_file()
        self._mtime = self._current_mtime()
        self.changed.emit()

    def get_entry(self, entry_id):
        for e in self.entries:
            if e["id"] == entry_id:
                return e
        return None

LOGGER = Logger()

# ─────────────────────────────────────────────────────────────────────────
# Ignore store — tri-state ignore system (folders + files)
# ─────────────────────────────────────────────────────────────────────────

class TriStateSet(QObject):
    """Generic tri-state (full/partial/none) path set, cascading up/down a
    tree. persist_path=None means in-memory only (not written to disk)."""
    changed = pyqtSignal()

    def __init__(self, persist_path=None):
        super().__init__()
        self.persist_path = persist_path
        self.marked = set()
        if persist_path:
            self.load()

    def load(self):
        try:
            with open(self.persist_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.marked = set(data.get("marked", data.get("ignored", [])))
        except Exception:
            self.marked = set()

    def save(self):
        if self.persist_path:
            with open(self.persist_path, "w", encoding="utf-8") as f:
                json.dump({"marked": sorted(self.marked)}, f, indent=2)
        self.changed.emit()

    def clear_all(self):
        self.marked = set()
        self.save()

    def is_marked(self, relpath):
        relpath = to_posix(relpath)
        if "" in self.marked:
            return True
        if relpath in self.marked:
            return True
        parts = relpath.split("/")
        for i in range(1, len(parts)):
            if "/".join(parts[:i]) in self.marked:
                return True
        return False

    def set_full(self, relpath):
        relpath = to_posix(relpath)
        self.marked = {p for p in self.marked
                        if not (p == relpath or p.startswith(relpath + "/" if relpath else ""))}
        self.marked.add(relpath)
        self.save()

    def set_none(self, relpath, raw_children_fn):
        """Unmark relpath. Handles inherited-ancestor (incl. root "") and
        direct-descendant (clear subtree) cases."""
        relpath = to_posix(relpath)
        parts = relpath.split("/") if relpath else []
        found = None
        for i in range(len(parts), -1, -1):
            candidate = "/".join(parts[:i]) if i > 0 else ""
            if candidate in self.marked:
                found = candidate
                break
        if found is not None:
            self.marked.discard(found)
            if found == relpath:
                pfx = relpath + "/" if relpath else ""
                self.marked = {p for p in self.marked if not p.startswith(pfx)}
            if found != relpath:
                cur = found
                cur_parts = cur.split("/") if cur else []
                target_parts = parts
                for depth in range(len(cur_parts), len(target_parts)):
                    next_on_path = "/".join(target_parts[:depth + 1])
                    siblings = raw_children_fn(cur)
                    for sib in siblings:
                        if sib != next_on_path:
                            self.marked.add(sib)
                    cur = next_on_path
        else:
            self.marked = {p for p in self.marked
                            if not (p == relpath or p.startswith(relpath + "/" if relpath else ""))}
        self.save()

    def state(self, relpath, raw_children_fn):
        """Returns 'full' | 'partial' | 'none' for a node, computed dynamically."""
        relpath = to_posix(relpath)
        if self.is_marked(relpath):
            return "full"
        prefix = relpath + "/" if relpath else ""
        if not any(p.startswith(prefix) for p in self.marked):
            return "none"
        children = raw_children_fn(relpath)
        if not children:
            return "none"
        states = [self.state(c, raw_children_fn) for c in children]
        if all(s == "full" for s in states):
            return "full"
        if all(s == "none" for s in states):
            return "none"
        return "partial"

IGNORE_STORE = TriStateSet(IGNORE_JSON)
SELECT_STORE = TriStateSet(None)

# ─────────────────────────────────────────────────────────────────────────
# Filesystem scanner
# ─────────────────────────────────────────────────────────────────────────

def load_gitignore_patterns():
    patterns = []
    gitignore_path = os.path.join(BASE_DIR, ".gitignore")
    if not os.path.exists(gitignore_path):
        return patterns
    with open(gitignore_path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                patterns.append(line)
    return patterns

def gitignore_matches(relpath, patterns):
    parts = to_posix(relpath).split("/")
    for pattern in patterns:
        pattern = pattern.rstrip("/")
        for part in parts:
            if fnmatch.fnmatch(part, pattern):
                return True
        if fnmatch.fnmatch(to_posix(relpath), pattern):
            return True
        if fnmatch.fnmatch(to_posix(relpath), f"**/{pattern}"):
            return True
    return False

_GITIGNORE_PATTERNS = load_gitignore_patterns()

class Scanner:
    """Builds & caches the raw project tree (unfiltered except hard excludes),
    and exposes filtered views for Reader / Ignore panel / Rewriter."""

    def __init__(self):
        self.raw_children = {}   # relpath ("" = root) -> list of child relpaths
        self.is_dir = {}         # relpath -> bool
        self.rescan()

    def rescan(self):
        global _GITIGNORE_PATTERNS
        _GITIGNORE_PATTERNS = load_gitignore_patterns()
        self.raw_children = {}
        self.is_dir = {}
        self.is_dir[""] = True

    def children_raw(self, relpath):
        """Lists a directory only on first request, then caches it."""
        relpath = to_posix(relpath)
        cached = self.raw_children.get(relpath)
        if cached is not None:
            return cached
        abs_dir = os.path.join(BASE_DIR, relpath.replace("/", os.sep)) if relpath else BASE_DIR
        try:
            names = sorted(os.listdir(abs_dir))
        except Exception:
            names = []
        kids = []
        for name in names:
            rel_p = relpath + "/" + name if relpath else name
            self.is_dir[rel_p] = os.path.isdir(os.path.join(abs_dir, name))
            kids.append(rel_p)
        self.raw_children[relpath] = kids
        return kids

    def effective_ignored(self, relpath):
        return IGNORE_STORE.is_marked(relpath)

    def all_files_filtered(self):
        """Flat list of file relpaths, respecting gitignore + ignore store."""
        out = []
        def walk(relpath):
            for child in self.children_raw(relpath):
                if self.effective_ignored(child):
                    continue
                if self.is_dir.get(child):
                    walk(child)
                else:
                    out.append(child)
        walk("")
        return sorted(out)

    def filtered_children(self, relpath):
        kids = self.children_raw(relpath)
        return [k for k in kids if not self.effective_ignored(k)]

    def gitignore_children(self, relpath):
        """Children after .gitignore only (keeps tooldata-ignore.json marked
        items visible so they can be toggled/dulled in the tree)."""
        kids = self.children_raw(relpath)
        return [k for k in kids if not gitignore_matches(k, _GITIGNORE_PATTERNS)]

SCANNER = Scanner()

# ─────────────────────────────────────────────────────────────────────────
# Rewriter engine (shared by Rewriter tab; edits any file incl. tooldata/*)
# C:1 -> create file (find must be ""); R:1 -> delete file
# ─────────────────────────────────────────────────────────────────────────

class RewriteRunner:
    """Stateful, pausable rewrite engine. C and R are mutually exclusive and
    required (no implicit blank-find create). An edit with find=="" on an
    existing, non-C file means 'replace the whole file' and needs a Yes/No
    confirmation via on_confirm_needed(message, on_yes, on_no)."""

    def __init__(self, data, on_confirm_needed, on_finished):
        self.changes = list(data.get("changes", []))
        self.results = []
        self.on_confirm_needed = on_confirm_needed
        self.on_finished = on_finished
        self._edit_ctx = None

    def validate(self):
        errs = []
        for change in self.changes:
            rel_path = to_posix(change.get("file", "?"))
            has_c = bool(change.get("C", 0))
            has_r = bool(change.get("R", 0))
            if has_c and has_r:
                errs.append(f"❌ {rel_path} — C and R cannot both be set")
                continue
            if not has_c and not has_r:
                abs_path = os.path.join(BASE_DIR, rel_path.replace("/", os.sep))
                if not os.path.exists(abs_path):
                    errs.append(f"❌ {rel_path} — file not found and C flag not set")
        return errs

    def start(self):
        self._process_next_change()

    def _process_next_change(self):
        if not self.changes:
            self.on_finished(self.results)
            return
        change = self.changes.pop(0)
        rel_path = to_posix(change["file"])
        abs_path = os.path.join(BASE_DIR, rel_path.replace("/", os.sep))
        is_create = bool(change.get("C", 0))
        is_delete = bool(change.get("R", 0))

        if is_delete:
            if os.path.exists(abs_path):
                with open(abs_path, "r", encoding="utf-8") as f:
                    before_content = f.read()
                os.remove(abs_path)
                snapshot = {"files": [{"file": rel_path, "op": "delete", "before_full": before_content}]}
                self.results.append(f"🗑️  {rel_path} — deleted")
                LOGGER.log("Rewriter", "delete", rel_path, "", snapshot=snapshot)
            else:
                self.results.append(f"⚠️  {rel_path} — delete skipped (not found)")
            self._process_next_change()
            return

        if is_create:
            edits = change.get("edits", [])
            content = edits[0].get("replace", "") if edits else ""
            os.makedirs(os.path.dirname(abs_path) or ".", exist_ok=True)
            with open(abs_path, "w", encoding="utf-8") as f:
                f.write(content)
            snapshot = {"files": [{"file": rel_path, "op": "create"}]}
            self.results.append(f"🆕 {rel_path} — created")
            LOGGER.log("Rewriter", "create", rel_path, f"{len(content)} chars", snapshot=snapshot)
            self._process_next_change()
            return

        # normal edit path — validated to exist already
        with open(abs_path, "r", encoding="utf-8") as f:
            content = f.read()
        self._edit_ctx = {"rel_path": rel_path, "abs_path": abs_path, "content": content, "original": content,
                           "edits": list(change.get("edits", [])), "n": 0, "touched": False}
        self.results.append(f"📄 {rel_path}")
        self._process_next_edit()

    def _process_next_edit(self):
        ctx = self._edit_ctx
        if not ctx["edits"]:
            if ctx["touched"]:
                with open(ctx["abs_path"], "w", encoding="utf-8") as f:
                    f.write(ctx["content"])
                ops = make_diff_ops(ctx["original"], ctx["content"])
                snapshot = {"files": [{"file": ctx["rel_path"], "op": "edit", "ops": ops}]}
                LOGGER.log("Rewriter", "edit", ctx["rel_path"], f"{ctx['n']} edit(s)", snapshot=snapshot)
            self._process_next_change()
            return
        edit = ctx["edits"].pop(0)
        ctx["n"] += 1
        n = ctx["n"]
        find = edit.get("find", "")
        replace = edit["replace"]

        if find == "":
            def on_yes():
                ctx["content"] = replace
                ctx["touched"] = True
                self.results.append(f"  [{n}] ✅ entire file replaced")
                self._process_next_edit()

            def on_no():
                self.results.append(f"  [{n}] ⏭️  skipped (whole-file replace declined)")
                self._process_next_edit()

            self.on_confirm_needed(f"Replace entire contents of {ctx['rel_path']}?", on_yes, on_no)
            return

        if find not in ctx["content"]:
            self.results.append(f"  [{n}] ⚠️  pattern not found")
            self._process_next_edit()
            return
        count = ctx["content"].count(find)
        if count > 1:
            self.results.append(f"  [{n}] ⚠️  found {count} times — skipping")
            self._process_next_edit()
            return
        ctx["content"] = ctx["content"].replace(find, replace)
        ctx["touched"] = True
        self.results.append(f"  [{n}] ✅ edit applied")
        self._process_next_edit()

# ─────────────────────────────────────────────────────────────────────────
# Revert engine — undoes one log entry's snapshot (or a chain of them)
# ─────────────────────────────────────────────────────────────────────────

def compute_file_state_at(file_rel, upto_entry_id):
    """Replays this file's own timeline (create/edit/delete entries only —
    Revert entries are excluded, since they're a side-effect, not ground
    truth) up to and including the entry with id == upto_entry_id.
    Returns (exists: bool, content: str|None) — the file's TRUE state as of
    that log entry, regardless of what happened to it afterward on disk."""
    exists = False
    content = None
    for e in LOGGER.entries:
        snap = e.get("snapshot")
        if snap:
            for f in snap.get("files", []):
                if f["file"] == file_rel:
                    op = f["op"]
                    if op == "create":
                        content = reconstruct_after("", f.get("ops", []))
                        exists = True
                    elif op == "edit":
                        content = reconstruct_after(content or "", f.get("ops", []))
                        exists = True
                    elif op == "delete":
                        exists = False
                        content = None
                    break
        if e["id"] == upto_entry_id:
            break
    return exists, content

def apply_file_state(file_rel, exists, content):
    """Writes disk to match a (exists, content) state computed above."""
    abs_path = os.path.join(BASE_DIR, file_rel.replace("/", os.sep))
    if exists:
        os.makedirs(os.path.dirname(abs_path) or ".", exist_ok=True)
        with open(abs_path, "w", encoding="utf-8") as fh:
            fh.write(content or "")
        return f"↪️ {file_rel} — restored to logged state"
    else:
        if os.path.exists(abs_path):
            os.remove(abs_path)
        return f"↪️ {file_rel} — removed (didn't exist yet at that point)"

# ─────────────────────────────────────────────────────────────────────────
# Theme
# ─────────────────────────────────────────────────────────────────────────

COLORS = {
    "bg": "#0b0e14",
    "bg_alt": "#11151d",
    "panel": "#151a24",
    "panel_alt": "#1a2029",
    "border": "#232a37",
    "text": "#e6e9ef",
    "text_dim": "#8890a0",
    "text_faint": "#5a6272",
    "accent": "#ff8a3d",       # amber/orange primary accent
    "accent_hover": "#ff9d5c",
    "teal": "#2dd4bf",         # secondary accent
    "green": "#3ddc84",        # create
    "red": "#ff5470",          # delete
    "blue": "#5b9dff",         # edit
    "yellow": "#f5c542",       # warn
}

FONT_FAMILY = "Segoe UI, Inter, Helvetica, Arial, sans-serif"
MONO_FAMILY = "JetBrains Mono, Consolas, monospace"

# ─────────────────────────────────────────────────────────────────────────
# SVG icons — rendered to QIcon at runtime, tinted via currentColor swap
# ─────────────────────────────────────────────────────────────────────────

SVG_REVERT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>'
SVG_REVERT_ALL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 8v4l3 2"/></svg>'
SVG_FIND_PREV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/><path d="M9 11h4"/></svg>'
SVG_VIEW_ORIGINAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3h7v7"/><path d="M21 3 10 14"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/></svg>'
SVG_HELP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4"/><line x1="12" y1="17" x2="12" y2="17"/></svg>'

def svg_icon(svg_str, size=16, color=None):
    if color:
        svg_str = svg_str.replace("currentColor", color)
    renderer = QSvgRenderer(QByteArray(svg_str.encode("utf-8")))
    pix = QPixmap(size, size)
    pix.fill(Qt.GlobalColor.transparent)
    painter = QPainter(pix)
    renderer.render(painter)
    painter.end()
    return QIcon(pix)

QSS = f"""
QWidget {{
    background: {COLORS['bg']};
    color: {COLORS['text']};
    font-family: {FONT_FAMILY};
    font-size: 10pt;
}}
QMainWindow {{ background: {COLORS['bg']}; }}

#TopBar {{ background: {COLORS['bg']}; border-bottom: 1px solid {COLORS['border']}; }}
#BrandLabel {{ color: {COLORS['accent']}; font-size: 13pt; font-weight: 800; letter-spacing: 0.5px; }}
#RootLabel {{ color: {COLORS['text_faint']}; font-size: 9pt; }}

QPushButton#TabBtn {{
    background: transparent;
    color: {COLORS['text_dim']};
    border: none;
    padding: 10px 18px;
    font-weight: 600;
    font-size: 10pt;
    border-bottom: 2px solid transparent;
}}
QPushButton#TabBtn:hover {{ color: {COLORS['text']}; }}
QPushButton#TabBtn[active="true"] {{
    color: {COLORS['accent']};
    border-bottom: 2px solid {COLORS['accent']};
}}

QSplitter::handle {{ background: {COLORS['border']}; }}
QSplitter::handle:horizontal {{ width: 2px; }}
QSplitter::handle:vertical {{ height: 2px; }}

QGroupBox {{
    background: {COLORS['panel']};
    border: 1px solid {COLORS['border']};
    border-radius: 8px;
    margin-top: 6px;
    font-weight: 700;
    color: {COLORS['text_dim']};
}}
QGroupBox::title {{
    subcontrol-origin: margin;
    left: 10px;
    padding: 0 6px;
    color: {COLORS['text']};
}}

QLineEdit, QPlainTextEdit, QTextEdit {{
    background: {COLORS['panel_alt']};
    border: 1px solid {COLORS['border']};
    border-radius: 6px;
    padding: 6px 8px;
    color: {COLORS['text']};
    selection-background-color: {COLORS['accent']};
}}
QLineEdit:focus, QPlainTextEdit:focus, QTextEdit:focus {{
    border: 1px solid {COLORS['accent']};
}}

QTreeWidget, QListWidget, QTableWidget {{
    background: {COLORS['panel']};
    border: 1px solid {COLORS['border']};
    border-radius: 6px;
    alternate-background-color: {COLORS['panel_alt']};
    outline: 0;
}}
QTreeWidget::item, QListWidget::item {{ padding: 3px 2px; }}
QTreeWidget::item:selected, QListWidget::item:selected {{
    background: {COLORS['accent']};
    color: #12100d;
}}
QHeaderView::section {{
    background: {COLORS['bg_alt']};
    color: {COLORS['text_dim']};
    border: none;
    border-bottom: 1px solid {COLORS['border']};
    padding: 6px;
    font-weight: 700;
}}

QPushButton {{
    background: {COLORS['panel_alt']};
    color: {COLORS['text']};
    border: 1px solid {COLORS['border']};
    border-radius: 6px;
    padding: 6px 14px;
    font-weight: 600;
}}
QPushButton:hover {{ border: 1px solid {COLORS['accent']}; }}
QPushButton:pressed {{ background: {COLORS['border']}; }}

QPushButton#Primary {{ background: {COLORS['accent']}; color: #1a1206; border: none; }}
QPushButton#Primary:hover {{ background: {COLORS['accent_hover']}; }}
QPushButton#Create {{ background: {COLORS['green']}; color: #06210f; border: none; }}
QPushButton#Danger {{ background: {COLORS['red']}; color: #2a0510; border: none; }}
QPushButton#Ghost {{ background: transparent; border: 1px solid {COLORS['border']}; color: {COLORS['text_dim']}; }}

QToolButton {{
    background: transparent;
    border: none;
    color: {COLORS['accent']};
    font-weight: 700;
    padding: 4px;
}}
QToolButton:hover {{ color: {COLORS['accent_hover']}; }}

QComboBox, QDateTimeEdit {{
    background: {COLORS['panel_alt']};
    border: 1px solid {COLORS['border']};
    border-radius: 6px;
    padding: 4px 8px;
}}

QScrollBar:vertical {{ background: {COLORS['bg']}; width: 10px; }}
QScrollBar::handle:vertical {{ background: {COLORS['border']}; border-radius: 5px; min-height: 24px; }}
QScrollBar::handle:vertical:hover {{ background: {COLORS['text_faint']}; }}
QScrollBar:horizontal {{ background: {COLORS['bg']}; height: 10px; }}
QScrollBar::handle:horizontal {{ background: {COLORS['border']}; border-radius: 5px; }}

QLabel#SectionTitle {{ color: {COLORS['text']}; font-size: 12pt; font-weight: 800; }}
QLabel#Dim {{ color: {COLORS['text_faint']}; font-size: 9pt; }}
QLabel#StatusOk {{ color: {COLORS['green']}; font-size: 9pt; font-weight: 700; }}
QLabel#StatusErr {{ color: {COLORS['red']}; font-size: 9pt; font-weight: 700; }}
QLabel#StatusInfo {{ color: {COLORS['blue']}; font-size: 9pt; font-weight: 700; }}
"""

# ─────────────────────────────────────────────────────────────────────────
# Reusable: Collapsible section box
# ─────────────────────────────────────────────────────────────────────────

class CollapsibleBox(QWidget):
    def __init__(self, title, content_widget, start_open=True, copy_text_fn=None):
        super().__init__()
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        header = QWidget()
        header.setObjectName("panel_alt")
        hl = QHBoxLayout(header)
        hl.setContentsMargins(10, 6, 10, 6)
        self.toggle_btn = QToolButton()
        self.toggle_btn.setArrowType(Qt.ArrowType.DownArrow if start_open else Qt.ArrowType.RightArrow)
        self.toggle_btn.setToolButtonStyle(Qt.ToolButtonStyle.ToolButtonTextBesideIcon)
        self.toggle_btn.setText(title)
        self.toggle_btn.setCheckable(True)
        self.toggle_btn.setChecked(start_open)
        self.toggle_btn.clicked.connect(self._toggle)
        hl.addWidget(self.toggle_btn)
        hl.addStretch()

        if copy_text_fn is not None:
            copy_btn = QToolButton()
            copy_btn.setText("Copy")
            copy_btn.setCursor(Qt.CursorShape.PointingHandCursor)

            def do_copy():
                text = copy_text_fn()
                if pyperclip:
                    try:
                        pyperclip.copy(text)
                    except Exception:
                        pass
                QApplication.instance().clipboard().setText(text)
                copy_btn.setText("Copied!")
                QTimer.singleShot(1200, lambda: copy_btn.setText("Copy"))

            copy_btn.clicked.connect(do_copy)
            hl.addWidget(copy_btn)

        header.setStyleSheet(f"background:{COLORS['bg_alt']}; border-radius:6px;")

        layout.addWidget(header)
        self.content = content_widget
        layout.addWidget(self.content)
        self.content.setVisible(start_open)

    def _toggle(self):
        open_now = self.toggle_btn.isChecked()
        self.content.setVisible(open_now)
        self.toggle_btn.setArrowType(Qt.ArrowType.DownArrow if open_now else Qt.ArrowType.RightArrow)


def make_readonly_text(text, mono=False):
    t = QTextEdit()
    t.setPlainText(text)
    t.setReadOnly(True)
    if mono:
        t.setFont(QFont("JetBrains Mono", 9))
    else:
        t.setFont(QFont("Segoe UI", 9))
    t.setStyleSheet(f"color:{COLORS['text_dim']}; background:{COLORS['panel']}; border:none;")
    return t


def make_copy_header(title, get_text_fn, parent_layout):
    row = QHBoxLayout()
    lbl = QLabel(title)
    lbl.setStyleSheet(f"color:{COLORS['text_dim']}; font-weight:700; font-size:9pt;")
    row.addWidget(lbl)
    row.addStretch()
    btn = QPushButton("Copy")
    btn.setObjectName("Ghost")
    btn.setFixedWidth(60)

    def do_copy():
        text = get_text_fn()
        if pyperclip:
            try:
                pyperclip.copy(text)
            except Exception:
                pass
        app = QApplication.instance()
        cb = app.clipboard()
        cb.setText(text)
        btn.setText("Copied!")
        QTimer.singleShot(1200, lambda: btn.setText("Copy"))

    btn.clicked.connect(do_copy)
    row.addWidget(btn)
    parent_layout.addLayout(row)


# ─────────────────────────────────────────────────────────────────────────
# Rules panel (editable, backs tooldata/rules.md)
# ─────────────────────────────────────────────────────────────────────────

class RulesPanel(QWidget):
    def __init__(self):
        super().__init__()
        v = QVBoxLayout(self)
        v.setContentsMargins(8, 8, 8, 8)
        row = QHBoxLayout()
        row.addWidget(QLabel("Rules (tooldata/rules.md)"))
        row.addStretch()
        copy_btn = QPushButton("Copy")
        copy_btn.setObjectName("Ghost")
        copy_btn.setFixedWidth(60)

        def do_copy():
            text = self.editor.toPlainText()
            if pyperclip:
                try:
                    pyperclip.copy(text)
                except Exception:
                    pass
            QApplication.instance().clipboard().setText(text)
            copy_btn.setText("Copied!")
            QTimer.singleShot(1200, lambda: copy_btn.setText("Copy"))

        copy_btn.clicked.connect(do_copy)
        row.addWidget(copy_btn)
        save_btn = QPushButton("Save")
        save_btn.setObjectName("Primary")
        save_btn.setFixedWidth(70)
        save_btn.clicked.connect(self.save)
        row.addWidget(save_btn)
        v.addLayout(row)

        self.editor = QPlainTextEdit()
        self.editor.setFont(QFont("JetBrains Mono", 9))
        v.addWidget(self.editor)
        self.reload()

    def reload(self):
        try:
            with open(RULES_MD, "r", encoding="utf-8") as f:
                self.editor.setPlainText(f.read())
        except Exception:
            self.editor.setPlainText(DEFAULT_RULES)

    def save(self):
        with open(RULES_MD, "w", encoding="utf-8") as f:
            f.write(self.editor.toPlainText())
        LOGGER.log("Reader", "rules_save", "tooldata/rules.md", "")

# ─────────────────────────────────────────────────────────────────────────
# Instruction texts
# ─────────────────────────────────────────────────────────────────────────

READER_HOWTO_BANNER = "COPY THE RULES AND AI INSTRUCTIONS BELOW AND GIVE THEM TO THE AI YOU ARE USING RIGHT NOW."

READER_HOWTO = """Tree controls:
• Red checkbox = ignore this file/folder. Checking a folder ignores everything
  inside it (and visually dulls it). Full red = fully ignored, red dot =
  some descendants ignored, blank = none ignored.
• Green checkbox = select this file/folder for Export. Clicking the row
  itself (not just the checkbox) also toggles the green selection.
  Same full / dot / blank cascading logic as the red checkbox.
• Double-click a file to open it in your system's default editor (e.g. VS Code).

Other controls:
- Type to filter files by name or path in the search box
- Paste one or more relative paths, press Enter to select them (green)
- Shift+Enter = newline in the search box
- Export → = copy selected files to clipboard + write tooldata/output.txt
- Rules / AI Instructions panels below are resizable (drag the splitter)
  and collapsible (click the header)."""

READER_AI = f"""Root: {BASE_DIR}

Paste file paths to read (relative to root), one per line:
Input format:
```
path/to/file1.ext
path/to/file2.ext
```

Output format:
---
path/to/file.ext
---
<file contents, JSON-string-escaped>
---

Note: file contents are JSON-string-escaped (real newlines -> \\n,
real tabs -> \\t, literal backslashes -> \\\\). Copy substrings
directly as-is into "find"/"replace" fields in the Rewriter JSON —
do not re-escape them, they are already in the correct form."""

REWRITER_HOWTO = """How to use:
- Paste the changes JSON from the AI into the box, click Apply
- Output shows per-file and per-edit results
- Clear resets both boxes
- Each "find" must match exactly once, or that edit is skipped
- Multiple edits to the same file go in one edits array
- Every change needs exactly one of "C" (create) or "R" (delete) OR neither
  (plain edit) — having BOTH C and R is an error
- Plain edit on a file that doesn't exist (no C) is an error, not a prompt
- find:"" on an EXISTING file with no C flag means "replace the whole file"
  and needs a Yes/No in the Confirmations bar below Output — not a popup
- Re-clicking Apply with unchanged JSON is blocked ("already applied")
- Creating/deleting files here also updates Reader/Checklist/Rules/Ignore
  automatically — no manual refresh needed
- This is the only way the AI can edit checklist.json, rules.md or
  ignore.json without you doing it by hand. logs.jsonl is append-only
  and cannot be edited or deleted this way."""

REWRITER_AI = f"""Root: {BASE_DIR}

Give changes in this format:

```json
{{
  "changes": [
    {{
      "file": "relative/path/to/file.ext",
      "edits": [
        {{
          "find": "exact code to find,\\n    including newlines and indentation",
          "replace": "exact code to replace with,\\n    with correct indentation"
        }},
        {{
          "find": "another block in same file",
          "replace": "its replacement"
        }}
      ]
    }},
    {{
      "file": "relative/path/to/new_file.ext",
      "C": 1,
      "edits": [
        {{ "replace": "full contents of the new file" }}
      ]
    }},
    {{
      "file": "relative/path/to/old_file.ext",
      "R": 1
    }}
  ]
}}
```

Rules:
- \\n = newline, \\t = tab
- 4 spaces = 4 literal spaces
- "find" must match exactly once in the file
- file path uses / or \\\\, both work
- to delete text inside a file: set "replace" to ""
- to insert: put surrounding context in "find", include it in "replace"
- multiple edits per file go in the edits array
- To create a new file: set "C" flag as 1, no "find" needed — just "replace"
- To delete a whole file: set "R" flag as 1 on that file's change object
- C and R can NEVER both be set on the same change — that's an error
- A plain edit (no C, no R) on a file that doesn't exist is an error
- find:"" with no C flag on a file that DOES exist means "replace the
  entire file" — this pauses for a Yes/No confirmation in the app
- C and R are OMITTED unless true. C:0 or R:0 never appear — only include
  the key when it is 1
- You may edit tooldata/checklist.json, tooldata/rules.md and
  tooldata/ignore.json through this exact same mechanism. tooldata/logs.jsonl
  is append-only and must never be targeted."""

# ─────────────────────────────────────────────────────────────────────────
# Reader tab
# ─────────────────────────────────────────────────────────────────────────

class EnterTextEdit(QPlainTextEdit):
    """QPlainTextEdit where plain Enter submits, Shift+Enter inserts newline."""
    submitted = pyqtSignal()

    def keyPressEvent(self, event):
        if event.key() in (Qt.Key.Key_Return, Qt.Key.Key_Enter) and not (event.modifiers() & Qt.KeyboardModifier.ShiftModifier):
            self.submitted.emit()
            return
        super().keyPressEvent(event)


class ClickableLabel(QLabel):
    clicked = pyqtSignal()
    doubleClicked = pyqtSignal()

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self.clicked.emit()
        super().mousePressEvent(event)

    def mouseDoubleClickEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self.doubleClicked.emit()
        super().mouseDoubleClickEvent(event)


TRISTATE_QSS = f"""
QCheckBox::indicator {{
    width: 15px; height: 15px;
    border: 1px solid {COLORS['border']};
    border-radius: 3px;
}}
QCheckBox#IgnoreCheck::indicator {{ background: #4d2530; border-color: #6b2e3d; }}
QCheckBox#IgnoreCheck::indicator:checked {{ background: {COLORS['red']}; border-color: {COLORS['red']}; }}
QCheckBox#IgnoreCheck::indicator:indeterminate {{ background: qlineargradient(x1:0,y1:0,x2:1,y2:0, stop:0 {COLORS['red']}, stop:0.5 {COLORS['red']}, stop:0.51 #4d2530, stop:1 #4d2530); }}
QCheckBox#SelectCheck::indicator {{ background: #234a3a; border-color: #2f6b52; }}
QCheckBox#SelectCheck::indicator:checked {{ background: {COLORS['green']}; border-color: {COLORS['green']}; }}
QCheckBox#SelectCheck::indicator:indeterminate {{ background: qlineargradient(x1:0,y1:0,x2:1,y2:0, stop:0 {COLORS['green']}, stop:0.5 {COLORS['green']}, stop:0.51 #234a3a, stop:1 #234a3a); }}
"""

class TriCheckBox(QCheckBox):
    def nextCheckState(self):
        if self.checkState() == Qt.CheckState.Checked:
            self.setCheckState(Qt.CheckState.Unchecked)
        else:
            self.setCheckState(Qt.CheckState.Checked)


class SelectCheckBox(TriCheckBox):
    def nextCheckState(self):
        if self.checkState() == Qt.CheckState.Checked:
            self.setCheckState(Qt.CheckState.Unchecked)
        else:
            self.setCheckState(Qt.CheckState.Checked)


def open_in_default_app(abs_path):
    try:
        if sys.platform.startswith("win"):
            os.startfile(abs_path)  # noqa
        elif sys.platform == "darwin":
            subprocess.Popen(["open", abs_path])
        else:
            subprocess.Popen(["xdg-open", abs_path])
    except Exception:
        pass


def build_copy_tree(kind):
    """Render a tree-format text listing for the Copy Structure menu."""
    if kind == "selected":
        folder_pred = lambda p: SELECT_STORE.state(p, SCANNER.children_raw) != "none"
        file_pred = lambda p: SELECT_STORE.is_marked(p)
        include_files = True
    elif kind == "nonignored_folders":
        folder_pred = lambda p: IGNORE_STORE.state(p, SCANNER.children_raw) != "full"
        file_pred = None
        include_files = False
    elif kind == "nonignored_folders_files":
        folder_pred = lambda p: IGNORE_STORE.state(p, SCANNER.children_raw) != "full"
        file_pred = lambda p: not IGNORE_STORE.is_marked(p)
        include_files = True
    elif kind == "ignored_folders":
        folder_pred = lambda p: IGNORE_STORE.state(p, SCANNER.children_raw) != "none"
        file_pred = None
        include_files = False
    elif kind == "ignored_folders_files":
        folder_pred = lambda p: IGNORE_STORE.state(p, SCANNER.children_raw) != "none"
        file_pred = lambda p: IGNORE_STORE.is_marked(p)
        include_files = True
    elif kind == "all_folders":
        folder_pred = lambda p: True
        file_pred = None
        include_files = False
    elif kind == "all_folders_files":
        folder_pred = lambda p: True
        file_pred = lambda p: True
        include_files = True
    else:
        return ""

    lines = []

    def walk(path, prefix):
        children = sorted(SCANNER.children_raw(path),
                           key=lambda p: (not SCANNER.is_dir.get(p, False), p.lower()))
        kept = []
        for c in children:
            is_dir = SCANNER.is_dir.get(c, False)
            if is_dir:
                if folder_pred(c):
                    kept.append(c)
            elif include_files and file_pred and file_pred(c):
                kept.append(c)
        for i, c in enumerate(kept):
            is_last = i == len(kept) - 1
            connector = "└── " if is_last else "├── "
            is_dir = SCANNER.is_dir.get(c, False)
            lines.append(prefix + connector + c.split("/")[-1] + ("/" if is_dir else ""))
            if is_dir:
                walk(c, prefix + ("    " if is_last else "│   "))

    walk("", "")
    return "\n".join(lines) if lines else "(none)"


class ReaderTab(QWidget):
    def __init__(self, main_window):
        super().__init__()
        self.main_window = main_window
        root_h = QHBoxLayout(self)
        root_h.setContentsMargins(0, 0, 0, 0)

        splitter = QSplitter(Qt.Orientation.Horizontal)
        root_h.addWidget(splitter)

        # ---- left: file tree ----
        left = QWidget()
        lv = QVBoxLayout(left)
        title = QLabel("Reader")
        title.setObjectName("SectionTitle")
        lv.addWidget(title)

        self.search_box = EnterTextEdit()
        self.search_box.setFixedHeight(60)
        self.search_box.setPlaceholderText("Type to filter, or paste relative paths + Enter to select (green)…")
        self.search_box.submitted.connect(self._try_select_pasted)
        lv.addWidget(self.search_box)

        self.tree = QTreeWidget()
        self.tree.setColumnCount(1)
        self.tree.setHeaderHidden(True)
        self.tree.setAlternatingRowColors(True)
        self.tree.setStyleSheet(TRISTATE_QSS)
        self.tree.setSelectionMode(QAbstractItemView.SelectionMode.NoSelection)
        self.tree.setExpandsOnDoubleClick(False)
        self.tree.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.tree.customContextMenuRequested.connect(self._on_tree_context_menu)
        self.tree.itemExpanded.connect(self._on_item_expanded)
        lv.addWidget(self.tree)

        footer = QHBoxLayout()
        self.status_lbl = QLabel("Ready")
        self.status_lbl.setObjectName("Dim")
        footer.addWidget(self.status_lbl)
        footer.addStretch()
        self.copy_struct_btn = QPushButton("Copy Structure ▾")
        self.copy_struct_btn.setObjectName("Ghost")
        self.copy_struct_btn.clicked.connect(self._show_copy_structure_menu)
        footer.addWidget(self.copy_struct_btn)
        reset_btn = QPushButton("Reset")
        reset_btn.setObjectName("Ghost")
        reset_btn.clicked.connect(self._reset_selection)
        footer.addWidget(reset_btn)
        export_btn = QPushButton("Export →")
        export_btn.setObjectName("Primary")
        export_btn.clicked.connect(self.export)
        footer.addWidget(export_btn)
        lv.addLayout(footer)

        splitter.addWidget(left)

        # ---- right: collapsible panels — How To Use, Rules, AI Instructions ----
        right = QSplitter(Qt.Orientation.Vertical)
        right.setMinimumWidth(340)
        right.setMaximumWidth(560)

        how_w = QWidget()
        how_v = QVBoxLayout(how_w)
        banner = QLabel(READER_HOWTO_BANNER)
        banner.setWordWrap(True)
        banner.setStyleSheet(f"color:{COLORS['accent']}; font-weight:800; font-size:10pt;")
        how_v.addWidget(banner)
        how_v.addWidget(make_readonly_text(READER_HOWTO))
        right.addWidget(CollapsibleBox("✨ HOW TO USE", how_w, start_open=True))

        self.rules_panel = RulesPanel()
        right.addWidget(CollapsibleBox("RULES", self.rules_panel, start_open=True))

        ai_w = QWidget()
        ai_v = QVBoxLayout(ai_w)
        make_copy_header("AI INSTRUCTIONS", lambda: READER_AI, ai_v)
        ai_v.addWidget(make_readonly_text(READER_AI, mono=True))
        right.addWidget(CollapsibleBox("AI INSTRUCTIONS", ai_w, start_open=True))

        splitter.addWidget(right)
        splitter.setStretchFactor(0, 3)
        splitter.setStretchFactor(1, 2)

        self.side = right
        self.main_split = splitter
        self.search_box.textChanged.connect(self._on_search_changed)
        self._suppress_search_signal = False
        self._updating = False
        self._rows = {}  # path -> dict(item, ignore_cb, select_cb, label)
        self.rebuild_tree()

    # -- status --
    def _set_status(self, text, kind="Dim"):
        self.status_lbl.setText(text)
        self.status_lbl.setObjectName(kind)
        self.status_lbl.style().unpolish(self.status_lbl)
        self.status_lbl.style().polish(self.status_lbl)

    def _selected_count(self):
        return len(self._selected_files())

    def _selected_files(self):
        out = set()

        def walk(p):
            if IGNORE_STORE.is_marked(p):
                return
            if p and (p.split("/")[-1] in EXCLUDE_DIRNAMES):
                return
            abs_p = os.path.join(BASE_DIR, p.replace("/", os.sep))
            if os.path.isdir(abs_p):
                for c in SCANNER.children_raw(p):
                    walk(c)
            elif os.path.isfile(abs_p):
                out.add(p)

        for m in list(SELECT_STORE.marked):
            walk(m)
        return sorted(out)

    # -- tree building --
    def _make_row_widget(self, path, is_dir, name):
        row = QWidget()
        row.setStyleSheet("background: transparent;")
        h = QHBoxLayout(row)
        h.setContentsMargins(2, 1, 2, 1)
        h.setSpacing(6)

        ignore_cb = TriCheckBox()
        ignore_cb.setObjectName("IgnoreCheck")
        ignore_cb.setTristate(True)
        ignore_cb.stateChanged.connect(lambda _st, p=path: self._on_ignore_toggled(p))
        h.addWidget(ignore_cb)

        select_cb = SelectCheckBox()
        select_cb.setObjectName("SelectCheck")
        select_cb.setTristate(True)
        select_cb.stateChanged.connect(lambda _st, p=path: self._on_select_toggled(p))
        h.addWidget(select_cb)

        icon = "📁" if is_dir else "📄"
        label = ClickableLabel(f"{icon} {name}")
        if not is_dir:
            label.clicked.connect(lambda p=path: self._on_label_clicked(p))
            label.doubleClicked.connect(lambda p=path: self._on_label_double_clicked(p))
        h.addWidget(label)
        h.addStretch()
        return row, ignore_cb, select_cb, label

    def rebuild_tree(self, filter_text=""):
        self._updating = True
        self.tree.clear()
        self._rows = {}
        q = filter_text.strip().lower()

        def matches(relpath):
            return (not q) or (q in relpath.lower())

        def add_children(parent_item, parent_path):
            any_added = False
            for child in sorted(SCANNER.children_raw(parent_path),
                                 key=lambda p: (not SCANNER.is_dir.get(p, False), p.lower())):
                is_dir = SCANNER.is_dir.get(child, False)
                name = child.split("/")[-1]
                item = QTreeWidgetItem([""])
                item.setData(0, Qt.ItemDataRole.UserRole, child)
                if is_dir:
                    if q:
                        if not add_children(item, child):
                            continue
                    else:
                        item.addChild(QTreeWidgetItem([""]))
                    any_added = True
                else:
                    if not matches(child):
                        continue
                    any_added = True
                parent_item.addChild(item)
                row, ignore_cb, select_cb, label = self._make_row_widget(child, is_dir, name)
                self.tree.setItemWidget(item, 0, row)
                self._rows[child] = {"item": item, "ignore_cb": ignore_cb,
                                      "select_cb": select_cb, "label": label, "is_dir": is_dir}
            return any_added

        self._add_children = add_children
        root_name = os.path.basename(BASE_DIR) or BASE_DIR
        root_item = QTreeWidgetItem([""])
        root_item.setData(0, Qt.ItemDataRole.UserRole, "")
        self.tree.addTopLevelItem(root_item)
        add_children(root_item, "")
        row, ignore_cb, select_cb, label = self._make_row_widget("", True, root_name)
        self.tree.setItemWidget(root_item, 0, row)
        self._rows[""] = {"item": root_item, "ignore_cb": ignore_cb,
                           "select_cb": select_cb, "label": label, "is_dir": True}
        root_item.setExpanded(True)

        self._refresh_states()
        if q:
            n_files = sum(1 for r in self._rows.values() if not r["is_dir"])
            self._set_status(f"Found: {n_files} file(s)", "StatusInfo")
            self.tree.expandAll()
        self._updating = False

    def _refresh_states(self):
        self._updating = True
        state_map = {"full": Qt.CheckState.Checked, "partial": Qt.CheckState.PartiallyChecked,
                     "none": Qt.CheckState.Unchecked}
        for path, row in self._rows.items():
            ist = IGNORE_STORE.state(path, SCANNER.children_raw)
            sst = self._select_state(path)
            row["ignore_cb"].blockSignals(True)
            row["ignore_cb"].setCheckState(state_map[ist])
            row["ignore_cb"].blockSignals(False)
            row["select_cb"].blockSignals(True)
            row["select_cb"].setCheckState(state_map[sst])
            row["select_cb"].setEnabled(ist != "full")
            row["select_cb"].blockSignals(False)
            if ist == "full":
                row["label"].setStyleSheet(f"color:{COLORS['text_faint']};")
            else:
                row["label"].setStyleSheet(f"color:{COLORS['text']};")
        self._updating = False
        if not hasattr(self, "_status_timer"):
            self._status_timer = QTimer(self)
            self._status_timer.setSingleShot(True)
            self._status_timer.setInterval(120)
            self._status_timer.timeout.connect(self._update_status)
        self._status_timer.start()

    def _select_state(self, path):
        if IGNORE_STORE.is_marked(path):
            return "none"
        if SELECT_STORE.is_marked(path):
            return "full"
        prefix = path + "/" if path else ""
        if not any(p.startswith(prefix) for p in SELECT_STORE.marked):
            return "none"
        kids = [c for c in SCANNER.children_raw(path) if not IGNORE_STORE.is_marked(c)]
        if not kids:
            return "none"
        states = [self._select_state(c) for c in kids]
        if all(s == "full" for s in states):
            return "full"
        if all(s == "none" for s in states):
            return "none"
        return "partial"

    def _update_status(self):
        t = self.search_box.toPlainText().strip()
        if t and "\n" not in t:
            return
        n_sel = sum(1 for p in SELECT_STORE.marked if not IGNORE_STORE.is_marked(p))
        n_ign = len(IGNORE_STORE.marked)
        parts = []
        if n_sel:
            parts.append(f"Selected: {n_sel} item(s), {self._selected_count()} file(s)")
        if n_ign:
            parts.append(f"Ignored: {n_ign} item(s)")
        if parts:
            self._set_status("  |  ".join(parts), "StatusInfo")
        else:
            self._set_status("Ready", "Dim")

    def _on_search_changed(self):
        if self._suppress_search_signal:
            return
        text = self.search_box.toPlainText()
        if "\n" not in text:
            self.rebuild_tree(text)

    def _on_ignore_toggled(self, path):
        if self._updating:
            return
        row = self._rows.get(path)
        if not row:
            return
        state = row["ignore_cb"].checkState()
        if state == Qt.CheckState.Checked:
            IGNORE_STORE.set_full(path)
            SELECT_STORE.marked = {p for p in SELECT_STORE.marked
                                    if not (p == path or p.startswith(path + "/" if path else ""))}
            LOGGER.log("Reader", "ignore_add", path, "")
        elif state == Qt.CheckState.Unchecked:
            IGNORE_STORE.set_none(path, SCANNER.children_raw)
            LOGGER.log("Reader", "ignore_remove", path, "")
        SCANNER.rescan()
        self._refresh_states()

    def _on_select_toggled(self, path):
        if self._updating:
            return
        row = self._rows.get(path)
        if not row:
            return
        state = row["select_cb"].checkState()
        if state == Qt.CheckState.Checked and IGNORE_STORE.is_marked(path):
            self._refresh_states()
            return
        if state == Qt.CheckState.Checked:
            SELECT_STORE.set_full(path)
        elif state == Qt.CheckState.Unchecked:
            SELECT_STORE.set_none(path, SCANNER.children_raw)
        self._refresh_states()

    def _on_label_clicked(self, path):
        if IGNORE_STORE.is_marked(path):
            return
        current = SELECT_STORE.state(path, SCANNER.children_raw)
        if current == "full":
            SELECT_STORE.set_none(path, SCANNER.children_raw)
        else:
            SELECT_STORE.set_full(path)
        self._refresh_states()

    def _on_label_double_clicked(self, path):
        if not SCANNER.is_dir.get(path, False):
            abs_path = os.path.join(BASE_DIR, path.replace("/", os.sep))
            open_in_default_app(abs_path)
            LOGGER.log("Reader", "open_external", path, "")

    def _on_item_expanded(self, item):
        if self._updating or item.childCount() != 1:
            return
        ph = item.child(0)
        if ph.data(0, Qt.ItemDataRole.UserRole) is not None:
            return
        item.removeChild(ph)
        self._add_children(item, item.data(0, Qt.ItemDataRole.UserRole))
        self._refresh_states()

    def _on_tree_context_menu(self, pos):
        item = self.tree.itemAt(pos)
        if item is None:
            return
        path = item.data(0, Qt.ItemDataRole.UserRole)
        row = self._rows.get(path)
        if not row or not row["is_dir"]:
            return
        menu = QMenu(self)
        expand_act = menu.addAction("Expand All")
        collapse_act = menu.addAction("Collapse All")
        action = menu.exec(self.tree.viewport().mapToGlobal(pos))
        if action == expand_act:
            self._set_expanded_recursive(item, True)
        elif action == collapse_act:
            self._set_expanded_recursive(item, False)

    def _set_expanded_recursive(self, item, expanded):
        if not expanded:
            item.setExpanded(False)
            for i in range(item.childCount()):
                self._set_expanded_recursive(item.child(i), False)
            return
        self._expand_queue = [item]
        self._expand_step()

    def _expand_step(self):
        n = 0
        while self._expand_queue and n < 15:
            it = self._expand_queue.pop(0)
            p = it.data(0, Qt.ItemDataRole.UserRole)
            if p is None:
                continue
            if p and (IGNORE_STORE.is_marked(p) or p.split("/")[-1] in EXCLUDE_DIRNAMES):
                continue
            it.setExpanded(True)
            n += 1
            for i in range(it.childCount()):
                c = it.child(i)
                if self._rows.get(c.data(0, Qt.ItemDataRole.UserRole), {}).get("is_dir"):
                    self._expand_queue.append(c)
        if self._expand_queue:
            QTimer.singleShot(0, self._expand_step)

    def _reset_selection(self):
        SELECT_STORE.clear_all()
        self._refresh_states()

    # paste-path select on Enter -> selects then exports directly
    def _try_select_pasted(self):
        text = self.search_box.toPlainText().strip()
        lines = [to_posix(l.strip()) for l in text.splitlines() if l.strip()]
        if not lines:
            return
        found = []
        for line in lines:
            if not IGNORE_STORE.is_marked(line) and os.path.isfile(os.path.join(BASE_DIR, line.replace("/", os.sep))):
                SELECT_STORE.set_full(line)
                found.append(line)
        self._suppress_search_signal = True
        self.search_box.clear()
        self._suppress_search_signal = False
        self.rebuild_tree("")
        if found:
            self.export()
        else:
            self._set_status(f"Path not found: {lines[0]}", "StatusErr")

    def export(self):
        selected = self._selected_files()
        if not selected:
            self._set_status("No files selected", "StatusErr")
            return
        parts = []
        for rel in selected:
            abs_path = os.path.join(BASE_DIR, rel.replace("/", os.sep))
            try:
                with open(abs_path, "r", encoding="utf-8", errors="replace") as fh:
                    content = fh.read()
                escaped = json.dumps(content)[1:-1]
            except Exception as e:
                escaped = f"[Error reading file: {e}]"
            parts.append(f"---\n{rel}\n---\n{escaped}\n---")
        output = "\n\n".join(parts)
        out_path = os.path.join(TOOLDATA, "output.txt")
        with open(out_path, "w", encoding="utf-8") as fh:
            fh.write(output)
        if pyperclip:
            try:
                pyperclip.copy(output)
            except Exception:
                pass
        QApplication.instance().clipboard().setText(output)
        SELECT_STORE.clear_all()
        self._refresh_states()
        self._set_status(f"✓ Exported {len(selected)} file(s)", "StatusOk")
        self._status_timer.stop()
        LOGGER.log("Reader", "export", f"{len(selected)} file(s)", ", ".join(selected))

    def _show_copy_structure_menu(self):
        menu = QMenu(self)
        options = [
            ("Copy Selected Structure", "selected"),
            ("Copy Non Ignored Folders", "nonignored_folders"),
            ("Copy Non Ignored Folders+Files", "nonignored_folders_files"),
            ("Copy Ignored Folders", "ignored_folders"),
            ("Copy Ignored Folders+Files", "ignored_folders_files"),
            ("Copy All Folders", "all_folders"),
            ("Copy All Folders+Files", "all_folders_files"),
        ]
        for label, kind in options:
            menu.addAction(label, lambda k=kind: self._copy_structure(k))
        menu_h = menu.sizeHint().height()
        pos = self.copy_struct_btn.mapToGlobal(self.copy_struct_btn.rect().topLeft())
        pos.setY(pos.y() - menu_h)
        menu.exec(pos)

    def _copy_structure(self, kind):
        text = build_copy_tree(kind)
        if pyperclip:
            try:
                pyperclip.copy(text)
            except Exception:
                pass
        QApplication.instance().clipboard().setText(text)
        self._set_status(f"✓ Copied structure ({kind})", "StatusOk")
        LOGGER.log("Reader", "copy_structure", kind, "")

    def refresh(self):
        self.rebuild_tree(self.search_box.toPlainText() if "\n" not in self.search_box.toPlainText() else "")
        self.rules_panel.reload()

# ─────────────────────────────────────────────────────────────────────────
# Rewriter tab
# ─────────────────────────────────────────────────────────────────────────

class RewriterTab(QWidget):
    applied = pyqtSignal()

    def __init__(self, main_window):
        super().__init__()
        self.main_window = main_window
        root_h = QHBoxLayout(self)
        root_h.setContentsMargins(0, 0, 0, 0)
        splitter = QSplitter(Qt.Orientation.Horizontal)
        root_h.addWidget(splitter)

        left = QWidget()
        lv = QVBoxLayout(left)
        title = QLabel("Rewriter")
        title.setObjectName("SectionTitle")
        lv.addWidget(title)

        lv.addWidget(QLabel("Paste changes JSON:"))
        self.input_box = QPlainTextEdit()
        self.input_box.setFont(QFont("JetBrains Mono", 10))
        lv.addWidget(self.input_box, stretch=3)

        btn_row = QHBoxLayout()
        self.apply_btn = QPushButton("Apply")
        self.apply_btn.setObjectName("Primary")
        self.apply_btn.clicked.connect(self._on_apply_clicked)
        btn_row.addWidget(self.apply_btn)
        clear_btn = QPushButton("Clear")
        clear_btn.setObjectName("Ghost")
        clear_btn.clicked.connect(self.clear)
        btn_row.addWidget(clear_btn)
        btn_row.addStretch()
        lv.addLayout(btn_row)

        lv.addWidget(QLabel("Output:"))
        self.output_box = QPlainTextEdit()
        self.output_box.setFont(QFont("JetBrains Mono", 10))
        self.output_box.setReadOnly(True)
        lv.addWidget(self.output_box, stretch=2)

        lv.addWidget(QLabel("Confirmations:"))
        self.confirm_bar = QWidget()
        cb_v = QVBoxLayout(self.confirm_bar)
        cb_v.setContentsMargins(0, 0, 0, 0)
        self.confirm_label = QLabel("")
        self.confirm_label.setWordWrap(True)
        cb_v.addWidget(self.confirm_label)
        cb_row = QHBoxLayout()
        self.confirm_yes_btn = QPushButton("Yes")
        self.confirm_yes_btn.setObjectName("Create")
        self.confirm_no_btn = QPushButton("No")
        self.confirm_no_btn.setObjectName("Danger")
        cb_row.addWidget(self.confirm_yes_btn)
        cb_row.addWidget(self.confirm_no_btn)
        cb_row.addStretch()
        cb_v.addLayout(cb_row)
        self.confirm_bar.setVisible(False)
        lv.addWidget(self.confirm_bar)

        splitter.addWidget(left)

        right = QSplitter(Qt.Orientation.Vertical)
        right.setMinimumWidth(320)
        right.setMaximumWidth(520)

        how_w = QWidget()
        how_v = QVBoxLayout(how_w)
        how_v.addWidget(make_readonly_text(REWRITER_HOWTO))
        right.addWidget(CollapsibleBox("HOW TO USE", how_w, start_open=True))

        ai_w = QWidget()
        ai_v = QVBoxLayout(ai_w)
        make_copy_header("AI INSTRUCTIONS", lambda: REWRITER_AI, ai_v)
        ai_v.addWidget(make_readonly_text(REWRITER_AI, mono=True))
        right.addWidget(CollapsibleBox("AI INSTRUCTIONS", ai_w, start_open=True))

        right.setStretchFactor(0, 1)
        right.setStretchFactor(1, 1)
        QTimer.singleShot(0, lambda: right.setSizes([1, 1]))
        self.side = right
        self.main_split = splitter

        splitter.addWidget(right)
        splitter.setStretchFactor(0, 3)
        splitter.setStretchFactor(1, 2)

    def _on_apply_clicked(self):
        if not self.input_box.toPlainText().strip():
            return
        self.run()
        if self.output_box.toPlainText().startswith("❌"):
            return
        self.apply_btn.setText("Applied!")
        QTimer.singleShot(1000, lambda: self.apply_btn.setText("Apply"))

    def clear(self):
        self.input_box.clear()
        self.output_box.clear()
        self.confirm_bar.setVisible(False)

    def _show_confirm(self, message, on_yes, on_no):
        self.confirm_label.setText(message)
        self.confirm_bar.setVisible(True)
        try:
            self.confirm_yes_btn.clicked.disconnect()
        except TypeError:
            pass
        try:
            self.confirm_no_btn.clicked.disconnect()
        except TypeError:
            pass

        def yes():
            self.confirm_bar.setVisible(False)
            on_yes()

        def no():
            self.confirm_bar.setVisible(False)
            on_no()

        self.confirm_yes_btn.clicked.connect(yes)
        self.confirm_no_btn.clicked.connect(no)

    def _on_run_finished(self, results):
        self.output_box.setPlainText("Done:\n\n" + "\n".join(results))
        self._last_applied_raw = self._pending_raw
        self.applied.emit()

    def run(self):
        raw = self.input_box.toPlainText().strip()
        if not raw:
            return
        if raw == getattr(self, "_last_applied_raw", None):
            self.output_box.setPlainText("❌ This edit has already been applied.")
            return
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            self.output_box.setPlainText(f"❌ Invalid JSON:\n{e}")
            return

        runner = RewriteRunner(data, self._show_confirm, self._on_run_finished)
        errs = runner.validate()
        if errs:
            self.output_box.setPlainText("❌ Errors:\n\n" + "\n".join(errs))
            return

        self._pending_raw = raw
        self.output_box.clear()
        self._runner = runner
        runner.start()

# ─────────────────────────────────────────────────────────────────────────
# Checklist store
# ─────────────────────────────────────────────────────────────────────────

DEFAULT_STATUSES = ["Todo", "In Progress", "Review", "Done"]

def normalize_node(n):
    """Fill in any missing/blank keys with sensible defaults so an AI (or a
    human) editing checklist.json by hand never has to supply ids or
    timestamps — the app auto-fills them on every load/save."""
    ts = now_iso()
    n.setdefault("id", uuid.uuid4().hex[:10])
    n.setdefault("title", "")
    n.setdefault("type", "task")
    n.setdefault("category", "")
    n.setdefault("subcategory", "")
    n.setdefault("contributor", "")
    n.setdefault("description", "")
    n.setdefault("status", "Todo")
    if not n.get("created_at"):
        n["created_at"] = ts
    if not n.get("updated_at"):
        n["updated_at"] = n["created_at"]
    n.setdefault("completed_at", None)
    n["children"] = [normalize_node(c) for c in n.get("children", [])]
    return n

def normalize_ref_node(n):
    n.setdefault("id", uuid.uuid4().hex[:10])
    n.setdefault("name", "")
    n["children"] = [normalize_ref_node(c) for c in n.get("children", [])]
    return n

def normalize_contributor(c):
    if isinstance(c, str):
        c = {"name": c}
    c.setdefault("id", uuid.uuid4().hex[:10])
    c.setdefault("name", "")
    c.setdefault("description", "")
    c.setdefault("phone", "")
    c.setdefault("email", "")
    c.setdefault("designation", "")
    c.setdefault("category", "")
    c["children"] = [normalize_contributor(x) for x in c.get("children", [])]
    return c

def load_checklist():
    try:
        with open(CHECKLIST_JSON, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        data = {}
    data.setdefault("nodes", [])
    data.setdefault("contributors", [])
    data.setdefault("categories", [])
    data.setdefault("statuses", list(DEFAULT_STATUSES))
    data["nodes"] = [normalize_node(n) for n in data["nodes"]]
    data["categories"] = [normalize_ref_node(c) for c in data["categories"]]
    data["contributors"] = [normalize_contributor(c) for c in data["contributors"]]
    save_checklist(data)  # persist any auto-filled ids/timestamps immediately
    return data

def save_checklist(data):
    with open(CHECKLIST_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    try:
        save_checklist.stamp = os.path.getmtime(CHECKLIST_JSON)
    except Exception:
        pass

def new_node(title, ntype):
    ts = now_iso()
    return {
        "id": uuid.uuid4().hex[:10],
        "title": title,
        "type": ntype,  # "heading" | "task"
        "category": "",
        "subcategory": "",
        "contributor": "",
        "description": "",
        "status": "Todo",
        "created_at": ts,
        "updated_at": ts,
        "completed_at": None,
        "children": [],
    }

def new_ref_node(name):
    """Generic reference tree node (used by the categories meta panel)."""
    return {"id": uuid.uuid4().hex[:10], "name": name, "children": []}

def find_node_and_parent(nodes, node_id, parent=None):
    for n in nodes:
        if n["id"] == node_id:
            return n, parent
        found = find_node_and_parent(n.get("children", []), node_id, n)
        if found[0]:
            return found
    return None, None

def flatten_tasks(nodes, trail=None):
    trail = trail or []
    out = []
    for n in nodes:
        if n["type"] == "task":
            out.append((n, trail))
        out.extend(flatten_tasks(n["children"], trail + [n["title"]]))
    return out

def flatten_ref_names(nodes):
    """Flat list of all names in a reference tree (categories), any depth."""
    out = []
    for n in nodes:
        out.append(n["name"])
        out.extend(flatten_ref_names(n.get("children", [])))
    return out

def task_agg_state(node):
    """Returns 'full' | 'partial' | 'none' representing Done-ness of this
    node considering its own status (if it's a task) and all descendant
    task statuses. Headings aggregate purely off their children."""
    child_states = [task_agg_state(c) for c in node.get("children", [])]
    if node["type"] == "task":
        self_done = node.get("status") == "Done"
        if not child_states:
            return "full" if self_done else "none"
        if self_done and all(s == "full" for s in child_states):
            return "full"
        if not self_done and all(s == "none" for s in child_states):
            return "none"
        return "partial"
    else:
        if not child_states:
            return "none"
        if all(s == "full" for s in child_states):
            return "full"
        if all(s == "none" for s in child_states):
            return "none"
        return "partial"


# ─────────────────────────────────────────────────────────────────────────
# Task edit dialog
# ─────────────────────────────────────────────────────────────────────────

class AutoExpandingTextEdit(QPlainTextEdit):
    """QPlainTextEdit that always wraps and grows downward to fit its
    content instead of scrolling internally."""
    def __init__(self, text="", block_enter=False, parent=None):
        super().__init__(text, parent)
        self.block_enter = block_enter
        self.setLineWrapMode(QPlainTextEdit.LineWrapMode.WidgetWidth)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        self.textChanged.connect(self._adjust_height)
        QTimer.singleShot(0, self._adjust_height)

    def keyPressEvent(self, event):
        if self.block_enter and event.key() in (Qt.Key.Key_Return, Qt.Key.Key_Enter):
            return
        super().keyPressEvent(event)

    def _adjust_height(self):
        m = self.contentsMargins()
        h = int(self.document().size().height()) + m.top() + m.bottom() + 10
        self.setFixedHeight(max(h, 34))

    def resizeEvent(self, event):
        super().resizeEvent(event)
        self.document().setTextWidth(self.viewport().width())
        self._adjust_height()


class NodeEditDialog(QDialog):
    def __init__(self, node, statuses, contributors, categories, parent=None):
        super().__init__(parent)
        self.node = node
        self.setWindowTitle("Edit item")
        self.setMinimumWidth(480)
        self.setMaximumHeight(760)
        self.setSizeGripEnabled(True)

        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        scroll.setStyleSheet("background: transparent; border: none;")
        outer.addWidget(scroll)

        card = QWidget()
        card.setStyleSheet(f"background: {COLORS['panel']};")
        scroll.setWidget(card)
        v = QVBoxLayout(card)
        v.setContentsMargins(22, 20, 22, 18)
        v.setSpacing(14)

        def field_label(text):
            lbl = QLabel(text.upper())
            lbl.setStyleSheet(f"color:{COLORS['text_faint']}; font-size:8pt; font-weight:800; letter-spacing:0.5px;")
            return lbl

        v.addWidget(field_label("Title"))
        self.title_edit = AutoExpandingTextEdit(node["title"], block_enter=True)
        v.addWidget(self.title_edit)

        row1 = QHBoxLayout()
        row1.setSpacing(12)
        col_a = QVBoxLayout()
        col_a.setSpacing(4)
        col_a.addWidget(field_label("Type"))
        self.type_combo = QComboBox()
        self.type_combo.addItems(["heading", "task"])
        self.type_combo.setCurrentText(node["type"])
        col_a.addWidget(self.type_combo)
        row1.addLayout(col_a)

        col_b = QVBoxLayout()
        col_b.setSpacing(4)
        col_b.addWidget(field_label("Status"))
        self.status_combo = QComboBox()
        self.status_combo.addItems(statuses)
        if node.get("status", "Todo") not in statuses:
            self.status_combo.addItem(node.get("status", "Todo"))
        self.status_combo.setCurrentText(node.get("status", "Todo"))
        col_b.addWidget(self.status_combo)
        row1.addLayout(col_b)
        v.addLayout(row1)

        row2 = QHBoxLayout()
        row2.setSpacing(12)
        col_c = QVBoxLayout()
        col_c.setSpacing(4)
        col_c.addWidget(field_label("Category"))
        self.category_edit = QComboBox()
        self.category_edit.setEditable(True)
        self.category_edit.addItems(categories)
        self.category_edit.setCurrentText(node.get("category", ""))
        col_c.addWidget(self.category_edit)
        row2.addLayout(col_c)

        col_d = QVBoxLayout()
        col_d.setSpacing(4)
        col_d.addWidget(field_label("Subcategory"))
        self.subcategory_edit = QComboBox()
        self.subcategory_edit.setEditable(True)
        self.subcategory_edit.addItems(categories)
        self.subcategory_edit.setCurrentText(node.get("subcategory", ""))
        col_d.addWidget(self.subcategory_edit)
        row2.addLayout(col_d)
        v.addLayout(row2)

        v.addWidget(field_label("Contributor"))
        self.contributor_edit = QComboBox()
        self.contributor_edit.setEditable(True)
        self.contributor_edit.addItems(contributors)
        self.contributor_edit.setCurrentText(node.get("contributor", ""))
        v.addWidget(self.contributor_edit)

        v.addWidget(field_label("Description"))
        self.desc_edit = AutoExpandingTextEdit(node.get("description", ""), block_enter=False)
        v.addWidget(self.desc_edit)

        divider = QFrame()
        divider.setFrameShape(QFrame.Shape.HLine)
        divider.setStyleSheet(f"background: {COLORS['border']}; max-height: 1px; border: none;")
        v.addWidget(divider)

        meta = QLabel(f"Created {node.get('created_at','-')}   ·   "
                       f"Updated {node.get('updated_at','-')}   ·   "
                       f"Completed {node.get('completed_at') or '—'}")
        meta.setWordWrap(True)
        meta.setObjectName("Dim")
        v.addWidget(meta)

        btn_row = QHBoxLayout()
        btn_row.addStretch()
        cancel_btn = QPushButton("Cancel")
        cancel_btn.setObjectName("Ghost")
        cancel_btn.clicked.connect(self.reject)
        save_btn = QPushButton("Save")
        save_btn.setObjectName("Primary")
        save_btn.clicked.connect(self.accept)
        btn_row.addWidget(cancel_btn)
        btn_row.addWidget(save_btn)
        v.addLayout(btn_row)

    def apply_to_node(self):
        n = self.node
        old_status = n.get("status")
        n["title"] = self.title_edit.toPlainText().strip() or n["title"]
        n["type"] = self.type_combo.currentText()
        n["category"] = self.category_edit.currentText().strip()
        n["subcategory"] = self.subcategory_edit.currentText().strip()
        n["contributor"] = self.contributor_edit.currentText().strip()
        n["status"] = self.status_combo.currentText()
        n["description"] = self.desc_edit.toPlainText()
        n["updated_at"] = now_iso()
        if n["status"] == "Done" and old_status != "Done":
            n["completed_at"] = now_iso()
        elif n["status"] != "Done":
            n["completed_at"] = None
        return n


# ─────────────────────────────────────────────────────────────────────────
# Checklist meta panels: Contributors / Categories / Statuses CRUD
# ─────────────────────────────────────────────────────────────────────────

class ReorderTree(QTreeWidget):
    """QTreeWidget that reliably reports drag-and-drop moves (rowsMoved is not
    emitted for internal tree drops). Emits the moved item's id."""
    dropped = pyqtSignal(str)

    def dropEvent(self, event):
        cur = self.currentItem()
        nid = (cur.data(0, Qt.ItemDataRole.UserRole) or "") if cur else ""
        super().dropEvent(event)
        QTimer.singleShot(0, lambda: self.dropped.emit(nid))


class SimpleListCrudPanel(QWidget):
    """Flat list CRUD (used for Contributors and Statuses). Drag to reorder,
    right-click to rename/delete."""
    changed = pyqtSignal()

    def __init__(self, items_ref, log_label, min_items=None, show_rename_button=True):
        super().__init__()
        self.items_ref = items_ref  # list, mutated in place
        self.log_label = log_label
        self.min_items = min_items or 0
        self.delete_hook = None
        v = QVBoxLayout(self)
        v.setContentsMargins(8, 8, 8, 8)
        self.list_widget = QListWidget()
        self.list_widget.setAlternatingRowColors(True)
        self.list_widget.setDragDropMode(QAbstractItemView.DragDropMode.InternalMove)
        self.list_widget.setDefaultDropAction(Qt.DropAction.MoveAction)
        self.list_widget.setStyleSheet(
            f"QListWidget::item {{ padding: 6px 8px; border-bottom: 1px solid {COLORS['border']}; }}")
        self.list_widget.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.list_widget.customContextMenuRequested.connect(self._on_context_menu)
        self.list_widget.model().rowsMoved.connect(self._on_reordered)
        v.addWidget(self.list_widget)
        row = QHBoxLayout()
        add_btn = QPushButton("+ Add"); add_btn.setObjectName("Create")
        add_btn.clicked.connect(self.add_item)
        row.addWidget(add_btn)
        if show_rename_button:
            ren_btn = QPushButton("Rename"); ren_btn.setObjectName("Ghost")
            ren_btn.clicked.connect(self.rename_item)
            row.addWidget(ren_btn)
            v.addLayout(row)
        self.rebuild()

    def rebuild(self):
        self.list_widget.clear()
        for name in self.items_ref:
            self.list_widget.addItem(QListWidgetItem(name))

    def _on_reordered(self, *args):
        new_order = [self.list_widget.item(i).text() for i in range(self.list_widget.count())]
        if new_order != self.items_ref:
            self.items_ref[:] = new_order
            LOGGER.log("Checklist", "reorder", self.log_label, "")
            self.changed.emit()

    def _on_context_menu(self, pos):
        item = self.list_widget.itemAt(pos)
        if not item:
            return
        self.list_widget.setCurrentItem(item)
        menu = QMenu(self)
        rename_act = menu.addAction("Rename")
        delete_act = menu.addAction("Delete")
        action = menu.exec(self.list_widget.viewport().mapToGlobal(pos))
        if action == rename_act:
            self.rename_item()
        elif action == delete_act:
            self.delete_item()

    def add_item(self):
        text, ok = QInputDialog.getText(self, "Add", "Name:")
        text = text.strip()
        if ok and text and text not in self.items_ref:
            self.items_ref.append(text)
            LOGGER.log("Checklist", "create", self.log_label, text)
            self.rebuild()
            self.changed.emit()

    def rename_item(self):
        item = self.list_widget.currentItem()
        if not item:
            return
        old = item.text()
        text, ok = QInputDialog.getText(self, "Rename", "Name:", text=old)
        text = text.strip()
        if ok and text and text != old:
            idx = self.items_ref.index(old)
            self.items_ref[idx] = text
            LOGGER.log("Checklist", "update", self.log_label, f"{old} -> {text}")
            self.rebuild()
            self.changed.emit()

    def delete_item(self):
        item = self.list_widget.currentItem()
        if not item:
            return
        name = item.text()
        if len(self.items_ref) <= self.min_items:
            QMessageBox.warning(self, "Can't delete", "At least one item is required.")
            return
        if self.delete_hook:
            ok = self.delete_hook(name)
        else:
            ok = QMessageBox.question(self, "Delete", f"Delete '{name}'?") == QMessageBox.StandardButton.Yes
        if ok:
            self.items_ref.remove(name)
            LOGGER.log("Checklist", "delete", self.log_label, name)
            self.rebuild()
            self.changed.emit()


class CategoriesCrudPanel(QWidget):
    """Infinite nested CRUD tree (used for Category / Subcategory reference list)."""
    changed = pyqtSignal()
    RENAME_TEXT = "Rename"
    ADD_TEXT = "+ Add Category"
    KIND = "category"
    moved = pyqtSignal(str, str, str)

    def __init__(self, categories_ref):
        super().__init__()
        self.categories_ref = categories_ref  # list of ref-nodes, mutated in place
        v = QVBoxLayout(self)
        v.setContentsMargins(8, 8, 8, 8)
        self.tree = ReorderTree()
        self.tree.setHeaderHidden(True)
        self.tree.setAlternatingRowColors(True)
        self.tree.setStyleSheet(
            f"QTreeWidget::item {{ padding: 4px 2px; border-bottom: 1px solid {COLORS['border']}; }}")
        self.tree.setDragDropMode(QAbstractItemView.DragDropMode.InternalMove)
        self.tree.setDefaultDropAction(Qt.DropAction.MoveAction)
        self.tree.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.tree.customContextMenuRequested.connect(self._on_context_menu)
        self.tree.dropped.connect(self._on_reordered)
        v.addWidget(self.tree)
        row = QHBoxLayout()
        add_btn = QPushButton(self.ADD_TEXT); add_btn.setObjectName("Create")
        add_btn.clicked.connect(self.add_top)
        row.addWidget(add_btn)
        v.addLayout(row)
        self.rebuild()

    def rebuild(self):
        self.tree.clear()

        def add(nodes, parent_item):
            for n in nodes:
                item = QTreeWidgetItem([n["name"]])
                item.setData(0, Qt.ItemDataRole.UserRole, n["id"])
                if parent_item is None:
                    self.tree.addTopLevelItem(item)
                else:
                    parent_item.addChild(item)
                add(n.get("children", []), item)

        add(self.categories_ref, None)
        self.tree.expandAll()
        self.tree.setRootIsDecorated(any(n.get("children") for n in self.categories_ref))

    def _tree_to_data(self, parent_item):
        count = self.tree.topLevelItemCount() if parent_item is None else parent_item.childCount()
        result = []
        for i in range(count):
            item = self.tree.topLevelItem(i) if parent_item is None else parent_item.child(i)
            node_id = item.data(0, Qt.ItemDataRole.UserRole)
            orig, _ = find_node_and_parent(self.categories_ref, node_id)
            name = orig["name"] if orig else item.text(0)
            entry = dict(orig) if orig else {"id": node_id}
            entry["name"] = name
            entry["children"] = self._tree_to_data(item)
            result.append(entry)
        return result

    def _rename_node(self, node):
        text, ok = QInputDialog.getText(self, "Rename", "Name:", text=node["name"])
        text = text.strip()
        if ok and text:
            old = node["name"]
            node["name"] = text
            LOGGER.log("Checklist", "update", "category", f"{old} -> {text}")
            self.rebuild(); self.changed.emit()

    def _on_reordered(self, node_id=""):
        self.categories_ref[:] = self._tree_to_data(None)
        action, target, detail = describe_move(self.categories_ref, node_id, "name")
        self.moved.emit(action, f"{self.KIND}: {target}", detail)

    def add_top(self):
        text, ok = QInputDialog.getText(self, "Add", "Name:")
        text = text.strip()
        if ok and text:
            self.categories_ref.append(new_ref_node(text))
            LOGGER.log("Checklist", "create", "category", text)
            self.rebuild()
            self.changed.emit()

    def _on_context_menu(self, pos):
        item = self.tree.itemAt(pos)
        menu = QMenu(self)
        add_top_act = menu.addAction("+ Add parent")
        add_child_act = menu.addAction("+ Add child") if item else None
        rename_act = menu.addAction(self.RENAME_TEXT) if item else None
        delete_act = menu.addAction("Delete (+children)") if item else None
        action = menu.exec(self.tree.viewport().mapToGlobal(pos))
        if action is None:
            return
        node_id = item.data(0, Qt.ItemDataRole.UserRole) if item else None
        node, parent = find_node_and_parent(self.categories_ref, node_id) if item else (None, None)
        if action == add_top_act:
            if node is None:
                self.add_top()
                return
            text, ok = QInputDialog.getText(self, "Add parent", "Name:")
            text = text.strip()
            if ok and text:
                container = parent["children"] if parent else self.categories_ref
                new = new_ref_node(text)
                if node in container:
                    container[container.index(node)] = new
                    new["children"].append(node)
                LOGGER.log("Checklist", "create", "category", f"{text} as parent of {node['name']}")
                self.rebuild(); self.changed.emit()
            return
        if action == add_child_act and node is not None:
            text, ok = QInputDialog.getText(self, "Add child", "Name:")
            text = text.strip()
            if ok and text:
                node["children"].append(new_ref_node(text))
                LOGGER.log("Checklist", "create", "category", f"{text} under {node['name']}")
                self.rebuild(); self.changed.emit()
        elif action == rename_act and node is not None:
            self._rename_node(node)
        elif action == delete_act and node is not None:
            r = QMessageBox.question(self, "Delete", f"Delete '{node['name']}' and all children?")
            if r == QMessageBox.StandardButton.Yes:
                container = parent["children"] if parent else self.categories_ref
                container.remove(node)
                LOGGER.log("Checklist", "delete", "category", node["name"])
                self.rebuild(); self.changed.emit()


# ─────────────────────────────────────────────────────────────────────────
# Checklist tab
# ─────────────────────────────────────────────────────────────────────────

def find_path(nodes, node_id, trail=None):
    """Ancestors (root first) of node_id, or None if not found."""
    trail = trail or []
    for n in nodes:
        if n["id"] == node_id:
            return trail
        r = find_path(n.get("children", []), node_id, trail + [n])
        if r is not None:
            return r
    return None


def describe_move(nodes, nid, key):
    node, _ = find_node_and_parent(nodes, nid) if nid else (None, None)
    path = find_path(nodes, nid) if nid else None
    name = node.get(key, "item") if node else "item"
    if path:
        return "move", name, f"under {path[-1].get(key, '')}"
    return "reorder", name, "top level"


class ContributorDialog(QDialog):
    def __init__(self, node, categories, stats, managers, subs, parent=None):
        super().__init__(parent)
        self.node = node
        self.setWindowTitle("Edit contributor")
        self.setMinimumWidth(480)
        v = QVBoxLayout(self)
        v.setContentsMargins(20, 18, 20, 16)
        v.setSpacing(8)

        def lbl(t):
            w = QLabel(t.upper())
            w.setStyleSheet(f"color:{COLORS['text_faint']}; font-size:8pt; font-weight:800; letter-spacing:0.5px; border:none; background:transparent;")
            return w

        v.addWidget(lbl("Contributor name"))
        self.name_edit = QLineEdit(node.get("name", ""))
        v.addWidget(self.name_edit)
        v.addWidget(lbl("Description"))
        self.desc_edit = AutoExpandingTextEdit(node.get("description", ""))
        v.addWidget(self.desc_edit)
        v.addWidget(lbl("Contact number"))
        self.phone_edit = QLineEdit(node.get("phone", ""))
        v.addWidget(self.phone_edit)
        v.addWidget(lbl("Work email"))
        self.email_edit = QLineEdit(node.get("email", ""))
        v.addWidget(self.email_edit)
        v.addWidget(lbl("Job designation"))
        self.desig_edit = QLineEdit(node.get("designation", ""))
        v.addWidget(self.desig_edit)
        v.addWidget(lbl("Category focused"))
        self.cat_combo = QComboBox()
        self.cat_combo.addItem("")
        self.cat_combo.addItems(categories)
        cur = node.get("category", "")
        if cur and cur not in categories:
            self.cat_combo.addItem(cur)
        self.cat_combo.setCurrentText(cur)
        v.addWidget(self.cat_combo)

        dash = QFrame()
        dash.setStyleSheet(f"QFrame {{ background:{COLORS['panel_alt']}; border:1px solid {COLORS['border']}; border-radius:8px; }}")
        dv = QVBoxLayout(dash)
        dv.setContentsMargins(12, 10, 12, 10)
        dv.setSpacing(4)
        dv.addWidget(lbl("Dashboard"))
        stat = QLabel(f"Work done: {stats['done']}%   ·   In progress: {stats['progress']}%   ·   Backlog: {stats['backlog']}%   ({stats['total']} task(s))")
        stat.setWordWrap(True)
        stat.setStyleSheet(f"color:{COLORS['accent']}; font-weight:700; border:none; background:transparent;")
        dv.addWidget(stat)
        for title, names in (("Managers", managers), ("Subordinates", subs)):
            t = QLabel(f"{title}: " + (", ".join(names) if names else "—"))
            t.setWordWrap(True)
            t.setStyleSheet(f"color:{COLORS['text_dim']}; border:none; background:transparent;")
            dv.addWidget(t)
        v.addWidget(dash)

        row = QHBoxLayout()
        row.addStretch()
        cancel_btn = QPushButton("Cancel")
        cancel_btn.setObjectName("Ghost")
        cancel_btn.clicked.connect(self.reject)
        save_btn = QPushButton("Save")
        save_btn.setObjectName("Primary")
        save_btn.clicked.connect(self.accept)
        row.addWidget(cancel_btn)
        row.addWidget(save_btn)
        v.addLayout(row)

    def apply_to_node(self):
        n = self.node
        n["name"] = self.name_edit.text().strip() or n["name"]
        n["description"] = self.desc_edit.toPlainText()
        n["phone"] = self.phone_edit.text().strip()
        n["email"] = self.email_edit.text().strip()
        n["designation"] = self.desig_edit.text().strip()
        n["category"] = self.cat_combo.currentText().strip()


class ContributorsPanel(CategoriesCrudPanel):
    """Hierarchical contributors. Managers = ancestors, subordinates = descendants."""
    RENAME_TEXT = "Edit"
    ADD_TEXT = "+ Add Contributor"
    KIND = "contributor"

    def __init__(self, contributors_ref, get_nodes, get_categories):
        super().__init__(contributors_ref)
        self.get_nodes = get_nodes
        self.get_categories = get_categories

    def add_top(self):
        node = new_ref_node("")
        node.update({"description": "", "phone": "", "email": "", "designation": "", "category": ""})
        stats = {"total": 0, "done": 0, "progress": 0, "backlog": 0}
        dlg = ContributorDialog(node, flatten_ref_names(self.get_categories()), stats, [], [], self)
        if dlg.exec():
            dlg.apply_to_node()
            if not node["name"]:
                return
            self.categories_ref.append(node)
            LOGGER.log("Checklist", "create", "contributor", node["name"])
            self.rebuild(); self.changed.emit()

    def _rename_node(self, node):
        name = node["name"]
        tasks = [t for t, _ in flatten_tasks(self.get_nodes()) if t.get("contributor") == name]
        total = len(tasks)

        def pct(status):
            return round(100 * sum(1 for t in tasks if t.get("status") == status) / total) if total else 0

        stats = {"total": total, "done": pct("Done"), "progress": pct("In Progress"), "backlog": pct("Todo")}
        managers = [a["name"] for a in (find_path(self.categories_ref, node["id"]) or [])]
        subs = flatten_ref_names(node.get("children", []))
        dlg = ContributorDialog(node, flatten_ref_names(self.get_categories()), stats, managers, subs, self)
        if dlg.exec():
            dlg.apply_to_node()
            if node["name"] != name:
                for t, _ in flatten_tasks(self.get_nodes()):
                    if t.get("contributor") == name:
                        t["contributor"] = node["name"]
            LOGGER.log("Checklist", "update", "contributor", node["name"])
            self.rebuild(); self.changed.emit()


HEADING_SIZES = [19, 16, 14, 12]  # by depth, clamped
KANBAN_MAX_COLS = 5

CHECKLIST_AI = f"""Root: {BASE_DIR}
Checklist data lives at: tooldata/checklist.json

HOW TO ACTUALLY SEND AN EDIT (self-contained — this works even if you only
have this panel, not the Rewriter one): output ONE JSON object of this
shape and the user pastes it into the Rewriter tab and clicks Apply:

```json
{{
  "changes": [
    {{
      "file": "tooldata/checklist.json",
      "edits": [
        {{ "find": "exact substring of the CURRENT file", "replace": "its replacement" }}
      ]
    }}
  ]
}}
```
"find" must match the CURRENT file's text exactly once — ask the user to
export tooldata/checklist.json via Reader first if you haven't seen its
current contents, never guess at existing ids/timestamps/values.

WATCH OUT: stub nodes are structurally identical (e.g. multiple
"children": [] or "description": "" in the same file), so a short find
string like that will match more than once and the edit will be silently
skipped. Either include enough surrounding context (title, id, etc.) to
make "find" unique, or — safest for any structural change (add/remove/
reorder nodes) — send ONE edit with "find": "" and "replace" set to the
ENTIRE new file content (whole-file replace; the user gets a Yes/No
confirmation, so an "" find never needs "C" here since the file already
exists).

Minimal structure for new content — omit anything auto-filled (see Rules):

```json
{{
  "nodes": [
    {{
      "title": "Phase 0: Setup",
      "type": "heading",
      "children": [
        {{
          "title": "Set up repo", "type": "task",
          "category": "Backend", "contributor": "Alice",
          "children": []
        }}
      ]
    }}
  ],
  "contributors": ["Alice", "Bob"],
  "categories": [ {{ "name": "Backend", "children": [] }} ],
  "statuses": ["Todo", "In Progress", "Review", "Done"]
}}
```

Rules:
- "type" is "heading" (a phase/section, renders larger by nesting depth) or
  "task" (has a status checkbox, shown in Kanban)
- nesting under "children" is infinite on both nodes and categories
- "status" must be one of the strings in "statuses" — add it there first
  if it doesn't already exist; omit "status" to default to "Todo"
- AUTO-FILLED — you never need to write these, the app fills them in for
  any node/category missing them on every load: "id" (on nodes and
  categories), "created_at", "updated_at", "completed_at". Just omit
  them entirely on new items rather than guessing a timestamp or an id
- editing this file directly here bypasses the in-app Contributors /
  Categories / Statuses CRUD panels but is fully equivalent — the app
  re-reads this file after every Rewriter apply"""

STATUS_PALETTE = [COLORS['blue'], COLORS['yellow'], COLORS['teal'], COLORS['green'], COLORS['red'], COLORS['accent']]


class ClearingTreeWidget(ReorderTree):
    """QTreeWidget that clears its selection highlight when it loses focus,
    so only one thing is ever highlighted at a time."""
    def focusOutEvent(self, event):
        super().focusOutEvent(event)
        if event.reason() == Qt.FocusReason.PopupFocusReason:
            return
        self.clearSelection()


class KanbanListWidget(QListWidget):
    """QListWidget card column supporting drag-and-drop of cards between
    columns (changes the task's status), Jira-style."""
    def __init__(self, checklist_tab, status):
        super().__init__()
        self.checklist_tab = checklist_tab
        self.status = status
        self.setDragEnabled(True)
        self.setAcceptDrops(True)
        self.setDropIndicatorShown(True)
        self.setDefaultDropAction(Qt.DropAction.MoveAction)
        self.setSpacing(6)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.setResizeMode(QListWidget.ResizeMode.Adjust)
        self.setStyleSheet("QListWidget { background: transparent; border: none; }")

    def startDrag(self, supportedActions):
        item = self.currentItem()
        if not item:
            return
        node_id = item.data(Qt.ItemDataRole.UserRole)
        if not node_id:
            return
        drag = QDrag(self)
        mime = QMimeData()
        mime.setText(node_id)
        drag.setMimeData(mime)
        drag.exec(Qt.DropAction.MoveAction)

    def dragEnterEvent(self, event):
        if event.mimeData().hasText():
            event.acceptProposedAction()

    def dragMoveEvent(self, event):
        if event.mimeData().hasText():
            event.acceptProposedAction()

    def dropEvent(self, event):
        node_id = event.mimeData().text()
        event.acceptProposedAction()
        self.checklist_tab.move_task_to_status(node_id, self.status)

    def resizeEvent(self, event):
        super().resizeEvent(event)
        self._resize_cards()

    def _resize_cards(self):
        w = max(self.viewport().width() - 2, 0)
        if w <= 0:
            return
        for i in range(self.count()):
            item = self.item(i)
            widget = self.itemWidget(item)
            if widget:
                widget.setMaximumWidth(w)
                widget.setFixedWidth(w)
                item.setSizeHint(widget.sizeHint())

class ChecklistTab(QWidget):
    def __init__(self, main_window):
        super().__init__()
        self.main_window = main_window
        self.data = load_checklist()

        root_h = QHBoxLayout(self)
        root_h.setContentsMargins(0, 0, 0, 0)
        splitter = QSplitter(Qt.Orientation.Horizontal)
        root_h.addWidget(splitter)

        left = QWidget()
        v = QVBoxLayout(left)
        header = QHBoxLayout()
        title = QLabel("Checklist")
        title.setObjectName("SectionTitle")
        header.addWidget(title)
        ck_hint = QLabel("Copy the AI INSTRUCTIONS (bottom right) and give them to your AI agent to use the checklist with it!")
        ck_hint.setStyleSheet(f"color:{COLORS['accent']}; font-weight:800; font-size:9pt;")
        header.addWidget(ck_hint)
        header.addStretch()

        self.nested_btn = QPushButton("Nested")
        self.nested_btn.setObjectName("Primary")
        self.nested_btn.clicked.connect(lambda: self.switch_view("nested"))
        self.kanban_btn = QPushButton("Kanban")
        self.kanban_btn.setObjectName("Ghost")
        self.kanban_btn.clicked.connect(lambda: self.switch_view("kanban"))
        header.addWidget(self.nested_btn)
        header.addWidget(self.kanban_btn)

        add_phase_btn = QPushButton("+ Phase")
        add_phase_btn.setObjectName("Create")
        add_phase_btn.clicked.connect(self.add_top_phase)
        header.addWidget(add_phase_btn)
        add_task_btn = QPushButton("+ Task")
        add_task_btn.setObjectName("Create")
        add_task_btn.clicked.connect(self.add_top_task)
        header.addWidget(add_task_btn)
        v.addLayout(header)
        tip = QLabel("Right click on any item for options! Drag and Drop to reorder, Drag and drop on top of another item to nest it! Infinite nesting possible!")
        tip.setWordWrap(True)
        tip.setStyleSheet(f"color:{COLORS['accent']}; font-weight:800; font-size:9pt;")
        v.addWidget(tip)

        self.stack = QStackedWidget()
        v.addWidget(self.stack)

        # nested view
        self.tree = ClearingTreeWidget()
        self.tree.setHeaderHidden(True)
        self.tree.setAlternatingRowColors(True)
        self.tree.setSelectionMode(QAbstractItemView.SelectionMode.ExtendedSelection)
        self.tree.setDragDropMode(QAbstractItemView.DragDropMode.InternalMove)
        self.tree.setDefaultDropAction(Qt.DropAction.MoveAction)
        self.tree.itemChanged.connect(self._on_item_changed)
        self.tree.itemDoubleClicked.connect(self._on_double_click)
        self.tree.itemSelectionChanged.connect(self._on_tree_selection_changed)
        self.tree.dropped.connect(self._on_tree_reordered)
        self.tree.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.tree.customContextMenuRequested.connect(self._on_context_menu)
        self.stack.addWidget(self.tree)

        # kanban view — responsive grid, scrollable, max 5 columns
        self.kanban_scroll = QScrollArea()
        self.kanban_scroll.setWidgetResizable(True)
        self.kanban_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.kanban_inner = QWidget()
        self.kanban_grid = None  # QGridLayout, (re)built in _build_kanban_columns
        self.kanban_scroll.setWidget(self.kanban_inner)
        self.kanban_lists = {}
        self.stack.addWidget(self.kanban_scroll)

        status_row = QHBoxLayout()
        self.status_lbl = QLabel("Shift+Click / Ctrl+Click to multi-select")
        self.status_lbl.setObjectName("Dim")
        status_row.addWidget(self.status_lbl)
        status_row.addStretch()
        v.addLayout(status_row)

        splitter.addWidget(left)

        # ---- right: meta panel — Contributors / Categories / Statuses ----
        right = QSplitter(Qt.Orientation.Vertical)
        right.setMinimumWidth(300)
        right.setMaximumWidth(480)

        self.contrib_panel = ContributorsPanel(self.data["contributors"], lambda: self.data["nodes"], lambda: self.data["categories"])
        self.contrib_panel.changed.connect(self._on_meta_changed)
        self.contrib_panel.moved.connect(self._snapshot_checklist_save)
        right.addWidget(CollapsibleBox("CONTRIBUTORS", self.contrib_panel, start_open=True))

        self.category_panel = CategoriesCrudPanel(self.data["categories"])
        self.category_panel.changed.connect(self._on_meta_changed)
        self.category_panel.moved.connect(self._snapshot_checklist_save)
        right.addWidget(CollapsibleBox("CATEGORIES", self.category_panel, start_open=True))

        self.status_panel = SimpleListCrudPanel(self.data["statuses"], "status", min_items=1,
                                                 show_rename_button=False)
        self.status_panel.changed.connect(self._on_meta_changed)
        self.status_panel.delete_hook = self._confirm_status_delete
        right.addWidget(CollapsibleBox("STATUSES", self.status_panel, start_open=True))

        ai_w = QWidget()
        ai_v = QVBoxLayout(ai_w)
        ai_v.addWidget(make_readonly_text(CHECKLIST_AI, mono=True))
        right.addWidget(CollapsibleBox("AI INSTRUCTIONS", ai_w, start_open=False, copy_text_fn=lambda: CHECKLIST_AI))
        self.side = right
        self.main_split = splitter

        splitter.addWidget(right)
        splitter.setStretchFactor(0, 3)
        splitter.setStretchFactor(1, 2)

        self._updating = False
        self.rebuild()

    def _set_status(self, text, kind="Dim"):
        self.status_lbl.setText(text)
        self.status_lbl.setObjectName(kind)
        self.status_lbl.style().unpolish(self.status_lbl)
        self.status_lbl.style().polish(self.status_lbl)

    def _on_tree_selection_changed(self):
        n = len(self.tree.selectedItems())
        if n > 1:
            self._set_status(f"Selected: {n} item(s)", "StatusInfo")
        else:
            self._set_status("Shift+Click / Ctrl+Click to multi-select", "Dim")

    def _tree_to_nodes(self, parent_item):
        count = self.tree.topLevelItemCount() if parent_item is None else parent_item.childCount()
        result = []
        for i in range(count):
            item = self.tree.topLevelItem(i) if parent_item is None else parent_item.child(i)
            node_id = item.data(0, Qt.ItemDataRole.UserRole)
            node, _ = find_node_and_parent(self.data["nodes"], node_id)
            if node is None:
                continue
            node["children"] = self._tree_to_nodes(item)
            result.append(node)
        return result

    def _on_tree_reordered(self, node_id=""):
        if self._updating:
            return
        self.data["nodes"] = self._tree_to_nodes(None)
        action, target, detail = describe_move(self.data["nodes"], node_id, "title")
        self._snapshot_checklist_save(action, target, detail)
        self._rebuild_tree()

    def _status_color(self, status):
        statuses = self.statuses()
        try:
            idx = statuses.index(status)
        except ValueError:
            idx = 0
        return STATUS_PALETTE[idx % len(STATUS_PALETTE)]

    def _snapshot_checklist_save(self, action, target, details):
        """Diffs tooldata/checklist.json before/after the caller's mutation
        (already applied to self.data) and logs with a revertible snapshot,
        same mechanism the Rewriter edit path uses."""
        try:
            with open(CHECKLIST_JSON, "r", encoding="utf-8") as f:
                before_content = f.read()
        except Exception:
            before_content = ""
        self.save_silent()
        with open(CHECKLIST_JSON, "r", encoding="utf-8") as f:
            after_content = f.read()
        ops = make_diff_ops(before_content, after_content)
        snapshot = {"files": [{"file": "tooldata/checklist.json", "op": "edit", "ops": ops}]} if ops else None
        LOGGER.log("Checklist", action, target, details, snapshot=snapshot)

    def move_task_to_status(self, node_id, new_status):
        node, _ = find_node_and_parent(self.data["nodes"], node_id)
        if not node or node["status"] == new_status:
            return
        node["status"] = new_status
        node["updated_at"] = now_iso()
        node["completed_at"] = now_iso() if new_status == "Done" else None
        self._snapshot_checklist_save("status_change", node["title"], new_status)
        self._rebuild_kanban()

    def statuses(self):
        return self.data.get("statuses") or list(DEFAULT_STATUSES)

    def _on_meta_changed(self):
        self.save()
        if self.stack.currentIndex() == 1:
            self._build_kanban_columns()
        self.rebuild()

    def switch_view(self, which):
        if which == "nested":
            self.stack.setCurrentIndex(0)
            self.nested_btn.setObjectName("Primary")
            self.kanban_btn.setObjectName("Ghost")
        else:
            self.stack.setCurrentIndex(1)
            self.nested_btn.setObjectName("Ghost")
            self.kanban_btn.setObjectName("Primary")
            self._build_kanban_columns()
        for b in (self.nested_btn, self.kanban_btn):
            b.style().unpolish(b); b.style().polish(b)
        self.rebuild()

    def save(self):
        save_checklist(self.data)
        LOGGER.log("Checklist", "save", "tooldata/checklist.json", "")

    def save_silent(self):
        """Writes checklist.json without its own log entry — used by
        _snapshot_checklist_save, which logs the snapshot itself instead."""
        save_checklist(self.data)

    def reload_if_changed(self):
        try:
            m = os.path.getmtime(CHECKLIST_JSON)
        except Exception:
            m = None
        if m != getattr(save_checklist, "stamp", None):
            self.reload()

    def reload(self):
        self.data = load_checklist()
        self.contrib_panel.categories_ref = self.data["contributors"]
        self.contrib_panel.rebuild()
        self.category_panel.categories_ref = self.data["categories"]
        self.category_panel.rebuild()
        self.status_panel.items_ref = self.data["statuses"]
        self.status_panel.rebuild()
        if self.stack.currentIndex() == 1:
            self._build_kanban_columns()
        self.rebuild()

    def add_top_phase(self):
        idx = len(self.data["nodes"])
        node = new_node(f"Phase {idx}", "heading")
        self.data["nodes"].append(node)
        self.save()
        LOGGER.log("Checklist", "create", node["title"], "top-level heading")
        self.rebuild()

    def add_top_task(self):
        node = new_node("New Task", "task")
        self.data["nodes"].append(node)
        self.save()
        LOGGER.log("Checklist", "create", node["title"], "top-level task")
        self.rebuild()

    # ---- nested tree ----
    def rebuild(self):
        if self.stack.currentIndex() == 0:
            self._rebuild_tree()
        else:
            self._rebuild_kanban()

    def _rebuild_tree(self):
        self._updating = True
        self.tree.clear()

        def add(nodes, parent_item, depth):
            for n in nodes:
                if n["type"] == "heading":
                    size = HEADING_SIZES[min(depth, len(HEADING_SIZES) - 1)]
                    item = QTreeWidgetItem([n["title"]])
                    f = QFont(FONT_FAMILY.split(",")[0], size, QFont.Weight.Bold)
                    item.setFont(0, f)
                    item.setForeground(0, QColor(COLORS["text"]))
                else:
                    tag = f"[{n['status']}]"
                    meta = " / ".join(x for x in [n.get("category"), n.get("subcategory")] if x)
                    label = n["title"] + (f"  —  {meta}" if meta else "") + f"   {tag}"
                    item = QTreeWidgetItem([label])
                    item.setFlags(item.flags() | Qt.ItemFlag.ItemIsUserCheckable)
                    agg_state = {"full": Qt.CheckState.Checked, "partial": Qt.CheckState.PartiallyChecked,
                                 "none": Qt.CheckState.Unchecked}[task_agg_state(n)]
                    item.setCheckState(0, agg_state)
                    color = COLORS["green"] if n["status"] == "Done" else self._status_color(n["status"])
                    item.setForeground(0, QColor(color))
                item.setData(0, Qt.ItemDataRole.UserRole, n["id"])
                if parent_item is None:
                    self.tree.addTopLevelItem(item)
                else:
                    parent_item.addChild(item)
                add(n["children"], item, depth + 1)

        add(self.data["nodes"], None, 0)
        self.tree.expandAll()
        self.tree.setRootIsDecorated(any(n["children"] for n in self.data["nodes"]))
        self._updating = False

    def _set_subtree_status(self, node, status):
        """Cascade a status down to every task descendant (used when a
        parent task is checked/unchecked done in the nested tree)."""
        if node["type"] == "task":
            node["status"] = status
            node["updated_at"] = now_iso()
            node["completed_at"] = now_iso() if status == "Done" else None
        for c in node.get("children", []):
            self._set_subtree_status(c, status)

    def _on_item_changed(self, item, col):
        if self._updating:
            return
        node_id = item.data(0, Qt.ItemDataRole.UserRole)
        node, _ = find_node_and_parent(self.data["nodes"], node_id)
        if not node or node["type"] != "task":
            return
        done = item.checkState(0) == Qt.CheckState.Checked
        statuses = self.statuses()
        new_status = "Done" if (done and "Done" in statuses) else "Todo"
        self._set_subtree_status(node, new_status)
        self._snapshot_checklist_save("status_change", node["title"], new_status)
        self._rebuild_tree()

    def _on_double_click(self, item, col):
        node_id = item.data(0, Qt.ItemDataRole.UserRole)
        node, _ = find_node_and_parent(self.data["nodes"], node_id)
        if not node:
            return
        self._edit_node(node)

    def _add_parent(self, node, parent, ntype):
        new = new_node("New Phase" if ntype == "heading" else "New Task", ntype)
        container = parent["children"] if parent else self.data["nodes"]
        if node is not None and node in container:
            container[container.index(node)] = new
            new["children"].append(node)
            detail = f"parent of {node['title']}"
        else:
            container.append(new)
            detail = "top-level"
        self.save()
        LOGGER.log("Checklist", "create", new["title"], detail)
        self.rebuild()

    def _confirm_status_delete(self, name):
        tasks = [t for t, _ in flatten_tasks(self.data["nodes"]) if t.get("status") == name]
        if not tasks:
            return QMessageBox.question(self, "Delete", f"Delete '{name}'?") == QMessageBox.StandardButton.Yes
        dlg = QDialog(self)
        dlg.setWindowTitle("Delete status")
        dlg.setMinimumWidth(420)
        v = QVBoxLayout(dlg)
        msg = QLabel(f"This status has {len(tasks)} task(s) associated with it. Deleting '{name}' will either move them to another status or delete all of them.")
        msg.setWordWrap(True)
        v.addWidget(msg)
        combo = QComboBox()
        combo.addItems([s for s in self.statuses() if s != name])
        v.addWidget(combo)
        choice = {}

        def pick(k):
            choice["k"] = k
            dlg.accept()

        row = QHBoxLayout()
        row.addStretch()
        cancel_btn = QPushButton("Cancel"); cancel_btn.setObjectName("Ghost")
        cancel_btn.clicked.connect(dlg.reject)
        move_btn = QPushButton("Move to selected"); move_btn.setObjectName("Primary")
        move_btn.clicked.connect(lambda: pick("move"))
        del_btn = QPushButton("Delete all items"); del_btn.setObjectName("Danger")
        del_btn.clicked.connect(lambda: pick("delete"))
        for b in (cancel_btn, move_btn, del_btn):
            row.addWidget(b)
        v.addLayout(row)
        dlg.exec()
        k = choice.get("k")
        if k == "move":
            target = combo.currentText()
            for t in tasks:
                t["status"] = target
                t["updated_at"] = now_iso()
                t["completed_at"] = now_iso() if target == "Done" else None
            return True
        if k == "delete":
            for t in tasks:
                node, parent = find_node_and_parent(self.data["nodes"], t["id"])
                if node is None:
                    continue
                container = parent["children"] if parent else self.data["nodes"]
                if node in container:
                    container.remove(node)
            return True
        return False

    def _multi_context_menu(self, pos, sel):
        ids = [it.data(0, Qt.ItemDataRole.UserRole) for it in sel]
        menu = QMenu(self)
        del_act = menu.addAction(f"Delete all ({len(ids)})")
        sub = menu.addMenu("Mark all as")
        status_actions = {sub.addAction(s): s for s in self.statuses()}
        action = menu.exec(self.tree.viewport().mapToGlobal(pos))
        if action is None:
            return
        if action == del_act:
            r = QMessageBox.question(self, "Delete", f"Delete {len(ids)} items and all their children?")
            if r != QMessageBox.StandardButton.Yes:
                return
            found = [find_node_and_parent(self.data["nodes"], i) for i in ids]
            for node, parent in found:
                if node is None:
                    continue
                container = parent["children"] if parent else self.data["nodes"]
                if node in container:
                    container.remove(node)
            self.save()
            LOGGER.log("Checklist", "delete", f"{len(ids)} items", "multi-select")
            self.rebuild()
            return
        status = status_actions.get(action)
        if status:
            for i in ids:
                node, _ = find_node_and_parent(self.data["nodes"], i)
                if node and node["type"] == "task":
                    node["status"] = status
                    node["updated_at"] = now_iso()
                    node["completed_at"] = now_iso() if status == "Done" else None
            self._snapshot_checklist_save("status_change", f"{len(ids)} items", status)
            self.rebuild()

    def _edit_node(self, node):
        dlg = NodeEditDialog(node, self.statuses(), flatten_ref_names(self.data["contributors"]),
                              flatten_ref_names(self.data["categories"]), self)
        if dlg.exec():
            dlg.apply_to_node()
            self.save()
            LOGGER.log("Checklist", "update", node["title"], "")
            self.rebuild()

    def _on_context_menu(self, pos):
        item = self.tree.itemAt(pos)
        sel = self.tree.selectedItems()
        if item is not None and len(sel) > 1 and item in sel:
            self._multi_context_menu(pos, sel)
            return
        menu = QMenu(self)
        add_h_top = menu.addAction("+ Add parent heading")
        add_t_top = menu.addAction("+ Add parent task")
        node_id = item.data(0, Qt.ItemDataRole.UserRole) if item else None
        add_h_child = menu.addAction("+ Add child heading") if item else None
        add_t_child = menu.addAction("+ Add child task") if item else None
        edit_act = menu.addAction("Edit") if item else None
        delete_act = menu.addAction("Delete (+children)") if item else None

        action = menu.exec(self.tree.viewport().mapToGlobal(pos))
        if action is None:
            return
        node, parent = (None, None)
        if item:
            node, parent = find_node_and_parent(self.data["nodes"], node_id)
        if action in (add_h_top, add_t_top):
            self._add_parent(node, parent, "heading" if action == add_h_top else "task")
            return
        if action == add_h_child and node:
            node["children"].append(new_node("New Heading", "heading"))
            self.save(); LOGGER.log("Checklist", "create", "New Heading", f"under {node['title']}"); self.rebuild()
        elif action == add_t_child and node:
            node["children"].append(new_node("New Task", "task"))
            self.save(); LOGGER.log("Checklist", "create", "New Task", f"under {node['title']}"); self.rebuild()
        elif action == edit_act and node:
            self._edit_node(node)
        elif action == delete_act and node:
            r = QMessageBox.question(self, "Delete", f"Delete '{node['title']}' and all children?")
            if r == QMessageBox.StandardButton.Yes:
                container = parent["children"] if parent else self.data["nodes"]
                container.remove(node)
                self.save()
                LOGGER.log("Checklist", "delete", node["title"], "")
                self.rebuild()

    # ---- kanban ----
    def _build_kanban_columns(self):
        """(Re)build the responsive grid of status columns, max 5 per row,
        scrollable as a whole. Jira-style column chrome + card drag-drop."""
        old = self.kanban_inner.layout()
        if old is not None:
            while old.count():
                w = old.takeAt(0).widget()
                if w:
                    w.deleteLater()
            QWidget().setLayout(old)  # detach old layout
        grid = QGridLayout()
        grid.setSpacing(14)
        self.kanban_inner.setLayout(grid)
        self.kanban_grid = grid
        self.kanban_lists = {}

        statuses = self.statuses()
        cols = min(KANBAN_MAX_COLS, max(1, len(statuses)))
        for i, status in enumerate(statuses):
            r, c = divmod(i, cols)
            color = self._status_color(status)
            col_w = QFrame()
            col_w.setStyleSheet(
                f"QFrame {{ background: {COLORS['panel']}; border: 1px solid {COLORS['border']}; "
                f"border-top: 3px solid {color}; border-radius: 8px; }}")
            colv = QVBoxLayout(col_w)
            colv.setContentsMargins(10, 10, 10, 10)
            lbl = QLabel(status.upper())
            lbl.setStyleSheet(f"font-weight:800; color:{color}; border:none; background:transparent; letter-spacing:1px; font-size:9pt;")
            colv.addWidget(lbl)
            lst = KanbanListWidget(self, status)
            lst.setMinimumWidth(230)
            lst.setMinimumHeight(280)
            lst.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
            lst.customContextMenuRequested.connect(
                lambda pos, s=status, w=lst: self._kanban_context_menu(pos, s, w))
            lst.itemDoubleClicked.connect(self._kanban_double_click)
            colv.addWidget(lst)
            self.kanban_lists[status] = lst
            grid.addWidget(col_w, r, c)

    def _make_kanban_card(self, node, trail):
        color = self._status_color(node["status"])
        card = QFrame()
        card.setStyleSheet(
            f"QFrame {{ background: {COLORS['panel_alt']}; border: 1px solid {COLORS['border']}; "
            f"border-left: 3px solid {color}; border-radius: 6px; }}")
        v = QVBoxLayout(card)
        v.setContentsMargins(10, 8, 10, 8)
        v.setSpacing(4)
        title = QLabel(node["title"])
        title.setWordWrap(True)
        title.setStyleSheet(f"color:{COLORS['text']}; font-weight:700; font-size:10pt; border:none; background:transparent;")
        v.addWidget(title)
        crumb = " / ".join(x for x in trail[-2:] if x)
        bits = ([crumb] if crumb else []) + [x for x in [node.get("category"), node.get("contributor")] if x]
        if bits:
            sub = QLabel(" • ".join(bits))
            sub.setWordWrap(True)
            sub.setStyleSheet(f"color:{COLORS['text_faint']}; font-size:8pt; border:none; background:transparent;")
            v.addWidget(sub)
        return card

    def _rebuild_kanban(self):
        for lst in self.kanban_lists.values():
            lst.clear()
        statuses = self.statuses()
        fallback = statuses[0] if statuses else "Todo"
        for node, trail in flatten_tasks(self.data["nodes"]):
            item = QListWidgetItem()
            item.setData(Qt.ItemDataRole.UserRole, node["id"])
            lst = self.kanban_lists.get(node["status"], self.kanban_lists.get(fallback))
            if lst is None:
                continue
            card = self._make_kanban_card(node, trail)
            item.setSizeHint(card.sizeHint())
            lst.addItem(item)
            lst.setItemWidget(item, card)
        for lst in self.kanban_lists.values():
            lst._resize_cards()

    def _kanban_context_menu(self, pos, status, list_widget):
        item = list_widget.itemAt(pos)
        if not item:
            return
        menu = QMenu(self)
        move_actions = {}
        for s in self.statuses():
            if s == status:
                continue
            move_actions[menu.addAction(f"Move to {s}")] = s
        edit_act = menu.addAction("Edit")
        action = menu.exec(list_widget.viewport().mapToGlobal(pos))
        if action is None:
            return
        node_id = item.data(Qt.ItemDataRole.UserRole)
        node, _ = find_node_and_parent(self.data["nodes"], node_id)
        if not node:
            return
        if action == edit_act:
            self._edit_node(node)
            self._rebuild_kanban()
            return
        new_status = move_actions.get(action)
        if new_status:
            self.move_task_to_status(node_id, new_status)

    def _kanban_double_click(self, item):
        node_id = item.data(Qt.ItemDataRole.UserRole)
        node, _ = find_node_and_parent(self.data["nodes"], node_id)
        if node:
            self._edit_node(node)
            self._rebuild_kanban()

# ─────────────────────────────────────────────────────────────────────────
# Logs tab
# ─────────────────────────────────────────────────────────────────────────

class LogsTab(QWidget):
    def __init__(self, main_window):
        super().__init__()
        self.main_window = main_window
        self._row_ids = []
        v = QVBoxLayout(self)
        header = QHBoxLayout()
        title = QLabel("Logs")
        title.setObjectName("SectionTitle")
        header.addWidget(title)
        hint = QLabel("Hover on Option buttons to know more!")
        hint.setStyleSheet(f"color:{COLORS['accent']}; font-weight:800; font-size:9pt;")
        header.addWidget(hint)
        header.addStretch()
        help_btn = QToolButton()
        help_btn.setIcon(svg_icon(SVG_HELP, size=22, color=COLORS['accent']))
        help_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        help_text = (
            "<b>Revert (single arrow)</b> — restores this file to exactly the state "
            "it was in AT this log entry, discarding anything that happened to it "
            "afterward. 'Revert to', not 'revert before'.<br><br>"
            "<b>Revert All (double arrow)</b> — same idea but for every tracked file "
            "at once: rolls the whole repo back to how it looked right after this "
            "entry happened.<br><br>"
            "<b>Find Previous Change (magnifier)</b> — jumps to and highlights the "
            "most recent earlier log entry for the same file, so you can inspect "
            "or revert to an older state step by step.<br><br>"
            "<b>View original (link icon, on Revert rows)</b> — jumps to and "
            "highlights the entry that this Revert entry reverted to.<br><br>"
            "<b>To undo a delete:</b> a delete entry's revert-to state is 'file does "
            "not exist' (that IS the state right after deletion). To bring the file "
            "back, use Find Previous to jump to the edit/create entry right before "
            "the delete, then press Revert on THAT entry — that restores the file "
            "to its last content before it was removed.")
        self.help_btn = help_btn
        self._help_popup = QLabel(help_text, self, Qt.WindowType.Popup)
        self._help_popup.setTextFormat(Qt.TextFormat.RichText)
        self._help_popup.setWordWrap(True)
        self._help_popup.setFixedWidth(440)
        self._help_popup.setStyleSheet(f"background:{COLORS['panel']}; color:{COLORS['text']}; border:1px solid {COLORS['accent']}; border-radius:6px; padding:10px;")
        help_btn.clicked.connect(self._show_help)
        header.addWidget(help_btn)
        v.addLayout(header)

        filt_row = QHBoxLayout()
        self.tab_filter = QComboBox()
        self.tab_filter.addItems(["All tabs", "Reader", "Rewriter", "Checklist", "Logs"])
        self.tab_filter.currentIndexChanged.connect(self.refresh)
        filt_row.addWidget(self.tab_filter)

        self.search_filter = QLineEdit()
        self.search_filter.setPlaceholderText("Filter by action / target / details…")
        self.search_filter.textChanged.connect(self.refresh)
        filt_row.addWidget(self.search_filter)
        v.addLayout(filt_row)

        self.table = QTableWidget(0, 5)
        self.table.setHorizontalHeaderLabels(["Time", "Tab", "Action", "Target / Details", "Options"])
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeMode.Stretch)
        self.table.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeMode.ResizeToContents)
        self.table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.table.setAlternatingRowColors(True)
        v.addWidget(self.table)

        note = QLabel("Append-only audit log. logs.jsonl itself can't be edited/deleted from within the "
                       "app — reverting writes a new 'Revert' entry instead of erasing history.")
        note.setObjectName("Dim")
        note.setWordWrap(True)
        v.addWidget(note)

        LOGGER.changed.connect(self._on_logger_changed)
        self.table.verticalScrollBar().valueChanged.connect(self._on_scroll)
        self._dirty = True
        self._rows_data = []
        self._loaded = 0

    # ---- table rendering ----
    def refresh(self):
        tab_f = self.tab_filter.currentText()
        text_f = self.search_filter.text().lower().strip()
        rows = list(reversed(LOGGER.entries))
        if tab_f != "All tabs":
            rows = [r for r in rows if r.get("tab") == tab_f]
        if text_f:
            rows = [r for r in rows if text_f in json.dumps(r).lower()]
        self._dirty = False
        self._rows_data = rows
        self._row_ids = [r.get("id") for r in rows]
        self.table.setRowCount(0)
        self._loaded = 0
        self._load_more()

    def _load_more(self, upto=None):
        end = min(len(self._rows_data),
                  max(self._loaded + 100, (upto + 1) if upto is not None else 0))
        self.table.setRowCount(end)
        for i in range(self._loaded, end):
            r = self._rows_data[i]
            self.table.setItem(i, 0, QTableWidgetItem(r.get("time", "")))
            self.table.setItem(i, 1, QTableWidgetItem(r.get("tab", "")))
            action_text = r.get("action", "")
            if r.get("reverted_by"):
                action_text += "  (reverted)"
            self.table.setItem(i, 2, QTableWidgetItem(action_text))
            detail = r.get("target", "")
            if r.get("details"):
                detail += "  —  " + r["details"]
            self.table.setItem(i, 3, QTableWidgetItem(detail))
            self.table.setCellWidget(i, 4, self._make_options_widget(r))
        self._loaded = end

    def _on_scroll(self, value):
        sb = self.table.verticalScrollBar()
        if value >= sb.maximum() - 50 and self._loaded < len(self._rows_data):
            self._load_more()

    def _on_logger_changed(self):
        if self.isVisible():
            self.refresh()
        else:
            self._dirty = True

    def showEvent(self, event):
        super().showEvent(event)
        if self._dirty:
            self.refresh()

    def _show_help(self):
        p = self._help_popup
        p.adjustSize()
        pos = self.help_btn.mapToGlobal(self.help_btn.rect().bottomRight())
        p.move(pos.x() - p.width(), pos.y() + 4)
        p.show()

    def _entry_files(self, entry):
        """File(s) this entry is associated with, for Find Previous matching —
        prefers the snapshot's file list, falls back to the target field."""
        snap = entry.get("snapshot")
        if snap and snap.get("files"):
            return {f["file"] for f in snap["files"]}
        t = entry.get("target", "")
        return {t} if t else set()

    def _make_options_widget(self, entry):
        w = QWidget()
        h = QHBoxLayout(w)
        h.setContentsMargins(4, 0, 4, 0)
        h.setSpacing(6)
        if entry.get("action") == "Revert":
            link = QToolButton()
            link.setIcon(svg_icon(SVG_VIEW_ORIGINAL, color=COLORS['teal']))
            link.setCursor(Qt.CursorShape.PointingHandCursor)
            link.setToolTip("View original — jump to and highlight the log entry this reverted.")
            target_id = entry.get("reverts_id")
            link.clicked.connect(lambda _, tid=target_id: self._jump_to_entry(tid))
            h.addWidget(link)
        else:
            already = entry.get("reverted_by") is not None
            has_snapshot = bool(entry.get("snapshot"))

            revert_btn = QToolButton()
            revert_btn.setIcon(svg_icon(SVG_REVERT, color=COLORS['blue']))
            revert_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            revert_btn.setToolTip(
                "Revert to this state — restores this file to exactly the state it "
                "was in AT this log entry (discards anything that happened to the "
                "file after it)."
                if has_snapshot else
                "This action type doesn't have revertible snapshot data.")
            later_exists = has_snapshot and self._has_later_change(entry)
            revert_btn.setEnabled(later_exists and not already)
            revert_btn.clicked.connect(lambda _, e=entry: self._revert_single(e))
            h.addWidget(revert_btn)

            revert_all_btn = QToolButton()
            revert_all_btn.setIcon(svg_icon(SVG_REVERT_ALL, color=COLORS['accent']))
            revert_all_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            revert_all_btn.setToolTip(
                "Revert All to this point — rolls back the ENTIRE repo to its state "
                "AS OF this log entry (every tracked file lands exactly where it was "
                "right after this entry happened).")
            revert_all_btn.setEnabled(not already)
            revert_all_btn.clicked.connect(lambda _, e=entry: self._revert_all_to(e))
            h.addWidget(revert_all_btn)

        find_prev_btn = QToolButton()
        find_prev_btn.setIcon(svg_icon(SVG_FIND_PREV, color=COLORS['text_dim']))
        find_prev_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        find_prev_btn.setToolTip("Find previous change — jump to and highlight the most recent earlier log entry for the same file.")
        find_prev_btn.clicked.connect(lambda _, e=entry: self._find_previous_change(e))
        h.addWidget(find_prev_btn)

        h.addStretch()
        return w

    def _find_previous_change(self, entry):
        my_files = self._entry_files(entry)
        if not my_files:
            return
        idx = next((i for i, e in enumerate(LOGGER.entries) if e["id"] == entry["id"]), None)
        if idx is None:
            return
        for e in reversed(LOGGER.entries[:idx]):
            if e.get("action") == "Revert":
                continue
            if self._entry_files(e) & my_files:
                self._jump_to_entry(e["id"])
                return
        self._set_hint("No earlier change found for this file.")

    def _set_hint(self, text):
        QMessageBox.information(self, "Find Previous Change", text)

    def _has_later_change(self, entry):
        """True if some later log entry touched the same file(s) as `entry`'s
        snapshot — i.e. there's actually something to undo. If nothing
        happened to the file since, this entry's state IS the current state
        and reverting to it would be a no-op."""
        snap = entry.get("snapshot")
        if not snap:
            return False
        my_files = {f["file"] for f in snap.get("files", [])}
        idx = next((i for i, e in enumerate(LOGGER.entries) if e["id"] == entry["id"]), None)
        if idx is None:
            return False
        for e in LOGGER.entries[idx + 1:]:
            s = e.get("snapshot")
            if not s:
                continue
            later_files = {f["file"] for f in s.get("files", [])}
            if my_files & later_files:
                return True
        return False

    def _jump_to_entry(self, entry_id):
        if not entry_id:
            return
        self.tab_filter.setCurrentIndex(0)
        self.search_filter.clear()
        self.refresh()
        for i, eid in enumerate(self._row_ids):
            if eid == entry_id:
                if i >= self._loaded:
                    self._load_more(i)
                self.table.selectRow(i)
                self.table.scrollToItem(self.table.item(i, 0))
                break

    # ---- confirmation flows ----
    def _confirm_two_stage(self, message, on_confirmed):
        r1 = QMessageBox(self)
        r1.setWindowTitle("Are you sure?")
        r1.setText(message)
        yes_btn = r1.addButton("Yes", QMessageBox.ButtonRole.YesRole)
        r1.addButton("By Mistake", QMessageBox.ButtonRole.NoRole)
        r1.exec()
        if r1.clickedButton() != yes_btn:
            return
        r2 = QMessageBox(self)
        r2.setWindowTitle("Really sure?")
        r2.setText("Last check — this writes a new Revert entry and rewrites file(s) on disk. Proceed?")
        yea_btn = r2.addButton("YEA", QMessageBox.ButtonRole.YesRole)
        r2.addButton("Nevermind", QMessageBox.ButtonRole.NoRole)
        r2.exec()
        if r2.clickedButton() != yea_btn:
            return
        on_confirmed()

    def _revert_single(self, entry):
        self._confirm_two_stage(
            f"Restore '{entry.get('target','')}' to its state AT this log entry "
            f"({entry.get('time','')})? Anything that happened to it after this entry will be lost.",
            lambda: self._do_revert_single(entry))

    def _do_revert_single(self, entry):
        results = []
        snap = entry.get("snapshot") or {}
        for f in snap.get("files", []):
            rel = f["file"]
            exists, content = compute_file_state_at(rel, entry["id"])
            results.append(apply_file_state(rel, exists, content))
        new_entry = LOGGER.log(entry.get("tab", "Logs"), "Revert", entry.get("target", ""),
                                "; ".join(results) or "Reverted", reverts_id=entry["id"])
        LOGGER.mark_reverted(entry["id"], new_entry["id"])
        self.main_window.refresh_all()
        self.refresh()

    def _revert_all_to(self, entry):
        r1 = QMessageBox(self)
        r1.setWindowTitle("Are you sure?")
        r1.setText(f"Roll back the ENTIRE repo to its state AS OF "
                    f"'{entry.get('target','')}' ({entry.get('time','')})? Every tracked file will "
                    f"land exactly where it was right after that entry.")
        yes_btn = r1.addButton("Yes", QMessageBox.ButtonRole.YesRole)
        r1.addButton("By Mistake", QMessageBox.ButtonRole.NoRole)
        r1.exec()
        if r1.clickedButton() != yes_btn:
            return
        dlg = QInputDialog(self)
        dlg.setWindowTitle("Type to confirm")
        dlg.setLabelText("This rolls back every tracked file. Type exactly:\nYes revert to this point")
        dlg.setTextValue("")
        dlg.setOkButtonText("Confirm")
        dlg.setCancelButtonText("Nevermind")
        if dlg.exec() != QDialog.DialogCode.Accepted:
            return
        if dlg.textValue() != "Yes revert to this point":
            QMessageBox.warning(self, "No match", "Text didn't match exactly — repo NOT reverted.")
            return
        self._do_revert_all(entry)

    def _do_revert_all(self, entry):
        idx = next((i for i, e in enumerate(LOGGER.entries) if e["id"] == entry["id"]), None)
        if idx is None:
            return
        files = set()
        for e in LOGGER.entries:
            snap = e.get("snapshot")
            if snap:
                for f in snap.get("files", []):
                    files.add(f["file"])
        all_results = []
        for rel in sorted(files):
            exists, content = compute_file_state_at(rel, entry["id"])
            all_results.append(apply_file_state(rel, exists, content))
        superseded = [e for e in LOGGER.entries[idx + 1:]
                      if e.get("snapshot") and e.get("reverted_by") is None]
        new_entry = LOGGER.log(
            "Logs", "Revert", entry.get("target", ""),
            f"Rolled back repo to state as of this point ({len(files)} file(s) checked, "
            f"{len(superseded)} later change(s) superseded)",
            reverts_id=entry["id"])
        for e in superseded:
            LOGGER.mark_reverted(e["id"], new_entry["id"])
        self.main_window.refresh_all()
        self.refresh()

# ─────────────────────────────────────────────────────────────────────────
# Main window
# ─────────────────────────────────────────────────────────────────────────

class ClickAwayFilter(QObject):
    """Clears tree selections when the user clicks anywhere outside them."""
    def __init__(self, get_trees, on_click=None):
        super().__init__()
        self.get_trees = get_trees
        self.on_click = on_click

    def eventFilter(self, obj, ev):
        if ev.type() == QEvent.Type.MouseButtonPress and QApplication.activePopupWidget() is None:
            w = QApplication.widgetAt(ev.globalPosition().toPoint())
            gp = ev.globalPosition().toPoint()
            for t in self.get_trees():
                inside = w is not None and (w is t or t.isAncestorOf(w))
                if not inside:
                    t.clearSelection()
                elif w is t.viewport() and t.itemAt(t.viewport().mapFromGlobal(gp)) is None:
                    t.clearSelection()
            if self.on_click:
                self.on_click(w)
        return False


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("UnPro AIO")
        self.resize(1400, 880)
        self.setMinimumSize(420, 400)

        central = QWidget()
        self.setCentralWidget(central)
        root_v = QVBoxLayout(central)
        root_v.setContentsMargins(0, 0, 0, 0)
        root_v.setSpacing(0)

        # top bar: brand | tabs | root
        top = QWidget()
        top.setObjectName("TopBar")
        top_h = QHBoxLayout(top)
        top_h.setContentsMargins(16, 0, 16, 0)

        brand = QLabel("UnPro AIO")
        brand.setObjectName("BrandLabel")
        top_h.addWidget(brand)

        top_h.addSpacing(24)
        self.tab_buttons = {}
        tabs_row = QHBoxLayout()
        tabs_row.setSpacing(2)
        for name in ["Reader", "Rewriter", "Checklist", "Logs"]:
            btn = QPushButton(name)
            btn.setObjectName("TabBtn")
            btn.setProperty("active", "false")
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.clicked.connect(lambda checked, n=name: self.switch_tab(n))
            tabs_row.addWidget(btn)
            self.tab_buttons[name] = btn
        top_h.addLayout(tabs_row)
        top_h.addStretch()

        root_lbl = QLabel(f"Root — {BASE_DIR}")
        root_lbl.setObjectName("RootLabel")
        top_h.addWidget(root_lbl)
        self.root_lbl = root_lbl

        self.menu_btn = QToolButton()
        self.menu_btn.setText("☰")
        self.menu_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.menu_btn.setStyleSheet(f"QToolButton {{ color:{COLORS['accent']}; font-size:16pt; padding:2px 8px; }} QToolButton::menu-indicator {{ image: none; }}")
        self.menu_btn.clicked.connect(self._toggle_side)
        top_h.addWidget(self.menu_btn)

        top.setFixedHeight(48)
        root_v.addWidget(top)

        self.stack = QStackedWidget()
        root_v.addWidget(self.stack)

        self.reader_tab = ReaderTab(self)
        self.rewriter_tab = RewriterTab(self)
        self.checklist_tab = ChecklistTab(self)
        self.logs_tab = LogsTab(self)

        self.rewriter_tab.applied.connect(self.refresh_all)
        self._click_filter = ClickAwayFilter(lambda: [self.checklist_tab.tree,
                                                      self.checklist_tab.contrib_panel.tree,
                                                      self.checklist_tab.category_panel.tree], self._on_global_click)
        QApplication.instance().installEventFilter(self._click_filter)

        for w in [self.reader_tab, self.rewriter_tab, self.checklist_tab, self.logs_tab]:
            self.stack.addWidget(w)

        self._narrow = False
        self._side_open = True
        self._pref_open = True
        self.switch_tab("Reader")

    def switch_tab(self, name):
        index = {"Reader": 0, "Rewriter": 1, "Checklist": 2, "Logs": 3}[name]
        self.stack.setCurrentIndex(index)
        for n, btn in self.tab_buttons.items():
            btn.setProperty("active", "true" if n == name else "false")
            btn.style().unpolish(btn)
            btn.style().polish(btn)
        QTimer.singleShot(0, self._apply_side)
        if name == "Reader" and getattr(self, "_reader_dirty", False):
            self._flush_reader()
        if name == "Checklist":
            self.checklist_tab.reload_if_changed()

    def resizeEvent(self, event):
        super().resizeEvent(event)
        if not hasattr(self, "_pref_open"):
            return
        scr = self.screen()
        sw = scr.availableGeometry().width() if scr else 1920
        narrow = self.width() < sw * 0.6
        self.root_lbl.setVisible(not narrow)
        if narrow != self._narrow:
            self._narrow = narrow
            self._side_open = False if narrow else self._pref_open
        QTimer.singleShot(0, self._apply_side)

    def _toggle_side(self):
        self._side_open = not self._side_open
        if not self._narrow:
            self._pref_open = self._side_open
        self._apply_side()

    def _apply_side(self):
        for tab in (self.reader_tab, self.rewriter_tab, self.checklist_tab):
            side, split = tab.side, tab.main_split
            if self._narrow:
                tab._sized = False
                if side.parent() is not tab:
                    side.setParent(tab)
                w = max(side.minimumWidth(), min(420, tab.width() - 40))
                side.setGeometry(tab.width() - w, 0, w, tab.height())
                side.setVisible(self._side_open)
                side.raise_()
            else:
                fresh = side.parent() is not split or not getattr(tab, "_sized", False)
                if side.parent() is not split:
                    split.addWidget(side)
                side.setVisible(self._side_open)
                if fresh and self._side_open:
                    tab._sized = True
                    split.setStretchFactor(0, 4)
                    split.setStretchFactor(1, 1)
                    total = max(split.width(), 1000)
                    split.setSizes([int(total * 0.8), int(total * 0.2)])

    def _on_global_click(self, w):
        if not self._narrow or not self._side_open or w is self.menu_btn:
            return
        side = getattr(self.stack.currentWidget(), "side", None)
        if side is None:
            return
        if w is None or not (w is side or side.isAncestorOf(w)):
            self._side_open = False
            self._apply_side()

    def refresh_all(self):
        """Called after Rewriter applies changes (may have touched any file,
        including tooldata/checklist.json, rules.md, ignore.json)."""
        SCANNER.rescan()
        IGNORE_STORE.load()
        self._reader_dirty = True
        if self.stack.currentIndex() == 0:
            self._flush_reader()

    def _flush_reader(self):
        """Rebuilds the Reader tree only when it is visible; otherwise it is
        deferred until the Reader tab is next opened."""
        self._reader_dirty = False
        self.reader_tab.refresh()


def main():
    app = QApplication(sys.argv)
    app.setStyleSheet(QSS)
    LOGGER.start_watching()
    win = MainWindow()
    win.showMaximized()
    win.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()