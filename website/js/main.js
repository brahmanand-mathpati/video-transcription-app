// App entry point: owns the transcript state, wires up every feature module,
// and drives the overall upload -> transcribe -> export flow.

import { clock } from "./utils.js";
import { buildTxt, buildSrt, buildVtt, makeZip, saveFile } from "./formats.js";
import { saveHistory, listHistory, deleteHistory, clearHistory } from "./db.js";
import { initialTheme, applyTheme, toggleTheme } from "./theme.js";
import { readWav, readAudioNative, readAudioFFmpeg, mediaSeconds, cancelFFmpeg, NATIVE_LIMIT, NATIVE_SECONDS } from "./audio.js";
import { createMicRecorder } from "./recorder.js";
import { createQueue } from "./queue.js";
import * as ui from "./ui.js";

const $ = (id) => document.getElementById(id);

if (location.protocol === "file:") $("fileWarn").hidden = false;

/* ---------- state ---------- */
const segs = [];            // {s, e, text, words?}
let active = -1, running = false, wakeLock = null, t0 = 0, curFile = null, worker = null;

/* ---------- theme ---------- */
let theme = initialTheme();
applyTheme(theme, $("themeIcon"));
$("themeBtn").onclick = () => { theme = toggleTheme(theme, $("themeIcon")); };

/* ---------- toast ---------- */
const toast = (msg) => ui.toast($("toast"), msg);

/* ---------- export ---------- */
function build(fmt) {
  if (fmt === "txt") return buildTxt(segs, $("withTime").checked);
  if (fmt === "srt") return buildSrt(segs);
  return buildVtt(segs);
}
function baseName() { return ($("fname").textContent || "transcript").replace(/\.[^.]+$/, "").replace(/\s*\(from history\)$/, ""); }

document.querySelectorAll("[data-fmt]").forEach(b => b.onclick = () => {
  const f = b.dataset.fmt;
  saveFile(baseName() + "." + f, build(f), f === "txt" ? "text/plain" : f === "srt" ? "application/x-subrip" : "text/vtt");
  toast("." + f + " downloaded");
});
$("zipAll").onclick = () => {
  const zip = makeZip([
    { name: baseName() + ".txt", text: build("txt") },
    { name: baseName() + ".srt", text: build("srt") },
    { name: baseName() + ".vtt", text: build("vtt") },
  ]);
  saveFile(baseName() + "-transcript.zip", zip);
  toast("ZIP downloaded");
};
$("copy").onclick = async () => {
  const t = build("txt");
  try { await navigator.clipboard.writeText(t); toast("Copied to clipboard"); }
  catch (e) {
    const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta);
    ta.select(); document.execCommand("copy"); ta.remove(); toast("Copied to clipboard");
  }
};

/* ---------- history drawer ---------- */
async function renderHistory() {
  const entries = await listHistory();
  ui.renderHistoryList($("histList"), entries, {
    onOpen: (entry) => { openFromHistory(entry); $("histDrawer").hidden = true; },
    onDelete: async (id) => { await deleteHistory(id); renderHistory(); },
  });
}
$("histBtn").onclick = () => { $("histDrawer").hidden = false; renderHistory(); };
$("histClose").onclick = () => { $("histDrawer").hidden = true; };
$("histDrawer").addEventListener("click", (e) => { if (e.target === $("histDrawer")) $("histDrawer").hidden = true; });
$("histClear").onclick = async () => { await clearHistory(); renderHistory(); toast("History cleared"); };

function openFromHistory(entry) {
  segs.length = 0; active = -1;
  ui.resetTranscript($("lines"), $("empty"));
  $("find").value = ""; $("stats").hidden = true;
  $("home").hidden = true; $("work").hidden = false; window.scrollTo(0, 0);
  $("fname").textContent = entry.name + " (from history)";
  $("vid").removeAttribute("src");
  $("novideo").hidden = false; $("speedrow").hidden = true;
  $("cancel").hidden = true; $("again").hidden = false; $("queueInfo").hidden = true;
  entry.segs.forEach((s, i) => { segs.push(s); ui.addRow($("lines"), $("empty"), s, i, rowHandlers); });
  enableExport(true); updateStats();
  setStage("Opened from history. Click a timestamp — playback needs the original file re-uploaded.", 100);
}

/* ---------- transcript row interactions ---------- */
const rowHandlers = {
  onSeek: (seg) => { const v = $("vid"); if (v.src) { v.currentTime = seg.s; v.play().catch(() => {}); } },
  onEdit: () => { updateStats(); },
  onCopy: (seg) => { navigator.clipboard?.writeText(seg.text).then(() => toast("Line copied")); },
  onDelete: () => { updateStats(); enableExport(segs.some(s => s.text.trim())); },
};

