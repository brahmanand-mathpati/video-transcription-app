# Localscript — video/audio to text

Turn a video or audio file into a timestamped, editable transcript. Built two ways, same idea: **your recording stays private**.

![Localscript screenshot](website/assets/screenshot.jpg)

## Two ways to use it

| | [`website/`](website) (static, no build step) | [`streamlit_app/`](streamlit_app) |
|---|---|---|
| Runs | Entirely in your browser (Whisper via [transformers.js](https://github.com/huggingface/transformers.js)) | On a server (Whisper via [faster-whisper](https://github.com/SYSTRAN/faster-whisper)) |
| Your file | Never leaves your device | Uploaded to wherever the app runs |
| Hosting | Any static host, free | Streamlit Community Cloud, free |
| Best for | Privacy, no install | A hosted link you can share, Python-based workflows |

### Features

- Drop a file, drag-drop several to queue them, or record straight from your microphone
- 14 languages, with automatic detection and optional translation to English
- Word-level timestamps — the exact word being spoken highlights as the video plays
- Click any timestamp to jump the video there; edit any line inline
- Search the transcript, copy a single line, or export `.txt`, `.srt`, `.vtt`, or a bundled `.zip`
- On-device history (website version) — revisit or delete past transcripts, nothing leaves your browser
- Dark/light mode, keyboard shortcuts (`Space` play/pause, `←`/`→` seek)

## Quick start

**Website** (no install, works offline after the first load):
```powershell
cd website
python -m http.server 8000
```
Open `http://localhost:8000` in Chrome or Edge. (Opening `index.html` directly by double-click will show a warning — browsers block the speech worker for `file://` pages.)

**Streamlit app** (needs Python + ffmpeg):
```powershell
cd streamlit_app
pip install -r requirements.txt
streamlit run app.py
```
See [`streamlit_app/README.md`](streamlit_app/README.md) for deployment to Streamlit Community Cloud.

## Code layout (`website/`)

```
website/
├── index.html        markup only
├── css/styles.css     all styling (light/dark theme via CSS variables)
└── js/
    ├── main.js        app entry point — owns state, wires up every feature
    ├── ui.js          DOM rendering: transcript rows, history list, toasts
    ├── db.js          data layer — transcript history (IndexedDB)
    ├── audio.js       turns a dropped file into 16 kHz PCM (3 routes, up to ~2h)
    ├── formats.js     TXT/SRT/VTT export + zero-dependency ZIP writer
    ├── theme.js       dark/light mode
    ├── recorder.js    microphone recording feature
    ├── queue.js       batch file queue feature
    └── worker.js      the Whisper transcription engine (runs off the main thread)
```
Plain ES modules, no bundler or build step — open `index.html` through a local server (see Quick start) and the browser resolves the imports directly.

## Why both exist

The website is the privacy-first default — nothing you record or upload ever leaves your machine. The Streamlit app trades that off for a shareable hosted link and a Python-based pipeline, useful when you want to send someone a URL instead of a file.

## License

[MIT](LICENSE)
