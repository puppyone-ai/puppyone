/** Fixed trusted code. Source documents never contribute executable JavaScript. */
export const HTML_FRAME_BRIDGE = String.raw`
(() => {
  'use strict';
  let port = null, selected = null, active = null, enabled = true, frame = 0, typing = null, editingNode = null, composing = false;
  const nodes = new Map();
  const attribute = 'data-puppyone-html-target';
  const indexNodes = (ids) => {
    nodes.clear();
    const elements = document.querySelectorAll('[' + attribute + ']');
    elements.forEach((node, idx) => {
      const id = Array.isArray(ids) && ids[idx] ? ids[idx] : node.getAttribute(attribute);
      if (Array.isArray(ids) && ids[idx]) node.setAttribute(attribute, id);
      if (nodes.has(id)) { nodes.set(id, null); return; }
      nodes.set(id, node);
    });
  };
  indexNodes();
  const typingStyle = document.createElement('style');
  typingStyle.textContent = '[data-puppyone-html-typing]{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important}[' + attribute + ']:focus{outline:none!important}[' + attribute + ']:hover:not([data-puppyone-html-selected]){outline:1.5px dashed rgba(37,99,235,0.45)!important;outline-offset:2px!important}[data-puppyone-html-editable]{cursor:text}a[data-puppyone-html-link]{text-decoration:underline;color:-webkit-link}';
  document.head.append(typingStyle);
  const setSelectedAttr = (id) => {
    document.querySelectorAll('[data-puppyone-html-selected]').forEach((el) => el.removeAttribute('data-puppyone-html-selected'));
    if (id) nodes.get(id)?.setAttribute('data-puppyone-html-selected', '');
  };
  const activateEditable = (node) => {
    if (editingNode && editingNode !== node) {
      editingNode.removeAttribute('contenteditable');
      editingNode.querySelectorAll('[' + attribute + ']').forEach((child) => child.removeAttribute('contenteditable'));
    }
    editingNode = null;
    if (enabled && node && node.hasAttribute('data-puppyone-html-editable')) {
      node.setAttribute('contenteditable', 'true');
      node.querySelectorAll('[' + attribute + ']').forEach((child) => child.setAttribute('contenteditable', 'false'));
      editingNode = node;
    }
  };
  const readNodeText = (node) => {
    const mode = node.getAttribute('data-puppyone-html-editable');
    let out = '';
    const walk = (parent) => {
      for (const child of parent.childNodes) {
        if (child.nodeType === 3) {
          out += child.nodeValue || '';
        } else if (child.nodeType === 1) {
          if (child.tagName === 'BR') out += '\n';
          else if (mode === 'inline' && child.hasAttribute(attribute)) out += '\u0001';
          else walk(child);
        }
      }
    };
    walk(node);
    return out;
  };
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
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(true); });
  };
  const select = (event, edit) => {
    if (!enabled || !port) return;
    const target = event.target instanceof Element ? event.target.closest('[' + attribute + ']') : null;
    if (!target || !target.hasAttribute('data-puppyone-html-editable')) event.preventDefault();
    event.stopPropagation();
    if (!target) {
      activateEditable(null);
      setSelectedAttr(null);
      selected = null;
      active = null;
      send({ type: 'clear' });
      return;
    }
    activateEditable(target);
    selected = target.getAttribute(attribute);
    active = selected;
    setSelectedAttr(selected);
    measure(edit, event.type === 'focusin' ? 'focus' : 'select');
  };
  document.addEventListener('pointerdown', (event) => {
    if (!enabled || !port || event.button !== 0) return;
    const target = event.target instanceof Element ? event.target.closest('[' + attribute + ']') : null;
    activateEditable(target);
  }, true);
  document.addEventListener('click', (event) => select(event, true), true);
  document.addEventListener('dblclick', (event) => select(event, true), true);
  document.addEventListener('focusin', (event) => select(event, true), true);
  document.addEventListener('compositionstart', () => {
    composing = true;
    send({ type: 'composition', value: true });
  }, true);
  document.addEventListener('compositionend', () => {
    composing = false;
    send({ type: 'composition', value: false });
    if (editingNode && selected) {
      send({ type: 'input', id: selected, value: readNodeText(editingNode) });
      schedule();
    }
  }, true);
  document.addEventListener('input', () => {
    if (!enabled || !editingNode || !selected || composing) return;
    send({ type: 'input', id: selected, value: readNodeText(editingNode) });
    schedule();
  }, true);
  document.addEventListener('paste', (event) => {
    if (!enabled || !editingNode) return;
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') || '';
    if (text) document.execCommand('insertText', false, text);
  }, true);
  document.addEventListener('pointermove', (event) => {
    if (!enabled || !port || !selected) return;
    send({ type: 'pointer', x: event.clientX, y: event.clientY });
  }, true);
  let hover = null, hoverFrame = 0;
  document.addEventListener('pointermove', (event) => {
    hover = [event.clientX, event.clientY];
    if (!hoverFrame) hoverFrame = requestAnimationFrame(() => { hoverFrame = 0; if (hover) send({ type: 'hover', x: hover[0], y: hover[1] }); });
  }, true);
  document.addEventListener('pointerout', (event) => {
    if (event.relatedTarget) return;
    hover = null; send({ type: 'hover-end' });
  }, true);
  document.addEventListener('submit', (event) => event.preventDefault(), true);
  document.addEventListener('dragstart', (event) => event.preventDefault(), true);
  document.addEventListener('keydown', (event) => {
    if (event.isComposing || composing) return;
    if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'z' || event.ctrlKey && event.key.toLowerCase() === 'y')) {
      event.preventDefault(); if (enabled) send({ type: 'history', direction: event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo' });
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (editingNode) editingNode.blur();
      activateEditable(null);
      setSelectedAttr(null);
      selected = null;
      active = null;
      send({ type: 'clear' });
      return;
    }
    if (editingNode) {
      if ((event.key === 'Backspace' || event.key === 'Delete') && editingNode.getAttribute('data-puppyone-html-editable') === 'inline') {
        const sel = window.getSelection();
        if (sel && sel.rangeCount) {
          const range = sel.getRangeAt(0);
          if (!range.collapsed) {
            const frag = range.cloneContents();
            if (frag.querySelector && frag.querySelector('[' + attribute + ']')) { event.preventDefault(); return; }
          } else {
            const container = range.startContainer;
            const offset = range.startOffset;
            if (container.nodeType === 1) {
              const neighbor = event.key === 'Backspace' ? container.childNodes[offset - 1] : container.childNodes[offset];
              if (neighbor && neighbor.nodeType === 1 && neighbor.hasAttribute(attribute)) { event.preventDefault(); return; }
            } else if (container.nodeType === 3) {
              if (event.key === 'Backspace' && offset === 0 && container.previousSibling?.nodeType === 1 && container.previousSibling.hasAttribute(attribute)) {
                event.preventDefault(); return;
              }
              if (event.key === 'Delete' && offset === container.nodeValue.length && container.nextSibling?.nodeType === 1 && container.nextSibling.hasAttribute(attribute)) {
                event.preventDefault(); return;
              }
            }
          }
        }
      }
      if (event.key === 'Enter') {
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          editingNode.blur();
          return;
        }
        if (!['PRE', 'CODE'].includes(editingNode.tagName)) {
          event.preventDefault();
          document.execCommand('insertLineBreak');
          return;
        }
      }
    } else if (event.key === 'Enter') {
      select(event, true);
    }
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
      if (data.type === 'active' && nodes.has(data.id)) {
        active = data.id; selected = active; setSelectedAttr(selected); activateEditable(nodes.get(selected)); measure(true); return;
      }
      if (data.type === 'clear') {
        if (editingNode) editingNode.blur();
        activateEditable(null); setSelectedAttr(null); selected = null; active = null; setTyping(null); return;
      }
      if (data.type === 'enabled') {
        enabled = data.value === true;
        if (!enabled) { activateEditable(null); setSelectedAttr(null); }
        return;
      }
      if (data.type === 'inset') {
        if (Number.isFinite(data.value) && data.value > 0 && data.value <= 400) document.documentElement.style.setProperty('padding-top', data.value + 'px', 'important');
        schedule(); return;
      }
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
        if (patch.kind === 'structure') {
          activateEditable(null);
          if (patch.action === 'delete') {
            node.remove();
          } else if (patch.action === 'duplicate') {
            const clone = node.cloneNode(true);
            clone.removeAttribute('data-puppyone-html-selected');
            clone.removeAttribute('contenteditable');
            node.after(clone);
          } else if (patch.action === 'move-up') {
            const prev = node.previousElementSibling;
            if (prev) prev.before(node);
          } else if (patch.action === 'move-down') {
            const next = node.nextElementSibling;
            if (next) next.after(node);
          }
          indexNodes(patch.ids);
          selected = patch.selectId && nodes.has(patch.selectId) ? patch.selectId : null;
          active = selected;
          setSelectedAttr(selected);
          if (selected) {
            activateEditable(nodes.get(selected));
            measure(true, 'select');
          } else {
            send({ type: 'clear' });
          }
          continue;
        }
        if (patch.kind === 'text' && typeof patch.value === 'string') {
          if (editingNode === node) continue;
          if (!patch.lineBreaks) { node.textContent = patch.value; continue; }
          const children = [];
          patch.value.split('\n').forEach((line, i) => {
            if (i) children.push(document.createElement('br'));
            children.push(document.createTextNode(line));
          });
          node.replaceChildren(...children);
        } else if (patch.kind === 'attribute' && ['src', 'alt', 'style', 'href'].includes(patch.name)) {
          if (patch.name === 'href') {
            if (patch.value) node.setAttribute('data-puppyone-html-link', '');
            else node.removeAttribute('data-puppyone-html-link');
          } else if (patch.value === null) {
            node.removeAttribute(patch.name);
          } else {
            node.setAttribute(patch.name, patch.value);
          }
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
