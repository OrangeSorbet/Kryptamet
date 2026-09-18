import os
import json
import tkinter as tk
from tkinter import ttk, scrolledtext
import pyperclip

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ── file helpers ──────────────────────────────────────────────────────────────

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

def is_ignored(rel_path, patterns):
    import fnmatch
    parts = rel_path.replace("\\", "/").split("/")
    for pattern in patterns:
        pattern = pattern.rstrip("/")
        # match against each path component (folder names)
        for part in parts:
            if fnmatch.fnmatch(part, pattern):
                return True
        # match against full relative path
        if fnmatch.fnmatch(rel_path.replace("\\", "/"), pattern):
            return True
        if fnmatch.fnmatch(rel_path.replace("\\", "/"), f"**/{pattern}"):
            return True
    return False

def get_all_files():
    patterns = load_gitignore_patterns()
    files = []
    for root, dirs, fnames in os.walk(BASE_DIR):
        rel_root = os.path.relpath(root, BASE_DIR)
        # prune ignored dirs in-place so os.walk skips them
        dirs[:] = [
            d for d in dirs
            if not is_ignored(
                os.path.join(rel_root, d).replace("\\", "/").lstrip("./"),
                patterns
            ) and not d.startswith(".")
        ]
        for f in fnames:
            if f in ("FindAndModify.py", "output.txt"):
                continue
            abs_path = os.path.join(root, f)
            rel_path = os.path.relpath(abs_path, BASE_DIR)
            if not is_ignored(rel_path.replace("\\", "/"), patterns):
                files.append(rel_path)
    return sorted(files)

ALL_FILES = get_all_files()

def filter_files(query):
    q = query.lower()
    return [f for f in ALL_FILES if q in f.lower()]

# ── rewriter logic ────────────────────────────────────────────────────────────

def apply_changes_with_confirm(data):
    changes = data.get("changes", [])
    confirm_queue.clear()
    pending_results.clear()
    n_box = [0]

    def process_change(change, content_override=None):
        rel_path = change["file"].replace("/", os.sep).replace("\\", os.sep)
        abs_path = os.path.join(BASE_DIR, rel_path)
        edits = change.get("edits", [])
        content = content_override if content_override is not None else ""
        file_results = []
        for edit in edits:
            n_box[0] += 1
            find = edit["find"]
            replace = edit["replace"]
            if find not in content:
                file_results.append(f"  [{n_box[0]}] ⚠️  Pattern not found")
                continue
            count = content.count(find)
            if count > 1:
                file_results.append(f"  [{n_box[0]}] ⚠️  Found {count} times — skipping")
                continue
            content = content.replace(find, replace)
            file_results.append(f"  [{n_box[0]}] ✅ edit applied")
        with open(abs_path, "w", encoding="utf-8") as f:
            f.write(content)
        pending_results.append(f"📄 {rel_path}")
        pending_results.extend(file_results)

    remaining = list(changes)

    def process_next():
        while remaining:
            change = remaining.pop(0)
            rel_path = change["file"].replace("/", os.sep).replace("\\", os.sep)
            abs_path = os.path.join(BASE_DIR, rel_path)
            if not os.path.exists(abs_path):
                def make_decision(ch, ap):
                    def on_decision(create):
                        confirm_queue.pop(0)
                        if create:
                            os.makedirs(os.path.dirname(ap) or ".", exist_ok=True)
                            process_change(ch, "")
                        else:
                            pending_results.append(f"⏭️  Skipped: {ch['file']}")
                        process_next()
                    return on_decision
                confirm_queue.append((rel_path, change.get("edits", []), make_decision(change, abs_path)))
                show_next_confirm()
                return
            with open(abs_path, "r", encoding="utf-8") as f:
                content = f.read()
            process_change(change, content)
        show_next_confirm()  # finish

    process_next()

def apply_changes(data):
    # kept for compatibility, not used in UI anymore
    return []

# ── instructions ──────────────────────────────────────────────────────────────

READER_USER = '''How to use:
- Type to filter files by name or path
- Paste one or more relative paths, press Enter to select
- Shift+Enter = newline in search box
- Ctrl+Click / Shift+Click = multi-select
- Reset = clear selection
- Export → = copy to clipboard + write output.txt'''

