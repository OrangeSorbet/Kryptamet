#!/usr/bin/env python3
"""
UnPro AIO — single-file PyQt6 desktop tool.
Always lives in the project root. All persisted data lives in tooldata/.
"""
import os
import sys
import json
import uuid
import fnmatch
import subprocess
import datetime as _dt

from PyQt6.QtCore import Qt, QObject, pyqtSignal, QTimer
from PyQt6.QtGui import QFont, QColor, QIcon, QAction
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
# Logger — every CRUD action, append-only
# ─────────────────────────────────────────────────────────────────────────

class Logger(QObject):
    changed = pyqtSignal()

    def __init__(self):
        super().__init__()
        self.entries = []
        self._load()

    def _load(self):
        self.entries = []
        if os.path.exists(LOGS_JSONL):
            with open(LOGS_JSONL, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        self.entries.append(json.loads(line))
                    except Exception:
                        pass

    def log(self, tab, action, target, details=""):
        entry = {
            "time": now_iso(),
            "tab": tab,
            "action": action,
            "target": target,
            "details": details,
        }
        self.entries.append(entry)
        with open(LOGS_JSONL, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
        self.changed.emit()

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
                        if not (p == relpath or p.startswith(relpath + "/"))}
        self.marked.add(relpath)
        self.save()

    def set_none(self, relpath, raw_children_fn):
        """Unmark relpath. Handles both inherited-ancestor case (split)
        and direct-descendant case (clear subtree)."""
        relpath = to_posix(relpath)
        parts = relpath.split("/")
        found = None
        for i in range(len(parts), 0, -1):
            candidate = "/".join(parts[:i])
            if candidate in self.marked:
                found = candidate
                break
        if found is not None:
            self.marked.discard(found)
            if found != relpath:
                cur = found
                cur_parts = found.split("/")
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
                            if not (p == relpath or p.startswith(relpath + "/"))}
        self.save()

    def state(self, relpath, raw_children_fn):
        """Returns 'full' | 'partial' | 'none' for a node, computed dynamically."""
        relpath = to_posix(relpath)
        if self.is_marked(relpath):
            return "full"
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

        def walk(abs_dir, rel_dir):
            try:
                entries = sorted(os.listdir(abs_dir))
            except Exception:
                return []
            kids = []
            for name in entries:
                if name.startswith("."):
                    continue
                if name == SELF_NAME or name == "output.txt":
                    continue
                abs_p = os.path.join(abs_dir, name)
                rel_p = to_posix(os.path.join(rel_dir, name)) if rel_dir else name
                if os.path.isdir(abs_p):
                    if name in EXCLUDE_DIRNAMES:
                        continue
                    self.is_dir[rel_p] = True
                    kids.append(rel_p)
                    self.raw_children[rel_p] = walk(abs_p, rel_p)
                else:
                    self.is_dir[rel_p] = False
                    kids.append(rel_p)
            return kids

        self.raw_children[""] = walk(BASE_DIR, "")

    def children_raw(self, relpath):
        return self.raw_children.get(to_posix(relpath), [])

    def effective_ignored(self, relpath):
        return IGNORE_STORE.is_marked(relpath)

    def all_files_filtered(self):
        """Flat list of file relpaths, respecting gitignore + ignore store."""
        out = []
        def walk(relpath):
            for child in self.raw_children.get(relpath, []):
                if self.effective_ignored(child):
                    continue
                if self.is_dir.get(child):
                    walk(child)
                else:
                    out.append(child)
        walk("")
        return sorted(out)

    def filtered_children(self, relpath):
        kids = self.raw_children.get(to_posix(relpath), [])
        return [k for k in kids if not self.effective_ignored(k)]

    def gitignore_children(self, relpath):
        """Children after .gitignore only (keeps tooldata-ignore.json marked
        items visible so they can be toggled/dulled in the tree)."""
        kids = self.raw_children.get(to_posix(relpath), [])
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
                os.remove(abs_path)
                self.results.append(f"🗑️  {rel_path} — deleted")
                LOGGER.log("Rewriter", "delete", rel_path, "")
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
            self.results.append(f"🆕 {rel_path} — created")
            LOGGER.log("Rewriter", "create", rel_path, f"{len(content)} chars")
            self._process_next_change()
            return

        # normal edit path — validated to exist already
        with open(abs_path, "r", encoding="utf-8") as f:
            content = f.read()
        self._edit_ctx = {"rel_path": rel_path, "abs_path": abs_path, "content": content,
                           "edits": list(change.get("edits", [])), "n": 0, "touched": False}
        self.results.append(f"📄 {rel_path}")
        self._process_next_edit()

    def _process_next_edit(self):
        ctx = self._edit_ctx
        if not ctx["edits"]:
            if ctx["touched"]:
                with open(ctx["abs_path"], "w", encoding="utf-8") as f:
                    f.write(ctx["content"])
                LOGGER.log("Rewriter", "edit", ctx["rel_path"], f"{ctx['n']} edit(s)")
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

