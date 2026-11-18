// A direct connection between two browsers (WebRTC), with two data channels: "fast" for positions (unordered and
// never resent: a late position is a useless one) and "sure" for everything that must arrive (shots, hits,
// sinkings, the lobby). The whole offer and answer, network routes included, travel in one message each, so the
// room service is asked as little as possible.

const ICE = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

function gathered(pc, ms = 4000) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', check); resolve(); };
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    const t = setTimeout(done, ms);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

export class Link {
  constructor(pc) {
    this.pc = pc;
    this.fast = null;
    this.sure = null;
    this.onmessage = null;
    this.onclose = null;
    this.closed = false;
    this.opened = new Promise((resolve) => { this.#ready = resolve; });
    pc.addEventListener('connectionstatechange', () => {
      if (['failed', 'closed'].includes(pc.connectionState)) this.close();
      // A dropped connection that doesn't come back within a few seconds is gone
      if (pc.connectionState === 'disconnected') setTimeout(() => { if (pc.connectionState === 'disconnected') this.close(); }, 6000);
    });
  }

  #ready;

  attach(ch) {
    if (ch.label === 'fast') this.fast = ch; else this.sure = ch;
    ch.onmessage = (e) => { try { this.onmessage?.(JSON.parse(e.data)); } catch { /* not ours */ } };
    ch.onopen = () => { if (this.fast?.readyState === 'open' && this.sure?.readyState === 'open') this.#ready(); };
    ch.onclose = () => this.close();
    if (this.fast?.readyState === 'open' && this.sure?.readyState === 'open') this.#ready();
  }

  send(msg, fast = false) {
    const ch = fast ? this.fast : this.sure;
    if (ch?.readyState !== 'open') return;
    // Don't pile positions up behind a slow connection
    if (fast && ch.bufferedAmount > 64000) return;
    try { ch.send(JSON.stringify(msg)); } catch { /* closing */ }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.pc.close(); } catch { /* already */ }
    this.onclose?.();
  }
}

// The joiner: opens both channels and makes the offer
export async function makeOffer() {
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const link = new Link(pc);
  link.attach(pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 }));
  link.attach(pc.createDataChannel('sure', { ordered: true }));
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc);
  return { link, sdp: pc.localDescription.sdp, accept: (answer) => pc.setRemoteDescription({ type: 'answer', sdp: answer }) };
}

// The host: answers an offer; the joiner's channels arrive on their own
export async function answerOffer(sdp) {
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const link = new Link(pc);
  pc.ondatachannel = (e) => link.attach(e.channel);
  await pc.setRemoteDescription({ type: 'offer', sdp });
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc);
  return { link, sdp: pc.localDescription.sdp };
}