READER_AI = f'''Root: {BASE_DIR}

Paste file paths to read (relative to root), one per line:
Input format:
```
path/to/file1.ext
path/to/file2.ext
path/to/file3.ext
```

Output format:
---
path/to/file.ts
---
<file contents, JSON-string-escaped>
---

Note: file contents are JSON-string-escaped (real newlines -> \\n,
real tabs -> \\t, literal backslashes -> \\\\). Copy substrings
directly as-is into "find"/"replace" fields in the Rewriter JSON —
do not re-escape them, they are already in the correct form.'''

REWRITER_USER = '''How to use:
- Paste the changes JSON from Claude into the left box
- Click Apply to write changes to files
- Output shows per-file and per-edit results
- Clear resets both boxes
- Each find must match exactly once or that edit is skipped
- Multiple edits to same file go in one edits array'''

REWRITER_AI = f'''Root: {BASE_DIR}

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
      "file": "another/file.ext",
      "edits": [
        {{
          "find": "something",
          "replace": "something else"
        }}
      ]
    }}
  ]
}}
```

Rules:
- \\n = newline, \\t = tab
- 4 spaces = 4 literal spaces
- find must match exactly once in the file
- file path uses / or \\\\ both work
- to delete: set replace to ""
- to insert: put surrounding context in find, include it in replace
- multiple edits per file go in the edits array'''

# ── root window ───────────────────────────────────────────────────────────────

root = tk.Tk()
root.title("FindAndModify")
root.configure(bg="#0f0f0f")
root.resizable(True, True)
try:
    root.state("zoomed")  # Windows/Linux (most window managers)
except tk.TclError:
    root.attributes("-zoomed", True)  # fallback for some Linux WMs

style = ttk.Style()
style.theme_use("clam")
style.configure("Export.TButton", background="#3b82f6", foreground="#fff",
                font=("Inter", 11, "bold"), padding=8, relief="flat")
style.map("Export.TButton", background=[("active", "#2563eb")])
style.configure("Tab.TFrame", background="#0f0f0f")

# ── shared right-panel builder ────────────────────────────────────────────────

def make_right_panel(parent, user_text, ai_text):
    right = tk.Frame(parent, bg="#111", width=280)
    right.pack(side="right", fill="y")
    right.pack_propagate(False)

    tk.Label(right, text="How to use", font=("Inter", 11, "bold"),
             bg="#111", fg="#aaa").pack(anchor="w", padx=14, pady=(16, 6))
    ub = tk.Text(right, bg="#111", fg="#666", font=("Inter", 9),
                 relief="flat", bd=0, wrap="word", highlightthickness=0)
    ub.insert("1.0", user_text)
    ub.config(state="disabled")
    ub.pack(fill="x", padx=14)

    tk.Frame(right, bg="#222", height=1).pack(fill="x", padx=14, pady=12)

    ai_header = tk.Frame(right, bg="#111")
    ai_header.pack(fill="x", padx=14)
    tk.Label(ai_header, text="AI Instructions", font=("Inter", 11, "bold"),
             bg="#111", fg="#aaa").pack(side="left")

    def copy_ai():
        root.clipboard_clear()
        root.clipboard_append(ai_text)
        btn.config(text="Copied!")
        root.after(1500, lambda: btn.config(text="Copy"))

    btn = tk.Button(ai_header, text="Copy", bg="#1a1a1a", fg="#888",
                    font=("Inter", 9), relief="flat", bd=0,
                    activebackground="#222", activeforeground="#ccc",
                    padx=8, pady=2, command=copy_ai)
    btn.pack(side="right")

    ab = tk.Text(right, bg="#111", fg="#555", font=("JetBrains Mono", 8),
                 relief="flat", bd=0, wrap="word", highlightthickness=0)
    ab.insert("1.0", ai_text)
    ab.config(state="disabled")
    ab.pack(fill="both", expand=True, padx=14, pady=(6, 14))

    return right

# ── tab bar ───────────────────────────────────────────────────────────────────

tab_bar = tk.Frame(root, bg="#0a0a0a")
tab_bar.pack(fill="x", side="top")

