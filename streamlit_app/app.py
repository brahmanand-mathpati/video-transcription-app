import os
import subprocess
import tempfile
import time

import pandas as pd
import streamlit as st
from faster_whisper import WhisperModel

st.set_page_config(page_title="Localscript (Streamlit)", page_icon="🎙️", layout="wide")

MODELS = {
    "Tiny · fastest": "tiny",
    "Base · balanced": "base",
    "Small · most accurate": "small",
}
LANGUAGES = {
    "Detect automatically": None,
    "English": "en", "Hindi": "hi", "Marathi": "mr", "Telugu": "te",
    "Tamil": "ta", "Kannada": "kn", "Bengali": "bn", "Urdu": "ur",
    "Spanish": "es", "French": "fr", "German": "de", "Portuguese": "pt",
    "Japanese": "ja", "Chinese": "zh",
}


@st.cache_resource(show_spinner=False)
def load_model(size: str) -> WhisperModel:
    # int8 keeps CPU memory and time reasonable on free-tier hosting
    return WhisperModel(size, device="cpu", compute_type="int8")


def extract_audio(src_path: str) -> str:
    """Pull mono 16 kHz audio out of any video/audio file with ffmpeg."""
    out_path = src_path + ".wav"
    cmd = ["ffmpeg", "-y", "-i", src_path, "-vn", "-ac", "1", "-ar", "16000", out_path]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0 or not os.path.exists(out_path):
        raise RuntimeError(result.stderr[-800:] if result.stderr else "ffmpeg failed")
    return out_path


