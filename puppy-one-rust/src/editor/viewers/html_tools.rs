//! Interactive overlay tools for standalone HTML File Mode (`FileWindow`):
//! - Runtime JS error observer (`window.onerror` / `unhandledrejection`)
//! - DOM Element Picker (`PickElement` / 指哪改哪) with Rust source-line mapping
//! - Document-anchored Retina `<canvas>` Annotation (`Annotate` / 画笔批注 & `Laser`)
//! - Region / DOM-Card-Snap / Viewport / Full-Page Screenshot (`Screenshot` / 截屏)
//!
//! This module lives inside `po-editor` and communicates with `po-app` strictly
//! through [`HtmlToolMode`], [`HtmlToolSnapshot`], [`HtmlToolAction`], and
//! [`HtmlToolEvent`] on [`crate::editor::registry::ViewerSurface`].

use crate::localization::t;

/// Active interactive overlay tool inside the standalone HTML preview page.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum HtmlToolMode {
    #[default]
    None,
    PickElement,
    Annotate,
    Screenshot,
    Laser,
}

impl HtmlToolMode {
    pub fn as_js_name(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::PickElement => "pick",
            Self::Annotate => "annotate",
            Self::Screenshot => "screenshot",
            Self::Laser => "laser",
        }
    }

    pub fn from_js_name(raw: &str) -> Self {
        match raw {
            "pick" => Self::PickElement,
            "annotate" => Self::Annotate,
            "screenshot" => Self::Screenshot,
            "laser" => Self::Laser,
            _ => Self::None,
        }
    }
}

/// Uncaught script error or unhandled promise rejection reported by the page.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HtmlJsError {
    pub message: String,
    pub line: Option<u32>,
    pub column: Option<u32>,
}

/// Read-only snapshot of HTML File Mode tool state exposed to `FileWindow`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct HtmlToolSnapshot {
    pub mode: HtmlToolMode,
    pub js_errors: Vec<HtmlJsError>,
    pub has_annotations: bool,
    pub visual_edit: bool,
    pub source_open: bool,
}

/// Imperative HTML File Mode actions triggered by Header / More menu controls.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HtmlToolAction {
    /// Reloads the live WebView, resetting DOM state, JS errors, and overlays.
    ReloadAndReset,
    /// Captures and stitches a full-page vertical screenshot into a single PNG.
    CaptureFullPage,
    /// Clears any drawn `<canvas>` annotations without reloading the page.
    ClearAnnotations,
    /// Dismisses recorded runtime JS errors.
    ClearErrors,
}

/// Asynchronous events emitted by the HTML surface back to `FileWindow`.
#[derive(Clone, Debug, PartialEq)]
pub enum HtmlToolEvent {
    /// Tool mode, JS error count, or annotation presence changed.
    StateChanged,
    /// User clicked an element in `PickElement` mode.
    ElementPicked {
        selector: String,
        tag: String,
        lines: Option<(u32, u32)>,
        text_preview: String,
        html_snippet: String,
    },
    /// User captured a region, snapped element, annotated page, or full page to copy.
    CopyScreenshot {
        png: Vec<u8>,
        label: String,
    },
    /// User clicked "Send to Agent" from the annotation toolbar with drawn marks.
    SendAnnotatedToAgent {
        png: Vec<u8>,
        stroke_count: usize,
    },
}

/// Escapes a string for safe interpolation as a JS string literal inside `<script>`.
fn js_str(value: &str) -> String {
    serde_json::Value::String(value.to_owned())
        .to_string()
        .replace('<', "\\u003c")
}

const TOOLS_CSS: &str = include_str!("../../../assets/web/html-file-tools.css");

