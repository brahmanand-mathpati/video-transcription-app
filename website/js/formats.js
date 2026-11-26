// Export feature: turn segments into .txt/.srt/.vtt text, bundle them into a
// zero-dependency ZIP (store method, no compression library needed), and
// trigger a browser download.

import { clock, stamp } from "./utils.js";

export function buildTxt(segs, withTime) {
  return segs.filter(x => x.text.trim())
    .map(x => (withTime ? "[" + clock(x.s) + "] " : "") + x.text.trim())
    .join("\n");
}

export function buildSrt(segs) {
  return segs.filter(x => x.text.trim())
    .map((x, i) => (i + 1) + "\n" + stamp(x.s, ",") + " --> " + stamp(x.e, ",") + "\n" + x.text.trim() + "\n")
    .join("\n");
}

export function buildVtt(segs) {
  return "WEBVTT\n\n" + segs.filter(x => x.text.trim())
    .map(x => stamp(x.s, ".") + " --> " + stamp(x.e, ".") + "\n" + x.text.trim() + "\n")
    .join("\n");
}

export function saveFile(name, blobOrText, type) {
  const a = document.createElement("a");
  const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type: type + ";charset=utf-8" });
  a.href = URL.createObjectURL(blob);
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- tiny zero-dependency ZIP writer (store method) ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export function makeZip(files) {           // files: [{ name, text }]
  const enc = new TextEncoder();
  const { time, date } = dosDateTime();
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const nameB = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0, true);
    local.setUint16(8, 0, true); local.setUint16(10, time, true); local.setUint16(12, date, true);
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, nameB.length, true); local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), nameB, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0, true);
    cd.setUint16(10, 0, true); cd.setUint16(12, time, true); cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
    cd.setUint16(28, nameB.length, true); cd.setUint16(30, 0, true); cd.setUint16(32, 0, true);
    cd.setUint16(34, 0, true); cd.setUint16(36, 0, true); cd.setUint32(38, 0, true); cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameB);
    offset += local.byteLength + nameB.length + data.length;
  }
  const centralStart = offset;
  let centralSize = 0; for (const c of central) centralSize += c.length;
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true); end.setUint32(16, centralStart, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
}
