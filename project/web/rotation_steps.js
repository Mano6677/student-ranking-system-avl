// Pure helpers (no DOM) that replay an insert/delete step by step.
//
// avl.wasm (your C++) tells us WHICH rotations fired and in WHICH order
// (case, node y, child x, grandchild z). It does not hand back the tree after
// each individual rotation, so here we take a snapshot of the real tree before
// the operation, do the plain BST insert/delete on a copy, and then apply the
// rotations the C++ reported one at a time. At the end we compare the replayed
// tree with the real C++ tree (`ok`), so what you see is guaranteed to be what
// the C++ really did.
(function (root) {
  function mk(marks, roll, name) { return { marks, roll, name, left: null, right: null }; }
  function clone(n) { return n ? { marks: n.marks, roll: n.roll, name: n.name, left: clone(n.left), right: clone(n.right) } : null; }
  function H(n) { return n ? 1 + Math.max(H(n.left), H(n.right)) : 0; }
  function BF(n) { return n ? H(n.left) - H(n.right) : 0; }
  function find(n, marks) {
    while (n && n.marks !== marks) n = marks < n.marks ? n.left : n.right;
    return n;
  }
  function bstInsert(n, node) {
    if (!n) return node;
    if (node.marks < n.marks) n.left = bstInsert(n.left, node);
    else if (node.marks > n.marks) n.right = bstInsert(n.right, node);
    return n;
  }
  function bstDelete(n, marks) {
    if (!n) return null;
    if (marks < n.marks) n.left = bstDelete(n.left, marks);
    else if (marks > n.marks) n.right = bstDelete(n.right, marks);
    else {
      if (!n.left || !n.right) return n.left || n.right;
      let s = n.right; while (s.left) s = s.left;           // in-order successor
      n.marks = s.marks; n.roll = s.roll; n.name = s.name;
      n.right = bstDelete(n.right, s.marks);
    }
    return n;
  }
  function rotR(y) { const x = y.left; y.left = x.right; x.right = y; return x; }
  function rotL(x) { const y = x.right; x.right = y.left; y.left = x; return y; }
  function applyAt(n, marks, fn) {
    if (!n) return n;
    if (n.marks === marks) return fn(n);
    if (marks < n.marks) n.left = applyAt(n.left, marks, fn);
    else n.right = applyAt(n.right, marks, fn);
    return n;
  }
  function links(n, m) {
    if (!n) return m;
    m.set(n.marks, (n.left ? n.left.marks : '-') + '|' + (n.right ? n.right.marks : '-'));
    links(n.left, m); links(n.right, m);
    return m;
  }
  // marks of every node whose left/right child changed (or that is new)
  function changedNodes(before, after) {
    const a = links(before, new Map()), b = links(after, new Map()), out = [];
    b.forEach((v, k) => { if (a.get(k) !== v) out.push(k); });
    return out;
  }
  function sameTree(a, b) {
    if (!a || !b) return !a && !b;
    return a.marks === b.marks && a.roll === b.roll && sameTree(a.left, b.left) && sameTree(a.right, b.right);
  }
  function outOfBalance(n, out) {
    if (!n) return out;
    if (Math.abs(BF(n)) > 1) out.push(n.marks);
    outOfBalance(n.left, out); outOfBalance(n.right, out);
    return out;
  }
  function applyEvent(tree, ev) {
    const t = clone(tree);
    if (ev.case === 'LL') return { mid: null, after: applyAt(t, ev.y, rotR) };
    if (ev.case === 'RR') return { mid: null, after: applyAt(t, ev.y, rotL) };
    if (ev.case === 'LR') { const mid = applyAt(t, ev.x, rotL); return { mid, after: applyAt(clone(mid), ev.y, rotR) }; }
    const mid = applyAt(t, ev.x, rotR);                        // RL
    return { mid, after: applyAt(clone(mid), ev.y, rotL) };
  }

  // pre    : snapshot of the real tree BEFORE the operation (nested nodes, or null)
  // action : 'insert' | 'delete'
  // spec   : { marks, roll, name } of the student inserted / deleted
  // events : rotation events from the C++ in execution order
  // actual : snapshot of the real tree AFTER the operation
  function buildWalkthrough(pre, action, spec, events, actual) {
    const steps = [];
    let cur = clone(pre);
    steps.push({ type: 'start', tree: clone(cur) });
    cur = action === 'insert' ? bstInsert(cur, mk(spec.marks, spec.roll, spec.name)) : bstDelete(cur, spec.marks);
    steps.push({ type: 'bst', tree: clone(cur), unbalanced: outOfBalance(cur, []), focus: action === 'insert' ? [spec.marks] : [] });
    events.forEach((ev, i) => {
      const before = clone(cur);
      const r = applyEvent(cur, ev);
      const newRoot = (ev.case === 'LL' || ev.case === 'RR') ? ev.x : ev.z;
      steps.push({
        type: 'rot', index: i + 1, total: events.length, ev,
        before, mid: r.mid, after: clone(r.after),
        changed: changedNodes(before, r.after),
        hBefore: H(find(before, ev.y)), hAfter: H(find(r.after, newRoot)),
        next: events[i + 1] || null
      });
      cur = r.after;
    });
    steps.push({ type: 'final', tree: clone(cur) });
    return { action, spec, steps, ok: sameTree(cur, actual) };
  }

  const api = { mk, clone, H, BF, find, bstInsert, bstDelete, applyEvent, changedNodes, sameTree, buildWalkthrough };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RotSteps = api;
})(typeof window !== 'undefined' ? window : globalThis);