/// Returns the `<style>` + `<script>` bundle injected into `<head>` when an HTML
/// document is opened in standalone `FileWindow` mode.
pub fn injected_head_bundle() -> String {
    let pick_banner = js_str(t("fileMode.html.pickBanner"));
    let pen_draw = js_str(t("fileMode.html.penDraw"));
    let pen_highlight = js_str(t("fileMode.html.penHighlight"));
    let pen_rect = js_str(t("fileMode.html.penRect"));
    let pen_laser = js_str(t("fileMode.html.penLaser"));
    let pen_undo = js_str(t("fileMode.html.penUndo"));
    let pen_clear = js_str(t("fileMode.html.penClear"));
    let pen_copy = js_str(t("fileMode.html.penCopy"));
    let pen_send = js_str(t("fileMode.html.penSendAgent"));
    let shot_region = js_str(t("fileMode.html.shotRegion"));
    let shot_snap = js_str(t("fileMode.html.shotSnap"));
    let shot_viewport = js_str(t("fileMode.html.shotViewport"));
    let shot_hint = js_str(t("fileMode.html.shotHint"));

    format!(
        r#"<style id="puppyone-html-file-tools-style" data-po-tool-ui="1">{TOOLS_CSS}</style>
<script id="puppyone-html-file-tools-script" data-po-tool-ui="1">
(()=>{{
  if (window.__puppyoneHtmlTools) return;
  const ipc = window.ipc;
  const post = (msg) => {{ try {{ ipc && ipc.postMessage(JSON.stringify(msg)); }} catch (_) {{}} }};
  const LABELS = {{
    pickBanner: {pick_banner},
    penDraw: {pen_draw},
    penHighlight: {pen_highlight},
    penRect: {pen_rect},
    penLaser: {pen_laser},
    penUndo: {pen_undo},
    penClear: {pen_clear},
    penCopy: {pen_copy},
    penSend: {pen_send},
    shotRegion: {shot_region},
    shotSnap: {shot_snap},
    shotViewport: {shot_viewport},
    shotHint: {shot_hint}
  }};

  let errCount = 0;
  let lastErr = '';
  const reportErr = (message, line, col) => {{
    const text = String(message || 'Script error').trim();
    if (!text || text === lastErr || errCount >= 20) return;
    lastErr = text;
    errCount += 1;
    post({{
      type: 'po-tool',
      kind: 'js-error',
      message: text.slice(0, 400),
      line: typeof line === 'number' && line > 0 ? line : null,
      col: typeof col === 'number' && col > 0 ? col : null
    }});
  }};
  window.addEventListener('error', (e) => {{
    if (e && e.message) reportErr(e.message, e.lineno, e.colno);
  }});
  window.addEventListener('unhandledrejection', (e) => {{
    const r = e && e.reason;
    const msg = r instanceof Error ? (r.message || String(r)) : String(r || 'Unhandled promise rejection');
    reportErr('Unhandled Rejection: ' + msg, null, null);
  }});

  let mode = 'none';
  let penKind = 'pen';
  let penColor = '#ef4444';
  let shotKind = 'region';
  const strokes = [];
  let activeStroke = null;
  const laserPoints = [];
  let laserRaf = 0;
  let dragShot = null;
  let snapTarget = null;
  let pickTarget = null;
  let canvas = null;
  let ctx = null;
  let canvasScale = 1;
  let topBar = null;
  let bottomBar = null;
  let hoverBox = null;
  let hoverTag = null;
  let shotMask = null;
  let shotBox = null;
  let fullPageJob = null;

  const isToolUi = (el) => !!(el && el.closest && el.closest('[data-po-tool-ui="1"]'));
  const isChrome = (el) => !!(el && el.closest && el.closest('[data-po-chrome="1"]'));

  const syncState = () => {{
    post({{
      type: 'po-tool',
      kind: 'state',
      mode,
      hasAnnotations: strokes.length > 0
    }});
  }};

  const mk = (tag, attrs, text) => {{
    const el = document.createElement(tag);
    el.setAttribute('data-po-tool-ui', '1');
    if (attrs) {{
      for (const [k, v] of Object.entries(attrs)) {{
        if (k === 'className') el.className = v;
        else el.setAttribute(k, v);
      }}
    }}
    if (text != null) el.textContent = text;
    return el;
  }};

  const docMetrics = () => {{
    const de = document.documentElement;
    const b = document.body;
    const w = Math.max(window.innerWidth || 1, de ? de.scrollWidth : 0, b ? b.scrollWidth : 0);
    const h = Math.max(window.innerHeight || 1, de ? de.scrollHeight : 0, b ? b.scrollHeight : 0);
    return {{ w, h }};
  }};

  const ensureDom = () => {{
    const host = document.body || document.documentElement;
    if (!host) return false;
    if (!canvas) {{
      canvas = mk('canvas', {{ id: '__po_pen_canvas' }});
      host.appendChild(canvas);
      ctx = canvas.getContext('2d');
      canvas.addEventListener('pointerdown', onCanvasDown);
      canvas.addEventListener('pointermove', onCanvasMove);
      window.addEventListener('pointerup', onCanvasUp);
    }}
    if (!hoverBox) {{
      hoverBox = mk('div', {{ id: '__po_hover_box', 'data-po-chrome': '1' }});
      hoverTag = mk('div', {{ id: '__po_hover_tag', 'data-po-chrome': '1' }});
      shotMask = mk('div', {{ id: '__po_shot_mask', 'data-po-chrome': '1' }});
      shotBox = mk('div', {{ id: '__po_shot_box', 'data-po-chrome': '1' }});
      shotMask.addEventListener('pointerdown', onShotDown);
      shotMask.addEventListener('pointermove', onShotMove);
      window.addEventListener('pointerup', onShotUp);
      host.appendChild(hoverBox);
      host.appendChild(hoverTag);
      host.appendChild(shotMask);
      host.appendChild(shotBox);
    }}
    resizeCanvas();
    return true;
  }};

  const resizeCanvas = () => {{
    if (!canvas || !ctx) return;
    const {{ w, h }} = docMetrics();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const maxSide = 8192;
    const scale = Math.min(dpr, maxSide / Math.max(w, 1), maxSide / Math.max(h, 1));
    const bw = Math.max(1, Math.round(w * scale));
    const bh = Math.max(1, Math.round(h * scale));
    if (canvas.width !== bw || canvas.height !== bh) {{
      canvas.width = bw;
      canvas.height = bh;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      canvasScale = scale;
      redrawCanvas();
    }}
  }};

  const drawOneStroke = (s) => {{
    if (!ctx || !s.points || !s.points.length) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = s.color;
    if (s.kind === 'highlighter') {{
      ctx.globalAlpha = 0.34;
      ctx.lineWidth = 16;
    }} else {{
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2.6;
    }}
    if (s.kind === 'rect') {{
      const p0 = s.points[0];
      const p1 = s.points[s.points.length - 1];
      const x = Math.min(p0.x, p1.x);
      const y = Math.min(p0.y, p1.y);
      const w = Math.abs(p1.x - p0.x);
      const h = Math.abs(p1.y - p0.y);
      ctx.strokeRect(x, y, w, h);
    }} else {{
      ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length; i++) {{
        ctx.lineTo(s.points[i].x, s.points[i].y);
      }}
      ctx.stroke();
    }}
    ctx.restore();
  }};

  const redrawCanvas = () => {{
    if (!ctx || !canvas) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(canvasScale, 0, 0, canvasScale, 0, 0);
    for (const s of strokes) drawOneStroke(s);
    if (activeStroke) drawOneStroke(activeStroke);
    const now = performance.now();
    while (laserPoints.length && now - laserPoints[0].t > 1500) laserPoints.shift();
    if (laserPoints.length > 1) {{
      for (let i = 1; i < laserPoints.length; i++) {{
        const p0 = laserPoints[i - 1];
        const p1 = laserPoints[i];
        if (p1.gap) continue;
        const age = (now - p1.t) / 1500;
        const alpha = Math.max(0, 1 - age);
        ctx.save();
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#ef4444';
        ctx.shadowColor = '#ef4444';
        ctx.shadowBlur = 10;
        ctx.globalAlpha = alpha * 0.9;
        ctx.lineWidth = 4.5 * (0.45 + 0.55 * alpha);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
        ctx.restore();
      }}
      if (!laserRaf) {{
        laserRaf = requestAnimationFrame(() => {{
          laserRaf = 0;
          redrawCanvas();
        }});
      }}
    }}
  }};

  let laserDrawing = false;
  const pagePoint = (e) => ({{ x: e.clientX + window.scrollX, y: e.clientY + window.scrollY }});
  const effectivePen = () => (mode === 'laser' ? 'laser' : penKind);

  const onCanvasDown = (e) => {{
    if (mode !== 'annotate' && mode !== 'laser') return;
    if (e.button !== 0 || isChrome(e.target)) return;
    e.preventDefault();
    resizeCanvas();
    const pt = pagePoint(e);
    if (effectivePen() === 'laser') {{
      laserDrawing = true;
      laserPoints.push({{ x: pt.x, y: pt.y, t: performance.now(), gap: true }});
      redrawCanvas();
      return;
    }}
    activeStroke = {{
      kind: effectivePen(),
      color: penColor,
      points: [pt]
    }};
    redrawCanvas();
  }};

  const onCanvasMove = (e) => {{
    if (mode !== 'annotate' && mode !== 'laser') return;
    const pt = pagePoint(e);
    if (effectivePen() === 'laser') {{
      if (!laserDrawing) return;
      laserPoints.push({{ x: pt.x, y: pt.y, t: performance.now(), gap: false }});
      redrawCanvas();
      return;
    }}
    if (!activeStroke) return;
    if (activeStroke.kind === 'rect') {{
      activeStroke.points = [activeStroke.points[0], pt];
    }} else {{
      activeStroke.points.push(pt);
    }}
    redrawCanvas();
  }};

  const onCanvasUp = () => {{
    laserDrawing = false;
    if (!activeStroke) return;
    strokes.push(activeStroke);
    activeStroke = null;
    redrawCanvas();
    renderBars();
    syncState();
  }};

  const hideChromeAndCapture = (payload) => {{
    const els = document.querySelectorAll('[data-po-chrome="1"]');
    els.forEach((el) => {{
      el.setAttribute('data-po-prev-vis', el.style.visibility || '');
      el.style.visibility = 'hidden';
    }});
    requestAnimationFrame(() => {{
      requestAnimationFrame(() => {{
        post(payload);
      }});
    }});
  }};

  const restoreChrome = () => {{
    const els = document.querySelectorAll('[data-po-chrome="1"]');
    els.forEach((el) => {{
      const prev = el.getAttribute('data-po-prev-vis') || '';
      el.style.visibility = prev;
      el.removeAttribute('data-po-prev-vis');
    }});
  }};

  const elementSelector = (el) => {{
    const tag = (el.tagName || 'div').toLowerCase();
    if (el.id) return tag + '#' + el.id;
    const cls = Array.from(el.classList || []).filter((c) => !c.startsWith('__po_')).slice(0, 2);
    return cls.length ? tag + '.' + cls.join('.') : tag;
  }};

  const placeHover = (el) => {{
    if (!hoverBox || !hoverTag || !el) {{
      if (hoverBox) hoverBox.style.display = 'none';
      if (hoverTag) hoverTag.style.display = 'none';
      return;
    }}
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    hoverBox.style.display = 'block';
    hoverBox.style.left = r.left + 'px';
    hoverBox.style.top = r.top + 'px';
    hoverBox.style.width = r.width + 'px';
    hoverBox.style.height = r.height + 'px';
    hoverTag.style.display = 'block';
    hoverTag.textContent = elementSelector(el) + ' · ' + Math.round(r.width) + '×' + Math.round(r.height);
    hoverTag.style.left = Math.max(8, Math.min(window.innerWidth - 180, r.left)) + 'px';
    hoverTag.style.top = (r.top > 28 ? r.top - 24 : Math.min(window.innerHeight - 26, r.bottom + 6)) + 'px';
  }};

  const onDocMove = (e) => {{
    if (mode !== 'pick') return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || isToolUi(el) || el === document.documentElement || el === document.body) {{
      pickTarget = null;
      placeHover(null);
      return;
    }}
    pickTarget = el;
    placeHover(el);
  }};

  const onDocClick = (e) => {{
    if (mode !== 'pick') return;
    if (isChrome(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    const el = pickTarget || document.elementFromPoint(e.clientX, e.clientY);
    if (!el || isToolUi(el)) return;
    const tag = (el.tagName || 'div').toLowerCase();
    const allSame = Array.from(document.getElementsByTagName(tag)).filter((n) => !isToolUi(n));
    const idx = Math.max(0, allSame.indexOf(el));
    const classes = Array.from(el.classList || []).filter((c) => !c.startsWith('__po_'));
    const text = String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const html = String(el.outerHTML || '').replace(/\s+/g, ' ').trim().slice(0, 360);
    setMode('none');
    post({{
      type: 'po-tool',
      kind: 'picked',
      selector: elementSelector(el),
      tag,
      id: el.id || '',
      classes,
      index: idx,
      text,
      html
    }});
  }};

  const pickSnapCandidate = (x, y) => {{
    if (!shotMask) return null;
    shotMask.style.pointerEvents = 'none';
    let el = document.elementFromPoint(x, y);
    shotMask.style.pointerEvents = 'auto';
    while (el && el !== document.body && el !== document.documentElement) {{
      if (isToolUi(el)) return null;
      const r = el.getBoundingClientRect();
      if (r.width >= 48 && r.height >= 28 && (r.width < window.innerWidth * 0.96 || r.height < window.innerHeight * 0.92)) {{
        return el;
      }}
      el = el.parentElement;
    }}
    return null;
  }};

  const onShotDown = (e) => {{
    if (mode !== 'screenshot' || isChrome(e.target) && e.target !== shotMask) return;
    if (shotKind === 'snap') {{
      const el = snapTarget || pickSnapCandidate(e.clientX, e.clientY);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const pad = 4;
      const x = Math.max(0, r.left - pad);
      const y = Math.max(0, r.top - pad);
      const w = Math.min(window.innerWidth - x, r.width + pad * 2);
      const h = Math.min(window.innerHeight - y, r.height + pad * 2);
      setMode('none');
      hideChromeAndCapture({{
        type: 'po-tool',
        kind: 'snapshot',
        purpose: 'copy-screenshot',
        crop: [x, y, w, h],
        viewport: [window.innerWidth || 1, window.innerHeight || 1],
        label: elementSelector(el)
      }});
      return;
    }}
    dragShot = {{ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY }};
    if (shotBox) {{
      shotBox.style.display = 'block';
      shotBox.style.left = e.clientX + 'px';
      shotBox.style.top = e.clientY + 'px';
      shotBox.style.width = '0px';
      shotBox.style.height = '0px';
    }}
  }};

  const onShotMove = (e) => {{
    if (mode !== 'screenshot') return;
    if (shotKind === 'snap') {{
      snapTarget = pickSnapCandidate(e.clientX, e.clientY);
      placeHover(snapTarget);
      return;
    }}
    if (!dragShot || !shotBox) return;
    dragShot.x1 = e.clientX;
    dragShot.y1 = e.clientY;
    const x = Math.min(dragShot.x0, dragShot.x1);
    const y = Math.min(dragShot.y0, dragShot.y1);
    const w = Math.abs(dragShot.x1 - dragShot.x0);
    const h = Math.abs(dragShot.y1 - dragShot.y0);
    shotBox.style.left = x + 'px';
    shotBox.style.top = y + 'px';
    shotBox.style.width = w + 'px';
    shotBox.style.height = h + 'px';
  }};

  const onShotUp = () => {{
    if (mode !== 'screenshot' || shotKind !== 'region' || !dragShot) return;
    const x = Math.max(0, Math.min(dragShot.x0, dragShot.x1));
    const y = Math.max(0, Math.min(dragShot.y0, dragShot.y1));
    const w = Math.min(window.innerWidth - x, Math.abs(dragShot.x1 - dragShot.x0));
    const h = Math.min(window.innerHeight - y, Math.abs(dragShot.y1 - dragShot.y0));
    dragShot = null;
    if (shotBox) shotBox.style.display = 'none';
    if (w < 8 || h < 8) return;
    setMode('none');
    hideChromeAndCapture({{
      type: 'po-tool',
      kind: 'snapshot',
      purpose: 'copy-screenshot',
      crop: [x, y, w, h],
      viewport: [window.innerWidth || 1, window.innerHeight || 1],
      label: Math.round(w) + '×' + Math.round(h)
    }});
  }};

  const clearBars = () => {{
    if (topBar) {{ topBar.remove(); topBar = null; }}
    if (bottomBar) {{ bottomBar.remove(); bottomBar = null; }}
  }};

  const renderBars = () => {{
    clearBars();
    const host = document.body || document.documentElement;
    if (!host) return;
    if (mode === 'pick') {{
      topBar = mk('div', {{ className: '__po_bar __po_bar_top', 'data-po-chrome': '1' }});
      topBar.appendChild(mk('span', null, '🎯 ' + LABELS.pickBanner));
      const close = mk('button', {{ className: '__po_btn' }}, '✕');
      close.onclick = () => setMode('none');
      topBar.appendChild(close);
      host.appendChild(topBar);
    }} else if (mode === 'screenshot') {{
      topBar = mk('div', {{ className: '__po_bar __po_bar_top', 'data-po-chrome': '1' }});
      const mkShotBtn = (id, text) => {{
        const b = mk('button', {{ className: '__po_btn', 'data-active': shotKind === id ? '1' : '0' }}, text);
        b.onclick = () => {{
          shotKind = id;
          placeHover(null);
          renderBars();
        }};
        return b;
      }};
      topBar.appendChild(mkShotBtn('region', LABELS.shotRegion));
      topBar.appendChild(mkShotBtn('snap', LABELS.shotSnap));
      topBar.appendChild(mk('div', {{ className: '__po_sep' }}));
      const fullVp = mk('button', {{ className: '__po_btn __po_btn_primary' }}, LABELS.shotViewport);
      fullVp.onclick = () => {{
        setMode('none');
        hideChromeAndCapture({{
          type: 'po-tool',
          kind: 'snapshot',
          purpose: 'copy-screenshot',
          crop: null,
          viewport: [window.innerWidth || 1, window.innerHeight || 1],
          label: (window.innerWidth || 1) + '×' + (window.innerHeight || 1)
        }});
      }};
      topBar.appendChild(fullVp);
      const close = mk('button', {{ className: '__po_btn' }}, '✕');
      close.onclick = () => setMode('none');
      topBar.appendChild(close);
      host.appendChild(topBar);
    }} else if (mode === 'annotate') {{
      bottomBar = mk('div', {{ className: '__po_bar __po_bar_bottom', 'data-po-chrome': '1' }});
      const mkTool = (id, label) => {{
        const b = mk('button', {{ className: '__po_btn', 'data-active': penKind === id ? '1' : '0' }}, label);
        b.onclick = () => {{ penKind = id; renderBars(); }};
        return b;
      }};
      bottomBar.appendChild(mkTool('pen', LABELS.penDraw));
      bottomBar.appendChild(mkTool('highlighter', LABELS.penHighlight));
      bottomBar.appendChild(mkTool('rect', LABELS.penRect));
      bottomBar.appendChild(mkTool('laser', LABELS.penLaser));
      bottomBar.appendChild(mk('div', {{ className: '__po_sep' }}));
      for (const c of ['#ef4444', '#f59e0b', '#4599df', '#10b981']) {{
        const sw = mk('button', {{ className: '__po_swatch', 'data-active': penColor === c ? '1' : '0' }});
        sw.style.setProperty('background', c, 'important');
        sw.onclick = () => {{ penColor = c; renderBars(); }};
        bottomBar.appendChild(sw);
      }}
      bottomBar.appendChild(mk('div', {{ className: '__po_sep' }}));
      const undo = mk('button', {{ className: '__po_btn' }}, LABELS.penUndo);
      undo.onclick = () => {{ strokes.pop(); redrawCanvas(); renderBars(); syncState(); }};
      bottomBar.appendChild(undo);
      const clr = mk('button', {{ className: '__po_btn' }}, LABELS.penClear);
      clr.onclick = () => {{ strokes.length = 0; redrawCanvas(); renderBars(); syncState(); }};
      bottomBar.appendChild(clr);
      bottomBar.appendChild(mk('div', {{ className: '__po_sep' }}));
      const copyBtn = mk('button', {{ className: '__po_btn' }}, LABELS.penCopy);
      copyBtn.onclick = () => {{
        hideChromeAndCapture({{
          type: 'po-tool',
          kind: 'snapshot',
          purpose: 'copy-annotated',
          crop: null,
          viewport: [window.innerWidth || 1, window.innerHeight || 1],
          strokeCount: strokes.length
        }});
      }};
      bottomBar.appendChild(copyBtn);
      const sendBtn = mk('button', {{ className: '__po_btn __po_btn_primary' }}, LABELS.penSend);
      sendBtn.onclick = () => {{
        const count = strokes.length;
        setMode('none');
        hideChromeAndCapture({{
          type: 'po-tool',
          kind: 'snapshot',
          purpose: 'send-annotated',
          crop: null,
          viewport: [window.innerWidth || 1, window.innerHeight || 1],
          strokeCount: count
        }});
      }};
      bottomBar.appendChild(sendBtn);
      const close = mk('button', {{ className: '__po_btn' }}, '✕');
      close.onclick = () => setMode('none');
      bottomBar.appendChild(close);
      host.appendChild(bottomBar);
    }}
  }};

  const setMode = (next) => {{
    if (!ensureDom()) {{
      window.addEventListener('DOMContentLoaded', () => setMode(next), {{ once: true }});
      return;
    }}
    mode = next || 'none';
    dragShot = null;
    snapTarget = null;
    pickTarget = null;
    placeHover(null);
    if (shotBox) shotBox.style.display = 'none';
    if (shotMask) shotMask.style.display = mode === 'screenshot' ? 'block' : 'none';
    if (canvas) {{
      const interactive = mode === 'annotate' || mode === 'laser';
      canvas.style.pointerEvents = interactive ? 'auto' : 'none';
      canvas.style.cursor = interactive ? 'crosshair' : 'default';
    }}
    renderBars();
    syncState();
  }};

  window.addEventListener('mousemove', onDocMove, true);
  window.addEventListener('click', onDocClick, true);
  window.addEventListener('resize', () => {{ if (canvas) resizeCanvas(); }});
  window.addEventListener('keydown', (e) => {{
    if (e.key === 'Escape' && mode !== 'none') {{
      e.preventDefault();
      setMode('none');
    }} else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && mode === 'annotate' && strokes.length) {{
      e.preventDefault();
      strokes.pop();
      redrawCanvas();
      syncState();
    }}
  }}, true);

  const captureFullPage = () => {{
    if (!ensureDom()) return;
    setMode('none');
    const {{ w, h }} = docMetrics();
    const vh = Math.max(1, window.innerHeight || 1);
    const vw = Math.max(1, window.innerWidth || 1);
    const maxSlices = 8;
    const totalH = Math.min(h, vh * maxSlices);
    const steps = [];
    for (let y = 0; y < totalH; y += vh) {{
      steps.push(Math.min(y, Math.max(0, totalH - vh)));
      if (y + vh >= totalH) break;
    }}
    if (!steps.length) steps.push(0);
    const id = Date.now();
    fullPageJob = {{
      id,
      steps,
      idx: 0,
      origX: window.scrollX,
      origY: window.scrollY,
      totalH,
      vh,
      vw
    }};
    const els = document.querySelectorAll('[data-po-chrome="1"]');
    els.forEach((el) => {{ el.style.visibility = 'hidden'; }});
    stepFullPage();
  }};

  const stepFullPage = () => {{
    if (!fullPageJob) return;
    const job = fullPageJob;
    if (job.idx >= job.steps.length) {{
      window.scrollTo(job.origX, job.origY);
      restoreChrome();
      fullPageJob = null;
      return;
    }}
    const targetY = job.steps[job.idx];
    window.scrollTo(0, targetY);
    requestAnimationFrame(() => {{
      requestAnimationFrame(() => {{
        post({{
          type: 'po-tool',
          kind: 'fullpage-slice',
          id: job.id,
          index: job.idx,
          count: job.steps.length,
          scrollY: window.scrollY,
          totalHeight: job.totalH,
          viewportHeight: job.vh,
          viewportWidth: job.vw
        }});
      }});
    }});
  }};

  Object.defineProperty(window, '__puppyoneHtmlTools', {{
    configurable: false,
    writable: false,
    value: {{
      setMode,
      restoreChrome,
      clearAnnotations: () => {{
        strokes.length = 0;
        redrawCanvas();
        syncState();
      }},
      captureFullPage,
      nextSlice: (id) => {{
        if (!fullPageJob || fullPageJob.id !== id) return;
        fullPageJob.idx += 1;
        stepFullPage();
      }}
    }}
  }});
}})();
</script>"#
    )
}