/* ---------- UI state helpers ---------- */
function setStage(text, pct, isErr) {
  const s = $("stage"); s.textContent = text; s.className = isErr ? "err" : "";
  if (pct != null) $("bar").style.width = pct + "%";
}
function enableExport(on) { document.querySelectorAll("[data-fmt],#copy,#zipAll").forEach(b => b.disabled = !on); }
function updateStats() {
  ui.updateStats($("stats"), { segsEl: $("statSegs"), wordsEl: $("statWords"), durEl: $("statDur") }, segs);
}

/* ---------- playback: highlighting, speed, shortcuts ---------- */
function highlightNow() {
  const t = $("vid").currentTime; let idx = -1;
  for (let i = 0; i < segs.length; i++) { if (t >= segs[i].s && t < Math.max(segs[i].e, segs[i].s + 0.5)) { idx = i; break; } }
  if (idx === active) { const row = ui.getRow(idx); if (row) ui.updateWordHighlight(row, segs[idx], t); return; }
  if (active >= 0) { ui.setActive(active, false); ui.clearWordHighlight(ui.getRow(active)); }
  active = idx;
  if (idx >= 0) {
    ui.setActive(idx, true);
    if (!$("vid").paused) ui.scrollRowIntoView(idx);
    ui.updateWordHighlight(ui.getRow(idx), segs[idx], t);
  }
}
$("vid").addEventListener("timeupdate", highlightNow);

document.querySelectorAll(".speedrow [data-speed]").forEach(b => b.onclick = () => {
  $("vid").playbackRate = parseFloat(b.dataset.speed);
  document.querySelectorAll(".speedrow [data-speed]").forEach(x => x.classList.toggle("on", x === b));
});

document.addEventListener("keydown", (e) => {
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea" || e.target.isContentEditable) return;
  if ($("work").hidden) return;
  const v = $("vid"); if (!v.src) return;
  if (e.code === "Space") { e.preventDefault(); v.paused ? v.play().catch(() => {}) : v.pause(); }
  else if (e.code === "ArrowLeft") { e.preventDefault(); v.currentTime = Math.max(0, v.currentTime - 5); }
  else if (e.code === "ArrowRight") { e.preventDefault(); v.currentTime = Math.min(v.duration || Infinity, v.currentTime + 5); }
});

$("find").addEventListener("input", () => ui.applySearch(segs, $("find").value));

/* ---------- input method tabs (upload vs record) ---------- */
function setMode(mode) {
  $("tabUpload").classList.toggle("on", mode === "upload"); $("tabUpload").setAttribute("aria-selected", mode === "upload");
  $("tabRecord").classList.toggle("on", mode === "record"); $("tabRecord").setAttribute("aria-selected", mode === "record");
  $("drop").hidden = mode !== "upload"; $("recordPanel").hidden = mode !== "record";
}
$("tabUpload").onclick = () => setMode("upload");
$("tabRecord").onclick = () => setMode("record");

/* ---------- microphone recording ---------- */
const mic = createMicRecorder({
  onTick: (secs) => { $("recTime").textContent = clock(secs); },
  onStart: () => { $("recDot").hidden = false; $("recLabel").textContent = "Recording…"; $("recStartBtn").hidden = true; $("recStopBtn").hidden = false; },
  onStop: () => { $("recDot").hidden = true; $("recLabel").textContent = "Record from your microphone"; $("recStartBtn").hidden = false; $("recStopBtn").hidden = true; $("recTime").textContent = "00:00"; },
  onFinished: (file) => addFiles([file]),
  onError: (msg) => toast("Microphone access failed: " + msg),
});
$("recStartBtn").onclick = mic.start;
$("recStopBtn").onclick = mic.stop;

/* ---------- batch queue ---------- */
function updateQueueUI(list) {
  const el = $("queueInfo");
  if (list.length) { el.hidden = false; el.textContent = list.length + " more file" + (list.length > 1 ? "s" : "") + " queued — will start automatically. Cancel stops the whole queue."; }
  else el.hidden = true;
}
const queue = createQueue({ onChange: updateQueueUI, onProcess: (file) => start(file) });
function addFiles(fileList) {
  const wasIdle = !running && queue.length === 0;
  queue.enqueue(fileList, wasIdle);
}

/* ---------- run ---------- */
function newWorker() {
  return new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
}

function finish(msg, pct) {
  running = false; try { wakeLock && wakeLock.release(); } catch (e) {}
  $("cancel").hidden = true; $("again").hidden = queue.length > 0;
  setStage(msg, pct); enableExport(segs.some(s => s.text.trim())); updateStats();
  if (segs.some(s => s.text.trim())) {
    saveHistory({
      id: Date.now(), name: curFile ? curFile.name : "transcript", date: new Date().toISOString(),
      duration: Math.max(0, ...segs.map(s => s.e)),
      segs: segs.map(s => ({ s: s.s, e: s.e, text: s.text, words: s.words || null })),
    });
  }
  if (queue.length) setTimeout(() => queue.processNext(), 700);
}

