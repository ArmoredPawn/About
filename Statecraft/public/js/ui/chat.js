// Diplomatic channels: the world chat, one-to-one messages, group chats and a chat for every alliance.

import { $, h, flag, nationName, timeAgo, fill } from './dom.js';
import { modal } from './dialogs.js';

export class Chat {
  constructor(ctx) {
    this.ctx = ctx;
    this.channels = new Map(); // id -> { meta, messages }
    this.current = 'world';
    this.read = new Map();
    this.open = false;
    $('chat-close').addEventListener('click', () => this.toggle(false));
    $('chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('chat-input');
      const text = input.value.trim();
      if (!text) return;
      const ch = this.channels.get(this.current);
      if (ch?.pendingTo) this.ctx.net.send({ type: 'chat', ch: this.current, to: ch.pendingTo, text });
      else this.ctx.net.send({ type: 'chat', ch: this.current, text });
      input.value = '';
    });
    $('lobby-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('lobby-input');
      const text = input.value.trim();
      if (!text) return;
      this.ctx.net.send({ type: 'chat', ch: 'world', text });
      input.value = '';
    });
  }

  reset() {
    this.channels.clear();
    this.read.clear();
    this.current = 'world';
  }

  init(list) {
    this.channels.clear();
    for (const ch of list) this.channels.set(ch.id, { meta: ch, messages: ch.messages ?? [] });
    if (!this.channels.has(this.current)) this.current = 'world';
    this.render();
  }

  setChannels(list) {
    const keep = new Map(this.channels);
    this.channels.clear();
    for (const meta of list) this.channels.set(meta.id, { meta, messages: keep.get(meta.id)?.messages ?? [] });
    for (const [id, ch] of keep) if (ch.pendingTo && !this.channels.has(id)) this.channels.set(id, ch);
    if (!this.channels.has(this.current)) this.current = 'world';
    this.render();
  }

  receive(msg, meta) {
    let ch = this.channels.get(msg.ch);
    if (!ch) {
      ch = { meta, messages: [] };
      this.channels.set(msg.ch, ch);
    }
    ch.pendingTo = null;
    if (meta) ch.meta = meta;
    ch.messages.push(msg);
    if (ch.messages.length > 200) ch.messages.shift();
    const mine = msg.from && msg.from === this.ctx.state?.me && msg.player === this.ctx.myName;
    if (this.open && this.current === msg.ch) this.read.set(msg.ch, ch.messages.length);
    else if (!mine && !msg.system && this.ctx.screen === 'game' && msg.ch !== 'world') {
      this.ctx.toast(h('span', h('b', `${msg.player} (${nationName(this.ctx.state, msg.from)})`), ': ', msg.text.slice(0, 120)), 'info', () => { this.toggle(true); this.show(msg.ch); });
    }
    if (mine) this.read.set(msg.ch, ch.messages.length);
    this.render();
    this.ctx.refreshHud?.();
  }

  unread() {
    let n = 0;
    for (const [id, ch] of this.channels) n += Math.max(0, ch.messages.filter((m) => !m.system).length - (this.read.get(id) ?? 0)) * (id === 'world' ? 0 : 1);
    return n;
  }

  toggle(force) {
    this.open = force ?? !this.open;
    $('chat').hidden = !this.open;
    if (this.open) {
      this.read.set(this.current, this.channels.get(this.current)?.messages.length ?? 0);
      this.render();
      setTimeout(() => $('chat-input').focus(), 0);
    }
    this.ctx.refreshHud?.();
  }

  show(id) {
    this.current = id;
    this.read.set(id, this.channels.get(id)?.messages.length ?? 0);
    this.render();
    this.ctx.refreshHud?.();
  }

  // Opens (or starts) a one-to-one channel with another leader
  directTo(cid) {
    const me = this.ctx.state.me;
    const id = `dm:${[me, cid].sort().join(':')}`;
    if (!this.channels.has(id)) this.channels.set(id, { meta: { id, kind: 'dm', members: [me, cid] }, messages: [], pendingTo: cid });
    this.toggle(true);
    this.show(id);
  }

  label(meta) {
    const s = this.ctx.state;
    if (meta.kind === 'world') return 'World';
    if (meta.kind === 'dm') {
      const other = meta.members.find((m) => m !== s?.me);
      const leader = s?.countries[other]?.human;
      return `${nationName(s, other)}${leader ? ` · ${leader}` : ''}`;
    }
    return meta.name;
  }

  render() {
    this.#renderLobby();
    if (!this.ctx.state) return;
    const s = this.ctx.state;
    const groups = { world: [], alliance: [], group: [], dm: [] };
    for (const [id, ch] of this.channels) groups[ch.meta.kind]?.push([id, ch]);
    const chan = ([id, ch]) => {
      const unread = Math.max(0, ch.messages.filter((m) => !m.system).length - (this.read.get(id) ?? 0));
      const other = ch.meta.kind === 'dm' ? ch.meta.members.find((m) => m !== s.me) : null;
      return h('button.chan', { 'aria-current': String(id === this.current), onclick: () => this.show(id) },
        other ? flag(other) : h('span', { 'aria-hidden': 'true' }, ch.meta.kind === 'world' ? '🌐' : ch.meta.kind === 'alliance' ? '🛡' : '👥'),
        h('span.label', this.label(ch.meta)),
        unread && id !== this.current ? h('span.n', String(unread)) : null);
    };
    fill($('chat-channels'),
      h('h4', 'Public'), ...groups.world.map(chan),
      groups.alliance.length ? h('h4', 'Alliances') : null, ...groups.alliance.map(chan),
      h('h4', 'Groups'), ...groups.group.map(chan),
      h('button.chan', { onclick: () => this.newGroup() }, h('span', '＋'), h('span.label', 'New group chat')),
      h('h4', 'Direct'), ...groups.dm.map(chan),
      h('button.chan', { onclick: () => this.newDirect() }, h('span', '＋'), h('span.label', 'Message a leader')),
    );
    const cur = this.channels.get(this.current);
    if (!cur) return;
    const title = [h('span', this.label(cur.meta))];
    if (cur.meta.kind === 'group') {
      title.push(h('span.muted.small', `${cur.meta.members.length} leaders`));
      title.push(h('button.btn.small.ghost', { style: { marginLeft: 'auto' }, onclick: () => this.invite(cur.meta) }, 'Add'));
      title.push(h('button.btn.small.ghost', { onclick: () => this.ctx.net.send({ type: 'groupLeave', ch: cur.meta.id }) }, 'Leave'));
    }
    if (cur.meta.kind === 'alliance') title.push(h('span.muted.small', 'Members of this alliance only'));
    if (cur.meta.kind === 'world') title.push(h('span.muted.small', 'Every leader can read this'));
    $('chat-title').replaceChildren(...title);
    this.#fill($('chat-messages'), cur.messages);
  }

  #renderLobby() {
    const world = this.channels.get('world');
    if (world) this.#fill($('lobby-messages'), world.messages);
  }

  #fill(box, messages) {
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    const s = this.ctx.state;
    box.replaceChildren(...(messages.length ? messages.map((m) => {
      if (m.system) return h('div.msg.system', m.text);
      const mine = m.player === this.ctx.myName && (!s || m.from === s.me);
      return h('div.msg', { class: mine ? 'mine' : '' },
        h('div.who', m.from ? flag(m.from) : null, h('b', m.player), m.from ? h('span', nationName(s, m.from)) : null, h('time', timeAgo(m.t))),
        h('div.text', m.text));
    }) : [h('div.empty', 'No messages yet.')]));
    if (atBottom || box.dataset.init !== '1') { box.scrollTop = box.scrollHeight; box.dataset.init = '1'; }
  }

  #leaders() {
    const s = this.ctx.state;
    return Object.entries(s.countries).filter(([id, c]) => c.human && id !== s.me && !c.exile).map(([id, c]) => ({ id, name: c.name, leader: c.human }));
  }

  newDirect() {
    const leaders = this.#leaders();
    if (!leaders.length) return this.ctx.toast('No other human leaders are in this game.', 'warn');
    modal({
      title: 'Message a leader',
      body: h('div.list', leaders.map((l) => h('div.item.clickable', { onclick: () => { this.directTo(l.id); document.getElementById('modal').close(); } },
        h('div.item-head', flag(l.id), h('span.name', l.name), h('span.muted.small', l.leader))))),
    });
  }

  newGroup() {
    const leaders = this.#leaders();
    if (!leaders.length) return this.ctx.toast('No other human leaders are in this game.', 'warn');
    const name = h('input', { maxlength: 32, placeholder: 'e.g. Pacific Council' });
    const boxes = leaders.map((l) => [l, h('input', { type: 'checkbox', value: l.id })]);
    modal({
      title: 'New group chat',
      body: h('div.stack', h('label.field', h('span', 'Name'), name), h('div.field', h('span', 'Leaders'), h('div.choice-grid', boxes.map(([l, box]) => h('label.choice', box, flag(l.id), l.name))))),
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        { label: 'Create', kind: 'primary', onClick: () => {
          const members = boxes.filter(([, b]) => b.checked).map(([l]) => l.id);
          if (!name.value.trim() || !members.length) { this.ctx.toast('Name the group and pick at least one leader.', 'warn'); return false; }
          this.ctx.net.send({ type: 'group', name: name.value, members });
          this.toggle(true);
          return true;
        } },
      ],
    });
  }

  invite(meta) {
    const leaders = this.#leaders().filter((l) => !meta.members.includes(l.id));
    if (!leaders.length) return this.ctx.toast('Every other leader is already in this group.', 'info');
    const boxes = leaders.map((l) => [l, h('input', { type: 'checkbox', value: l.id })]);
    modal({
      title: `Add to ${meta.name}`,
      body: h('div.choice-grid', boxes.map(([l, box]) => h('label.choice', box, flag(l.id), l.name))),
      actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Add', kind: 'primary', onClick: () => this.ctx.net.send({ type: 'groupInvite', ch: meta.id, members: boxes.filter(([, b]) => b.checked).map(([l]) => l.id) }) }],
    });
  }
}