/// Pure-Rust HTML element source-line locator (`(start_line, end_line)`, 1-based).
/// Maps a picked DOM element (`tag`, `id`, `classes`, `text_hint`, `occurrence`)
/// back to its opening and closing line range in the raw HTML source.
pub fn locate_element_lines(
    source: &str,
    tag: &str,
    id: &str,
    classes: &[String],
    text_hint: &str,
    occurrence: usize,
) -> Option<(u32, u32)> {
    let wanted_tag = tag.trim().to_ascii_lowercase();
    if wanted_tag.is_empty() {
        return None;
    }
    let candidates = collect_tag_candidates(source, &wanted_tag);
    if candidates.is_empty() {
        return None;
    }
    let clean_hint = text_hint.split_whitespace().collect::<Vec<_>>().join(" ");
    let hint_prefix: String = clean_hint.chars().take(32).collect();

    let mut best: Option<(i32, &TagCandidate)> = None;
    for (idx, cand) in candidates.iter().enumerate() {
        let mut score = 0i32;
        if !id.is_empty() {
            if cand.id.as_deref() == Some(id) {
                score += 200;
            } else {
                score -= 40;
            }
        }
        for cls in classes {
            if cand.classes.iter().any(|c| c == cls) {
                score += 20;
            }
        }
        if !hint_prefix.is_empty() && cand.inner_text.contains(&hint_prefix) {
            score += 35;
        }
        let dist = idx.abs_diff(occurrence) as i32;
        score += (30 - dist * 6).max(0);
        if best.as_ref().is_none_or(|(best_score, _)| score > *best_score) {
            best = Some((score, cand));
        }
    }
    let (_, chosen) = best?;
    let start_line = byte_to_line(source, chosen.start_byte);
    let end_line = byte_to_line(source, chosen.end_byte.saturating_sub(1).max(chosen.start_byte));
    Some((start_line, end_line.max(start_line)))
}