content = tk.Frame(root, bg="#0f0f0f")
content.pack(fill="both", expand=True)

reader_frame = tk.Frame(content, bg="#0f0f0f")
rewriter_frame = tk.Frame(content, bg="#0f0f0f")

def show_tab(name):
    if name == "reader":
        reader_frame.pack(fill="both", expand=True)
        rewriter_frame.pack_forget()
        tab_reader.config(bg="#0f0f0f", fg="#f0f0f0")
        tab_rewriter.config(bg="#0a0a0a", fg="#555")
    else:
        rewriter_frame.pack(fill="both", expand=True)
        reader_frame.pack_forget()
        tab_rewriter.config(bg="#0f0f0f", fg="#f0f0f0")
        tab_reader.config(bg="#0a0a0a", fg="#555")

tab_reader = tk.Button(tab_bar, text="Reader", font=("Inter", 10, "bold"),
                       relief="flat", bd=0, padx=20, pady=10,
                       command=lambda: show_tab("reader"))
tab_reader.pack(side="left")

tab_rewriter = tk.Button(tab_bar, text="Rewriter", font=("Inter", 10, "bold"),
                         relief="flat", bd=0, padx=20, pady=10,
                         command=lambda: show_tab("rewriter"))
tab_rewriter.pack(side="left")

tk.Label(tab_bar, text=f"Root: {BASE_DIR}", font=("Inter", 9),
         bg="#0a0a0a", fg="#444").pack(side="right", padx=16)

# ── reader tab ────────────────────────────────────────────────────────────────

reader_body = tk.Frame(reader_frame, bg="#0f0f0f")
reader_body.pack(fill="both", expand=True)

reader_left = tk.Frame(reader_body, bg="#0f0f0f")
reader_left.pack(side="left", fill="both", expand=True)

make_right_panel(reader_body, READER_USER, READER_AI)

# header
rh = tk.Frame(reader_left, bg="#0f0f0f")
rh.pack(fill="x", padx=20, pady=(20, 0))
tk.Label(rh, text="Reader", font=("Inter", 18, "bold"),
         bg="#0f0f0f", fg="#f0f0f0").pack(anchor="w")

# search
search_frame = tk.Frame(reader_left, bg="#1a1a1a")
search_frame.pack(fill="x", padx=20, pady=12)
search_var = tk.StringVar()
search_entry = tk.Text(search_frame, bg="#1a1a1a", fg="#e0e0e0",
                       insertbackground="#e0e0e0", font=("Inter", 12),
                       relief="flat", bd=0, height=3, wrap="none")
search_entry.pack(fill="x", padx=12, pady=10)

tk.Frame(reader_left, bg="#222", height=1).pack(fill="x", padx=20)

# listbox
list_frame = tk.Frame(reader_left, bg="#0f0f0f")
list_frame.pack(fill="both", expand=True, padx=20, pady=10)

scrollbar = tk.Scrollbar(list_frame, bg="#1a1a1a", troughcolor="#0f0f0f",
                         activebackground="#333", highlightthickness=0)
scrollbar.pack(side="right", fill="y")

file_map = {}
listbox = tk.Listbox(list_frame, selectmode="extended", yscrollcommand=scrollbar.set,
                     bg="#111", fg="#ccc", selectbackground="#3b82f6",
                     selectforeground="#fff", font=("JetBrains Mono", 10),
                     activestyle="none", relief="flat", bd=0, highlightthickness=0)
listbox.pack(side="left", fill="both", expand=True)
scrollbar.config(command=listbox.yview)

def refresh_list(*_):
    global file_map
    query = search_var.get()
    matches = filter_files(query)
    listbox.delete(0, "end")
    file_map = {}
    tree = {}
    for f in matches:
        parts = f.replace("\\", "/").split("/")
        folder = "/".join(parts[:-1]) if len(parts) > 1 else ""
        tree.setdefault(folder, []).append(f)
    idx = 0
    for folder in sorted(tree.keys()):
        if folder:
            listbox.insert("end", f"📁 {folder}/")
            listbox.itemconfig("end", fg="#666", selectbackground="#0f0f0f",
                               selectforeground="#666")
            idx += 1
        for f in sorted(tree[folder]):
            listbox.insert("end", f"{'    ' if folder else ''}{os.path.basename(f)}")
            file_map[idx] = f
            idx += 1
            listbox.itemconfig("end", foreground="#e0e0e0")

