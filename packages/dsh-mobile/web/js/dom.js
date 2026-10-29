/* DSH Mobile — tiny DOM toolkit. No framework, no innerHTML for app data
 * (only for sanitized markdown output). */
import { t } from './i18n.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * h('div.card', { props }, ...children)
 * Supported props: class/className, text, html (sanitized callers only), dataset,
 * style (object), on* listeners, boolean/normal attributes.
 */
export function h(tag, props, ...children) {
  const parts = String(tag || 'div').split('.');
  const el = document.createElement(parts[0] || 'div');
  if (parts.length > 1) el.className = parts.slice(1).join(' ');
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class' || key === 'className') {
        el.className = el.className ? `${el.className} ${value}` : String(value);
      } else if (key === 'text') {
        el.textContent = String(value);
      } else if (key === 'html') {
        el.innerHTML = String(value);
      } else if (key === 'dataset') {
        Object.assign(el.dataset, value);
      } else if (key === 'style' && typeof value === 'object') {
        for (const [prop, v] of Object.entries(value)) el.style.setProperty(prop, v);
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (value === true) {
        el.setAttribute(key, '');
      } else {
        el.setAttribute(key, String(value));
      }
    }
  }
  appendChildren(el, children);
  return el;
}

export function appendChildren(el, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) {
      appendChildren(el, child);
    } else if (child instanceof Node) {
      el.appendChild(child);
    } else {
      el.appendChild(document.createTextNode(String(child)));
    }
  }
  return el;
}

export function frag(...children) {
  const f = document.createDocumentFragment();
  appendChildren(f, children);
  return f;
}