struct TagCandidate {
    start_byte: usize,
    end_byte: usize,
    id: Option<String>,
    classes: Vec<String>,
    inner_text: String,
}

fn is_void_html_tag(tag: &str) -> bool {
    matches!(
        tag,
        "area"
            | "base"
            | "br"
            | "col"
            | "embed"
            | "hr"
            | "img"
            | "input"
            | "link"
            | "meta"
            | "param"
            | "source"
            | "track"
            | "wbr"
    )
}

fn byte_to_line(source: &str, byte_idx: usize) -> u32 {
    let clamped = byte_idx.min(source.len());
    1 + source.as_bytes()[..clamped]
        .iter()
        .filter(|&&b| b == b'\n')
        .count() as u32
}

fn collect_tag_candidates(source: &str, wanted_tag: &str) -> Vec<TagCandidate> {
    let mut out = Vec::new();
    let bytes = source.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        let Some(rel) = source[i..].find('<') else {
            break;
        };
        let at = i + rel;
        let rest = &source[at..];
        if let Some(comment) = rest.strip_prefix("<!--") {
            let skip = comment.find("-->").map_or(rest.len(), |e| e + 7);
            i = at + skip;
            continue;
        }
        let Some((name, tag_len, self_closing)) = parse_start_tag(rest) else {
            i = at + 1;
            continue;
        };
        if matches!(name.as_str(), "script" | "style") && name != wanted_tag {
            let after = &rest[tag_len..];
            let close_pat = format!("</{name}");
            let skip = after
                .to_ascii_lowercase()
                .find(&close_pat)
                .map_or(after.len(), |p| p + close_pat.len());
            i = at + tag_len + skip;
            continue;
        }
        if name == wanted_tag {
            let open_src = &rest[..tag_len];
            let id = extract_attr(open_src, "id");
            let classes = extract_attr(open_src, "class")
                .map(|c| c.split_whitespace().map(str::to_owned).collect())
                .unwrap_or_default();
            let end_byte = if self_closing || is_void_html_tag(&name) {
                at + tag_len
            } else {
                find_matching_close(source, at + tag_len, &name).unwrap_or(at + tag_len)
            };
            let raw_inner = &source[(at + tag_len).min(end_byte)..end_byte];
            let inner_text = strip_tags_normalized(raw_inner);
            out.push(TagCandidate {
                start_byte: at,
                end_byte,
                id,
                classes,
                inner_text,
            });
        }
        i = at + tag_len;
    }
    out
}

