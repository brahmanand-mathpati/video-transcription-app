// Transcription engine, running in its own module Worker so the main thread
// never blocks. Loads Whisper via transformers.js, picks WebGPU when
// available, and streams back grouped, word-timestamped segments.
import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3";

const SR = 16000;
let asr = null, loadedKey = "", stop = false;

async function load(model) {
  let device = "wasm";
  try { if (self.navigator.gpu && await self.navigator.gpu.requestAdapter()) device = "webgpu"; } catch (e) {}
  const key = model + "|" + device;
  if (asr && key === loadedKey) return device;
  const files = {};
  const progress_callback = (p) => {
    if (p.status === "progress" && p.total) {
      files[p.file] = { l: p.loaded, t: p.total };
      let l = 0, t = 0;
      for (const f in files) { l += files[f].l; t += files[f].t; }
      postMessage({ type: "download", pct: Math.round(100 * l / t), device });
    }
  };
  const dtype = device === "webgpu"
    ? { encoder_model: "fp32", decoder_model_merged: "q4" }
    : { encoder_model: "q8", decoder_model_merged: "q8" };
  asr = await pipeline("automatic-speech-recognition", model, { device, dtype, progress_callback });
  loadedKey = key;
  return device;
}

// Cut near 30 s, but at the quietest moment so words are not sliced in half.
function nextEnd(a, start, sc) {
  const WIN = 30 * SR, SEARCH = 4 * SR, F = 1600;
  let end = Math.min(start + WIN, a.length);
  if (end >= a.length) return a.length;
  let best = end, bestE = Infinity;
  for (let p = end - SEARCH; p + F <= end; p += F) {
    let e = 0; for (let i = p; i < p + F; i++) { const v = a[i] * sc; e += v * v; }
    if (e < bestE) { bestE = e; best = p + (F >> 1); }
  }
  return best;
}
function toFloat(a, s, e) {            // one window at a time keeps memory low on 2-hour files
  if (a instanceof Float32Array) return a.subarray(s, e);
  const out = new Float32Array(e - s);
  for (let i = s; i < e; i++) out[i - s] = a[i] / 32768;
  return out;
}
function rms(a) { let e = 0; for (let i = 0; i < a.length; i++) e += a[i] * a[i]; return Math.sqrt(e / Math.max(1, a.length)); }

// Word-level chunks are grouped into readable lines (by word count, duration, or sentence end),
// while each line keeps its per-word timing for karaoke-style highlighting during playback.
function groupWords(words) {
  const MAXW = 12, MAXDUR = 7;
  const groups = []; let cur = [];
  for (const w of words) {
    if (!w.text || !w.text.trim()) continue;
    cur.push(w);
    const dur = w.e - cur[0].s;
    const endsSentence = /[.!?][)"'”]?$/.test(w.text.trim());
    if (cur.length >= MAXW || dur >= MAXDUR || endsSentence) { groups.push(cur); cur = []; }
  }
  if (cur.length) groups.push(cur);
  return groups.map((ws) => ({
    s: ws[0].s, e: ws[ws.length - 1].e,
    text: ws.map((x) => x.text).join("").replace(/\s+/g, " ").trim(),
    words: ws.map((x) => ({ w: x.text.trim(), s: x.s, e: x.e })).filter((w) => w.w),
  })).filter((g) => g.text);
}

onmessage = async (ev) => {
  const m = ev.data;
  if (m.type === "stop") { stop = true; return; }
  stop = false;
  try {
    postMessage({ type: "loading" });
    const device = await load(m.model);
    postMessage({ type: "ready", device, seconds: Math.round(m.audio.length / SR) });
    const a = m.audio, sc = a instanceof Float32Array ? 1 : 1 / 32768;
    let start = 0;
    while (start < a.length && !stop) {
      const end = nextEnd(a, start, sc);
      const chunk = toFloat(a, start, end);
      if (rms(chunk) > 0.004) {            // skip silence: Whisper invents words there
        const opts = { return_timestamps: "word", task: m.task };
        if (m.language) opts.language = m.language;
        const out = await asr(chunk, opts);
        const base = start / SR, endSec = end / SR;
        const words = (out.chunks && out.chunks.length ? out.chunks : [{ timestamp: [0, null], text: out.text }])
          .map(c => ({
            text: (c.text || ""),
            s: base + (c.timestamp[0] || 0),
            e: c.timestamp[1] == null ? endSec : base + c.timestamp[1],
          }));
        const segs = groupWords(words);
        if (segs.length) postMessage({ type: "segments", segs });
      }
      start = end;
      postMessage({ type: "progress", pct: Math.round(100 * start / a.length) });
    }
    postMessage({ type: stop ? "stopped" : "done" });
  } catch (err) {
    postMessage({ type: "error", message: String(err && err.message || err) });
  }
};