QSS = f"""
QWidget {{
    background: {COLORS['bg']};
    color: {COLORS['text']};
    font-family: {FONT_FAMILY};
    font-size: 10pt;
}}
QMainWindow {{ background: {COLORS['bg']}; }}

#TopBar {{ background: {COLORS['bg_alt']}; border-bottom: 1px solid {COLORS['border']}; }}
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
    color: {COLORS['text_dim']};
    font-weight: 700;
    padding: 4px;
}}
QToolButton:hover {{ color: {COLORS['accent']}; }}

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
    def __init__(self, title, content_widget, start_open=True):
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
        return sum(1 for f in SCANNER.all_files_filtered() if SELECT_STORE.is_marked(f))

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

        select_cb = TriCheckBox()
        select_cb.setObjectName("SelectCheck")
        select_cb.setTristate(True)
        select_cb.stateChanged.connect(lambda _st, p=path: self._on_select_toggled(p))
        h.addWidget(select_cb)

        icon = "📁" if is_dir else "📄"
        label = ClickableLabel(f"{icon} {name}")
        label.clicked.connect(lambda p=path: self._on_label_clicked(p))
        if not is_dir:
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
                    has_child = add_children(item, child)
                    if not has_child and q:
                        continue
                    any_added = True
                else:
                    if not matches(child):
                        continue
                    any_added = True
                if parent_item is None:
                    self.tree.addTopLevelItem(item)
                else:
                    parent_item.addChild(item)
                row, ignore_cb, select_cb, label = self._make_row_widget(child, is_dir, name)
                self.tree.setItemWidget(item, 0, row)
                self._rows[child] = {"item": item, "ignore_cb": ignore_cb,
                                      "select_cb": select_cb, "label": label, "is_dir": is_dir}
            return any_added

        add_children(None, "")
        self._refresh_states()
        if q:
            n_files = sum(1 for r in self._rows.values() if not r["is_dir"])
            self._set_status(f"Found: {n_files} file(s)", "StatusInfo")
        if q:
            self.tree.expandAll()
        self._updating = False

    def _refresh_states(self):
        self._updating = True
        state_map = {"full": Qt.CheckState.Checked, "partial": Qt.CheckState.PartiallyChecked,
                     "none": Qt.CheckState.Unchecked}
        for path, row in self._rows.items():
            ist = IGNORE_STORE.state(path, SCANNER.children_raw)
            sst = SELECT_STORE.state(path, SCANNER.children_raw)
            row["ignore_cb"].blockSignals(True)
            row["ignore_cb"].setCheckState(state_map[ist])
            row["ignore_cb"].blockSignals(False)
            row["select_cb"].blockSignals(True)
            row["select_cb"].setCheckState(state_map[sst])
            row["select_cb"].blockSignals(False)
            if ist == "full":
                row["label"].setStyleSheet(f"color:{COLORS['text_faint']};")
            elif ist == "partial":
                row["label"].setStyleSheet(f"color:{COLORS['text_dim']};")
            else:
                row["label"].setStyleSheet(f"color:{COLORS['text']};")
        self._updating = False
        n_sel = self._selected_count()
        if n_sel:
            self._set_status(f"Selected: {n_sel} file(s)", "StatusInfo")
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
            if line in self._rows:
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
        selected = [f for f in SCANNER.all_files_filtered() if SELECT_STORE.is_marked(f)]
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
        LOGGER.log("Reader", "export", f"{len(selected)} file(s)", ", ".join(selected))

    def _show_copy_structure_menu(self):
        menu = QMenu(self)
        options = [
            ("Copy Selected Structure", "selected"),
            ("Copy Non Ignored Folders", "nonignored_folders"),
            ("Copy Non Ignored Folders+Files", "nonignored_folders_files"),
            ("Copy Ignored Folders", "ignored_folders"),
            ("Copy Ignored Folders+Files", "ignored_folders_files"),
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
        apply_btn = QPushButton("Apply")
        apply_btn.setObjectName("Primary")
        apply_btn.clicked.connect(self.run)
        btn_row.addWidget(apply_btn)
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

        splitter.addWidget(right)
        splitter.setStretchFactor(0, 3)
        splitter.setStretchFactor(1, 2)

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
    return data

def save_checklist(data):
    with open(CHECKLIST_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

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


# ─────────────────────────────────────────────────────────────────────────
# Task edit dialog
# ─────────────────────────────────────────────────────────────────────────

class NodeEditDialog(QDialog):
    def __init__(self, node, statuses, contributors, categories, parent=None):
        super().__init__(parent)
        self.node = node
        self.setWindowTitle("Edit item")
        self.setMinimumWidth(420)
        form = QFormLayout(self)

        self.title_edit = QLineEdit(node["title"])
        form.addRow("Title", self.title_edit)

        self.type_combo = QComboBox()
        self.type_combo.addItems(["heading", "task"])
        self.type_combo.setCurrentText(node["type"])
        form.addRow("Type", self.type_combo)

        self.category_edit = QComboBox()
        self.category_edit.setEditable(True)
        self.category_edit.addItems(categories)
        self.category_edit.setCurrentText(node.get("category", ""))
        form.addRow("Category", self.category_edit)

        self.subcategory_edit = QComboBox()
        self.subcategory_edit.setEditable(True)
        self.subcategory_edit.addItems(categories)
        self.subcategory_edit.setCurrentText(node.get("subcategory", ""))
        form.addRow("Subcategory", self.subcategory_edit)

        self.contributor_edit = QComboBox()
        self.contributor_edit.setEditable(True)
        self.contributor_edit.addItems(contributors)
        self.contributor_edit.setCurrentText(node.get("contributor", ""))
        form.addRow("Contributor", self.contributor_edit)

        self.status_combo = QComboBox()
        self.status_combo.addItems(statuses)
        if node.get("status", "Todo") not in statuses:
            self.status_combo.addItem(node.get("status", "Todo"))
        self.status_combo.setCurrentText(node.get("status", "Todo"))
        form.addRow("Status", self.status_combo)

        self.desc_edit = QPlainTextEdit(node.get("description", ""))
        self.desc_edit.setFixedHeight(90)
        form.addRow("Description", self.desc_edit)

        meta = QLabel(f"Created: {node.get('created_at','-')}   "
                       f"Updated: {node.get('updated_at','-')}   "
                       f"Completed: {node.get('completed_at') or '-'}")
        meta.setObjectName("Dim")
        form.addRow(meta)

        btn_row = QHBoxLayout()
        save_btn = QPushButton("Save")
        save_btn.setObjectName("Primary")
        save_btn.clicked.connect(self.accept)
        cancel_btn = QPushButton("Cancel")
        cancel_btn.setObjectName("Ghost")
        cancel_btn.clicked.connect(self.reject)
        btn_row.addStretch()
        btn_row.addWidget(cancel_btn)
        btn_row.addWidget(save_btn)
        form.addRow(btn_row)

    def apply_to_node(self):
        n = self.node
        old_status = n.get("status")
        n["title"] = self.title_edit.text().strip() or n["title"]
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

class SimpleListCrudPanel(QWidget):
    """Flat list CRUD (used for Contributors and Statuses)."""
    changed = pyqtSignal()

    def __init__(self, items_ref, log_label, min_items=None):
        super().__init__()
        self.items_ref = items_ref  # list, mutated in place
        self.log_label = log_label
        self.min_items = min_items or 0
        v = QVBoxLayout(self)
        v.setContentsMargins(8, 8, 8, 8)
        self.list_widget = QListWidget()
        v.addWidget(self.list_widget)
        row = QHBoxLayout()
        add_btn = QPushButton("+ Add"); add_btn.setObjectName("Create")
        add_btn.clicked.connect(self.add_item)
        ren_btn = QPushButton("Rename"); ren_btn.setObjectName("Ghost")
        ren_btn.clicked.connect(self.rename_item)
        del_btn = QPushButton("Delete"); del_btn.setObjectName("Danger")
        del_btn.clicked.connect(self.delete_item)
        row.addWidget(add_btn); row.addWidget(ren_btn); row.addWidget(del_btn)
        v.addLayout(row)
        self.rebuild()

    def rebuild(self):
        self.list_widget.clear()
        for name in self.items_ref:
            self.list_widget.addItem(QListWidgetItem(name))

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
        r = QMessageBox.question(self, "Delete", f"Delete '{name}'?")
        if r == QMessageBox.StandardButton.Yes:
            self.items_ref.remove(name)
            LOGGER.log("Checklist", "delete", self.log_label, name)
            self.rebuild()
            self.changed.emit()


class CategoriesCrudPanel(QWidget):
    """Infinite nested CRUD tree (used for Category / Subcategory reference list)."""
    changed = pyqtSignal()

    def __init__(self, categories_ref):
        super().__init__()
        self.categories_ref = categories_ref  # list of ref-nodes, mutated in place
        v = QVBoxLayout(self)
        v.setContentsMargins(8, 8, 8, 8)
        hint = QLabel("Right-click to add/rename/delete. Infinite nesting.")
        hint.setObjectName("Dim")
        v.addWidget(hint)
        self.tree = QTreeWidget()
        self.tree.setHeaderHidden(True)
        self.tree.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.tree.customContextMenuRequested.connect(self._on_context_menu)
        v.addWidget(self.tree)
        row = QHBoxLayout()
        add_btn = QPushButton("+ Add top-level"); add_btn.setObjectName("Create")
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
        add_top_act = menu.addAction("+ Add top-level")
        add_child_act = menu.addAction("+ Add child") if item else None
        rename_act = menu.addAction("Rename") if item else None
        delete_act = menu.addAction("Delete (+children)") if item else None
        action = menu.exec(self.tree.viewport().mapToGlobal(pos))
        if action is None:
            return
        if action == add_top_act:
            self.add_top()
            return
        node_id = item.data(0, Qt.ItemDataRole.UserRole) if item else None
        node, parent = find_node_and_parent(self.categories_ref, node_id) if item else (None, None)
        if action == add_child_act and node is not None:
            text, ok = QInputDialog.getText(self, "Add child", "Name:")
            text = text.strip()
            if ok and text:
                node["children"].append(new_ref_node(text))
                LOGGER.log("Checklist", "create", "category", f"{text} under {node['name']}")
                self.rebuild(); self.changed.emit()
        elif action == rename_act and node is not None:
            text, ok = QInputDialog.getText(self, "Rename", "Name:", text=node["name"])
            text = text.strip()
            if ok and text:
                old = node["name"]
                node["name"] = text
                LOGGER.log("Checklist", "update", "category", f"{old} -> {text}")
                self.rebuild(); self.changed.emit()
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

HEADING_SIZES = [19, 16, 14, 12]  # by depth, clamped
KANBAN_MAX_COLS = 5

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

        self.stack = QStackedWidget()
        v.addWidget(self.stack)

        # nested view
        self.tree = QTreeWidget()
        self.tree.setHeaderHidden(True)
        self.tree.setAlternatingRowColors(True)
        self.tree.itemChanged.connect(self._on_item_changed)
        self.tree.itemDoubleClicked.connect(self._on_double_click)
        self.tree.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.tree.customContextMenuRequested.connect(self._on_context_menu)
        self.stack.addWidget(self.tree)

        # kanban view — responsive grid, scrollable, max 5 columns
        self.kanban_scroll = QScrollArea()
        self.kanban_scroll.setWidgetResizable(True)
        self.kanban_inner = QWidget()
        self.kanban_grid = None  # QGridLayout, (re)built in _build_kanban_columns
        self.kanban_scroll.setWidget(self.kanban_inner)
        self.kanban_lists = {}
        self.stack.addWidget(self.kanban_scroll)

        splitter.addWidget(left)

        # ---- right: meta panel — Contributors / Categories / Statuses ----
        right = QSplitter(Qt.Orientation.Vertical)
        right.setMinimumWidth(300)
        right.setMaximumWidth(480)

        self.contrib_panel = SimpleListCrudPanel(self.data["contributors"], "contributor")
        self.contrib_panel.changed.connect(self._on_meta_changed)
        right.addWidget(CollapsibleBox("CONTRIBUTORS", self.contrib_panel, start_open=True))

        self.category_panel = CategoriesCrudPanel(self.data["categories"])
        self.category_panel.changed.connect(self._on_meta_changed)
        right.addWidget(CollapsibleBox("CATEGORIES", self.category_panel, start_open=True))

        self.status_panel = SimpleListCrudPanel(self.data["statuses"], "status", min_items=1)
        self.status_panel.changed.connect(self._on_meta_changed)
        right.addWidget(CollapsibleBox("STATUSES", self.status_panel, start_open=True))

        splitter.addWidget(right)
        splitter.setStretchFactor(0, 3)
        splitter.setStretchFactor(1, 2)

        self._updating = False
        self._build_kanban_columns()
        self.rebuild()

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

    def reload(self):
        self.data = load_checklist()
        self.contrib_panel.items_ref = self.data["contributors"]
        self.contrib_panel.rebuild()
        self.category_panel.categories_ref = self.data["categories"]
        self.category_panel.rebuild()
        self.status_panel.items_ref = self.data["statuses"]
        self.status_panel.rebuild()
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
                    item.setCheckState(0, Qt.CheckState.Checked if n["status"] == "Done" else Qt.CheckState.Unchecked)
                    color = COLORS["green"] if n["status"] == "Done" else COLORS["text"]
                    item.setForeground(0, QColor(color))
                item.setData(0, Qt.ItemDataRole.UserRole, n["id"])
                if parent_item is None:
                    self.tree.addTopLevelItem(item)
                else:
                    parent_item.addChild(item)
                add(n["children"], item, depth + 1)

        add(self.data["nodes"], None, 0)
        self.tree.expandAll()
        self._updating = False

    def _on_item_changed(self, item, col):
        if self._updating:
            return
        node_id = item.data(0, Qt.ItemDataRole.UserRole)
        node, _ = find_node_and_parent(self.data["nodes"], node_id)
        if not node or node["type"] != "task":
            return
        done = item.checkState(0) == Qt.CheckState.Checked
        statuses = self.statuses()
        node["status"] = "Done" if (done and "Done" in statuses) else ("Todo" if not done else node["status"])
        node["completed_at"] = now_iso() if done else None
        node["updated_at"] = now_iso()
        self.save()
        LOGGER.log("Checklist", "status_change", node["title"], node["status"])
        self._rebuild_tree()

    def _on_double_click(self, item, col):
        node_id = item.data(0, Qt.ItemDataRole.UserRole)
        node, _ = find_node_and_parent(self.data["nodes"], node_id)
        if not node:
            return
        self._edit_node(node)

    def _edit_node(self, node):
        dlg = NodeEditDialog(node, self.statuses(), self.data["contributors"],
                              flatten_ref_names(self.data["categories"]), self)
        if dlg.exec():
            dlg.apply_to_node()
            self.save()
            LOGGER.log("Checklist", "update", node["title"], "")
            self.rebuild()

    def _on_context_menu(self, pos):
        item = self.tree.itemAt(pos)
        menu = QMenu(self)
        add_h_top = menu.addAction("+ Add top-level heading")
        add_t_top = menu.addAction("+ Add top-level task")
        node_id = item.data(0, Qt.ItemDataRole.UserRole) if item else None
        add_h_child = menu.addAction("+ Add child heading") if item else None
        add_t_child = menu.addAction("+ Add child task") if item else None
        edit_act = menu.addAction("Edit") if item else None
        delete_act = menu.addAction("Delete (+children)") if item else None

        action = menu.exec(self.tree.viewport().mapToGlobal(pos))
        if action is None:
            return
        if action == add_h_top:
            self.data["nodes"].append(new_node("New Phase", "heading"))
            self.save(); self.rebuild(); return
        if action == add_t_top:
            self.data["nodes"].append(new_node("New Task", "task"))
            self.save(); self.rebuild(); return
        node, parent = (None, None)
        if item:
            node, parent = find_node_and_parent(self.data["nodes"], node_id)
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
        scrollable as a whole."""
        old = self.kanban_inner.layout()
        if old is not None:
            while old.count():
                w = old.takeAt(0).widget()
                if w:
                    w.deleteLater()
            QWidget().setLayout(old)  # detach old layout
        grid = QGridLayout()
        self.kanban_inner.setLayout(grid)
        self.kanban_grid = grid
        self.kanban_lists = {}

        statuses = self.statuses()
        cols = min(KANBAN_MAX_COLS, max(1, len(statuses)))
        for i, status in enumerate(statuses):
            r, c = divmod(i, cols)
            col_w = QWidget()
            colv = QVBoxLayout(col_w)
            lbl = QLabel(status)
            lbl.setStyleSheet(f"font-weight:800; color:{COLORS['accent']};")
            colv.addWidget(lbl)
            lst = QListWidget()
            lst.setMinimumWidth(220)
            lst.setMinimumHeight(260)
            lst.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
            lst.customContextMenuRequested.connect(
                lambda pos, s=status, w=lst: self._kanban_context_menu(pos, s, w))
            lst.itemDoubleClicked.connect(self._kanban_double_click)
            colv.addWidget(lst)
            self.kanban_lists[status] = lst
            grid.addWidget(col_w, r, c)

    def _rebuild_kanban(self):
        for lst in self.kanban_lists.values():
            lst.clear()
        statuses = self.statuses()
        fallback = statuses[0] if statuses else "Todo"
        for node, trail in flatten_tasks(self.data["nodes"]):
            crumb = " / ".join(trail[-2:]) if trail else ""
            label = node["title"] + (f"\n{crumb}" if crumb else "")
            item = QListWidgetItem(label)
            item.setData(Qt.ItemDataRole.UserRole, node["id"])
            self.kanban_lists.get(node["status"], self.kanban_lists.get(fallback)).addItem(item)

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
            node["status"] = new_status
            node["updated_at"] = now_iso()
            node["completed_at"] = now_iso() if new_status == "Done" else None
            self.save()
            LOGGER.log("Checklist", "status_change", node["title"], new_status)
            self._rebuild_kanban()

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
        v = QVBoxLayout(self)
        header = QHBoxLayout()
        title = QLabel("Logs")
        title.setObjectName("SectionTitle")
        header.addWidget(title)
        header.addStretch()
        v.addLayout(header)

        filt_row = QHBoxLayout()
        self.tab_filter = QComboBox()
        self.tab_filter.addItems(["All tabs", "Reader", "Rewriter", "Checklist"])
        self.tab_filter.currentIndexChanged.connect(self.refresh)
        filt_row.addWidget(self.tab_filter)

        self.search_filter = QLineEdit()
        self.search_filter.setPlaceholderText("Filter by action / target / details…")
        self.search_filter.textChanged.connect(self.refresh)
        filt_row.addWidget(self.search_filter)
        v.addLayout(filt_row)

        self.table = QTableWidget(0, 4)
        self.table.setHorizontalHeaderLabels(["Time", "Tab", "Action", "Target / Details"])
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeMode.Stretch)
        self.table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.table.setAlternatingRowColors(True)
        v.addWidget(self.table)

        note = QLabel("Append-only audit log. Every action across every tab is recorded here and cannot be edited or deleted from within the app.")
        note.setObjectName("Dim")
        note.setWordWrap(True)
        v.addWidget(note)

        LOGGER.changed.connect(self.refresh)
        self.refresh()

    def refresh(self):
        tab_f = self.tab_filter.currentText()
        text_f = self.search_filter.text().lower().strip()
        rows = list(reversed(LOGGER.entries))
        if tab_f != "All tabs":
            rows = [r for r in rows if r.get("tab") == tab_f]
        if text_f:
            rows = [r for r in rows if text_f in json.dumps(r).lower()]
        self.table.setRowCount(len(rows))
        for i, r in enumerate(rows):
            self.table.setItem(i, 0, QTableWidgetItem(r.get("time", "")))
            self.table.setItem(i, 1, QTableWidgetItem(r.get("tab", "")))
            self.table.setItem(i, 2, QTableWidgetItem(r.get("action", "")))
            detail = r.get("target", "")
            if r.get("details"):
                detail += "  —  " + r["details"]
            self.table.setItem(i, 3, QTableWidgetItem(detail))