async function start(file) {
  if (!file) return;
  curFile = file;
  segs.length = 0; active = -1;
  ui.resetTranscript($("lines"), $("empty"));
  $("find").value = ""; enableExport(false); $("stats").hidden = true;
  $("home").hidden = true; $("work").hidden = false; window.scrollTo(0, 0);
  $("fname").textContent = file.name;
  $("novideo").hidden = true; $("speedrow").hidden = false;
  const v = $("vid"); if (v.src) URL.revokeObjectURL(v.src); v.src = URL.createObjectURL(file); v.playbackRate = 1;
  document.querySelectorAll(".speedrow [data-speed]").forEach(x => x.classList.toggle("on", x.dataset.speed === "1"));
  $("cancel").hidden = false; $("again").hidden = true; running = true;

  try { wakeLock = await navigator.wakeLock.request("screen"); } catch (e) {}   // keep the screen awake
  let audio = null;
  setStage("Reading the audio from your file…", 3);
  try { audio = await readWav(file); } catch (e) { audio = null; }
  if (!audio) {
    const secs = await mediaSeconds(file);          // the browser can only decode short files in one go
    if (file.size <= NATIVE_LIMIT && !(secs > NATIVE_SECONDS)) { try { audio = await readAudioNative(file); } catch (e) { audio = null; } }
  }
  if (!audio && running) {
    setStage("Extracting the audio from a large file. This can take a few minutes…", 3);
    try { audio = await readAudioFFmpeg(file, (p) => setStage("Extracting the audio… " + p + "%", 3 + p * 0.1)); }
    catch (e) {
      console.error(e);
      const why = (e && e.message ? e.message : String(e)).slice(0, 160) + (location.protocol === "file:" ? " (You opened the page from a file. Use the localhost steps shown on the home page.)" : "");
      if (running) { finish("Could not read the audio [" + why + "]. For very large files you need internet on the first run. Or extract the audio first as WAV (ffmpeg -i video.mp4 -vn -ac 1 -ar 16000 audio.wav) and drop that file instead.", 0); $("stage").className = "err"; }
      return;
    }
  }
  if (!running) return;

  worker = newWorker();
  worker.onerror = () => { finish("The speech engine could not start. Check your internet connection (needed on the first run) and try again.", 0); $("stage").className = "err"; };
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === "loading") setStage("Loading the speech model…", 5);
    else if (m.type === "download") setStage("Downloading the model (first run only): " + m.pct + "% · " + (m.device === "webgpu" ? "graphics chip" : "processor mode"), 5 + m.pct * 0.15);
    else if (m.type === "ready") {
      t0 = Date.now();
      const slow = m.device !== "webgpu" && m.seconds > 1200;
      setStage("Transcribing " + clock(m.seconds) + " of audio (" + (m.device === "webgpu" ? "using your graphics chip" : "processor mode, slower") + ")…" + (slow ? " This is slow without a graphics chip; Tiny model or Chrome/Edge will be much faster." : ""), 20);
    }
    else if (m.type === "segments") {
      m.segs.forEach(s => { segs.push(s); ui.addRow($("lines"), $("empty"), s, segs.length - 1, rowHandlers); });
      enableExport(true); updateStats(); highlightNow();
    }
    else if (m.type === "progress") {
      let eta = "";
      if (m.pct >= 3) { const left = (Date.now() - t0) / 1000 * (100 - m.pct) / m.pct; eta = " · about " + (left > 90 ? Math.ceil(left / 60) + " min" : Math.ceil(left) + " s") + " left"; }
      setStage("Transcribing… " + m.pct + "%" + eta + ". Keep this tab open.", 20 + m.pct * 0.8);
    }
    else if (m.type === "done") finish(segs.length ? "Done. Click a timestamp to jump, or edit any line." : "Done, but no speech was found in this file.", 100);
    else if (m.type === "stopped") finish("Stopped. What was transcribed so far is kept below.", null);
    else if (m.type === "error") { finish("Something went wrong: " + m.message, null); $("stage").className = "err"; }
  };
  worker.postMessage({
    type: "run", audio, model: $("model").value, language: $("lang").value || null,
    task: $("translate").checked ? "translate" : "transcribe",
  }, [audio.buffer]);
}

$("file").addEventListener("change", (e) => addFiles(e.target.files));
const drop = $("drop");
["dragenter", "dragover"].forEach(t => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(t => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));

$("cancel").onclick = () => {
  queue.clear();
  if (cancelFFmpeg()) { running = false; finish("Cancelled.", 0); return; }
  if (worker) worker.postMessage({ type: "stop" });
  running = false; setStage("Stopping after the current section…");
};
$("again").onclick = () => {
  if (worker) worker.terminate(); worker = null;
  cancelFFmpeg();
  $("vid").pause(); $("work").hidden = true; $("home").hidden = false; $("file").value = "";
};
