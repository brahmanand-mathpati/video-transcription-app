// Small, dependency-free formatting helpers shared by the rest of the app.

export function pad(n, w = 2) {
  return String(n).padStart(w, "0");
}

export function clock(t) {
  t = Math.max(0, t || 0);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
  return (h ? pad(h) + ":" : "") + pad(m) + ":" + pad(s);
}

export function stamp(t, sep) {
  t = Math.max(0, t);
  const ms = Math.round(t * 1000);
  return pad(Math.floor(ms / 3600000)) + ":" + pad(Math.floor((ms % 3600000) / 60000)) + ":" + pad(Math.floor((ms % 60000) / 1000)) + sep + pad(ms % 1000, 3);
}

export function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