fn parse_start_tag(s: &str) -> Option<(String, usize, bool)> {
    let body = s.strip_prefix('<')?;
    if body.starts_with('/') || body.starts_with('!') || body.starts_with('?') {
        return None;
    }
    let name: String = body
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect();
    if name.is_empty() || !name.starts_with(|c: char| c.is_ascii_alphabetic()) {
        return None;
    }
    let mut quote: Option<char> = None;
    let mut prev = ' ';
    for (idx, ch) in body.char_indices().skip(name.len()) {
        match (quote, ch) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), _) => {}
            (None, '"' | '\'') => quote = Some(ch),
            (None, '>') => {
                let self_closing = prev == '/';
                return Some((name.to_ascii_lowercase(), idx + 2, self_closing));
            }
            _ => {}
        }
        if !ch.is_whitespace() {
            prev = ch;
        }
    }
    None
}

fn find_matching_close(source: &str, from: usize, tag: &str) -> Option<usize> {
    let mut depth = 1usize;
    let mut i = from;
    let close_prefix = format!("</{tag}");
    while i < source.len() {
        let rel = source[i..].find('<')?;
        let at = i + rel;
        let rest = &source[at..];
        if let Some(comment) = rest.strip_prefix("<!--") {
            i = at + comment.find("-->").map_or(rest.len(), |e| e + 7);
            continue;
        }
        let lower_head: String = rest.chars().take(close_prefix.len() + 2).collect();
        if lower_head.to_ascii_lowercase().starts_with(&close_prefix) {
            let next_ch = rest[close_prefix.len()..].chars().next();
            if next_ch.is_some_and(|c| c == '>' || c.is_whitespace()) {
                let close_len = rest.find('>').map_or(rest.len(), |e| e + 1);
                depth -= 1;
                if depth == 0 {
                    return Some(at + close_len);
                }
                i = at + close_len;
                continue;
            }
        }
        if let Some((open_name, len, self_closing)) = parse_start_tag(rest) {
            if open_name == tag && !self_closing && !is_void_html_tag(&open_name) {
                depth += 1;
            }
            i = at + len;
            continue;
        }
        i = at + 1;
    }
    None
}

