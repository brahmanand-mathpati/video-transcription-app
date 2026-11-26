# Localscript — Streamlit edition

Upload a video or audio file, get a timestamped transcript, edit it, export `.txt` / `.srt` / `.vtt`.

Unlike the browser-only version in the parent folder, the file is uploaded to wherever this
app runs and transcribed there (CPU, via [faster-whisper](https://github.com/SYSTRAN/faster-whisper)).
It is not private/local the way the single-file website is.

## Run locally

```powershell
cd streamlit_app
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

You also need `ffmpeg` on your system `PATH` (not just in `packages.txt`, which is only read by
Streamlit Community Cloud). On Windows: `winget install ffmpeg` or `choco install ffmpeg`.

```powershell
streamlit run app.py
```

## Deploy to Streamlit Community Cloud

1. Push this repo (or at least the `streamlit_app/` folder) to GitHub.
2. Go to https://share.streamlit.io and sign in with GitHub.
3. Click **Create app** → pick the repo/branch → set **Main file path** to `streamlit_app/app.py`.
4. Deploy. Streamlit installs `requirements.txt` and the apt packages in `packages.txt`
   (which installs `ffmpeg`) automatically.

### Free-tier limits to plan around

- Roughly 0.078–2 CPU cores and 690 MB–2.7 GB RAM, no GPU.
- Use the **Tiny** or **Base** model there; **Small** will be slow and may hit memory limits.
- For long recordings, upload audio only (e.g. `.mp3`) — the whole upload is held in server memory.
- Keep the browser tab open while it transcribes.

## Differences from the website version

| | Website (`index.html`) | Streamlit (`app.py`) |
|---|---|---|
| Where it runs | Entirely in your browser | Uploaded to the Streamlit server |
| Privacy | File never leaves your device | File leaves your device |
| Max practical length | ~2 hours (tested) | Short clips on free tier; longer locally |
| Hosting | Any static host, free | Streamlit Community Cloud, free |
