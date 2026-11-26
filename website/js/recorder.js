// Feature: recording straight from the microphone, so a live lecture or
// meeting can be transcribed the same way as an uploaded file. No DOM
// references here — callbacks report state changes to whoever wires the UI.

export function createMicRecorder({ onTick, onStart, onStop, onFinished, onError }) {
  let mediaRecorder = null, chunks = [], timer = null, startedAt = 0;

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
        const ext = (mediaRecorder.mimeType || "").includes("ogg") ? "ogg" : "webm";
        const file = new File([blob], "recording-" + new Date().toISOString().replace(/[:.]/g, "-") + "." + ext, { type: blob.type });
        onFinished && onFinished(file);
      };
      mediaRecorder.start();
      startedAt = Date.now();
      onStart && onStart();
      timer = setInterval(() => onTick && onTick((Date.now() - startedAt) / 1000), 500);
    } catch (e) {
      onError && onError(e && e.message ? e.message : String(e));
    }
  }

  function stop() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
    clearInterval(timer);
    onStop && onStop();
  }

  return { start, stop };
}
