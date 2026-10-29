/* DSH Mobile — Layout Lab.
 * Real foldable support is CSS-only (media queries + env(viewport-segment-*)).
 * This lab replays the exact same layout variables on any screen so posture
 * behaviour (two panes, hinge gutter, state preserved) can be reviewed without
 * a physical foldable. Open with ?lab=1 (panel) or the #/lab route (page).
 */
import { t } from './i18n.js';
import { h, icon, openOverlay, page } from './dom.js';
import { navigate } from './router.js';

const labState = { layout: 'dual', width: 940, hinge: 24 };

const WIDTHS = [380, 673, 940, 1172];
const HINGES = [0, 16, 24, 48];

export function initLab() {
  const params = new URLSearchParams(location.search);
  const enabled = params.get('lab') != null && params.get('lab') !== '0';
  if (!enabled) return false;
  document.documentElement.classList.add('lab');
  applyLab();
  const bar = document.getElementById('lab-bar');
  if (bar) {
    bar.hidden = false;
    bar.replaceChildren(...buildControls('bar'));
  }
  return true;
}

export function openLab() {
  openOverlay(
    () => {
    const info = segmentInfo();
    const envLine = info.envWidth
      ? `env(viewport-segment-width 0 0) = ${info.envWidth}`
      : t('lab.envUnsupported');
    const body = h(
      'div',
      null,
      h(
        'div.pair-hero',
        null,
        h('div.pair-mark', null, icon('fold', 'icon-lg')),
        h('h2.pair-title', { text: t('lab.title') }),
        h('p.pair-sub', { text: t('lab.subtitle') })
      ),
      h(
        'section.section',
        null,
        h('h2.section-title', { text: t('lab.layout') }),
        h('div.lab-page-controls', null, ...buildControls('page')),
        h(
          'div.diag-grid',
          null,
          diag(t('lab.realSegments'), info.segments2 ? t('lab.detected', { n: 2 }) : t('lab.notSupported')),
          diag('spanning', info.spanning ? 'single-fold-vertical / dual-screen' : '—'),
          diag(t('lab.envValue'), envLine),
          diag(t('lab.viewport'), `${window.innerWidth}×${window.innerHeight}`)
        )
      ),
      h(
        'section.section',
        null,
        h('h2.section-title', { text: t('lab.explainTitle') }),
        h('div.pair-steps', null, h('p.row-hint', { text: t('lab.explain') }), h('p.row-hint', { text: t('lab.note') })),
        h(
          'div.pair-form',
          null,
          h(
            'a.btn.btn-primary.btn-block',
            { href: '?demo=1&lab=1#/s/s-demo-1', style: { 'text-decoration': 'none' } },
            icon('sparkle', 'icon-sm'),
            h('span', { text: `${t('lab.openDemo')} (?demo=1&lab=1)` })
          ),
          h('p.row-hint', { text: t('lab.hint') }),
          h('p.row-hint', { text: t('lab.frameHint') })
        )
      )
    );
    return page({ title: t('lab.title'), body });
    },
    {
      onClose: (reason) => {
        if (reason === 'user' && location.hash === '#/lab') navigate('/sessions');
      },
    }
  );
}

function diag(key, value) {
  return h(
    'div.diag-item',
    null,
    h('span.diag-key', { text: key }),
    h('span.diag-val', { text: value })
  );
}

/* ── controls ──────────────────────────────────────────────────────── */

function buildControls(variant) {
  const nodes = [];
  const isBar = variant === 'bar';

  const group = (label) => h('div.lab-group', null, h('span.lab-label', { text: label }));
  const button = (label, active, onClick) =>
    h(
      'button.lab-btn',
      { type: 'button', 'aria-pressed': String(active), onclick: onClick },
      h('span', { text: label })
    );

  const layoutGroup = group(t('lab.layout'));
  for (const [layout, label] of [
    ['single', t('lab.single')],
    ['dual', t('lab.dual')],
    ['rail', t('lab.rail')],
  ]) {
    layoutGroup.appendChild(
      button(label, labState.layout === layout, () => {
        labState.layout = layout;
        applyLab();
        rerender();
      })
    );
  }
  nodes.push(layoutGroup);

  const hingeGroup = group(t('lab.hinge'));
  for (const hinge of HINGES) {
    hingeGroup.appendChild(
      button(`${hinge}px`, labState.hinge === hinge, () => {
        labState.hinge = hinge;
        applyLab();
        rerender();
      })
    );
  }
  nodes.push(hingeGroup);

  const widthGroup = group(t('lab.width'));
  for (const width of WIDTHS) {
    widthGroup.appendChild(
      button(String(width), labState.width === width, () => {
        labState.width = width;
        applyLab();
        rerender();
      })
    );
  }
  nodes.push(widthGroup);

  const posture = h('div.lab-group', null, h('span.lab-label', { text: t('lab.posture') }));
  posture.appendChild(
    h('span.chip', {
      text: labState.layout === 'single' ? t('lab.posture.folded') : t('lab.posture.unfolded'),
    })
  );
  nodes.push(posture);

  nodes.push(
    h(
      'button.lab-btn',
      {
        type: 'button',
        onclick: () => {
          labState.layout = 'dual';
          labState.width = 940;
          labState.hinge = 24;
          applyLab();
          rerender();
        },
      },
      h('span', { text: t('lab.reset') })
    )
  );

  if (isBar) {
    nodes.push(
      h(
        'a.lab-btn',
        { href: '#/lab', style: { 'text-decoration': 'none' }, 'aria-label': t('lab.title') },
        h('span', { text: '?' })
      )
    );
  }
  return nodes;
}

function rerender() {
  const bar = document.getElementById('lab-bar');
  if (bar && !bar.hidden) bar.replaceChildren(...buildControls('bar'));
  const overlay = document.getElementById('overlay');
  if (overlay && !overlay.hidden) openLab();
}

function applyLab() {
  const root = document.documentElement;
  root.dataset.labLayout = labState.layout;
  root.dataset.labPosture = labState.layout === 'single' ? 'folded' : 'unfolded';
  root.style.setProperty('--lab-w', `${labState.layout === 'single' ? 400 : labState.width}px`);
  root.style.setProperty('--lab-hinge', `${labState.hinge}px`);
}

/* ── real-device detection helpers (used by diagnostics too) ───────── */

export function segmentInfo() {
  const matches = (query) => {
    try {
      return window.matchMedia(query).matches;
    } catch {
      return false;
    }
  };
  const info = {
    segments2: matches('(horizontal-viewport-segments: 2)'),
    spanning:
      matches('(spanning: single-fold-vertical)') || matches('(spanning: dual-screen)'),
    envWidth: '',
  };
  try {
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:absolute;left:-9999px;top:0;visibility:hidden;width:env(viewport-segment-width 0 0, 0px)';
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe).width;
    probe.remove();
    if (computed && computed !== '0px') info.envWidth = computed;
  } catch {
    /* env() unsupported */
  }
  return info;
}

export function isLabEnabled() {
  return document.documentElement.classList.contains('lab');
}

export function labStateSnapshot() {
  return { ...labState };
}

export { WIDTHS, HINGES };
