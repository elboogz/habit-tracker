// Browsers only expose `crypto.randomUUID()` in secure contexts (HTTPS, or `localhost`) — over
// a plain-HTTP LAN address like http://192.168.x.x:8081 (how the web build gets tested from a
// phone) it's simply missing, even though `crypto.getRandomValues()` — which has no such
// restriction — is enough to build a UUID v4 by hand. No-ops on native, where expo-crypto talks
// to a native module directly rather than a global `crypto` object.
if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID !== 'function') {
  globalThis.crypto.randomUUID = (() => {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
    return [
      hex.slice(0, 4).join(''),
      hex.slice(4, 6).join(''),
      hex.slice(6, 8).join(''),
      hex.slice(8, 10).join(''),
      hex.slice(10, 16).join(''),
    ].join('-') as `${string}-${string}-${string}-${string}-${string}`;
  }) as Crypto['randomUUID'];
}