export function icon(name, extra = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `icon${extra ? ` ${extra}` : ''}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.appendChild(use);
  return svg;
}

export function clear(el) {
  while (el && el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function byId(id) {
  return document.getElementById(id);
}

export function debounce(fn, ms = 150) {
  let timer = 0;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

/** Coalesce high-frequency updates into one paint per frame. */
export function raf(fn) {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn();
    });
  };
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isNearBottom(el, threshold = 140) {
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

export function scrollToBottom(el, smooth = false) {
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

export function focusFirst(root) {
  if (!root) return;
  const candidates = root.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  for (const candidate of candidates) {
    if (candidate.offsetParent !== null) {
      candidate.focus({ preventScroll: true });
      return;
    }
  }
}

export function autoGrow(textarea, max = 0.42 * window.innerHeight) {
  if (!textarea) return;
  textarea.style.height = 'auto';
  const next = Math.min(textarea.scrollHeight, max);
  textarea.style.height = `${next}px`;
  textarea.style.overflowY = textarea.scrollHeight > max ? 'auto' : 'hidden';
}

export function copyText(value) {
  const text = String(value);
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => false
    );
  }
  const area = h('textarea', { class: 'sr-only', readonly: true });
  area.value = text;
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return Promise.resolve(ok);
}

/* ── toasts & announcements ────────────────────────────────────────── */

let toastCount = 0;

export function toast(message, kind = 'info', ms = 3000) {
  const box = byId('toasts');
  if (!box) return;
  if (toastCount > 3) {
    box.firstElementChild?.remove();
  } else {
    toastCount += 1;
  }
  const glyph = kind === 'danger' ? 'alert' : kind === 'ok' ? 'check' : 'info';
  const node = h(
    'div.toast',
    { class: kind !== 'info' ? `toast-${kind}` : '', role: 'status' },
    icon(glyph, 'icon-sm'),
    h('span', { text: message })
  );
  box.appendChild(node);
  setTimeout(() => {
    node.remove();
    toastCount = Math.max(0, toastCount - 1);
  }, ms);
}

export function announce(message) {
  const region = byId('live-region');
  if (!region) return;
  region.textContent = '';
  // Force screen readers to re-announce identical strings.
  requestAnimationFrame(() => {
    region.textContent = message;
  });
}

/* ── overlay pages (pair / settings / lab) ─────────────────────────── */

let overlayRender = null;
let overlayCloseHandler = null;

export function openOverlay(render, { onClose } = {}) {
  overlayRender = render;
  overlayCloseHandler = onClose || null;
  refreshOverlay();
  const el = byId('overlay');
  if (!el) return;
  el.hidden = false;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  document.addEventListener('keydown', overlayKeydown);
  requestAnimationFrame(() => focusFirst(el));
}

export function refreshOverlay() {
  const el = byId('overlay');
  if (!el || !overlayRender) return;
  const scrollTop = el.querySelector('.overlay-body')?.scrollTop || 0;
  el.replaceChildren(overlayRender({ close: closeOverlay, refresh: refreshOverlay }));
  const body = el.querySelector('.overlay-body');
  if (body) body.scrollTop = scrollTop;
}

export function closeOverlay(reason = 'user') {
  const el = byId('overlay');
  if (!el || el.hidden) return;
  el.hidden = true;
  el.replaceChildren();
  el.removeAttribute('role');
  el.removeAttribute('aria-modal');
  document.removeEventListener('keydown', overlayKeydown);
  overlayRender = null;
  if (overlayCloseHandler) overlayCloseHandler(reason);
  overlayCloseHandler = null;
}

function overlayKeydown(event) {
  if (event.key === 'Escape' && !document.querySelector('.sheet')) {
    event.preventDefault();
    closeOverlay('user');
  }
}

export function page({ title, body, actions = [] }) {
  const head = h(
    'header.overlay-head',
    null,
    h(
      'button.btn-icon',
      { type: 'button', 'aria-label': t('common.close'), onclick: () => closeOverlay('user') },
      icon('close')
    ),
    h('h1.overlay-title', { text: title }),
    ...actions.map((action) =>
      h(
        'button.btn-icon',
        {
          type: 'button',
          'aria-label': action.label,
          onclick: action.onClick,
          ...(action.id ? { id: action.id } : {}),
        },
        icon(action.icon)
      )
    )
  );
  return h('div.overlay-page', null, head, h('div.overlay-body', null, body));
}

/* ── bottom sheets (approval / question) ───────────────────────────── */

const sheetStack = [];

export function openSheet({ title, subtitle, body, actions = [], onClose, labelledBy }) {
  const host = byId('sheets');
  if (!host) return () => {};
  const sheet = h('div.sheet', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title || undefined,
  });

  const close = (reason = 'dismiss') => {
    const entry = sheetStack.find((item) => item.sheet === sheet);
    if (!entry) return;
    sheetStack.splice(sheetStack.indexOf(entry), 1);
    entry.backdrop.remove();
    sheet.remove();
    document.removeEventListener('keydown', entry.keydown);
    if (entry.onClose) entry.onClose(reason);
    if (!document.querySelector('.sheet') && document.querySelector('.overlay')) {
      // Overlay stays put; nothing else to restore.
    }
  };

  const backdrop = h('div.sheet-backdrop', { onclick: () => close('backdrop') });
  const keydown = (event) => {
    if (event.key === 'Escape' && sheetStack[sheetStack.length - 1]?.sheet === sheet) {
      event.preventDefault();
      close('escape');
    }
  };

  const actionNodes = actions.map((action) => {
    if (action.type === 'button') {
      return h(
        'button.btn',
        {
          type: 'button',
          class: action.kind ? `btn-${action.kind}` : '',
          onclick: () => action.onClick(() => close('action')),
          disabled: action.disabled || undefined,
        },
        action.icon ? icon(action.icon, 'icon-sm') : null,
        h('span', { text: action.label })
      );
    }
    return h(
      'button.sheet-action',
      { type: 'button', onclick: () => action.onClick(() => close('action')) },
      h('span', { text: action.label }),
      icon(action.icon || 'forward', 'icon-sm')
    );
  });

  sheet.append(
    h('div.sheet-grip'),
    h(
      'div.sheet-head',
      null,
      h('h2.sheet-title', { text: title || '' }),
      subtitle ? h('p.sheet-sub', { text: subtitle }) : null
    ),
    body ? h('div.sheet-body', null, body) : null,
    actionNodes.length
      ? h(
          'div.sheet-actions',
          { class: actions.every((a) => a.type === 'button') ? 'row' : '' },
          ...actionNodes
        )
      : null
  );

  host.append(backdrop, sheet);
  sheetStack.push({ sheet, backdrop, onClose, keydown });
  document.addEventListener('keydown', keydown);
  requestAnimationFrame(() => focusFirst(sheet));
  return () => close('api');
}

export function closeAllSheets() {
  for (const entry of [...sheetStack]) {
    entry.backdrop.remove();
    entry.sheet.remove();
    document.removeEventListener('keydown', entry.keydown);
  }
  sheetStack.length = 0;
}

/* ── misc ──────────────────────────────────────────────────────────── */

export function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
  return el;
}

export function isVisible(el) {
  return !!(el && el.offsetParent !== null);
}
