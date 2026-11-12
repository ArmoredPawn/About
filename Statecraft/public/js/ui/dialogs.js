// Modal dialogs and toasts.

import { $, h, fill } from './dom.js';

// Opens a modal. Each action's onClick may return false (or a promise of false) to keep it open.
export function modal({ title, body, actions = [], onClose }) {
  const dlg = $('modal');
  const close = () => { if (dlg.open) dlg.close(); };
  const foot = h('div.modal-foot', actions.map((a) => {
    const btn = h('button.btn', { class: a.kind ?? '', type: 'button' }, a.label);
    btn.addEventListener('click', async () => {
      if (!a.onClick) return close();
      btn.disabled = true;
      try {
        const keep = await a.onClick();
        if (keep !== false) close();
      } finally {
        btn.disabled = false;
      }
    });
    return btn;
  }));
  fill($('modal-body'),
    h('div.modal-head', h('h2', title), h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: close }, '✕')),
    h('div.modal-body', body),
    actions.length ? foot : null,
  );
  dlg.onclose = () => onClose?.();
  if (!dlg.open) dlg.showModal();
  return { close, el: dlg };
}

export function confirmBox(title, text, { ok = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    modal({
      title,
      body: typeof text === 'string' ? h('p.muted', text) : text,
      actions: [
        { label: 'Cancel', kind: 'ghost', onClick: () => { answered = true; resolve(false); } },
        { label: ok, kind: danger ? 'danger' : 'primary', onClick: () => { answered = true; resolve(true); } },
      ],
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

export function closeModal() {
  const dlg = $('modal');
  if (dlg.open) dlg.close();
}

const TOAST_TITLES = { good: 'Good news', bad: 'Bad news', war: 'War', warn: 'Notice', proposal: 'Proposal', un: 'United Nations', nuclear: 'Nuclear alert', info: 'Report' };

export function toast(text, kind = 'info', onClick) {
  const box = $('toasts');
  const el = h('div.toast', { class: kind }, h('div.t', TOAST_TITLES[kind] ?? 'Report'), text);
  el.addEventListener('click', () => { onClick?.(); el.remove(); });
  box.append(el);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => el.remove(), kind === 'nuclear' || kind === 'proposal' ? 12000 : 6500);
}

// Number field with a label and an optional suffix
export function numberField(label, { value = '', min, max, step = 'any', suffix, id } = {}) {
  const input = h('input', { type: 'number', value, min, max, step, id, inputmode: 'decimal' });
  return { el: h('label.field', h('span', label, suffix ? ` (${suffix})` : ''), input), input };
}

export function selectField(label, options, value) {
  const sel = h('select', options.map(([v, text]) => h('option', { value: v, selected: String(v) === String(value) }, text)));
  return { el: h('label.field', h('span', label), sel), input: sel };
}
