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


st.title("🎙️ Localscript — Streamlit edition")
st.caption(
    "Upload a video or audio file and get a timestamped transcript. "
    "Unlike the browser version, the file is processed on this server, not on your device."
)

with st.sidebar:
    st.header("Options")
    model_label = st.selectbox("Model", list(MODELS.keys()), index=1)
    lang_label = st.selectbox("Spoken language", list(LANGUAGES.keys()), index=0)
    translate = st.checkbox("Translate the speech into English")
    with_time = st.checkbox("Add timestamps to .txt export", value=True)
    st.markdown("---")
    st.caption(
        "Free hosting tiers have no GPU and limited CPU/RAM. "
        "Prefer Tiny or Base for anything over a few minutes long, "
        "and upload audio-only files (e.g. .mp3) for long recordings."
    )

uploaded = st.file_uploader(
    "Drop a video or audio file",
    type=["mp4", "mov", "webm", "mkv", "mp3", "wav", "m4a"],
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
