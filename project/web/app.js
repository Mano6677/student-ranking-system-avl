
let wasmExports = null, wasmMemory = null;
let rotationHistory = [];
let lastWalkthrough = null;   // step-by-step replay of the latest insert/delete
let wtSelected = 0;
let wtTimer = null;

async function initWasm() {
  // Fetches the compiled C++ (avl.wasm) sitting next to this file.
  // Must be served over http(s) — opening index.html directly via file://
  // will block this fetch in most browsers. Use a local server (see README).
  const resp = await fetch('avl.wasm');
  if (!resp.ok) throw new Error('Could not fetch avl.wasm (HTTP ' + resp.status + ') — are you running this through a local server?');
  const bytes = await resp.arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, {});
  wasmExports = instance.exports;
  if (wasmExports._initialize) wasmExports._initialize();
  wasmMemory = wasmExports.memory;
}

function writeName(name) {
  const ptr = wasmExports.getNameScratchPtr();
  const bytes = new TextEncoder().encode(name);
  const view = new Uint8Array(wasmMemory.buffer, ptr, 48);
  view.fill(0);
  view.set(bytes.slice(0, 47));
}
function readCStr(ptr) {
  const view = new Uint8Array(wasmMemory.buffer, ptr, 48);
  let end = view.indexOf(0);
  if (end === -1) end = 48;
  return new TextDecoder().decode(view.slice(0, end));
}

const CASE_NAMES = { 0: null, 1: 'LL', 2: 'RR', 3: 'LR', 4: 'RL' };

