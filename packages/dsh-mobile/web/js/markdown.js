/* DSH Mobile — markdown-lite renderer.
 * Input is escaped first; only our own whitelisted tags are ever emitted, so a
 * tool preview or assistant message can not inject HTML. Supports: fenced code,
 * inline code, bold, italic, strikethrough, links (http/https only), autolinks,
 * unordered/ordered lists, headings, blockquotes, horizontal rules, paragraphs.
 */
import { escapeHtml } from './dom.js';

const FENCE_RE = /```([\w+#.-]*)[^\S\n]*\n?([\s\S]*?)```/g;
const NUL = '\u0000';

export function md(source) {
  let text = String(source == null ? '' : source).replace(/\u0000/g, '');
  const blocks = [];

  text = text.replace(FENCE_RE, (_match, lang, code) => {
    const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
    blocks.push(`<pre><code${cls}>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`);
    return `${NUL}C${blocks.length - 1}${NUL}`;
  });

  // Escape everything before adding markup.
  let html = escapeHtml(text);

  // Protect inline code from further inline formatting.
  const inline = [];
  html = html.replace(/`([^`\n]+)`/g, (_match, code) => {
    inline.push(`<code>${code}</code>`);
    return `${NUL}I${inline.length - 1}${NUL}`;
  });

  html = renderBlocks(html);

  // Inline formatting (operates on text + our block tags only).
  html = html
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label, url) => {
      const clean = url.replace(/&amp;/g, '&');
      return `<a href="${escapeHtml(clean)}" target="_blank" rel="noopener noreferrer nofollow">${label}</a>`;
    })
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_m, prefix, url) => {
      const clean = url.replace(/&amp;/g, '&');
      const trailing = clean.match(/[.,;:!?]+$/);
      const tail = trailing ? trailing[0] : '';
      const href = tail ? clean.slice(0, -tail.length) : clean;
      return `${prefix}<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(href)}</a>${tail}`;
    })
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
    .replace(/(^|[^*\w])\*([^*\n]+?)\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+?)_(?![_\w])/g, '$1<em>$2</em>');

  html = html.replace(new RegExp(`${NUL}I(\\d+)${NUL}`, 'g'), (_m, index) => inline[Number(index)] || '');
  html = html.replace(new RegExp(`${NUL}C(\\d+)${NUL}`, 'g'), (_m, index) => blocks[Number(index)] || '');
  return html;
}

function renderBlocks(html) {
  const lines = html.split('\n');
  const out = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${paragraph.join('<br>')}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    out.push(`<${list.type}>${list.items.map((item) => `<li>${item}</li>`).join('')}</${list.type}>`);
    list = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }
    if (new RegExp(`^${NUL}C\\d+${NUL}$`).test(trimmed)) {
      flushParagraph();
      flushList();
      out.push(trimmed);
      continue;
    }
    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length + 2; // h1→h3, keep chat hierarchy sane
      out.push(`<h${level}>${heading[2]}</h${level}>`);
      continue;
    }
    const unordered = trimmed.match(/^[-*+]\s+(.*)$/);
    if (unordered) {
      flushParagraph();
      if (!list || list.type !== 'ul') {
        flushList();
        list = { type: 'ul', items: [] };
      }
      list.items.push(unordered[1]);
      continue;
    }
    const ordered = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (ordered) {
      flushParagraph();
      if (!list || list.type !== 'ol') {
        flushList();
        list = { type: 'ol', items: [] };
      }
      list.items.push(ordered[1]);
      continue;
    }
    const quote = trimmed.match(/^&gt;\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      out.push(`<blockquote>${quote[1]}</blockquote>`);
      continue;
    }
    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      flushParagraph();
      flushList();
      out.push('<hr>');
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  return out.join('');
}

/** Render into an element. The output is sanitized by construction. */
export function renderMD(element, source) {
  if (!element) return element;
  element.classList.add('md');
  element.innerHTML = md(source);
  return element;
}
