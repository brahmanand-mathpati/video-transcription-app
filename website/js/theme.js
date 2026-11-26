// Dark/light theme feature: persisted in localStorage, falls back to the
// system preference, degrades gracefully if storage is unavailable.

const KEY = "ls-theme";
const SUN_PATH = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
const MOON_PATH = '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>';

function readStored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
function writeStored(t) { try { localStorage.setItem(KEY, t); } catch (e) {} }

export function iconPathFor(theme) { return theme === "dark" ? MOON_PATH : SUN_PATH; }

export function initialTheme() {
  return readStored() || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

export function applyTheme(theme, iconEl) {
  document.documentElement.dataset.theme = theme;
  if (iconEl) iconEl.innerHTML = iconPathFor(theme);
}

export function toggleTheme(current, iconEl) {
  const next = current === "dark" ? "light" : "dark";
  writeStored(next);
  applyTheme(next, iconEl);
  return next;
}