function rollExists(rollNo) {
  return wasmExports.searchStudentByRoll(rollNo) === 1;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function showMsg(el, text, ok) {
  el.textContent = text;
  el.className = 'msg show ' + (ok ? 'ok' : 'err');
  setTimeout(() => el.classList.remove('show'), 3400);
}

function flashRotation() {
  const wrap = document.getElementById('treeSvgWrap');
  wrap.classList.remove('flash');
  void wrap.offsetWidth;
  wrap.classList.add('flash');
}

function renderRotationLog() {
  const el = document.getElementById('rotationLogWrap');
  const why = document.getElementById('whyRotateWrap');
  if (!rotationHistory.length) el.innerHTML = '';
  else {
    const items = rotationHistory.slice(0, 8).map(r => {
      const actionTag = r.action === 'delete' ? '🗑️ Delete' : '➕ Insert';
      return `<div class="rot-item"><span class="rot-case ${r.case}">${r.case}</span>
        <span>${actionTag} · ${r.case === 'LL' ? 'Left-Left' : r.case === 'RR' ? 'Right-Right' : r.case === 'LR' ? 'Left-Right' : 'Right-Left'}
        rebalance at node <b>${r.y}</b> — ${r.action === 'delete' ? 'after deleting' : 'while inserting'} ${escapeHtml(r.student)} (${r.trigger})</span></div>`;
    }).join('');
    el.innerHTML = `<div class="rot-title">🔄 Rotation Log</div>${items}`;
  }
  if (lastWalkthrough) renderWalkthrough(lastWalkthrough);
  else if (rotationHistory.length) renderWhyRotate(rotationHistory[0]);
  else why.innerHTML = '';
}

function reasoningText(r) {
  const { case: c, y, x, z, balance, leftH, rightH, trigger, action, student } = r;
  const bf = balance > 0 ? `+${balance}` : `${balance}`;
  const cause = action === 'delete'
    ? `after deleting ${escapeHtml(student)} (marks <b>${trigger}</b>)`
    : `after inserting <b>${trigger}</b>`;
  const base = `Node <b>${y}</b> became unbalanced (balance factor ${bf} = left height ${leftH} − right height ${rightH}) ${cause}.`;

  if (action === 'insert') {
    if (c === 'LL') return `${base} Since <b>${trigger}</b> &lt; <b>${x}</b> (${y}'s left child), the new node landed in the left subtree's left side — the <b>LL case</b>. A single <b>right rotation</b> at ${y} pulls ${x} up as the new local root.`;
    if (c === 'RR') return `${base} Since <b>${trigger}</b> &gt; <b>${x}</b> (${y}'s right child), the new node landed in the right subtree's right side — the <b>RR case</b>. A single <b>left rotation</b> at ${y} pulls ${x} up as the new local root.`;
    if (c === 'LR') return `${base} Since <b>${trigger}</b> &gt; <b>${x}</b> (${y}'s left child), it landed in the left subtree's right side — the <b>LR case</b>. A <b>left rotation</b> at ${x} followed by a <b>right rotation</b> at ${y} brings <b>${z}</b> up as the new local root.`;
    return `${base} Since <b>${trigger}</b> &lt; <b>${x}</b> (${y}'s right child), it landed in the right subtree's left side — the <b>RL case</b>. A <b>right rotation</b> at ${x} followed by a <b>left rotation</b> at ${y} brings <b>${z}</b> up as the new local root.`;
  } else {
    if (c === 'LL') return `${base} ${y}'s left child <b>${x}</b> is not right-heavy, so this is the <b>LL case</b>. A single <b>right rotation</b> at ${y} pulls ${x} up as the new local root.`;
    if (c === 'RR') return `${base} ${y}'s right child <b>${x}</b> is not left-heavy, so this is the <b>RR case</b>. A single <b>left rotation</b> at ${y} pulls ${x} up as the new local root.`;
    if (c === 'LR') return `${base} ${y}'s left child <b>${x}</b> is right-heavy, so this is the <b>LR case</b>. A <b>left rotation</b> at ${x} followed by a <b>right rotation</b> at ${y} brings <b>${z}</b> up as the new local root.`;
    return `${base} ${y}'s right child <b>${x}</b> is left-heavy, so this is the <b>RL case</b>. A <b>right rotation</b> at ${x} followed by a <b>left rotation</b> at ${y} brings <b>${z}</b> up as the new local root.`;
  }
}

// Spells out the EXACT boolean condition the C++ code evaluated, with real
// numbers substituted, so it's unambiguous which condition fired.
function conditionLine(r) {
  const { case: c, y, x, balance, trigger, action, childBalance } = r;
  if (action === 'insert') {
    const cmp = { LL: `${trigger} < ${x}`, RR: `${trigger} > ${x}`, LR: `${trigger} > ${x}`, RL: `${trigger} < ${x}` }[c];
    const balCond = (c === 'LL' || c === 'LR') ? `balance(${y}) = ${balance} > 1` : `balance(${y}) = ${balance} < -1`;
    return `${balCond}  &amp;&amp;  inserted ${cmp}  →  <b>TRUE</b>  →  <b>${c} case</b>`;
  } else {
    const side = (c === 'LL' || c === 'LR') ? 'left' : 'right';
    const balCond = (c === 'LL' || c === 'LR') ? `balance(${y}) = ${balance} > 1` : `balance(${y}) = ${balance} < -1`;
    const childCond = { LL: `getBalance(${side}=${x}) = ${childBalance} >= 0`,
                         LR: `getBalance(${side}=${x}) = ${childBalance} < 0`,
                         RR: `getBalance(${side}=${x}) = ${childBalance} <= 0`,
                         RL: `getBalance(${side}=${x}) = ${childBalance} > 0` }[c];
    return `${balCond}  &amp;&amp;  ${childCond}  →  <b>TRUE</b>  →  <b>${c} case</b>`;
  }
}

// Builds a keyed multi-state description of the local rotation: every
// element (node/triangle) keeps a stable id across states, only its
// position and parent change — so we can animate real motion between states,
// including a true two-phase animation for LR/RL double rotations.
// `sequences[i]` groups the ids into ordered clusters for the i-th
// transition, so the rotation visibly happens one step at a time rather
// than everything moving at once.
function buildRotationStates(caseName, y, x, z) {
  if (caseName === 'LL') return {
    ids: ['y','x','T1','T2','T3'],
    states: [
      { pos: { y:[85,25], x:[45,60], T1:[20,95], T2:[70,95], T3:[135,70] },
        parent: { x:'y', T1:'x', T2:'x', T3:'y' } },
      { pos: { x:[85,25], T1:[45,60], y:[135,70], T2:[110,105], T3:[155,105] },
        parent: { T1:'x', y:'x', T2:'y', T3:'y' } }
    ],
    sequences: [ [ ['x','y'], ['T2'], ['T1','T3'] ] ],
    steps: ['Single right rotation at ' + y]
  };
  if (caseName === 'RR') return {
    ids: ['y','x','T1','T2','T3'],
    states: [
      { pos: { y:[85,25], x:[125,60], T1:[35,70], T2:[100,95], T3:[150,95] },
        parent: { x:'y', T1:'y', T2:'x', T3:'x' } },
      { pos: { x:[85,25], T3:[125,60], y:[35,70], T1:[10,105], T2:[60,105] },
        parent: { y:'x', T3:'x', T1:'y', T2:'y' } }
    ],
    sequences: [ [ ['x','y'], ['T2'], ['T1','T3'] ] ],
    steps: ['Single left rotation at ' + y]
  };
  if (caseName === 'LR') return {
    ids: ['y','x','z','T1','T2','T3','T4'],
    states: [
      { pos: { y:[85,20], x:[45,55], z:[80,90], T1:[25,85], T2:[60,115], T3:[100,115], T4:[135,60] },
        parent: { x:'y', T1:'x', z:'x', T2:'z', T3:'z', T4:'y' } },
      { pos: { y:[85,20], z:[45,55], x:[25,90], T1:[10,120], T2:[40,120], T3:[80,90], T4:[135,60] },
        parent: { z:'y', x:'z', T1:'x', T2:'x', T3:'z', T4:'y' } },
      { pos: { z:[85,25], x:[45,60], y:[125,60], T1:[25,90], T2:[60,90], T3:[105,90], T4:[145,90] },
        parent: { x:'z', y:'z', T1:'x', T2:'x', T3:'y', T4:'y' } }
    ],
    sequences: [
      [ ['x','z'], ['T2'], ['T1'] ],       // phase 1: left rotation at x
      [ ['z','y'], ['T3'], ['T4'] ]        // phase 2: right rotation at y
    ],
    steps: ['Step 1: left rotation at ' + x, 'Step 2: right rotation at ' + y]
  };
  // RL
  return {
    ids: ['y','x','z','T1','T2','T3','T4'],
    states: [
      { pos: { y:[85,20], x:[125,55], z:[90,90], T1:[35,60], T2:[70,115], T3:[110,115], T4:[145,85] },
        parent: { x:'y', T1:'y', z:'x', T2:'z', T3:'z', T4:'x' } },
      { pos: { y:[85,20], z:[125,55], x:[145,85], T1:[35,60], T2:[110,90], T3:[130,120], T4:[160,120] },
        parent: { z:'y', T1:'y', T2:'z', x:'z', T3:'x', T4:'x' } },
      { pos: { z:[85,25], y:[45,60], x:[125,60], T1:[25,90], T2:[60,90], T3:[105,90], T4:[145,90] },
        parent: { y:'z', x:'z', T1:'y', T2:'y', T3:'x', T4:'x' } }
    ],
    sequences: [
      [ ['x','z'], ['T2'], ['T4'] ],       // phase 1: right rotation at x
      [ ['z','y'], ['T1'], ['T3'] ]        // phase 2: left rotation at y
    ],
    steps: ['Step 1: right rotation at ' + x, 'Step 2: left rotation at ' + y]
  };
}

const ROTATE_STEP_MS = 700;   // how long one element takes to glide into place
const ROTATE_STAGGER_MS = 620; // gap before the next group starts (slightly less than STEP so it feels continuous, not choppy)
const ROTATE_PHASE_PAUSE_MS = 550; // pause between phase 1 and phase 2 of a double rotation

let whyRotatePlayToken = 0;

function renderWhyRotate(r, target, compact) {
  const wrap = target || document.getElementById('whyRotateWrap');
  const { ids, states, sequences, steps } = buildRotationStates(r.case, r.y, r.x, r.z);
  const labelOf = id => (id === 'y' || id === 'x' || id === 'z') ? { y: r.y, x: r.x, z: r.z }[id] : id;
  const isNode = id => id === 'y' || id === 'x' || id === 'z';
  const W = 170, H = 140;
  const s0 = states[0];

  let nodesHtml = '', edgesHtml = '';
  ids.forEach((id, idx) => {
    const [px, py] = s0.pos[id];
    if (isNode(id)) {
      nodesHtml += `<g id="ranim-${id}" class="ranim-node-g">
        <circle class="ranim-circle" cx="${px}" cy="${py}" r="20" fill="var(--bg2)" stroke="var(--accent2)" stroke-width="2"/>
        <text class="ranim-text" x="${px}" y="${py+5}" text-anchor="middle" font-size="12" font-weight="700" fill="var(--text)">${labelOf(id)}</text>
      </g>`;
    } else {
      nodesHtml += `<g id="ranim-${id}" class="ranim-tri-g">
        <path class="ranim-path" d="M ${px-16},${py+14} L ${px+16},${py+14} L ${px},${py-14} Z" fill="none" stroke="var(--card-border)" stroke-width="2"/>
        <text class="ranim-tritext" x="${px}" y="${py+9}" text-anchor="middle" font-size="9" fill="var(--muted)">${id}</text>
      </g>`;
    }
    const parentId = s0.parent[id];
    if (parentId) {
      const [ppx, ppy] = s0.pos[parentId];
      edgesHtml += `<line id="redge-${id}" class="ranim-edge" x1="${ppx}" y1="${ppy}" x2="${px}" y2="${py}" stroke="var(--card-border)" stroke-width="2" opacity="1"/>`;
    } else {
      edgesHtml += `<line id="redge-${id}" class="ranim-edge" x1="${px}" y1="${py}" x2="${px}" y2="${py}" stroke="var(--card-border)" stroke-width="2" opacity="0"/>`;
    }
  });

  const svgId = 'ranimsvg-' + Math.random().toString(36).slice(2, 9);
  const svgHtml = `<svg id="${svgId}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <g>${edgesHtml}</g><g>${nodesHtml}</g>
  </svg>`;

  const stepLabel = `<div class="anim-steplabel" id="steplabel-${svgId}">${steps[0]}</div>`;

  wrap.innerHTML = compact ? `
    <div class="rotate-diagrams">
      <div>${svgHtml}${stepLabel}</div>
    </div>
    <button class="btn secondary" id="replay-${svgId}" style="margin-top:8px;">▶ Replay this rotation</button>` : `
    <div class="why-card">
      <h3>🤔 Why did it rotate? (latest: ${r.action === 'delete' ? '🗑️ Delete' : '➕ Insert'} → ${r.case})</h3>
      <div class="condition-title">Condition checked</div>
      <div class="condition-line">${conditionLine(r)}</div>
      <div class="why-text">${reasoningText(r)}</div>
      <div class="rotate-diagrams">
        <div>${svgHtml}${stepLabel}</div>
      </div>
      <button class="btn secondary" id="replay-${svgId}" style="margin-top:12px;">▶ Replay rotation</button>
    </div>`;

  function setElementPos(id, nx, ny) {
    const svgEl = document.getElementById(svgId);
    if (!svgEl) return;
    const g = svgEl.querySelector('#ranim-' + id);
    if (g) {
      if (isNode(id)) {
        const c = g.querySelector('.ranim-circle');
        c.setAttribute('cx', nx); c.setAttribute('cy', ny);
        const t = g.querySelector('.ranim-text');
        t.setAttribute('x', nx); t.setAttribute('y', ny + 5);
      } else {
        const p = g.querySelector('.ranim-path');
        p.setAttribute('d', `M ${nx-16},${ny+14} L ${nx+16},${ny+14} L ${nx},${ny-14} Z`);
        const t = g.querySelector('.ranim-tritext');
        t.setAttribute('x', nx); t.setAttribute('y', ny + 9);
      }
    }
  }
  function setEdge(childId, parentId, st) {
    const svgEl = document.getElementById(svgId);
    if (!svgEl) return;
    const e = svgEl.querySelector('#redge-' + childId);
    if (!e) return;
    if (parentId) {
      const [ppx, ppy] = st.pos[parentId];
      const [cx, cy] = st.pos[childId];
      e.setAttribute('x1', ppx); e.setAttribute('y1', ppy);
      e.setAttribute('x2', cx); e.setAttribute('y2', cy);
      e.setAttribute('opacity', '1');
    } else {
      e.setAttribute('opacity', '0');
    }
  }

  // instantly snap everything to a state, no transition (used for reset / initial paint)
  function snapToState(stateIdx) {
    const svgEl = document.getElementById(svgId);
    if (!svgEl) return;
    const st = states[stateIdx];
    svgEl.querySelectorAll('.ranim-circle, .ranim-text, .ranim-path, .ranim-tritext, .ranim-edge').forEach(el => el.style.transitionDelay = '0ms, 0ms, 0ms, 0ms');
    ids.forEach(id => { const [nx, ny] = st.pos[id]; setElementPos(id, nx, ny); setEdge(id, st.parent[id], st); });
  }

  // animates group-by-group from `fromState` to `toState`, one group settling
  // before the next starts moving (this is the "each edge goes, then the
  // next" sequencing that was asked for)
  function animateTransition(fromState, toState, groups, onDone) {
    const svgEl = document.getElementById(svgId);
    if (!svgEl) { if (onDone) onDone(); return; }
    // any id not explicitly grouped just moves in the final group, together with the rest
    const grouped = new Set(groups.flat());
    const rest = ids.filter(id => !grouped.has(id));
    const allGroups = rest.length ? [...groups, rest] : groups;

    allGroups.forEach((group, gi) => {
      const delay = gi * ROTATE_STAGGER_MS;
      group.forEach(id => {
        const g = svgEl.querySelector('#ranim-' + id);
        const e = svgEl.querySelector('#redge-' + id);
        if (g) g.querySelectorAll('.ranim-circle,.ranim-text,.ranim-path,.ranim-tritext').forEach(el => el.style.transitionDelay = delay + 'ms');
        if (e) e.style.transitionDelay = delay + 'ms';
      });
      setTimeout(() => {
        group.forEach(id => {
          const [nx, ny] = states[toState].pos[id];
          setElementPos(id, nx, ny);
          setEdge(id, states[toState].parent[id], states[toState]);
        });
      }, 20); // let transitionDelay assignment paint first
    });

    const totalMs = allGroups.length * ROTATE_STAGGER_MS + ROTATE_STEP_MS;
    if (onDone) setTimeout(onDone, totalMs);
  }

  function play() {
    const myToken = ++whyRotatePlayToken;
    const svgEl = document.getElementById(svgId);
    if (!svgEl) return;

    snapToState(0);
    void svgEl.offsetWidth; // force reflow so the snap doesn't itself animate
    svgEl.querySelectorAll('.ranim-circle, .ranim-text, .ranim-path, .ranim-tritext, .ranim-edge').forEach(el => el.style.transitionDelay = '0ms');

    const lbl = document.getElementById('steplabel-' + svgId);
    if (lbl) lbl.textContent = steps[0];

    setTimeout(() => {
      if (whyRotatePlayToken !== myToken) return;
      animateTransition(0, 1, sequences[0], () => {
        if (whyRotatePlayToken !== myToken || sequences.length < 2) return;
        setTimeout(() => {
          if (whyRotatePlayToken !== myToken) return;
          if (lbl) lbl.textContent = steps[1];
          animateTransition(1, 2, sequences[1]);
        }, ROTATE_PHASE_PAUSE_MS);
      });
    }, 300);
  }

  document.getElementById('replay-' + svgId).addEventListener('click', play);
  setTimeout(play, 300); // auto-play once when this card first appears
}

// ---------- step-by-step walkthrough (every rotation, one at a time) ----------

// nested snapshot of the real C++ tree (used to replay an operation)
function snapshotTree() {
  const { nodes, rootRoll } = getTreeData();
  const build = r => {
    if (r === -1 || r == null || !nodes.has(r)) return null;
    const d = nodes.get(r);
    return { marks: d.marks, roll: d.rollNo, name: d.name, left: build(d.left), right: build(d.right) };
  };
  return rootRoll === null ? null : build(rootRoll);
}

// Small standalone SVG of any tree snapshot. `o.changed` = nodes whose child
// links differ from the previous figure, `o.roles` = {marks: 'y'|'x'|'z'}.
function treeFigure(root, o) {
  o = o || {};
  if (!root) return '<div class="wt-empty">(empty tree)</div>';
  const changed = new Set(o.changed || []), focus = new Set(o.focus || []), roles = o.roles || {};
  const pos = new Map(); let idx = 0, maxD = 0;
  (function walk(n, d) { if (!n) return; walk(n.left, d + 1); pos.set(n.marks, { i: idx++, d }); maxD = Math.max(maxD, d); walk(n.right, d + 1); })(root, 0);
  const GX = 40, GY = 56, R = 16, PAD = 26;
  const W = Math.max(120, idx * GX + PAD), Ht = (maxD + 1) * GY + 22;
  let edges = '', nodesSvg = '';
  (function draw(n) {
    if (!n) return;
    const p = pos.get(n.marks), x = PAD / 2 + p.i * GX + GX / 2 - 8, y = p.d * GY + 26;
    [n.left, n.right].forEach(c => {
      if (!c) return;
      const q = pos.get(c.marks);
      edges += `<line x1="${x}" y1="${y}" x2="${PAD / 2 + q.i * GX + GX / 2 - 8}" y2="${q.d * GY + 26}" stroke="var(--card-border)" stroke-width="2"/>`;
    });
    draw(n.left); draw(n.right);
  })(root);
  (function draw(n) {
    if (!n) return;
    const p = pos.get(n.marks), x = PAD / 2 + p.i * GX + GX / 2 - 8, y = p.d * GY + 26;
    const bf = RotSteps.BF(n), bad = Math.abs(bf) > 1;
    const role = roles[n.marks];
    let stroke = 'var(--card-border)', sw = 2;
    if (changed.has(n.marks)) { stroke = 'var(--accent2)'; sw = 3; }
    if (focus.has(n.marks)) { stroke = 'var(--gold, #fbbf24)'; sw = 3; }
    if (role === 'x' || role === 'z') { stroke = 'var(--accent)'; sw = 3; }
    if (bad || role === 'y') { stroke = 'var(--danger)'; sw = 3; }
    nodesSvg += `<g><circle cx="${x}" cy="${y}" r="${R}" fill="var(--bg2)" stroke="${stroke}" stroke-width="${sw}"/>
      <text x="${x}" y="${y + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--text)">${n.marks}</text>
      <text x="${x}" y="${y + R + 11}" text-anchor="middle" font-size="9" fill="${bad ? 'var(--danger)' : 'var(--muted)'}" font-weight="${bad ? 700 : 400}">bf ${bf > 0 ? '+' + bf : bf}</text></g>`;
    draw(n.left); draw(n.right);
  })(root);
  return `<svg style="width:100%;max-width:${W}px;height:auto;display:block;margin:0 auto" viewBox="0 0 ${W} ${Ht}">${edges}${nodesSvg}</svg>`;
}

function figBox(title, svg, note) {
  return `<div class="wt-fig"><div class="wt-fig-title">${title}</div><div class="wt-fig-scroll">${svg}</div>${note ? `<div class="wt-fig-note">${note}</div>` : ''}</div>`;
}

function stepNavLabel(st) {
  if (st.type === 'start') return '0 · Before';
  if (st.type === 'bst') return '1 · BST ' + (lastWalkthrough.action === 'delete' ? 'delete' : 'insert');
  if (st.type === 'rot') return `Rotation ${st.index} · ${st.ev.case}`;
  return '✓ Final';
}

function rotationExplain(st, wt) {
  const ev = st.ev, y = ev.y;
  const isDel = wt.action === 'delete';
  const newRoot = (ev.case === 'LL' || ev.case === 'RR') ? ev.x : ev.z;
  let html = '';

  // why THIS rotation is the one that happens now
  if (st.index === 1) {
    html += `<p><b>Why this rotation comes first:</b> after the plain BST ${isDel ? 'delete' : 'insert'}, AVL walks <b>bottom-up</b> from the ${isDel ? 'place where the node was removed' : 'new leaf'} towards the root and fixes the <b>first (lowest)</b> node whose balance factor is outside −1…+1. That node is <b>${y}</b>, so only <b>this one</b> rotation is done now; nothing else in the tree is touched yet.</p>`;
  } else {
    const prev = wt.steps.find(s => s.type === 'rot' && s.index === st.index - 1);
    html += `<p><b>Why this rotation happens now:</b> rotation ${st.index - 1} made its subtree shorter (height ${prev.hBefore} → ${prev.hAfter}). That changes the balance of its ancestor <b>${y}</b>, which is now left height ${ev.leftH} − right height ${ev.rightH} = <b>${ev.balance > 0 ? '+' : ''}${ev.balance}</b> — out of range, so AVL has to rotate again here.</p>`;
  }

  // what actually changed / stayed
  html += `<p><b>What changed:</b> only the highlighted <span class="wt-dot teal"></span> nodes got new child links. <b>Every other node is identical to the previous figure</b> — the rest of the tree stays exactly the same. The subtree that was rooted at ${y} (height ${st.hBefore}) is now rooted at <b>${newRoot}</b> with height ${st.hAfter}.</p>`;

  // why the next rotation does / doesn't happen
  if (st.next) {
    const n = st.next;
    html += `<p><b>Why it changes again:</b> because this subtree is now ${st.hBefore > st.hAfter ? 'shorter' : 'different'}, the walk continues up and finds node <b>${n.y}</b> unbalanced (balance ${n.balance > 0 ? '+' : ''}${n.balance}). So the tree changes a second time → see rotation ${st.index + 1}.</p>`;
  } else if (isDel) {
    html += `<p><b>Why it stops here:</b> the walk keeps going up to the root, but every remaining ancestor has balance −1, 0 or +1, so no further rotation is needed.</p>`;
  } else {
    html += `<p><b>Why it stops here:</b> for an <b>insert</b>, one rotation (single or double) brings this subtree back to the height it had <i>before</i> the insert (${st.hAfter}). No ancestor sees any height change, so everything above stays the same and <b>no second rotation</b> can happen.</p>`;
  }
  return html;
}

function wtStepBody(wt, i) {
  const st = wt.steps[i], isDel = wt.action === 'delete';
  const who = `${escapeHtml(wt.spec.name || '')} (marks ${wt.spec.marks})`;
  if (st.type === 'start') {
    return `<p>This is the real tree <b>before</b> ${isDel ? 'deleting' : 'inserting'} ${who}. Every node has a balance factor (bf = left height − right height) of −1, 0 or +1.</p>` +
      figBox('Tree before', treeFigure(st.tree));
  }
  if (st.type === 'bst') {
    const bad = st.unbalanced;
    const txt = bad.length
      ? `AVL first does a <b>normal BST ${isDel ? 'delete' : 'insert'}</b> of ${who}. This breaks the balance at: ${bad.map(m => `<b>${m}</b> (bf ${RotSteps.BF(RotSteps.find(st.tree, m)) > 0 ? '+' : ''}${RotSteps.BF(RotSteps.find(st.tree, m))})`).join(', ')} — shown in red. Now the rebalancing walk starts at the bottom.`
      : `AVL first does a <b>normal BST ${isDel ? 'delete' : 'insert'}</b> of ${who}. No node went out of range, so <b>no rotation is needed</b>.`;
    return `<p>${txt}</p>` + figBox(`After plain BST ${isDel ? 'delete' : 'insert'} (not rebalanced yet)`, treeFigure(st.tree, { focus: st.focus }));
  }
  if (st.type === 'final') {
    const n = wt.steps.filter(s => s.type === 'rot').length;
    return `<p>✅ <b>Finished.</b> ${n ? `${n} rotation${n > 1 ? 's were' : ' was'} needed` : 'No rotation was needed'}, and every node is balanced again (all bf between −1 and +1). ${wt.ok ? 'This replay is checked against the real C++ tree — they are identical.' : ''}</p>` +
      figBox('Final tree', treeFigure(st.tree));
  }
  // rotation step
  const ev = st.ev;
  const roles = {}; roles[ev.y] = 'y'; roles[ev.x] = 'x'; if (ev.z > -1) roles[ev.z] = 'z';
  const r = Object.assign({ action: wt.action, student: wt.spec.name || '', trigger: wt.spec.marks }, ev);
  let figs = figBox(`Before rotation ${st.index}`, treeFigure(st.before, { roles }), 'red = unbalanced node, blue = pivot nodes');
  if (st.mid) {
    const first = ev.case === 'LR' ? `left rotation at ${ev.x}` : `right rotation at ${ev.x}`;
    const second = ev.case === 'LR' ? `right rotation at ${ev.y}` : `left rotation at ${ev.y}`;
    const mchanged = RotSteps.changedNodes(st.before, st.mid);
    figs += figBox(`Phase 1 · ${first}`, treeFigure(st.mid, { changed: mchanged }));
    figs += figBox(`Phase 2 · ${second}`, treeFigure(st.after, { changed: RotSteps.changedNodes(st.mid, st.after) }));
  } else {
    figs += figBox(`After rotation ${st.index}`, treeFigure(st.after, { changed: st.changed }), 'teal = nodes whose links changed');
  }
  return `<div class="wt-cond"><div class="condition-title">Condition checked</div><div class="condition-line">${conditionLine(r)}</div></div>
    <div class="why-text">${reasoningText(r)}</div>
    <div class="wt-figs">${figs}</div>
    <div class="wt-explain">${rotationExplain(st, wt)}</div>
    <div class="wt-diagram-title">How the pointers move (T1, T2, T3 are the untouched subtrees)</div>
    <div id="wt-diagram"></div>`;
}

function renderWalkthrough(wt, keepSel) {
  const wrap = document.getElementById('whyRotateWrap');
  if (wtTimer) { clearInterval(wtTimer); wtTimer = null; }
  if (!keepSel) {
    const firstRot = wt.steps.findIndex(s => s.type === 'rot');
    wtSelected = firstRot >= 0 ? firstRot : wt.steps.length - 1;
  }
  const rots = wt.steps.filter(s => s.type === 'rot').length;
  const title = `${wt.action === 'delete' ? '🗑️ Delete' : '➕ Insert'} ${escapeHtml(wt.spec.name || '')} (marks ${wt.spec.marks}) — ${rots ? rots + ' rotation' + (rots > 1 ? 's' : '') : 'no rotation'}`;
  const nav = wt.steps.map((st, i) =>
    `<button class="wt-pill ${st.type === 'rot' ? 'rot' : ''} ${i === wtSelected ? 'active' : ''}" data-i="${i}">${stepNavLabel(st)}</button>`).join('');
  wrap.innerHTML = `
    <div class="why-card wt-card">
      <h3>🔬 Step-by-step · ${title}</h3>
      <div class="wt-nav">${nav}</div>
      <div class="wt-body" id="wtBody"></div>
      <div class="wt-controls">
        <button class="btn secondary" id="wtPrev">◀ Prev</button>
        <button class="btn secondary" id="wtPlay">⏵ Play all steps</button>
        <button class="btn secondary" id="wtNext">Next ▶</button>
      </div>
    </div>`;

  function show(i) {
    wtSelected = Math.max(0, Math.min(wt.steps.length - 1, i));
    wrap.querySelectorAll('.wt-pill').forEach(p => p.classList.toggle('active', +p.dataset.i === wtSelected));
    document.getElementById('wtBody').innerHTML = wtStepBody(wt, wtSelected);
    const st = wt.steps[wtSelected];
    if (st.type === 'rot') renderWhyRotate(Object.assign({ action: wt.action, student: wt.spec.name || '', trigger: wt.spec.marks }, st.ev), document.getElementById('wt-diagram'), true);
  }
  wrap.querySelectorAll('.wt-pill').forEach(p => p.addEventListener('click', () => { stopPlay(); show(+p.dataset.i); }));
  function stopPlay() { if (wtTimer) { clearInterval(wtTimer); wtTimer = null; } const b = document.getElementById('wtPlay'); if (b) b.textContent = '⏵ Play all steps'; }
  document.getElementById('wtPrev').addEventListener('click', () => { stopPlay(); show(wtSelected - 1); });
  document.getElementById('wtNext').addEventListener('click', () => { stopPlay(); show(wtSelected + 1); });
  document.getElementById('wtPlay').addEventListener('click', () => {
    if (wtTimer) { stopPlay(); return; }
    show(0);
    document.getElementById('wtPlay').textContent = '⏸ Pause';
    wtTimer = setInterval(() => {
      if (wtSelected >= wt.steps.length - 1) { stopPlay(); return; }
      show(wtSelected + 1);
    }, 4200);
  });
  show(wtSelected);
}


function getRankingList() {
  const n = wasmExports.computeRanking();
  const list = [];
  for (let i = 0; i < n; i++) {
    list.push({
      rollNo: wasmExports.rankingRollAt(i),
      marks: wasmExports.rankingMarksAt(i),
      name: readCStr(wasmExports.rankingNamePtrAt(i))
    });
  }
  return list;
}

function getTreeData() {
  const n = wasmExports.exportTree();
  const bufPtr = wasmExports.getTreeBufPtr();
  const view = new Int32Array(wasmMemory.buffer, bufPtr, n * 5);
  const nodes = new Map();
  let rootRoll = null;
  for (let i = 0; i < n; i++) {
    const b = i * 5;
    const rollNo = view[b], marks = view[b+1], left = view[b+2], right = view[b+3], isRoot = view[b+4];
    const name = readCStr(wasmExports.treeNamePtrAt(i));
    nodes.set(rollNo, { rollNo, marks, left, right, isRoot, name });
    if (isRoot) rootRoll = rollNo;
  }
  return { nodes, rootRoll };
}

// ---------- UI wiring ----------
const addBtn = document.getElementById('addBtn');
const addMsg = document.getElementById('addMsg');
const deleteBtn = document.getElementById('deleteBtn');
const deleteMsg = document.getElementById('deleteMsg');
const countBadge = document.getElementById('countBadge');

// pulls every rotation event fired by the last addStudent/deleteStudent call
// and pushes them into rotationHistory (delete can cascade into several)
function collectRotationEvents(action, student, trigger) {
  const n = wasmExports.getRotationEventCount();
  const events = [];
  for (let i = 0; i < n; i++) {
    const caseName = CASE_NAMES[wasmExports.getRotationEventCase(i)];
    const ev = {
      case: caseName, action, student, trigger,
      y: wasmExports.getRotationEventY(i), x: wasmExports.getRotationEventX(i), z: wasmExports.getRotationEventZ(i),
      balance: wasmExports.getRotationEventBalance(i),
      leftH: wasmExports.getRotationEventLeftH(i), rightH: wasmExports.getRotationEventRightH(i),
      childBalance: wasmExports.getRotationEventChildBalance(i)
    };
    events.push(ev);
  }
  // push in reverse so the most recently executed (closest to actual root) ends up first
  for (let i = events.length - 1; i >= 0; i--) rotationHistory.unshift(events[i]);
  return events;
}

addBtn.addEventListener('click', () => {
  const rollNo = parseInt(document.getElementById('rollNo').value, 10);
  const name = document.getElementById('studentName').value.trim();
  const marks = parseInt(document.getElementById('marks').value, 10);

  if (isNaN(rollNo) || !name || isNaN(marks)) {
    showMsg(addMsg, 'Please fill roll no, name and marks.', false);
    return;
  }
  if (marks < 0 || marks > 100) {
    showMsg(addMsg, 'Marks should be between 0 and 100.', false);
    return;
  }
  if (rollExists(rollNo)) {
    showMsg(addMsg, 'Roll No already exists!', false);
    return;
  }

  const pre = snapshotTree();
  writeName(name);
  const err = wasmExports.addStudent(rollNo, marks);

  if (err === 1) {
    showMsg(addMsg, 'Duplicate marks not allowed! (' + marks + ')', false);
  } else if (err === 2) {
    showMsg(addMsg, 'Student limit reached.', false);
  } else {
    const events = collectRotationEvents('insert', name, marks);
    lastWalkthrough = RotSteps.buildWalkthrough(pre, 'insert', { marks, roll: rollNo, name }, events, snapshotTree());
    if (events.length) {
      const names = events.map(e => `${e.case} (at ${e.y})`).join(', ');
      showMsg(addMsg, `Added ${name} ✓ — tree rebalanced: ${names}`, true);
      flashRotation();
    } else {
      showMsg(addMsg, `Added ${name} (Marks: ${marks}) ✓ — no rotation needed`, true);
    }
    document.getElementById('rollNo').value = '';
    document.getElementById('studentName').value = '';
    document.getElementById('marks').value = '';
  }
  renderAll();
});

deleteBtn.addEventListener('click', () => {
  const marks = parseInt(document.getElementById('deleteMarks').value, 10);
  if (isNaN(marks) || marks < 0 || marks > 100) {
    showMsg(deleteMsg, 'Enter valid marks (0 – 100).', false);
    return;
  }
  // AVL keys are unique marks, so find the student holding these marks
  let rollNo = null;
  const total = wasmExports.computeRanking();
  for (let i = 0; i < total; i++) {
    if (wasmExports.rankingMarksAt(i) === marks) { rollNo = wasmExports.rankingRollAt(i); break; }
  }
  if (rollNo === null) {
    showMsg(deleteMsg, `No student found with Marks ${marks}.`, false);
    return;
  }
  // grab the student's name before deleting, for the log/message
  let studentName = '';
  if (wasmExports.searchStudentByRoll(rollNo)) {
    studentName = readCStr(wasmExports.getSearchNamePtr());
  }

  const pre = snapshotTree();
  const ok = wasmExports.deleteStudent(rollNo); // C++ AVL delete (by marks key)
  if (!ok) {
    showMsg(deleteMsg, `No student found with Marks ${marks}.`, false);
    return;
  }

  const trigger = wasmExports.getLastTriggerMarks();
  const events = collectRotationEvents('delete', studentName, trigger);
  lastWalkthrough = RotSteps.buildWalkthrough(pre, 'delete', { marks, roll: rollNo, name: studentName }, events, snapshotTree());
  if (events.length) {
    const names = events.map(e => `${e.case} (at ${e.y})`).join(', ');
    showMsg(deleteMsg, `Deleted ${studentName} (Marks: ${marks}) ✓ — tree rebalanced: ${names}`, true);
    flashRotation();
  } else {
    showMsg(deleteMsg, `Deleted ${studentName} (Marks: ${marks}) ✓ — no rotation needed`, true);
  }
  document.getElementById('deleteMarks').value = '';
  renderAll();
});

document.getElementById('sampleBtn').addEventListener('click', () => {
  const sample = [
    [101, 'Arun Kumar', 78], [102, 'Priya S', 92], [103, 'Karthik R', 65],
    [104, 'Divya M', 88], [105, 'Suresh V', 55], [106, 'Meena T', 95],
    [107, 'Vignesh P', 72]
  ];
  sample.forEach(([r, n, m]) => {
    if (!rollExists(r)) {
      const pre = snapshotTree();
      writeName(n);
      const err = wasmExports.addStudent(r, m);
      if (err === 0) {
        const evs = collectRotationEvents('insert', n, m);
        // keep the walkthrough of the latest insert that actually rotated
        if (evs.length || !lastWalkthrough) lastWalkthrough = RotSteps.buildWalkthrough(pre, 'insert', { marks: m, roll: r, name: n }, evs, snapshotTree());
      }
    }
  });
  renderAll();
  showMsg(addMsg, 'Sample data loaded ✓', true);
});

document.getElementById('resetBtn').addEventListener('click', () => {
  wasmExports.resetAll();
  rotationHistory = [];
  lastWalkthrough = null;
  renderAll();
  showMsg(addMsg, 'All data cleared.', true);
});

document.getElementById('searchBtn').addEventListener('click', () => {
  const rollNo = parseInt(document.getElementById('searchRoll').value, 10);
  const resultEl = document.getElementById('searchResult');
  if (isNaN(rollNo)) {
    resultEl.className = 'search-result show';
    resultEl.innerHTML = '⚠️ Enter a valid roll number.';
    return;
  }
  resultEl.className = 'search-result show';
  if (wasmExports.searchStudentByRoll(rollNo)) {
    const name = readCStr(wasmExports.getSearchNamePtr());
    const marks = wasmExports.getSearchMarks();
    resultEl.innerHTML = `✅ <b>Student Found</b><br>Roll No: ${rollNo}<br>Name: ${escapeHtml(name)}<br>Marks: ${marks}`;
  } else {
    resultEl.innerHTML = `❌ No student found with Roll No ${rollNo}.`;
  }
});

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
  });
});

