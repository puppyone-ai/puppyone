/** Fixed trusted code. Source documents never contribute executable JavaScript. */
export const HTML_FRAME_BRIDGE = String.raw`
(() => {
  'use strict';
  let port = null, selected = null, active = null, enabled = true, frame = 0, typing = null;
  const nodes = new Map();
  const attribute = 'data-puppyone-html-target';
  document.querySelectorAll('[' + attribute + ']').forEach((node) => {
    const id = node.getAttribute(attribute);
    if (nodes.has(id)) { nodes.set(id, null); return; }
    nodes.set(id, node);
  });
  const typingStyle = document.createElement('style');
  typingStyle.textContent = '[data-puppyone-html-typing]{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important}[' + attribute + ']:focus{outline:none!important}';
  document.head.append(typingStyle);
  const setTyping = (id) => {
    if (typing) nodes.get(typing)?.removeAttribute('data-puppyone-html-typing');
    typing = id;
    if (typing) nodes.get(typing)?.setAttribute('data-puppyone-html-typing', '');
  };
  const send = (value) => { if (port) port.postMessage(value); };
  const measure = (edit = false, reason = 'measure') => {
    if (!selected) return;
    const node = nodes.get(selected);
    if (!node || !node.isConnected) return;
    const editing = typing; setTyping(null);
    const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
    let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
    let transformed = style.writingMode !== 'horizontal-tb';
    for (let parent = node; parent; parent = parent.parentElement) {
      const current = getComputedStyle(parent);
      if (current.transform !== 'none' || current.rotate !== 'none' || current.scale !== 'none'
        || current.zoom && current.zoom !== '1' && current.zoom !== 'normal') transformed = true;
      if (parent !== node && (current.overflowX !== 'visible' || current.overflowY !== 'visible')) {
        const bounds = parent.getBoundingClientRect();
        if (current.overflowX !== 'visible') { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
        if (current.overflowY !== 'visible') { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
      }
    }
    let anchor = rect;
    if (node.tagName !== 'IMG' && node.textContent.trim()) {
      const range = document.createRange(); range.selectNodeContents(node);
      const textBounds = range.getBoundingClientRect();
      if (textBounds.width > 0 && textBounds.height > 0) anchor = textBounds;
    }
    send({ type: 'selection', id: selected, edit, reason, anchor: { x: anchor.x, y: anchor.y, width: anchor.width, height: anchor.height }, rect: {
      x: rect.x, y: rect.y, width: rect.width, height: rect.height
    }, clip: { top: Math.max(0, top - rect.top), right: Math.max(0, rect.right - right),
      bottom: Math.max(0, rect.bottom - bottom), left: Math.max(0, left - rect.left) },
    styles: { fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight,
      lineHeight: style.lineHeight, color: style.color, backgroundColor: style.backgroundColor,
      textAlign: style.textAlign, padding: style.padding, borderRadius: style.borderRadius,
      width: style.width, height: style.height, margin: style.margin,
      letterSpacing: style.letterSpacing, fontStyle: style.fontStyle, textTransform: style.textTransform, textDecoration: style.textDecoration,
      transformed } });
    setTyping(editing);
  };
  const schedule = () => {
    send({ type: 'viewport', x: scrollX, y: scrollY });
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); });
  };
  const select = (event, edit) => {
    event.preventDefault(); event.stopPropagation();
    if (!enabled || !port) return;
    const target = event.target instanceof Element ? event.target.closest('[' + attribute + ']') : null;
    if (active && nodes.get(active)?.contains(target)) {
      active = target.getAttribute(attribute); selected = active; measure(true, 'select'); return;
    }
    active = null;
    if (!target) { selected = null; send({ type: 'clear' }); return; }
    selected = target.getAttribute(attribute);
    measure(edit, event.type === 'focusin' ? 'focus' : 'select');
  };
  document.addEventListener('click', (event) => select(event, false), true);
  document.addEventListener('dblclick', (event) => select(event, false), true);
  document.addEventListener('focusin', (event) => select(event, false), true);
  document.addEventListener('pointermove', (event) => {
    // Pointer movement is inert until an explicit click or keyboard focus selects a block.
    if (!enabled || !port || !selected) return;
    send({ type: 'pointer', x: event.clientX, y: event.clientY });
  }, true);
  document.addEventListener('submit', (event) => event.preventDefault(), true);
  document.addEventListener('dragstart', (event) => event.preventDefault(), true);
  document.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'z' || event.ctrlKey && event.key.toLowerCase() === 'y')) {
      event.preventDefault(); if (enabled) send({ type: 'history', direction: event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo' });
    } else if (event.key === 'Enter') select(event, true);
    else if (event.key === 'Escape') { selected = null; active = null; send({ type: 'clear' }); }
  }, true);
  addEventListener('scroll', schedule, true);
  addEventListener('resize', schedule);
  const observer = new ResizeObserver(schedule);
  observer.observe(document.documentElement);
  document.fonts.ready.then(schedule);
  addEventListener('message', function connect(event) {
    if (event.source !== parent || !event.data || event.data.type !== 'puppyone-html-connect'
      || event.data.session !== SESSION
      || port || event.ports.length !== 1) return;
    port = event.ports[0];
    port.onmessage = ({ data }) => {
      if (!data || typeof data !== 'object') return;
      if (data.type === 'typing') { setTyping(nodes.has(data.id) ? data.id : null); return; }
      if (data.type === 'active' && nodes.has(data.id)) { active = data.id; selected = active; measure(); return; }
      if (data.type === 'clear') { selected = null; active = null; setTyping(null); return; }
      if (data.type === 'enabled') { enabled = data.value === true; return; }
      if (data.type === 'base') {
        let base = document.querySelector('base');
        if (!data.value) { base?.remove(); return; }
        if (base?.href === data.value) return;
        if (!base) { base = document.createElement('base'); document.head.prepend(base); }
        base.href = data.value;
        document.querySelectorAll('img[src],link[rel=stylesheet][href]').forEach(node => {
          const attr = node.tagName === 'IMG' ? 'src' : 'href'; node.setAttribute(attr, node.getAttribute(attr));
        });
        schedule(); return;
      }
      if ((data.type === 'scroll' || data.type === 'restore-scroll') && Number.isFinite(data.x) && Number.isFinite(data.y)) {
        if (data.type === 'restore-scroll') scrollTo(data.x, data.y);
        else {
          let container = nodes.get(selected)?.parentElement;
          while (container && !(['auto', 'scroll'].includes(getComputedStyle(container).overflowY) && container.scrollHeight > container.clientHeight)) container = container.parentElement;
          (container || window).scrollBy(data.x, data.y);
        }
        return;
      }
      if (data.type === 'measure') { schedule(); return; }
      if (data.type === 'check-style' && typeof data.request === 'string') {
        const node = nodes.get(data.id);
        if (!node) return;
        const editing = typing; setTyping(null);
        const original = node.getAttribute('style');
        let supported = false;
        try {
          node.style.setProperty(data.property, data.value);
          const normal = getComputedStyle(node).getPropertyValue(data.property);
          node.style.setProperty(data.property, data.value, 'important');
          const forced = getComputedStyle(node).getPropertyValue(data.property);
          supported = normal === forced;
        } finally {
          if (original === null) node.removeAttribute('style'); else node.setAttribute('style', original);
          setTyping(editing);
        }
        send({ type: 'style-check', request: data.request, supported });
        return;
      }
      if (data.type !== 'patch' || !Array.isArray(data.patches) || data.patches.length > 32) return;
      for (const patch of data.patches) {
        const node = nodes.get(patch.id);
        if (!node) continue;
        if (patch.kind === 'text' && typeof patch.value === 'string') {
          if (!patch.lineBreaks) { node.textContent = patch.value; continue; }
          const children = [];
          patch.value.split('\n').forEach((line, i) => {
            if (i) children.push(document.createElement('br'));
            children.push(document.createTextNode(line));
          });
          node.replaceChildren(...children);
        } else if (patch.kind === 'attribute' && ['src', 'alt', 'style'].includes(patch.name)) {
          if (patch.value === null) node.removeAttribute(patch.name);
          else node.setAttribute(patch.name, patch.value);
        }
      }
      schedule();
    };
    port.start();
    send({ type: 'ready', ids: [...nodes].filter(([, node]) => node).map(([id]) => id) });
  });
  addEventListener('pagehide', () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame); port?.close(); });
})();
`;
