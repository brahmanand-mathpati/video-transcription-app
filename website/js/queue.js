// Feature: a simple FIFO batch queue, so dropping several files (or adding
// more while one is processing) transcribes them one after another.

export function createQueue({ onChange, onProcess }) {
  const files = [];

  function enqueue(fileList, isIdle) {
    const arr = Array.from(fileList || []);
    if (!arr.length) return;
    files.push(...arr);
    onChange && onChange(files);
    if (isIdle) processNext();
  }

  function processNext() {
    if (!files.length) { onChange && onChange(files); return; }
    const file = files.shift();
    onChange && onChange(files);
    onProcess && onProcess(file);
  }

  function clear() {
    files.length = 0;
    onChange && onChange(files);
  }

  return { enqueue, processNext, clear, get length() { return files.length; } };
}
