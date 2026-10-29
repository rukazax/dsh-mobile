/* DSH Mobile — pairing screen.
 * Contract §2: POST /pair { code, deviceName, devicePlatform } → deviceToken.
 * The PWA can not read the desktop QR directly, so the QR's dshm:// link can be
 * pasted and is parsed here; the address + 8-character code can also be typed.
 */
import {
  api,
  errorText,
  getBase,
  getDevice,
  normalizeBase,
  setBase,
  setDevice,
  setToken,
} from './api.js';
import { prefs, store } from './store.js';
import { t } from './i18n.js';
import { h, icon, openOverlay, page, toast } from './dom.js';
import { navigate } from './router.js';
import { refreshSessions } from './sessions.js';

export function openPair() {
  const prefilled = readDeepLink();
  openOverlay(
    ({ close }) => {
    const serverInput = h('input.input', {
      type: 'url',
      id: 'pair-server',
      value: prefilled.url || getBase(),
      placeholder: t('pair.serverPlaceholder'),
      inputmode: 'url',
      autocapitalize: 'off',
      spellcheck: 'false',
      autocomplete: 'url',
    });
    const codeInput = h('input.input.code-input', {
      id: 'pair-code',
      value: prefilled.code || '',
      placeholder: t('pair.codePlaceholder'),
      maxlength: '32',
      inputmode: 'text',
      autocapitalize: 'characters',
      spellcheck: 'false',
      autocomplete: 'one-time-code',
      'aria-label': t('pair.code'),
    });
    const nameInput = h('input.input', {
      type: 'text',
      value: prefilled.name || getDevice()?.name || guessDeviceName(),
      placeholder: t('pair.devicePlaceholder'),
      autocomplete: 'off',
    });
    const errorBox = h('div.banner.banner-danger', { hidden: true });
    const submit = h(
      'button.btn.btn-primary.btn-block',
      { type: 'submit' },
      icon('link', 'icon-sm'),
      h('span', { text: t('pair.submit') })
    );
    const form = h(
      'form.pair-form',
      { novalidate: '' },
      h('div.field', null, h('label', { for: 'pair-server', text: t('pair.server') }), serverInput, h('small.row-hint', { text: t('pair.serverHint') })),
      h('div.field', null, h('label', { for: 'pair-code', text: t('pair.code') }), codeInput),
      h('div.field', null, h('label', { for: 'pair-device', text: t('pair.device') }), nameInput),
      errorBox,
      submit,
      insecureNote(prefilled.url || getBase())
    );

    const showError = (message) => {
      errorBox.hidden = false;
      errorBox.replaceChildren(icon('alert', 'icon-sm'), h('span', { text: message }));
    };

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const base = normalizeBase(serverInput.value);
      if (!/^https?:\/\//i.test(serverInput.value.trim())) {
        showError(t('settings.serverInvalid'));
        return;
      }
      const code = codeInput.value.trim().toUpperCase();
      if (!code) {
        showError(t('pair.errorInvalid'));
        codeInput.focus();
        return;
      }
      submit.disabled = true;
      submit.lastElementChild.textContent = t('pair.submitting');
      errorBox.hidden = true;
      try {
        setBase(base);
        const result = await api.pair({
          code,
          deviceName: nameInput.value.trim() || guessDeviceName(),
          devicePlatform: guessPlatform(),
        });
        setToken(result.deviceToken);
        const device = {
          id: result.deviceId,
          name: nameInput.value.trim() || guessDeviceName(),
          platform: guessPlatform(),
          host: result.host || { name: 'DSH', appVersion: '', protocol: 1 },
        };
        setDevice(device);
        prefs.set('pairedAt', new Date().toISOString());
        store.update('auth', { paired: true });
        store.set({ device, sessionsState: 'idle', sessionsError: '' });
        toast(t('pair.success'), 'ok');
        close();
        navigate('/sessions');
        refreshSessions({ silent: true });
      } catch (error) {
        const message =
          error?.code === 'pairing-invalid'
            ? t('pair.errorInvalid')
            : error?.code === 'pairing-expired'
              ? t('pair.errorExpired')
              : error?.code === 'rate-limited'
                ? t('pair.errorRate')
                : error?.code === 'network'
                  ? t('pair.errorNetwork')
                  : errorText(error);
        showError(message);
      } finally {
        submit.disabled = false;
        submit.lastElementChild.textContent = t('pair.submit');
      }
    });

    const linkInput = h('textarea.textarea', {
      rows: '2',
      placeholder: t('pair.pastePlaceholder'),
      'aria-label': t('pair.paste'),
      spellcheck: 'false',
    });
    const parseBtn = h(
      'button.btn.btn-block',
      {
        type: 'button',
        onclick: () => {
          const parsed = parsePairLink(linkInput.value);
          if (!parsed) {
            showError(t('pair.pasteError'));
            return;
          }
          serverInput.value = parsed.url;
          codeInput.value = parsed.code;
          showError_clear();
          codeInput.focus();
          toast(t('pair.manualHint'), 'info');
        },
      },
      icon('qr', 'icon-sm'),
      h('span', { text: t('pair.pasteApply') })
    );
    function showError_clear() {
      errorBox.hidden = true;
    }

    const body = h(
      'div',
      null,
      h(
        'div.pair-hero',
        null,
        h('div.pair-mark', { text: '>_' }),
        h('h2.pair-title', { text: t('pair.title') }),
        h('p.pair-sub', { text: t('pair.subtitle') })
      ),
      form,
      h(
        'div.pair-steps',
        null,
        h('h3.tool-section-label', { text: t('pair.stepsTitle') }),
        step('1', t('pair.step1')),
        step('2', t('pair.step2')),
        step('3', t('pair.step3'))
      ),
      h(
        'section.section',
        null,
        h('h2.section-title', { text: t('pair.paste') }),
        h('div.pair-form', null, linkInput, parseBtn)
      ),
      h(
        'section.section',
        null,
        h('h2.section-title', { text: t('pair.demoTitle') }),
        h('div.pair-form', null, h('p.row-hint', { text: t('pair.demoText') }), demoLink())
      )
    );
    return page({ title: t('pair.title'), body });
    },
    {
      onClose: (reason) => {
        if (reason === 'user' && location.hash === '#/pair') navigate('/sessions');
      },
    }
  );
}

