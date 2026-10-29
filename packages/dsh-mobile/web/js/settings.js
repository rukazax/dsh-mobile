/* DSH Mobile — settings overlay: connection, language, theme, text size,
 * diagnostics (RTT / bytes / cache / stream) and destructive actions. */
import {
  api,
  clearAuth,
  errorText,
  getBase,
  getDevice,
  hasAuth,
  netStats,
  setBase,
} from './api.js';
import { sseStats } from './sse.js';
import { prefs, store } from './store.js';
import {
  fmtBytes,
  fmtDateTime,
  fmtDuration,
  getLang,
  setLang,
  t,
} from './i18n.js';
import * as db from './db.js';
import { h, icon, openOverlay, page, refreshOverlay, toast } from './dom.js';
import { navigate } from './router.js';
import { refreshSessions } from './sessions.js';

let cacheStats = { sessions: 0, events: 0, mode: '—' };
let editingServer = false;
let diagnosticsTimer = 0;

export function openSettings() {
  editingServer = false;
  openOverlay(
    ({ close }) => {
      const body = h('div.settings-page');
      body.append(
        section(t('settings.connection'), connectionRows()),
        section(t('settings.diagnostics'), diagnosticsNodes()),
        section(t('settings.language'), [
          row(
            h('div.row-label', null, t('settings.language'), h('small', { text: t('settings.languageHint') })),
            segmented(
              [
                { value: 'ru', label: 'Русский' },
                { value: 'en', label: 'English' },
              ],
              getLang(),
              (value) => {
                setLang(value);
                prefs.set('lang', value);
                store.update('ui', { lang: value });
                toast(value === 'ru' ? 'Русский интерфейс' : 'English UI', 'ok');
                openSettings();
              }
            )
          ),
        ]),
        section(t('settings.theme'), [
          row(
            h('div.row-label', null, t('settings.theme')),
            segmented(
              [
                { value: 'auto', label: t('settings.theme.auto') },
                { value: 'light', label: t('settings.theme.light') },
                { value: 'dark', label: t('settings.theme.dark') },
              ],
              store.get('ui').theme,
              (value) => {
                prefs.set('theme', value);
                store.update('ui', { theme: value });
                document.documentElement.dataset.theme = value;
                toast(t('settings.theme') + ': ' + t(`settings.theme.${value}`), 'ok');
                openSettings();
              }
            )
          ),
          row(
            h(
              'div.row-label',
              null,
              t('settings.fontSize'),
              h('small', { text: t('settings.fontSizeHint') })
            ),
            segmented(
              [
                { value: '0.9', label: 'A−' },
                { value: '1', label: 'A' },
                { value: '1.15', label: 'A+' },
                { value: '1.3', label: 'A++' },
              ],
              String(store.get('ui').fontScale),
              (value) => {
                const scale = Number(value);
                prefs.set('fontScale', scale);
                store.update('ui', { fontScale: scale });
                document.documentElement.style.setProperty('--font-scale', String(scale));
                openSettings();
              }
            )
          ),
        ]),
        section(t('settings.actions'), actionRows(close)),
        h(
          'div.settings-foot',
          null,
          h('div', { text: `${t('settings.version')} 0.1.0 · protocol 1` }),
          h('div', { text: t('settings.aboutText') })
        )
      );
      return page({ title: t('settings.title'), body });
    },
    {
      onClose: (reason) => {
        clearInterval(diagnosticsTimer);
        diagnosticsTimer = 0;
        if (reason === 'user' && location.hash === '#/settings') navigate('/sessions');
      },
    }
  );
  db.stats().then((value) => {
    cacheStats = value;
    refreshOverlay();
  });
  clearInterval(diagnosticsTimer);
  diagnosticsTimer = setInterval(() => {
    if (!document.getElementById('overlay') || document.getElementById('overlay').hidden) {
      clearInterval(diagnosticsTimer);
      diagnosticsTimer = 0;
      return;
    }
    refreshOverlay();
  }, 1500);
}

/* ── section builders ──────────────────────────────────────────────── */

function section(title, children) {
  return h('section.section', null, h('h2.section-title', { text: title }), ...children);
}

function row(label, value) {
  return h('div.row', null, label, value);
}

function segmented(options, current, onPick) {
  const group = h('div.segmented');
  for (const option of options) {
    group.appendChild(
      h(
        'button.seg-btn',
        {
          type: 'button',
          'aria-pressed': String(option.value === current),
          onclick: () => onPick(option.value),
        },
        h('span', { text: option.label })
      )
    );
  }
  return group;
}

