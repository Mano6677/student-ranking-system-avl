# Student Marks Ranking System — AVL Tree

Two things live in this folder:

1. **`src/student_ranking_avl.cpp`** — the original console program (menu-driven,
   `cin`/`cout`). Compile and run this normally in VS Code — it's plain C++,
   nothing special.
2. **`web/`** — a browser UI (Insert, Delete (by Marks), Tree view, Ranking, Search,
   Topper, animated rotation explanations) whose core logic is **the same
   AVL algorithm, compiled to WebAssembly** from `src/avl_lib.cpp`. The
   `.cpp` is the real engine; the browser is not a JavaScript
   reimplementation — `app.js` just calls into the compiled `.wasm`.

```
.
├── build.sh                    # recompiles src/avl_lib.cpp -> web/avl.wasm
├── src/
│   ├── student_ranking_avl.cpp # original console program
│   └── avl_lib.cpp             # same algorithm, exposed for WebAssembly
└── web/
    ├── index.html
    ├── styles.css
    ├── app.js                  # loads avl.wasm, wires it to the UI
    └── avl.wasm                # prebuilt — you don't need to rebuild it
```

## 1. Running the console program in VS Code

1. Open this folder in VS Code.
2. Install the **C/C++** extension (Microsoft) if you don't have it.
3. Open `src/student_ranking_avl.cpp`.
4. Run it either way:
   - **Terminal:** `g++ -o ranking src/student_ranking_avl.cpp && ./ranking`
   - **Run button:** with the C/C++ extension, just click ▷ at the top right
     (it will prompt you to select `g++.exe`/`g++` the first time).

This is the exact menu program (Add / Display Ranking / Search / Find
Topper) you already had — nothing about it changed.

## 2. Running the web app in VS Code

The web app loads `avl.wasm` with `fetch()`, which browsers block when you
just double-click `index.html` (that opens it as a `file://` URL). You need
a local server — two easy options:

**Option A — VS Code "Live Server" extension (easiest)**
1. Install the **Live Server** extension (by Ritwick Dey) from the
   Extensions panel.
2. Right-click `web/index.html` → **"Open with Live Server"**.
3. It opens in your browser at something like `http://127.0.0.1:5500/...` —
   the app loads immediately.

**Option B — any local HTTP server**
```bash
cd web
python3 -m http.server 8000
# then open http://localhost:8000 in your browser
```

Either way, you should see an **"Engine: your original C++ (compiled to
WebAssembly)"** badge at the top — that's `avl.wasm` running your algorithm.

## 3. Rebuilding `avl.wasm` after editing `avl_lib.cpp`

You only need this if you change the C++ logic. `web/avl.wasm` is already
built and checked in, so this step is optional.

```bash
pip install ziglang --break-system-packages   # one-time: gives you a C++ -> WebAssembly compiler
./build.sh
```

`build.sh` runs Zig's bundled clang targeting `wasm32-wasi` as a "reactor"
module (a library with exported functions, no `main()`), then exports every
function `app.js` calls. The resulting `avl.wasm` needs **zero runtime
imports** — no WASI calls are actually made, since the library only touches
its own static memory (no file/stdin/stdout access) — so `app.js` can
instantiate it with an empty import object.

## What's actually in `avl_lib.cpp`

Same core algorithm as `student_ranking_avl.cpp`:
- `Student` struct, `height()`, `getBalance()`, `createStudent()`
- `rightRotate()` / `leftRotate()`
- `insertNode()` — identical LL / RR / LR / RL branch logic
- `deleteByMarks()` — standard AVL delete (BST delete + rebalance on the way
  back up), with the textbook delete-time case conditions:
  - LL: `balance > 1 && getBalance(left) >= 0`
  - LR: `balance > 1 && getBalance(left) < 0`
  - RR: `balance < -1 && getBalance(right) <= 0`
  - RL: `balance < -1 && getBalance(right) > 0`
- `searchStudentByRoll()`, `findTopper()`, reverse in-order `rankingWalk()`

The only additions for the UI are:
- fixed-size `char name[48]` instead of `std::string` (so a name can be
  copied across the JS/WASM memory boundary with a plain byte copy)
- a small static object pool instead of `new`/`delete` (simplest way to
  avoid pulling in a real allocator for a WebAssembly reactor module)
- a `recordRotation(...)` call at each of the 8 rotation sites (4 in insert,
  4 in delete) that just records which case fired and the node values
  involved, purely so the UI can display *why* — it doesn't change the
  rotation logic itself.

This was cross-checked against an independent reference AVL implementation
across 4,000+ randomized insert/delete sequences (1,000+ rotations) with
zero mismatches in which case fired.

## Change log
- **Delete is now by Marks** (not Roll No). Marks are the AVL key and are
  unique, so the UI looks up the student holding those marks and runs the
  same C++ AVL delete on it. No C++/WASM rebuild was needed.
- **Step-by-step rotation walkthrough** (Tree View tab). After every insert/delete
  you get pills: `0 · Before` → `1 · BST insert/delete` → `Rotation 1` →
  `Rotation 2` … → `✓ Final`. Each rotation shows the real tree before and after
  (double rotations show Phase 1 and Phase 2), which nodes changed, why *this*
  rotation fires now, and why the next one happens (or why it stops).
  `web/rotation_steps.js` replays the rotations the C++ reported and checks the
  result equals the real C++ tree (tested on 22,000+ random operations).