function step(number, text) {
  return h('div.step', null, h('span.step-n', { text: number }), h('span', { text }));
}

function insecureNote(base) {
  const insecure = /^http:\/\//i.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(base);
  if (!insecure) return null;
  return h(
    'div.banner.banner-warn',
    { style: { margin: '0' } },
    icon('lock', 'icon-sm'),
    h('div', null, h('strong', { text: t('pair.insecureTitle') }), h('div', { text: t('pair.insecureText') }))
  );
}

function demoLink() {
  return h(
    'a.btn.btn-block',
    { href: '?demo=1#/s/s-demo-1', style: { 'text-decoration': 'none' } },
    icon('sparkle', 'icon-sm'),
    h('span', { text: t('pair.openDemo') })
  );
}

function guessDeviceName() {
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  return 'DSH Mobile Web';
}

function guessPlatform() {
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  return 'web';
}

function readDeepLink() {
  const params = new URLSearchParams(location.search);
  const hash = location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?') + 1) : '';
  const hashParams = new URLSearchParams(hash);
  const get = (key) => params.get(key) || hashParams.get(key) || '';
  const url = get('url');
  const code = get('code');
  return {
    url: url ? decodeURIComponent(url) : '',
    code: code ? decodeURIComponent(code).toUpperCase() : '',
    name: get('name') ? decodeURIComponent(get('name')) : '',
  };
}

export function parsePairLink(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const urlMatch = text.match(/[?&]url=([^&\s]+)/i);
  const codeMatch = text.match(/[?&]code=([^&\s]+)/i);
  if (urlMatch && codeMatch) {
    try {
      return {
        url: decodeURIComponent(urlMatch[1]),
        code: decodeURIComponent(codeMatch[1]).toUpperCase(),
      };
    } catch {
      return null;
    }
  }
  return null;
}
