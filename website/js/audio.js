// Feature: turning a dropped file into 16 kHz mono PCM, by whichever of the
// three routes fits the file, without ever loading more than one piece of a
// multi-hour recording into memory at once.

export const NATIVE_LIMIT = 200 * 1024 * 1024;   // above these, use the piece-by-piece routes
export const NATIVE_SECONDS = 1800;

// Route 0 (any length): 16-bit WAV is read in small pieces, so a 2-hour file never fills memory.
export async function readWav(file) {
  const head = new DataView(await file.slice(0, 65536).arrayBuffer());
  if (head.byteLength < 44 || head.getUint32(0) !== 0x52494646 || head.getUint32(8) !== 0x57415645) return null;
  let p = 12, fmt = null, dataStart = 0, dataLen = 0;
  while (p + 8 <= head.byteLength) {
    const id = head.getUint32(p), sz = head.getUint32(p + 4, true);
    if (id === 0x666d7420) fmt = { tag: head.getUint16(p + 8, true), ch: head.getUint16(p + 10, true), rate: head.getUint32(p + 12, true), bits: head.getUint16(p + 22, true) };
    else if (id === 0x64617461) { dataStart = p + 8; dataLen = sz; break; }
    p += 8 + sz + (sz & 1);
  }
  if (!fmt || !dataStart || fmt.bits !== 16 || (fmt.tag !== 1 && fmt.tag !== 0xFFFE) || !fmt.ch) return null;
  dataLen = Math.min(dataLen, file.size - dataStart);
  const ch = fmt.ch, frame = 2 * ch, frames = Math.floor(dataLen / frame), ratio = fmt.rate / 16000;
  const outN = Math.floor(frames / ratio), out = new Int16Array(outN), BLK = 1 << 20;
  for (let o0 = 0; o0 < outN; o0 += BLK) {
    const o1 = Math.min(outN, o0 + BLK), f0 = Math.floor(o0 * ratio), f1 = Math.min(frames, Math.floor(o1 * ratio) + 1);
    const buf = new Int16Array(await file.slice(dataStart + f0 * frame, dataStart + f1 * frame).arrayBuffer());
    const n = f1 - f0, mono = new Float32Array(n);
    for (let i = 0; i < n; i++) { let v = 0; for (let c = 0; c < ch; c++) v += buf[i * ch + c]; mono[i] = v / ch; }
    for (let o = o0; o < o1; o++) {                       // average the input frames that fall into each output sample
      const a = Math.floor(o * ratio) - f0, b = Math.max(a + 1, Math.min(n, Math.floor((o + 1) * ratio) - f0));
      let v = 0; for (let i = a; i < b; i++) v += mono[i];
      out[o] = v / (b - a);
    }
  }
  return out;
}

// Route 1 (fast, small files): the browser decodes the audio itself.
export async function readAudioNative(file) {
  const buf = await file.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  let ab;
  try { ab = await ctx.decodeAudioData(buf); } finally { ctx.close(); }
  const n = ab.length, ch = ab.numberOfChannels, out = new Int16Array(n);
  const data = []; for (let c = 0; c < ch; c++) data.push(ab.getChannelData(c));
  for (let i = 0; i < n; i++) {
    let v = 0; for (let c = 0; c < ch; c++) v += data[c][i];
    v = v / ch * 32768; out[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
  }
  return out;
}

export function mediaSeconds(file) {
  return new Promise((res) => {
    const m = document.createElement("video"), u = URL.createObjectURL(file);
    const done = (d) => { URL.revokeObjectURL(u); res(d); };
    m.preload = "metadata"; m.onloadedmetadata = () => done(m.duration); m.onerror = () => done(NaN);
    setTimeout(() => done(NaN), 8000); m.src = u;
  });
}

// Route 2 (long or big files): ffmpeg reads the file in pieces and writes only the speech audio (16 kHz mono).
const FF = "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/";
const CORE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/";
let ff = null;

export async function readAudioFFmpeg(file, onProgress) {
  const { FFmpeg } = await import(/* webpackIgnore: true */ FF + "index.js");
  const wrap = URL.createObjectURL(new Blob(['import "' + FF + 'worker.js";'], { type: "text/javascript" }));
  ff = new FFmpeg();
  ff.on("progress", ({ progress }) => { if (progress > 0 && progress <= 1) onProgress(Math.round(progress * 100)); });
  await ff.load({ classWorkerURL: wrap, coreURL: CORE + "ffmpeg-core.js", wasmURL: CORE + "ffmpeg-core.wasm" });
  try { await ff.createDir("/in"); } catch (e) {}
  await ff.mount("WORKERFS", { files: [new File([file], "input")] }, "/in");
  const code = await ff.exec(["-i", "/in/input", "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "/out.pcm"]);
  if (code !== 0) throw new Error("ffmpeg could not find audio in this file");
  const u8 = await ff.readFile("/out.pcm");
  ff.terminate(); ff = null;
  return new Int16Array(u8.buffer, u8.byteOffset, u8.byteLength >> 1);
}

export function cancelFFmpeg() {
  if (ff) { try { ff.terminate(); } catch (e) {} ff = null; return true; }
  return false;
}
