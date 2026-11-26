// UI layer: all direct DOM rendering for the transcript panel and the
// history drawer. Holds no transcript data itself — callers pass segments
// in, and get interaction callbacks out via `handlers`.

import { clock } from "./utils.js";

let rows = [];   // DOM row per segment index, mirrors the app's `segs` array

export function resetTranscript(linesEl, emptyEl) {
  rows = [];
  linesEl.querySelectorAll(".seg").forEach(n => n.remove());
  emptyEl.hidden = false;
}

export function renderWords(tx, seg) {
  tx.textContent = "";
  if (seg.words && seg.words.length) {
    seg.words.forEach((w, i) => {
      const sp = document.createElement("span"); sp.className = "w";
      sp.textContent = w.w + (i < seg.words.length - 1 ? " " : "");
      tx.appendChild(sp);
    });
  } else {
    tx.textContent = seg.text;
  }
}

// handlers: { onSeek(seg), onEdit(seg), onCopy(seg), onDelete(seg, row) }
export function addRow(linesEl, emptyEl, seg, index, handlers) {
  emptyEl.hidden = true;
  const row = document.createElement("div"); row.className = "seg";

  const ts = document.createElement("button"); ts.className = "ts"; ts.textContent = clock(seg.s);
  ts.setAttribute("aria-label", "Play from " + clock(seg.s));
  ts.onclick = () => handlers.onSeek && handlers.onSeek(seg);

  const tx = document.createElement("div"); tx.className = "tx"; tx.contentEditable = "true"; tx.spellcheck = false;
  renderWords(tx, seg);
  tx.addEventListener("input", () => {
    seg.text = tx.textContent; seg.words = null;
    handlers.onEdit && handlers.onEdit(seg);
  });

  const rowbtns = document.createElement("div"); rowbtns.className = "rowbtns";
  const copyBtn = document.createElement("button"); copyBtn.type = "button"; copyBtn.textContent = "Copy";
  copyBtn.onclick = () => handlers.onCopy && handlers.onCopy(seg);
  const delBtn = document.createElement("button"); delBtn.type = "button"; delBtn.textContent = "Delete";
  delBtn.onclick = () => { seg.text = ""; row.remove(); handlers.onDelete && handlers.onDelete(seg, row); };
  rowbtns.append(copyBtn, delBtn);

  row.append(ts, tx, rowbtns);
  linesEl.appendChild(row);
  rows[index] = row;
  return row;
}

export function getRow(index) { return rows[index]; }

export function clearWordHighlight(row) {
  if (row) row.querySelectorAll(".tx .w.cur").forEach(s => s.classList.remove("cur"));
}

export function updateWordHighlight(row, seg, t) {
  if (!row || !seg || !seg.words || !seg.words.length) return;
  const spans = row.querySelectorAll(".tx .w");
  let idx = -1;
  for (let i = 0; i < seg.words.length; i++) {
    const w = seg.words[i], nxt = seg.words[i + 1];
    if (t >= w.s && (!nxt || t < nxt.s)) { idx = i; break; }
  }
  spans.forEach((s, i) => s.classList.toggle("cur", i === idx));
}

export function setActive(index, on) { if (rows[index]) rows[index].classList.toggle("on", on); }
export function scrollRowIntoView(index) { if (rows[index]) rows[index].scrollIntoView({ block: "nearest" }); }

export function applySearch(segs, query) {
  const q = query.trim().toLowerCase();
  rows.forEach((row, i) => {
    if (!row) return;
    const tx = row.querySelector(".tx"), plain = segs[i].text;
    if (!q) { row.classList.remove("hide"); renderWords(tx, segs[i]); return; }
    const hit = plain.toLowerCase().indexOf(q);
    row.classList.toggle("hide", hit < 0);
    if (hit >= 0 && document.activeElement !== tx) {
      tx.textContent = "";
      tx.append(plain.slice(0, hit));
      const mk = document.createElement("mark"); mk.textContent = plain.slice(hit, hit + q.length);
      tx.append(mk, plain.slice(hit + q.length));
    }
  });
}

export function updateStats(statsEl, parts, segs) {
  const list = segs.filter(x => x.text.trim());
  if (!list.length) { statsEl.hidden = true; return; }
  statsEl.hidden = false;
  parts.segsEl.textContent = list.length;
  parts.wordsEl.textContent = list.reduce((n, x) => n + x.text.trim().split(/\s+/).filter(Boolean).length, 0);
  parts.durEl.textContent = clock(Math.max(...list.map(x => x.e)));
}

let toastTimer;
export function toast(toastEl, msg) {
  toastEl.textContent = msg; toastEl.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1600);
}

// handlers: { onOpen(entry), onDelete(id) }
export function renderHistoryList(container, entries, handlers) {
  container.innerHTML = "";
  if (!entries.length) { container.innerHTML = '<p class="hist-empty">No saved transcripts yet.</p>'; return; }
  for (const entry of entries) {
    const div = document.createElement("div"); div.className = "hist-item";
    const words = entry.segs.reduce((n, s) => n + s.text.trim().split(/\s+/).filter(Boolean).length, 0);
    const name = document.createElement("div"); name.className = "row";
    const nameSpan = document.createElement("span"); nameSpan.className = "name"; nameSpan.textContent = entry.name;
    name.appendChild(nameSpan);
    const meta = document.createElement("div"); meta.className = "meta";
    meta.textContent = new Date(entry.date).toLocaleString() + " · " + entry.segs.length + " lines · " + words + " words · " + clock(entry.duration);
    const acts = document.createElement("div"); acts.className = "acts";
    const openBtn = document.createElement("button"); openBtn.type = "button"; openBtn.textContent = "Open";
    openBtn.onclick = () => handlers.onOpen && handlers.onOpen(entry);
    const delBtn = document.createElement("button"); delBtn.type = "button"; delBtn.textContent = "Delete";
    delBtn.onclick = () => handlers.onDelete && handlers.onDelete(entry.id);
    acts.append(openBtn, delBtn);
    div.append(name, meta, acts);
    container.appendChild(div);
  }
}