def on_search_enter(event):
    query = search_entry.get("1.0", "end-1c").strip()
    lines = [l.strip().replace("/", os.sep).replace("\\", os.sep)
             for l in query.splitlines() if l.strip()]
    if not lines:
        return
    found = []
    for line in lines:
        for idx, path in file_map.items():
            if path.replace("/", os.sep).replace("\\", os.sep) == line:
                listbox.selection_set(idx)
                listbox.see(idx)
                found.append(path)
                break
    if found:
        r_status_var.set(f"Selected: {len(found)} file(s)")
        r_status_label.config(fg="#3b82f6")
        search_entry.delete("1.0", "end")
    else:
        r_status_var.set(f"Path not found: {lines[0]}")
        r_status_label.config(fg="#ef4444")

def on_return(event):
    if not (event.state & 0x1):
        on_search_enter(event)
        return "break"

search_entry.bind("<Return>", on_return)
search_var.trace_add("write", refresh_list)
refresh_list()

def export():
    selected = [file_map[i] for i in listbox.curselection() if i in file_map]
    if not selected:
        r_status_var.set("No files selected")
        r_status_label.config(fg="#ef4444")
        root.after(2000, lambda: (r_status_var.set("Ready"), r_status_label.config(fg="#555")))
        return
    parts = []
    for rel in selected:
        abs_path = os.path.join(BASE_DIR, rel)
        try:
            with open(abs_path, "r", encoding="utf-8", errors="replace") as fh:
                content = fh.read()
            escaped = json.dumps(content)[1:-1]  # strip surrounding quotes
        except Exception as e:
            escaped = f"[Error reading file: {e}]"
        parts.append(f"---\n{rel}\n---\n{escaped}\n---")
    output = "\n\n".join(parts)
    with open(os.path.join(BASE_DIR, "output.txt"), "w", encoding="utf-8") as fh:
        fh.write(output)
    pyperclip.copy(output)
    listbox.selection_clear(0, "end")
    r_status_var.set(f"✓ Exported {len(selected)} file(s)")
    r_status_label.config(fg="#22c55e")
    root.after(3000, lambda: (r_status_var.set("Ready"), r_status_label.config(fg="#555")))

# footer
r_footer = tk.Frame(reader_left, bg="#0f0f0f")
r_footer.pack(fill="x", padx=20, pady=(0, 16))

r_status_var = tk.StringVar(value="Ready")
r_status_label = tk.Label(r_footer, textvariable=r_status_var, font=("Inter", 9),
                           bg="#0f0f0f", fg="#555")
r_status_label.pack(side="left")

tk.Button(r_footer, text="Reset", bg="#1a1a1a", fg="#888",
          font=("Inter", 10), relief="flat", bd=0,
          activebackground="#222", activeforeground="#ccc",
          command=lambda: listbox.selection_clear(0, "end")).pack(side="right", padx=(8, 0))

ttk.Button(r_footer, text="Export →", style="Export.TButton",
           command=export).pack(side="right")

# ── rewriter tab ──────────────────────────────────────────────────────────────

rewriter_body = tk.Frame(rewriter_frame, bg="#0f0f0f")
rewriter_body.pack(fill="both", expand=True)

rewriter_left = tk.Frame(rewriter_body, bg="#0f0f0f")
rewriter_left.pack(side="left", fill="both", expand=True)

make_right_panel(rewriter_body, REWRITER_USER, REWRITER_AI)

# Confirmation queue panel (below right panel, inside rewriter_body)
confirm_frame = tk.Frame(rewriter_body, bg="#0f0f0f")
# packed dynamically when needed

confirm_queue = []  # list of (rel_path, edits, on_decision)
pending_results = []

