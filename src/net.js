/**
 * Phone-as-controller networking.
 *  - Host (TV / PC / tablet): opens a PeerJS peer "sternenfront-<CODE>" and accepts controller connections.
 *  - Pad (phone): connects to that code and streams its stick/button state.
 *  - Chromecast: the Presentation API casts the game to a TV; the phone keeps a direct channel and becomes the pad.
 * Signalling uses the public PeerJS broker (override with ?peer=host:port[:path] for a self-hosted one).
 */

const PREFIX = 'sternenfront-';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const netAvailable = () => typeof RTCPeerConnection !== 'undefined' && !import.meta.env.VITE_ARTIFACT;

export function peerOptions() {
  const q = new URLSearchParams(location.search).get('peer');
  if (!q) return { debug: 0 };
  const [host, port, ...path] = q.split(':');
  return { host, port: +port || 9000, path: '/' + (path.join(':') || ''), secure: location.protocol === 'https:' && !['localhost', '127.0.0.1'].includes(host), debug: 0 };
}

function wrapPeerConn(conn) {
  return {
    send: (m) => conn.open && conn.send(m),
    onMessage: (cb) => conn.on('data', cb),
    onClose: (cb) => { conn.on('close', cb); conn.on('error', cb); },
    close: () => conn.close(),
  };
}

export function wrapPresentation(conn) {
  const closeCbs = [];
  conn.addEventListener('close', () => closeCbs.forEach((c) => c()));
  conn.addEventListener('terminate', () => closeCbs.forEach((c) => c()));
  return {
    send: (m) => conn.state === 'connected' && conn.send(JSON.stringify(m)),
    onMessage: (cb) => conn.addEventListener('message', (e) => { try { cb(JSON.parse(e.data)); } catch { /* ignore */ } }),
    onClose: (cb) => closeCbs.push(cb),
    close: () => conn.terminate?.(),
  };
}

function randomCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHA[(Math.random() * ALPHA.length) | 0];
  return s;
}

export function padUrl(code) {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('pad', code);
  const peer = new URLSearchParams(location.search).get('peer');
  if (peer) u.searchParams.set('peer', peer);
  return u.toString();
}

/** Starts the controller lobby. onDevice(transport) is called for each phone that connects. */
export async function startHost(onDevice, onStatus) {
  const { Peer } = await import('peerjs');
  let tries = 0;
  const open = () => new Promise((resolve, reject) => {
    const code = randomCode();
    const peer = new Peer(PREFIX + code, peerOptions());
    peer.on('open', () => resolve({ peer, code }));
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id' && tries++ < 4) { peer.destroy(); open().then(resolve, reject); }
      else { onStatus?.('error', e.type || String(e)); reject(e); }
    });
  });
  const { peer, code } = await open();
  peer.on('connection', (conn) => {
    conn.on('open', () => onDevice(wrapPeerConn(conn), conn.metadata?.name));
  });
  peer.on('disconnected', () => { onStatus?.('reconnect'); try { peer.reconnect(); } catch { /* ignore */ } });
  onStatus?.('open', code);
  return { code, url: padUrl(code), close: () => peer.destroy() };
}

/** Connects a phone controller to a host code. */
export async function connectPad(code, name, onStatus) {
  const { Peer } = await import('peerjs');
  return new Promise((resolve, reject) => {
    const peer = new Peer(peerOptions());
    peer.on('error', (e) => { onStatus?.('error', e.type || String(e)); reject(e); });
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code.toUpperCase(), { metadata: { name }, serialization: 'json' });
      conn.on('open', () => resolve(wrapPeerConn(conn)));
      conn.on('error', (e) => reject(e));
    });
  });
}

/** Casting via Presentation API (Chrome on Android/desktop → Chromecast / Cast-capable TVs). */
export const castAvailable = () => 'PresentationRequest' in window && !import.meta.env.VITE_ARTIFACT;

export async function startCast() {
  const u = new URL(location.href);
  u.search = ''; u.hash = '';
  u.searchParams.set('cast', '1');
  const req = new PresentationRequest([u.toString()]);
  const conn = await req.start();
  await new Promise((res, rej) => {
    if (conn.state === 'connected') return res();
    conn.addEventListener('connect', res, { once: true });
    conn.addEventListener('close', () => rej(new Error('closed')), { once: true });
  });
  return wrapPresentation(conn);
}

/** On the cast receiver: hand over each presentation connection as a controller. */
export function listenCastReceiver(onDevice) {
  const recv = navigator.presentation?.receiver;
  if (!recv) return false;
  recv.connectionList.then((list) => {
    list.connections.forEach((c) => onDevice(wrapPresentation(c), 'Cast-Handy'));
    list.addEventListener('connectionavailable', (e) => onDevice(wrapPresentation(e.connection), 'Cast-Handy'));
  });
  return true;
}