def clock(t: float) -> str:
    t = max(0.0, t)
    h, rem = divmod(int(t), 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def srt_stamp(t: float) -> str:
    ms = round(max(0.0, t) * 1000)
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def vtt_stamp(t: float) -> str:
    return srt_stamp(t).replace(",", ".")


def build_txt(rows, with_time: bool) -> str:
    lines = []
    for r in rows:
        prefix = f"[{clock(r['start'])}] " if with_time else ""
        lines.append(prefix + r["text"].strip())
    return "\n".join(lines)


def build_srt(rows) -> str:
    blocks = []
    for i, r in enumerate(rows, 1):
        blocks.append(f"{i}\n{srt_stamp(r['start'])} --> {srt_stamp(r['end'])}\n{r['text'].strip()}\n")
    return "\n".join(blocks)


def build_vtt(rows) -> str:
    blocks = ["WEBVTT\n"]
    for r in rows:
        blocks.append(f"{vtt_stamp(r['start'])} --> {vtt_stamp(r['end'])}\n{r['text'].strip()}\n")
    return "\n".join(blocks)


st.markdown(
    """
<style>
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@700&family=IBM+Plex+Sans:wght@400;500&family=IBM+Plex+Mono:wght@400;500&display=swap');

:root {
  --teal: #0B6E6E; --teal-dark: #084F50; --amber: #F4B63F; --amber-soft: #2A2516;
  --bg: #0E1A1D; --surface: #152629; --ink: #EAF3F1; --muted: #9FB6B7; --line: #2A4044;
}
html, body, [class^="css"], [class*=" css"] { font-family: 'IBM Plex Sans', sans-serif; }
.stApp { background: var(--bg); color: var(--ink); }
h1, h2, h3 { font-family: 'Bricolage Grotesque', sans-serif !important; letter-spacing: -0.01em; }

section[data-testid="stSidebar"] { background: var(--surface); border-right: 1px solid var(--line); }

.ls-brand { display: flex; align-items: center; gap: 10px; margin-bottom: 2px; }
.ls-brand .dot { width: 14px; height: 14px; background: var(--teal); border-radius: 50% 50% 50% 0; display: inline-block; }
.ls-brand .name { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 700; font-size: 1.4rem; }
.ls-brand .tag { font-size: .72rem; color: var(--muted); background: var(--bg); border: 1px solid var(--line); padding: 2px 10px; border-radius: 99px; }
.ls-badges { display: flex; gap: 8px; margin: 10px 0 16px; flex-wrap: wrap; }
.ls-badge { font-size: .78rem; color: var(--teal); background: var(--amber-soft); border: 1px solid var(--amber); padding: 4px 10px; border-radius: 99px; }

[data-testid="stFileUploaderDropzone"] {
  background: var(--surface) !important;
  border: 2px dashed var(--teal) !important;
  border-radius: 16px !important;
}
[data-testid="stFileUploaderDropzone"]:hover { border-color: var(--amber) !important; }

.stButton > button, .stDownloadButton > button {
  background: var(--teal); color: #fff; border: 1px solid var(--teal); border-radius: 8px; font-weight: 500;
}
.stButton > button:hover, .stDownloadButton > button:hover { background: var(--teal-dark); border-color: var(--teal-dark); }

div[data-testid="stExpander"], div[data-testid="stStatusWidget"],
div[data-testid="stVerticalBlockBorderWrapper"] {
  background: var(--surface); border: 1px solid var(--line) !important; border-radius: 12px;
}
div[data-testid="stVerticalBlockBorderWrapper"] { padding: 4px 6px; }

.block-container { max-width: 880px; padding-top: 2rem; }

[data-baseweb="select"] > div { background: var(--surface) !important; border-color: var(--line) !important; border-radius: 8px !important; }
[data-testid="stCheckbox"] { background: transparent; }

.ls-step b { display: block; font-family: 'IBM Plex Mono', monospace; font-size: .72rem; color: var(--teal); letter-spacing: .04em; margin-bottom: 4px; }
.ls-step h4 { font-family: 'Bricolage Grotesque', sans-serif; margin: 0 0 4px; }
.ls-step p { color: var(--muted); font-size: .88rem; margin: 0; }
</style>
<div class="ls-brand"><span class="dot"></span><span class="name">Localscript</span><span class="tag">Streamlit edition</span></div>
<div class="ls-badges">
  <span class="ls-badge">⚡ Hosted transcription</span>
  <span class="ls-badge">🌐 14 languages</span>
  <span class="ls-badge">📝 TXT · SRT · VTT</span>
</div>
""",
    unsafe_allow_html=True,
)
st.caption(
    "Upload a video or audio file and get a timestamped transcript. "
    "Unlike the browser version, the file is processed on this server, not on your device."
)

with st.sidebar:
    st.header("Options")
    with st.container(border=True):
        model_label = st.selectbox("Model", list(MODELS.keys()), index=1)
        lang_label = st.selectbox("Spoken language", list(LANGUAGES.keys()), index=0)
        translate = st.checkbox("Translate the speech into English")
        with_time = st.checkbox("Add timestamps to .txt export", value=True)
    st.caption(
        "Free hosting tiers have no GPU and limited CPU/RAM. "
        "Prefer Tiny or Base for anything over a few minutes long, "
        "and upload audio-only files (e.g. .mp3) for long recordings."
    )

with st.container(border=True):
    uploaded = st.file_uploader(
        "Drop a video or audio file",
        type=["mp4", "mov", "webm", "mkv", "mp3", "wav", "m4a"],
    )
    if uploaded is None:
        st.caption("Up to 200 MB · MP4, MOV, WEBM, MKV, MP3, WAV, M4A")

if "rows" not in st.session_state:
    st.session_state.rows = []
if "fname" not in st.session_state:
    st.session_state.fname = None

if uploaded is None and not st.session_state.rows:
    st.markdown("<br>", unsafe_allow_html=True)
    c1, c2, c3 = st.columns(3)
    steps = [
        ("Step 01", "Upload a file", "Drop a video or audio file above, or pick one from your device."),
        ("Step 02", "Whisper transcribes it", "Runs on this server with faster-whisper. Lines stream in as they're produced."),
        ("Step 03", "Edit and export", "Fix any line in the table, then download TXT, SRT, or VTT."),
    ]
    for col, (num, title, body) in zip((c1, c2, c3), steps):
        with col:
            with st.container(border=True):
                st.markdown(
                    f'<div class="ls-step"><b>{num}</b><h4>{title}</h4><p>{body}</p></div>',
                    unsafe_allow_html=True,
                )

if "rows" not in st.session_state:
    st.session_state.rows = []
if "fname" not in st.session_state:
    st.session_state.fname = None

if uploaded is not None and st.button("Transcribe", type="primary"):
    st.session_state.rows = []
    st.session_state.fname = uploaded.name

    with tempfile.TemporaryDirectory() as tmp:
        src_path = os.path.join(tmp, uploaded.name)
        with open(src_path, "wb") as f:
            f.write(uploaded.getbuffer())

        status = st.status("Extracting audio…", expanded=True)
        try:
            wav_path = extract_audio(src_path)
        except Exception as e:
            status.update(label="Could not read the audio", state="error")
            st.error(f"ffmpeg could not extract audio from this file: {e}")
            st.stop()

        status.update(label="Loading the speech model…")
        model = load_model(MODELS[model_label])

        status.update(label="Transcribing…")
        t0 = time.time()
        segments, info = model.transcribe(
            wav_path,
            language=LANGUAGES[lang_label],
            task="translate" if translate else "transcribe",
            vad_filter=True,  # skip silence, same reasoning as the browser version
            beam_size=1,      # raise for more accuracy at the cost of speed
        )

        placeholder = st.empty()
        rows = []
        for seg in segments:
            rows.append({"start": seg.start, "end": seg.end, "text": seg.text.strip()})
            elapsed = time.time() - t0
            placeholder.markdown(
                f"**{clock(seg.end)}** transcribed so far · {elapsed:.0f}s elapsed\n\n"
                + "\n\n".join(f"`{clock(r['start'])}` {r['text']}" for r in rows[-8:])
            )
        st.session_state.rows = rows
        status.update(label=f"Done in {time.time() - t0:.0f}s", state="complete")

if st.session_state.rows:
    st.subheader("Transcript")
    df = pd.DataFrame(st.session_state.rows)
    edited = st.data_editor(
        df,
        column_config={
            "start": st.column_config.NumberColumn("Start (s)", disabled=True, format="%.2f"),
            "end": st.column_config.NumberColumn("End (s)", disabled=True, format="%.2f"),
            "text": st.column_config.TextColumn("Text", width="large"),
        },
        hide_index=True,
        use_container_width=True,
        key="editor",
    )
    rows = edited.to_dict("records")
    base = os.path.splitext(st.session_state.fname or "transcript")[0]

    col1, col2, col3, col4 = st.columns(4)
    col1.download_button("Copy / download .txt", build_txt(rows, with_time), f"{base}.txt", "text/plain")
    col2.download_button("Download .srt", build_srt(rows), f"{base}.srt", "application/x-subrip")
    col3.download_button("Download .vtt", build_vtt(rows), f"{base}.vtt", "text/vtt")
