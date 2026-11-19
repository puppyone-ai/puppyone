const status = document.getElementById("status");
const out = document.getElementById("out");

function setStatus(text, ok = true) {
  status.textContent = text;
  status.className = ok ? "ok" : "err";
  window.puppyoneViewer?.ui.setState({
    status: ok ? "ready" : "error",
    message: text,
  });
}

async function main() {
  if (!window.puppyoneViewer) {
    setStatus("puppyoneViewer bridge missing", false);
    return;
  }
  window.puppyoneViewer.ui.setState({ status: "loading", message: "Opening document" });
  const meta = await window.puppyoneViewer.document.getMeta();
  const handle = await window.puppyoneViewer.resource.open();
  try {
    const header = new Uint8Array(await window.puppyoneViewer.resource.readRange({
      handle: handle.handle,
      offset: 0,
      length: Math.min(12, handle.sizeBytes || 12),
    }));
    const magic = String.fromCharCode(...header.slice(0, 4));
    out.textContent = JSON.stringify({
      name: meta.name,
      sizeBytes: meta.sizeBytes,
      revision: meta.revision,
      magic,
      headerHex: [...header].map((byte) => byte.toString(16).padStart(2, "0")).join(" "),
    }, null, 2);
    if (magic === "glTF") setStatus("GLB header verified via bounded Range read");
    else setStatus(`Unexpected magic "${magic}"`, false);
  } finally {
    await window.puppyoneViewer.resource.close(handle.handle);
  }
}

main().catch((error) => {
  setStatus(error?.message || String(error), false);
  out.textContent = String(error?.stack || error);
});