# ─────────────────────────────────────────────────────────────────────────
# Main window
# ─────────────────────────────────────────────────────────────────────────

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("UnPro AIO")
        self.resize(1400, 880)

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

        top.setFixedHeight(48)
        root_v.addWidget(top)

        self.stack = QStackedWidget()
        root_v.addWidget(self.stack)

        self.reader_tab = ReaderTab(self)
        self.rewriter_tab = RewriterTab(self)
        self.checklist_tab = ChecklistTab(self)
        self.logs_tab = LogsTab(self)

        self.rewriter_tab.applied.connect(self.refresh_all)

        for w in [self.reader_tab, self.rewriter_tab, self.checklist_tab, self.logs_tab]:
            self.stack.addWidget(w)

        self.switch_tab("Reader")

    def switch_tab(self, name):
        index = {"Reader": 0, "Rewriter": 1, "Checklist": 2, "Logs": 3}[name]
        self.stack.setCurrentIndex(index)
        for n, btn in self.tab_buttons.items():
            btn.setProperty("active", "true" if n == name else "false")
            btn.style().unpolish(btn)
            btn.style().polish(btn)
        if name == "Checklist":
            self.checklist_tab.reload()

    def refresh_all(self):
        """Called after Rewriter applies changes (may have touched any file,
        including tooldata/checklist.json, rules.md, ignore.json)."""
        SCANNER.rescan()
        IGNORE_STORE.load()
        self.reader_tab.refresh()
        self.checklist_tab.reload()


def main():
    app = QApplication(sys.argv)
    app.setStyleSheet(QSS)
    win = MainWindow()
    win.showMaximized()
    win.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()