fn extract_attr(open_tag: &str, wanted: &str) -> Option<String> {
    let inner = open_tag
        .trim_start_matches('<')
        .trim_end_matches('>')
        .trim_end_matches('/');
    let mut chars = inner.char_indices().peekable();
    while chars.peek().is_some_and(|(_, c)| !c.is_whitespace()) {
        chars.next();
    }
    loop {
        while chars.peek().is_some_and(|(_, c)| c.is_whitespace()) {
            chars.next();
        }
        let start = chars.peek()?.0;
        while chars
            .peek()
            .is_some_and(|(_, c)| !c.is_whitespace() && *c != '=')
        {
            chars.next();
        }
        let name = &inner[start..chars.peek().map_or(inner.len(), |(idx, _)| *idx)];
        if name.is_empty() {
            return None;
        }
        while chars.peek().is_some_and(|(_, c)| c.is_whitespace()) {
            chars.next();
        }
        let val = if chars.peek().is_some_and(|(_, c)| *c == '=') {
            chars.next();
            while chars.peek().is_some_and(|(_, c)| c.is_whitespace()) {
                chars.next();
            }
            match chars.peek().map(|(_, c)| *c) {
                Some(q @ ('"' | '\'')) => {
                    chars.next();
                    let vstart = chars.peek().map_or(inner.len(), |(idx, _)| *idx);
                    let mut vend = inner.len();
                    for (idx, c) in chars.by_ref() {
                        if c == q {
                            vend = idx;
                            break;
                        }
                    }
                    inner[vstart..vend].to_owned()
                }
                _ => {
                    let vstart = chars.peek().map_or(inner.len(), |(idx, _)| *idx);
                    while chars.peek().is_some_and(|(_, c)| !c.is_whitespace()) {
                        chars.next();
                    }
                    inner[vstart..chars.peek().map_or(inner.len(), |(idx, _)| *idx)].to_owned()
                }
            }
        } else {
            String::new()
        };
        if name.eq_ignore_ascii_case(wanted) {
            return Some(val);
        }
    }
}

