#!/usr/bin/env bash
# Recompiles src/avl_lib.cpp -> web/avl.wasm
#
# Uses Zig (https://ziglang.org) only because it bundles a clang + wasi-libc
# toolchain, so you don't need to install the full Emscripten SDK just to
# target WebAssembly. Zig itself is NOT part of the app — avl.wasm is plain
# C++ compiled to WebAssembly, with zero runtime imports (no WASI calls are
# actually used, since the library never touches stdin/stdout/files).
#
# Install Zig once if you don't have it:
#   pip install ziglang --break-system-packages
#   (or download a prebuilt binary from https://ziglang.org/download/)

set -e
cd "$(dirname "$0")"

echo "Compiling src/avl_lib.cpp -> web/avl.wasm ..."

python3 -m ziglang c++ --target=wasm32-wasi -mexec-model=reactor -O2 \
  -Wl,--no-entry \
  -Wl,--export=addStudent,--export=deleteStudent \
  -Wl,--export=getLastActionType,--export=getLastTriggerMarks \
  -Wl,--export=getRotationEventCount,--export=getRotationEventCase \
  -Wl,--export=getRotationEventY,--export=getRotationEventX,--export=getRotationEventZ \
  -Wl,--export=getRotationEventBalance,--export=getRotationEventLeftH,--export=getRotationEventRightH \
  -Wl,--export=getRotationEventChildBalance \
  -Wl,--export=getTreeHeight,--export=getStudentCount,--export=computeRanking \
  -Wl,--export=rankingRollAt,--export=rankingMarksAt,--export=rankingNamePtrAt \
  -Wl,--export=searchStudentByRoll,--export=getSearchRoll,--export=getSearchMarks,--export=getSearchNamePtr \
  -Wl,--export=findTopper,--export=getTopperRoll,--export=getTopperMarks,--export=getTopperNamePtr \
  -Wl,--export=exportTree,--export=getTreeBufPtr,--export=treeNamePtrAt \
  -Wl,--export=getNameScratchPtr,--export=resetAll \
  -o web/avl.wasm src/avl_lib.cpp

echo "Done: web/avl.wasm ($(wc -c < web/avl.wasm) bytes)"