def show_next_confirm():
    for w in confirm_frame.winfo_children():
        w.destroy()
    if not confirm_queue:
        confirm_frame.pack_forget()
        # finish applying
        output_box.config(state="normal")
        output_box.delete("1.0", "end")
        output_box.insert("end", f"Done:\n\n")
        for r in pending_results:
            output_box.insert("end", r + "\n")
        output_box.config(state="disabled")
        return
    rel_path, edits, on_decision = confirm_queue[0]
    confirm_frame.pack(side="bottom", fill="x", padx=20, pady=(0, 8))
    tk.Label(confirm_frame, text=f"File not found: {rel_path}",
             font=("Inter", 9, "bold"), bg="#0f0f0f", fg="#f59e0b").pack(anchor="w")
    tk.Label(confirm_frame, text="Create new file or cancel this file?",
             font=("Inter", 9), bg="#0f0f0f", fg="#888").pack(anchor="w", pady=(2, 6))
    row = tk.Frame(confirm_frame, bg="#0f0f0f")
    row.pack(anchor="w")
    tk.Button(row, text="Create File", bg="#22c55e", fg="#fff",
              font=("Inter", 9, "bold"), relief="flat", bd=0,
              padx=10, pady=4,
              command=lambda: on_decision(True)).pack(side="left")
    tk.Button(row, text="Cancel", bg="#1a1a1a", fg="#888",
              font=("Inter", 9), relief="flat", bd=0,
              padx=10, pady=4,
              command=lambda: on_decision(False)).pack(side="left", padx=(8, 0))

def process_confirm_queue():
    if not confirm_queue:
        show_next_confirm()
        return
    rel_path, edits, on_decision = confirm_queue[0]
    show_next_confirm()

wh = tk.Frame(rewriter_left, bg="#0f0f0f")
wh.pack(fill="x", padx=20, pady=(20, 0))
tk.Label(wh, text="Rewriter", font=("Inter", 18, "bold"),
         bg="#0f0f0f", fg="#f0f0f0").pack(anchor="w")

tk.Label(rewriter_left, text="Paste changes JSON:", font=("Inter", 10),
         bg="#0f0f0f", fg="#888").pack(anchor="w", padx=20, pady=(16, 4))

input_box = scrolledtext.ScrolledText(rewriter_left, bg="#111", fg="#e0e0e0",
                                       insertbackground="#e0e0e0",
                                       font=("JetBrains Mono", 10),
                                       relief="flat", bd=0,
                                       highlightthickness=1,
                                       highlightbackground="#222")
input_box.pack(fill="both", expand=True, padx=20)

btn_row = tk.Frame(rewriter_left, bg="#0f0f0f")
btn_row.pack(fill="x", padx=20, pady=10)

def run():
    raw = input_box.get("1.0", "end-1c").strip()
    output_box.config(state="normal")
    output_box.delete("1.0", "end")
    output_box.config(state="disabled")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        output_box.config(state="normal")
        output_box.insert("end", f"❌ Invalid JSON:\n{e}")
        output_box.config(state="disabled")
        return
    apply_changes_with_confirm(data)

def clear():
    input_box.delete("1.0", "end")
    output_box.config(state="normal")
    output_box.delete("1.0", "end")
    output_box.config(state="disabled")

tk.Button(btn_row, text="Apply", bg="#3b82f6", fg="#fff",
          font=("Inter", 11, "bold"), relief="flat", bd=0,
          activebackground="#2563eb", activeforeground="#fff",
          padx=16, pady=6, command=run).pack(side="left")
tk.Button(btn_row, text="Clear", bg="#1a1a1a", fg="#888",
          font=("Inter", 10), relief="flat", bd=0,
          activebackground="#222", activeforeground="#ccc",
          padx=12, pady=6, command=clear).pack(side="left", padx=(8, 0))

tk.Label(rewriter_left, text="Output:", font=("Inter", 10),
         bg="#0f0f0f", fg="#888").pack(anchor="w", padx=20, pady=(0, 4))

output_box = scrolledtext.ScrolledText(rewriter_left, bg="#111", fg="#aaa",
                                        font=("JetBrains Mono", 10),
                                        relief="flat", bd=0, height=8,
                                        highlightthickness=1,
                                        highlightbackground="#222",
                                        state="disabled")
output_box.pack(fill="x", padx=20, pady=(0, 20))

# ── init ──────────────────────────────────────────────────────────────────────

show_tab("reader")
root.mainloop()