function connectionRows() {
  const device = getDevice() || store.get('device');
  const base = getBase();
  const insecure = /^http:\/\//i.test(base);
  const nodes = [];

  if (editingServer) {
    const input = h('input.input', {
      type: 'url',
      value: base,
      placeholder: t('pair.serverPlaceholder'),
      'aria-label': t('settings.server'),
      inputmode: 'url',
      autocapitalize: 'off',
      spellcheck: 'false',
    });
    nodes.push(
      h(
        'div.pair-form',
        null,
        h('div.field', null, h('span.field-label', { text: t('settings.server') }), input),
        h('small', { class: 'row-hint', text: t('settings.serverHint') }),
        h(
          'div.sheet-actions.row',
          null,
          h(
            'button.btn.btn-primary',
            {
              type: 'button',
              onclick: () => {
                if (!/^https?:\/\//i.test(input.value.trim())) {
                  toast(t('settings.serverInvalid'), 'danger');
                  return;
                }
                setBase(input.value);
                editingServer = false;
                toast(t('settings.serverSaved'), 'ok');
                refreshSessions({ silent: true });
                openSettings();
              },
            },
            icon('check', 'icon-sm'),
            h('span', { text: t('common.save') })
          ),
          h(
            'button.btn.btn-ghost',
            {
              type: 'button',
              onclick: () => {
                editingServer = false;
                openSettings();
              },
            },
            h('span', { text: t('common.cancel') })
          )
        )
      )
    );
  } else {
    nodes.push(
      row(
        h('div.row-label', null, t('settings.server'), h('small', { text: base })),
        h(
          'button.btn.btn-sm',
          { type: 'button', onclick: () => { editingServer = true; openSettings(); } },
          h('span', { text: t('settings.changeServer') })
        )
      )
    );
  }

  nodes.push(
    row(
      h('div.row-label', null, t('settings.state')),
      h('span.row-value', {
        text: hasAuth() || store.get('ui').demo ? t('settings.paired') : t('settings.notPaired'),
      })
    ),
    row(h('div.row-label', null, t('settings.host')), h('span.row-value', { text: device?.host?.name || '—' })),
    row(
      h('div.row-label', null, t('settings.device')),
      h('span.row-value', { text: device?.name || device?.id || t('settings.noDevice') })
    ),
    row(
      h('div.row-label', null, t('settings.protocol')),
      h('span.row-value', { text: device?.host?.protocol ? `v${device.host.protocol}` : '1' })
    )
  );
  if (insecure) {
    nodes.push(
      h(
        'div.banner.banner-warn',
        { style: { margin: '8px 16px 12px' } },
        icon('lock', 'icon-sm'),
        h('span', { text: t('conn.insecureHint') })
      )
    );
  }
  return nodes;
}

function diagnosticsNodes() {
  const state = store.get();
  const sseState = sseStats.lastStatus || state.stream?.state || 'idle';
  const cells = [
    [t('settings.diag.requests'), String(netStats.requests)],
    [t('settings.diag.bytes'), fmtBytes(netStats.bytes)],
    [t('settings.diag.rtt'), fmtDuration(netStats.rttMs)],
    [t('settings.diag.sse'), sseState],
    [t('settings.diag.sseEvents'), String(sseStats.events)],
    [t('settings.diag.resyncs'), String(state.diagnostics.resyncs || 0)],
    [t('settings.diag.cacheSessions'), `${cacheStats.sessions} (${cacheStats.mode})`],
    [t('settings.diag.cacheEvents'), String(cacheStats.events)],
    [
      t('settings.diag.lastSync'),
      state.diagnostics.lastSyncAt ? fmtDateTime(new Date(state.diagnostics.lastSyncAt).toISOString()) : t('common.never'),
    ],
    [t('settings.diag.serverTime'), api.base()],
  ];
  return [
    h(
      'div.diag-grid',
      null,
      ...cells.map(([key, value]) =>
        h('div.diag-item', null, h('span.diag-key', { text: key }), h('span.diag-val', { text: value }))
      )
    ),
    h('div.settings-foot', { text: t('settings.diagHint') }),
    h(
      'button.row',
      {
        type: 'button',
        onclick: async () => {
          await refreshSessions();
          toast(t('settings.refreshAll'), 'ok');
          openSettings();
        },
      },
      h('span.row-label', { text: t('settings.refreshAll') }),
      icon('refresh', 'icon-sm')
    ),
  ];
}

function actionRows(close) {
  const demo = store.get('ui').demo;
  const rows = [
    h(
      'button.row',
      {
        type: 'button',
        onclick: () => {
          navigate('/lab');
          close();
        },
      },
      h('div.row-label', null, t('settings.openLab'), h('small', { text: t('settings.labHint') })),
      icon('fold', 'icon-sm')
    ),
    h(
      'a.row',
      { href: demo ? '?demo=0#/sessions' : '?demo=1#/s/s-demo-1', style: { 'text-decoration': 'none' } },
      h('div.row-label', null, demo ? t('settings.disconnect') : t('settings.openDemo'), h('small', { text: t('settings.demoHint') })),
      icon('sparkle', 'icon-sm')
    ),
    h(
      'button.row',
      {
        type: 'button',
        onclick: async () => {
          if (!confirm(t('settings.clearCacheConfirm'))) return;
          await db.clearAll();
          cacheStats = await db.stats();
          toast(t('settings.cacheCleared'), 'ok');
          openSettings();
        },
      },
      h('div.row-label', null, t('settings.clearCache')),
      icon('trash', 'icon-sm')
    ),
    h(
      'button.row',
      {
        type: 'button',
        onclick: async () => {
          if (demo) {
            toast(t('demo.banner'), 'info');
            return;
          }
          if (!confirm(t('settings.revokeConfirm'))) return;
          try {
            await api.revoke();
            clearAuth();
            store.update('auth', { paired: false });
            toast(t('settings.revokeDone'), 'ok');
            navigate('/pair');
          } catch (error) {
            toast(errorText(error), 'danger');
          }
        },
      },
      h('div.row-label', null, t('settings.revoke'), h('small', { text: t('settings.deviceHint') })),
      icon('device', 'icon-sm')
    ),
    h(
      'button.row',
      {
        type: 'button',
        class: 'row',
        style: { color: 'var(--danger)' },
        onclick: () => {
          if (demo) {
            toast(t('demo.banner'), 'info');
            return;
          }
          if (!confirm(t('settings.disconnectConfirm'))) return;
          clearAuth();
          store.update('auth', { paired: false });
          navigate('/pair');
        },
      },
      h('div.row-label', null, t('settings.disconnect')),
      icon('close', 'icon-sm')
    ),
  ];
  return rows;
}
