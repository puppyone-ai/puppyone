/** Fixed trusted code. Source documents never contribute executable JavaScript. */
export const HTML_FRAME_BRIDGE = String.raw`
(() => {
  'use strict';
  let port = null, selected = null, enabled = true, frame = 0;
  const nodes = new Map();
  const attribute = 'data-puppyone-html-target';
  document.querySelectorAll('[' + attribute + ']').forEach((node) => {
    const id = node.getAttribute(attribute);
    if (nodes.has(id)) { nodes.set(id, null); return; }
    nodes.set(id, node);
  });
  const send = (value) => { if (port) port.postMessage(value); };
  const measure = (edit = false) => {
    if (!selected) return;
    const node = nodes.get(selected);
    if (!node || !node.isConnected) return;
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
    send({ type: 'selection', id: selected, edit, rect: {
      x: rect.x, y: rect.y, width: rect.width, height: rect.height
    }, clip: { top: Math.max(0, top - rect.top), right: Math.max(0, rect.right - right),
      bottom: Math.max(0, rect.bottom - bottom), left: Math.max(0, left - rect.left) },
    styles: { fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight,
      lineHeight: style.lineHeight, color: style.color, backgroundColor: style.backgroundColor,
      textAlign: style.textAlign, padding: style.padding, borderRadius: style.borderRadius,
      width: style.width, height: style.height, margin: style.margin,
      transformed } });
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); });
  };
  const select = (event, edit) => {
    event.preventDefault(); event.stopPropagation();
    if (!enabled || !port) return;
    const target = event.target instanceof Element ? event.target.closest('[' + attribute + ']') : null;
    if (!target) { selected = null; send({ type: 'clear' }); return; }
    selected = target.getAttribute(attribute);
    measure(edit);
  };
  document.addEventListener('click', (event) => select(event, false), true);
  document.addEventListener('dblclick', (event) => select(event, true), true);
  document.addEventListener('submit', (event) => event.preventDefault(), true);
  document.addEventListener('dragstart', (event) => event.preventDefault(), true);
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault(); if (enabled) send({ type: 'history', direction: event.shiftKey ? 'redo' : 'undo' });
    } else if (event.key === 'Enter') select(event, true);
    else if (event.key === 'Escape') { selected = null; send({ type: 'clear' }); }
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
      if (data.type === 'measure') { schedule(); return; }
      if (data.type === 'check-style' && typeof data.request === 'string') {
        const node = nodes.get(data.id);
        if (!node) return;
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