function renderRanking(list) {
  const body = document.getElementById('rankingBody');
  if (!list.length) { body.innerHTML = '<div class="empty">No ranking to show yet.</div>'; return; }
  let rows = list.map((s, i) => {
    const rank = i + 1;
    const cls = rank === 1 ? 'rank-1' : rank === 2 ? 'rank-2' : rank === 3 ? 'rank-3' : '';
    return `<tr><td class="${cls}">${rank}</td><td>${s.rollNo}</td><td>${escapeHtml(s.name)}</td><td>${s.marks}</td></tr>`;
  }).join('');
  body.innerHTML = `<table><thead><tr><th>Rank</th><th>Roll No</th><th>Name</th><th>Marks</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderTopper() {
  const body = document.getElementById('topperBody');
  if (!wasmExports.findTopper()) {
    body.innerHTML = '<div class="empty">No topper yet — add students first.</div>';
    return;
  }
  const name = readCStr(wasmExports.getTopperNamePtr());
  const roll = wasmExports.getTopperRoll();
  const marks = wasmExports.getTopperMarks();
  body.innerHTML = `
    <div class="topper-card">
      <div class="topper-medal">🏅</div>
      <div class="topper-info">
        <h3>${escapeHtml(name)}</h3>
        <p>Roll No: ${roll}</p>
        <p>Marks: <b style="color:var(--gold)">${marks}</b></p>
      </div>
    </div>`;
}

let treeInitialized = false;

function renderTree() {
  const wrap = document.getElementById('treeSvgWrap');
  const { nodes, rootRoll } = getTreeData();

  if (rootRoll === null) {
    wrap.innerHTML = '<div class="empty">No students yet — add one on the left, or load sample data.</div>';
    treeInitialized = false;
    return;
  }

  const positions = new Map();
  let xCounter = 0;
  const NODE_R = 30, X_GAP = 80, Y_GAP = 90;

  function assign(rollNo, depth) {
    if (rollNo === -1 || rollNo === null || rollNo === undefined) return;
    const node = nodes.get(rollNo);
    if (!node) return;
    assign(node.left, depth + 1);
    positions.set(rollNo, { x: xCounter * X_GAP + 50, y: depth * Y_GAP + 50 });
    xCounter++;
    assign(node.right, depth + 1);
  }
  assign(rootRoll, 0);

  const maxX = Math.max(...[...positions.values()].map(p => p.x)) + 50;
  const maxY = Math.max(...[...positions.values()].map(p => p.y)) + 50;

  // parent lookup: which rollNo is the parent of each rollNo, in this new state
  const parentOf = new Map();
  for (const [rn, node] of nodes) {
    if (node.left !== -1) parentOf.set(node.left, rn);
    if (node.right !== -1) parentOf.set(node.right, rn);
  }

  const existingSvg = wrap.querySelector('svg');

  // First render, or the wrap doesn't have our keyed structure yet — build fresh (no animation to run from)
  if (!existingSvg || !treeInitialized) {
    let edgesHtml = '', nodesHtml = '';
    for (const [rn, node] of nodes) {
      const p = positions.get(rn);
      const parentRn = parentOf.get(rn);
      if (parentRn !== undefined) {
        const pp = positions.get(parentRn);
        edgesHtml += `<line id="edge-${rn}" class="tree-edge" x1="${pp.x}" y1="${pp.y}" x2="${p.x}" y2="${p.y}" stroke="var(--card-border)" stroke-width="2" opacity="1"/>`;
      } else {
        edgesHtml += `<line id="edge-${rn}" class="tree-edge" x1="${p.x}" y1="${p.y}" x2="${p.x}" y2="${p.y}" stroke="var(--card-border)" stroke-width="2" opacity="0"/>`;
      }
      const isRoot = node.isRoot === 1;
      nodesHtml += `
        <g id="node-${rn}" class="node-group">
          <circle class="node-circle" cx="${p.x}" cy="${p.y}" r="${NODE_R}"
            fill="${isRoot ? 'var(--accent)' : 'var(--bg2)'}"
            stroke="${isRoot ? 'var(--accent)' : 'var(--accent2)'}" stroke-width="2"/>
          <text class="node-marks" x="${p.x}" y="${p.y - 4}" text-anchor="middle" font-size="12" font-weight="700"
            fill="${isRoot ? '#0b0e14' : 'var(--text)'}">${node.marks}</text>
          <text class="node-roll" x="${p.x}" y="${p.y + 10}" text-anchor="middle" font-size="8"
            fill="${isRoot ? '#0b0e14' : 'var(--muted)'}">#${node.rollNo}</text>
          <text class="node-name" x="${p.x}" y="${p.y + NODE_R + 16}" text-anchor="middle" font-size="10" fill="var(--muted)">${escapeHtml(node.name)}</text>
        </g>`;
    }
    wrap.innerHTML = `<svg width="${maxX}" height="${maxY + 20}" viewBox="0 0 ${maxX} ${maxY + 20}" xmlns="http://www.w3.org/2000/svg">
      <g class="edges-layer">${edgesHtml}</g>
      <g class="nodes-layer">${nodesHtml}</g>
    </svg>`;
    treeInitialized = true;
    return;
  }

  // Incremental patch: update existing elements so the browser animates the
  // position/color change (this is what makes a rotation visibly "swing").
  existingSvg.setAttribute('width', maxX);
  existingSvg.setAttribute('height', maxY + 20);
  existingSvg.setAttribute('viewBox', `0 0 ${maxX} ${maxY + 20}`);

  const edgesLayer = existingSvg.querySelector('.edges-layer');
  const nodesLayer = existingSvg.querySelector('.nodes-layer');
  const seenRolls = new Set(nodes.keys());

  // remove groups/edges for students that no longer exist (deleted)
  nodesLayer.querySelectorAll('.node-group').forEach(g => {
    const rn = parseInt(g.id.replace('node-', ''), 10);
    if (!seenRolls.has(rn)) {
      g.style.opacity = '0';
      setTimeout(() => g.remove(), 550);
      const e = edgesLayer.querySelector('#edge-' + rn);
      if (e) { e.style.opacity = '0'; setTimeout(() => e.remove(), 550); }
    }
  });

  let i = 0;
  for (const [rn, node] of nodes) {
    const p = positions.get(rn);
    const isRoot = node.isRoot === 1;
    const delay = Math.min(i, 8) * 60; // slight stagger so nodes settle one after another
    i++;

    let g = nodesLayer.querySelector('#node-' + rn);
    if (!g) {
      // newly added student — fade in at its position, no motion needed
      g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.id = 'node-' + rn;
      g.className.baseVal = 'node-group';
      g.style.opacity = '0';
      g.innerHTML = `
        <circle class="node-circle" cx="${p.x}" cy="${p.y}" r="${NODE_R}" fill="${isRoot ? 'var(--accent)' : 'var(--bg2)'}" stroke="${isRoot ? 'var(--accent)' : 'var(--accent2)'}" stroke-width="2"/>
        <text class="node-marks" x="${p.x}" y="${p.y - 4}" text-anchor="middle" font-size="12" font-weight="700" fill="${isRoot ? '#0b0e14' : 'var(--text)'}">${node.marks}</text>
        <text class="node-roll" x="${p.x}" y="${p.y + 10}" text-anchor="middle" font-size="8" fill="${isRoot ? '#0b0e14' : 'var(--muted)'}">#${node.rollNo}</text>
        <text class="node-name" x="${p.x}" y="${p.y + NODE_R + 16}" text-anchor="middle" font-size="10" fill="var(--muted)">${escapeHtml(node.name)}</text>`;
      nodesLayer.appendChild(g);
      requestAnimationFrame(() => { g.style.transitionDelay = delay + 'ms'; g.style.opacity = '1'; });
    } else {
      g.style.transitionDelay = delay + 'ms';
      const circle = g.querySelector('.node-circle');
      circle.setAttribute('cx', p.x); circle.setAttribute('cy', p.y);
      circle.setAttribute('fill', isRoot ? 'var(--accent)' : 'var(--bg2)');
      circle.setAttribute('stroke', isRoot ? 'var(--accent)' : 'var(--accent2)');
      const marksT = g.querySelector('.node-marks');
      marksT.setAttribute('x', p.x); marksT.setAttribute('y', p.y - 4);
      marksT.setAttribute('fill', isRoot ? '#0b0e14' : 'var(--text)');
      const rollT = g.querySelector('.node-roll');
      rollT.setAttribute('x', p.x); rollT.setAttribute('y', p.y + 10);
      rollT.setAttribute('fill', isRoot ? '#0b0e14' : 'var(--muted)');
      const nameT = g.querySelector('.node-name');
      nameT.setAttribute('x', p.x); nameT.setAttribute('y', p.y + NODE_R + 16);
    }

    // edge into this node from its (possibly new) parent
    let e = edgesLayer.querySelector('#edge-' + rn);
    const parentRn = parentOf.get(rn);
    if (!e) {
      e = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      e.id = 'edge-' + rn;
      e.setAttribute('class', 'tree-edge');
      e.setAttribute('stroke', 'var(--card-border)');
      e.setAttribute('stroke-width', '2');
      if (parentRn !== undefined) {
        const pp = positions.get(parentRn);
        e.setAttribute('x1', pp.x); e.setAttribute('y1', pp.y);
        e.setAttribute('x2', p.x); e.setAttribute('y2', p.y);
        e.setAttribute('opacity', '0');
        edgesLayer.appendChild(e);
        requestAnimationFrame(() => { e.style.transitionDelay = delay + 'ms'; e.setAttribute('opacity', '1'); });
      } else {
        e.setAttribute('x1', p.x); e.setAttribute('y1', p.y);
        e.setAttribute('x2', p.x); e.setAttribute('y2', p.y);
        e.setAttribute('opacity', '0');
        edgesLayer.appendChild(e);
      }
    } else {
      e.style.transitionDelay = delay + 'ms';
      if (parentRn !== undefined) {
        const pp = positions.get(parentRn);
        e.setAttribute('x1', pp.x); e.setAttribute('y1', pp.y);
        e.setAttribute('x2', p.x); e.setAttribute('y2', p.y);
        e.setAttribute('opacity', '1');
      } else {
        e.setAttribute('opacity', '0');
      }
    }
  }
}

function renderAll() {
  const n = wasmExports.getStudentCount();
  countBadge.textContent = n + (n === 1 ? ' student' : ' students');
  document.getElementById('statCount').textContent = n;
  document.getElementById('statHeight').textContent = wasmExports.getTreeHeight();

  const list = getRankingList();
  const avg = list.length ? (list.reduce((s, x) => s + x.marks, 0) / list.length).toFixed(1) : '–';
  document.getElementById('statAvg').textContent = avg;

  renderRanking(list);
  renderTree();
  renderTopper();
  renderRotationLog();
}

initWasm().then(() => {
  document.getElementById('loadingRoot').style.display = 'none';
  document.getElementById('appRoot').style.display = 'block';
  renderAll();
}).catch(err => {
  document.getElementById('loadingRoot').innerHTML =
    '⚠️ Could not start the WebAssembly engine: ' + escapeHtml(String(err));
});