fn strip_tags_normalized(html: &str) -> String {
    let mut out = String::with_capacity(html.len().min(256));
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn locate_element_lines_resolves_ids_nested_cards_and_void_elements() {
        let html = "\
<!DOCTYPE html>
<html>
<body>
  <header id=\"hero\" class=\"top-bar\">
    <h1>Quarterly Report</h1>
  </header>
  <section class=\"grid\">
    <div class=\"card metric\">
      <span>Revenue</span>
    </div>
    <div class=\"card metric highlight\">
      <span>ARR Growth +42%</span>
      <p>Strong enterprise expansion</p>
    </div>
  </section>
  <img id=\"chart-img\" src=\"chart.png\">
</body>
</html>";

        assert_eq!(
            locate_element_lines(html, "header", "hero", &["top-bar".into()], "Quarterly", 0),
            Some((4, 6))
        );
        assert_eq!(
            locate_element_lines(
                html,
                "div",
                "",
                &["card".into(), "highlight".into()],
                "ARR Growth +42%",
                1
            ),
            Some((11, 14))
        );
        assert_eq!(
            locate_element_lines(html, "img", "chart-img", &[], "", 0),
            Some((16, 16))
        );
    }

    #[test]
    fn injected_bundle_contains_controller_and_no_raw_closing_script_hazard() {
        let bundle = injected_head_bundle();
        assert!(bundle.contains("__puppyoneHtmlTools"));
        assert!(bundle.contains("__po_pen_canvas"));
        assert_eq!(bundle.matches("</script>").count(), 1);
    }
}
