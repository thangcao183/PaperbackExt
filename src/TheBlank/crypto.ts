/**
 * Cryptographic utilities for TheBlank source.
 *
 * Implements:
 * - X25519 key exchange (RFC 7748)
 * - HMAC-SHA256 signing (via SubtleCrypto)
 * - SHA-256 digest (via SubtleCrypto)
 * - ChaCha20 (IETF), HChaCha20, Poly1305, SecretStream (XChaCha20-Poly1305)
 *
 * SecretStream/ChaCha20/Poly1305 ported from keiyoushi's TheBlank Java implementation.
 */

// ================================================================
// X25519 (Curve25519 Diffie-Hellman) — RFC 7748
// ================================================================

type Fe = Int32Array;

function feNew(): Fe {
  return new Int32Array(16);
}

function feCarry(o: Fe): void {
  for (let i = 0; i < 16; i++) {
    o[i] += 65536;
    const carry = Math.floor(o[i] / 65536);
    o[(i + 1) % 16] += carry - 1 + (i === 15 ? 37 * (carry - 1) : 0);
    o[i] -= carry * 65536;
  }
}

function feSel(p: Fe, q: Fe, b: number): void {
  const c = ~(b - 1);
  for (let i = 0; i < 16; i++) {
    const t = c & (p[i] ^ q[i]);
    p[i] ^= t;
    q[i] ^= t;
  }
}

function fePack(o: Uint8Array, n: Fe): void {
  const m = feNew();
  const t = feNew();
  for (let i = 0; i < 16; i++) t[i] = n[i];
  feCarry(t);
  feCarry(t);
  feCarry(t);
  for (let j = 0; j < 2; j++) {
    m[0] = t[0] - 0xffed;
    for (let i = 1; i < 15; i++) {
      m[i] = t[i] - 0xffff - ((m[i - 1] >> 16) & 1);
      m[i - 1] &= 0xffff;
    }
    m[15] = t[15] - 0x7fff - ((m[14] >> 16) & 1);
    const b = (m[15] >> 16) & 1;
    m[14] &= 0xffff;
    feSel(t, m, 1 - b);
  }
  for (let i = 0; i < 16; i++) {
    o[2 * i] = t[i] & 0xff;
    o[2 * i + 1] = t[i] >> 8;
  }
}

function feUnpack(o: Fe, a: Uint8Array): void {
  for (let i = 0; i < 16; i++) o[i] = a[2 * i] + (a[2 * i + 1] << 8);
  o[15] &= 0x7fff;
}

function feAdd(o: Fe, a: Fe, b: Fe): void {
  for (let i = 0; i < 16; i++) o[i] = a[i] + b[i];
}

function feSub(o: Fe, a: Fe, b: Fe): void {
  for (let i = 0; i < 16; i++) o[i] = a[i] - b[i];
}

function feMul(o: Fe, a: Fe, b: Fe): void {
  const t = new Float64Array(31);
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 16; j++) {
      t[i + j] += a[i] * b[j];
    }
  }
  for (let i = 16; i < 31; i++) {
    t[i - 16] += 38 * t[i];
  }
  for (let i = 0; i < 16; i++) o[i] = t[i];
  feCarry(o);
  feCarry(o);
}

function feSq(o: Fe, a: Fe): void {
  feMul(o, a, a);
}

function feInv(o: Fe, a: Fe): void {
  const c = feNew();
  for (let i = 0; i < 16; i++) c[i] = a[i];
  for (let i = 253; i >= 0; i--) {
    feSq(c, c);
    if (i !== 2 && i !== 4) feMul(c, c, a);
  }
  for (let i = 0; i < 16; i++) o[i] = c[i];
}

function feScalarMult(q: Uint8Array, n: Uint8Array, p: Uint8Array): void {
  const z = new Uint8Array(32);
  for (let i = 0; i < 31; i++) z[i] = n[i];
  z[31] = (n[31] & 127) | 64;
  z[0] &= 248;

  const xFe = feNew();
  feUnpack(xFe, p);

  const aFe = feNew(),
    bFe = feNew(),
    cFe = feNew(),
    dFe = feNew();
  const e = feNew(),
    f = feNew();
  bFe[0] = 1;
  for (let i = 0; i < 16; i++) aFe[i] = xFe[i];
  dFe[0] = 1;

  for (let i = 254; i >= 0; --i) {
    const bit = (z[i >>> 3] >>> (i & 7)) & 1;
    feSel(aFe, cFe, bit);
    feSel(bFe, dFe, bit);
    feAdd(e, aFe, bFe);
    feSub(aFe, aFe, bFe);
    feAdd(f, cFe, dFe);
    feSub(cFe, cFe, dFe);
    feMul(dFe, e, cFe);
    feMul(cFe, aFe, f);
    feAdd(e, dFe, cFe);
    feSub(aFe, dFe, cFe);
    feSq(bFe, aFe);
    feSub(cFe, e, f);
    const a121665 = feNew();
    a121665[0] = 0xdb41;
    a121665[1] = 1;
    feMul(aFe, cFe, a121665);
    feAdd(aFe, aFe, e);
    feMul(cFe, cFe, aFe);
    feMul(aFe, e, f);
    feMul(dFe, bFe, xFe);
    feSq(bFe, e);
    feSel(aFe, cFe, bit);
    feSel(bFe, dFe, bit);
  }

  const inv = feNew();
  feInv(inv, bFe);
  feMul(aFe, aFe, inv);
  fePack(q, aFe);
}

const BASEPOINT = new Uint8Array(32);
BASEPOINT[0] = 9;

/** Generate an X25519 public key from a private key. */
export function x25519PublicKey(privateKey: Uint8Array): Uint8Array {
  const pub = new Uint8Array(32);
  feScalarMult(pub, privateKey, BASEPOINT);
  return pub;
}

/** Compute the X25519 shared secret. */
export function x25519ScalarMult(
  privateKey: Uint8Array,
  publicKey: Uint8Array,
): Uint8Array {
  const shared = new Uint8Array(32);
  feScalarMult(shared, privateKey, publicKey);
  return shared;
}

// ================================================================
// HMAC-SHA256 (via SubtleCrypto)
// ================================================================

export async function hmacSha256Hex(
  key: string,
  message: string,
): Promise<string> {
  const subtle = (globalThis as unknown as { crypto: { subtle: SubtleCrypto } })
    .crypto.subtle;
  const enc = new TextEncoder();
  const keyBytes = enc.encode(key);
  const msgBytes = enc.encode(message);
  const keyBuf = new ArrayBuffer(keyBytes.byteLength);
  new Uint8Array(keyBuf).set(keyBytes);
  const msgBuf = new ArrayBuffer(msgBytes.byteLength);
  new Uint8Array(msgBuf).set(msgBytes);
  const cryptoKey = await subtle.importKey(
    "raw",
    keyBuf,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await subtle.sign("HMAC", cryptoKey, msgBuf);
  return bufToHex(new Uint8Array(sig));
}

// ================================================================
// SHA-256 (via SubtleCrypto)
// ================================================================

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const subtle = (globalThis as unknown as { crypto: { subtle: SubtleCrypto } })
    .crypto.subtle;
  const copy = new ArrayBuffer(data.byteLength);
  new Uint8Array(copy).set(data);
  const hash = await subtle.digest("SHA-256", copy);
  return new Uint8Array(hash);
}

// ================================================================
// ChaCha20 (IETF variant) — ported from keiyoushi Java
// ================================================================

function load32LE(src: Uint8Array, offset: number): number {
  return (
    ((src[offset] & 0xff) |
      ((src[offset + 1] & 0xff) << 8) |
      ((src[offset + 2] & 0xff) << 16) |
      ((src[offset + 3] & 0xff) << 24)) >>>
    0
  );
}

function store32LE(dst: Uint8Array, offset: number, w: number): void {
  dst[offset] = w & 0xff;
  dst[offset + 1] = (w >>> 8) & 0xff;
  dst[offset + 2] = (w >>> 16) & 0xff;
  dst[offset + 3] = (w >>> 24) & 0xff;
}

function rotl32(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

function chachaBlock(output: Int32Array, input: Int32Array): void {
  let x0 = input[0],
    x1 = input[1],
    x2 = input[2],
    x3 = input[3];
  let x4 = input[4],
    x5 = input[5],
    x6 = input[6],
    x7 = input[7];
  let x8 = input[8],
    x9 = input[9],
    x10 = input[10],
    x11 = input[11];
  let x12 = input[12],
    x13 = input[13],
    x14 = input[14],
    x15 = input[15];

  for (let i = 0; i < 20; i += 2) {
    // Column rounds
    x0 = (x0 + x4) | 0;
    x12 = rotl32(x12 ^ x0, 16);
    x8 = (x8 + x12) | 0;
    x4 = rotl32(x4 ^ x8, 12);
    x0 = (x0 + x4) | 0;
    x12 = rotl32(x12 ^ x0, 8);
    x8 = (x8 + x12) | 0;
    x4 = rotl32(x4 ^ x8, 7);

    x1 = (x1 + x5) | 0;
    x13 = rotl32(x13 ^ x1, 16);
    x9 = (x9 + x13) | 0;
    x5 = rotl32(x5 ^ x9, 12);
    x1 = (x1 + x5) | 0;
    x13 = rotl32(x13 ^ x1, 8);
    x9 = (x9 + x13) | 0;
    x5 = rotl32(x5 ^ x9, 7);

    x2 = (x2 + x6) | 0;
    x14 = rotl32(x14 ^ x2, 16);
    x10 = (x10 + x14) | 0;
    x6 = rotl32(x6 ^ x10, 12);
    x2 = (x2 + x6) | 0;
    x14 = rotl32(x14 ^ x2, 8);
    x10 = (x10 + x14) | 0;
    x6 = rotl32(x6 ^ x10, 7);

    x3 = (x3 + x7) | 0;
    x15 = rotl32(x15 ^ x3, 16);
    x11 = (x11 + x15) | 0;
    x7 = rotl32(x7 ^ x11, 12);
    x3 = (x3 + x7) | 0;
    x15 = rotl32(x15 ^ x3, 8);
    x11 = (x11 + x15) | 0;
    x7 = rotl32(x7 ^ x11, 7);

    // Diagonal rounds
    x0 = (x0 + x5) | 0;
    x15 = rotl32(x15 ^ x0, 16);
    x10 = (x10 + x15) | 0;
    x5 = rotl32(x5 ^ x10, 12);
    x0 = (x0 + x5) | 0;
    x15 = rotl32(x15 ^ x0, 8);
    x10 = (x10 + x15) | 0;
    x5 = rotl32(x5 ^ x10, 7);

    x1 = (x1 + x6) | 0;
    x12 = rotl32(x12 ^ x1, 16);
    x11 = (x11 + x12) | 0;
    x6 = rotl32(x6 ^ x11, 12);
    x1 = (x1 + x6) | 0;
    x12 = rotl32(x12 ^ x1, 8);
    x11 = (x11 + x12) | 0;
    x6 = rotl32(x6 ^ x11, 7);

    x2 = (x2 + x7) | 0;
    x13 = rotl32(x13 ^ x2, 16);
    x8 = (x8 + x13) | 0;
    x7 = rotl32(x7 ^ x8, 12);
    x2 = (x2 + x7) | 0;
    x13 = rotl32(x13 ^ x2, 8);
    x8 = (x8 + x13) | 0;
    x7 = rotl32(x7 ^ x8, 7);

    x3 = (x3 + x4) | 0;
    x14 = rotl32(x14 ^ x3, 16);
    x9 = (x9 + x14) | 0;
    x4 = rotl32(x4 ^ x9, 12);
    x3 = (x3 + x4) | 0;
    x14 = rotl32(x14 ^ x3, 8);
    x9 = (x9 + x14) | 0;
    x4 = rotl32(x4 ^ x9, 7);
  }

  output[0] = (x0 + input[0]) | 0;
  output[1] = (x1 + input[1]) | 0;
  output[2] = (x2 + input[2]) | 0;
  output[3] = (x3 + input[3]) | 0;
  output[4] = (x4 + input[4]) | 0;
  output[5] = (x5 + input[5]) | 0;
  output[6] = (x6 + input[6]) | 0;
  output[7] = (x7 + input[7]) | 0;
  output[8] = (x8 + input[8]) | 0;
  output[9] = (x9 + input[9]) | 0;
  output[10] = (x10 + input[10]) | 0;
  output[11] = (x11 + input[11]) | 0;
  output[12] = (x12 + input[12]) | 0;
  output[13] = (x13 + input[13]) | 0;
  output[14] = (x14 + input[14]) | 0;
  output[15] = (x15 + input[15]) | 0;
}

/** ChaCha20 IETF stream generation (fills output buffer). */
function chacha20StreamIETF(
  c: Uint8Array,
  clen: number,
  nonce: Uint8Array,
  key: Uint8Array,
): void {
  const input = new Int32Array(16);
  const output = new Int32Array(16);
  const blockBytes = new Uint8Array(64);

  input[0] = 0x61707865;
  input[1] = 0x3320646e;
  input[2] = 0x79622d32;
  input[3] = 0x6b206574;
  for (let i = 0; i < 8; i++) input[4 + i] = load32LE(key, i * 4);
  input[12] = 0;
  input[13] = load32LE(nonce, 0);
  input[14] = load32LE(nonce, 4);
  input[15] = load32LE(nonce, 8);

  let pos = 0;
  while (pos < clen) {
    chachaBlock(output, input);
    for (let i = 0; i < 16; i++) store32LE(blockBytes, i * 4, output[i]);
    const toCopy = Math.min(64, clen - pos);
    c.set(blockBytes.subarray(0, toCopy), pos);
    pos += 64;
    input[12] = (input[12] + 1) | 0;
  }
}

/** ChaCha20 IETF XOR with initial counter. */
function chacha20StreamIETFXorIC(
  c: Uint8Array,
  m: Uint8Array,
  mlen: number,
  nonce: Uint8Array,
  ic: number,
  key: Uint8Array,
): void {
  const input = new Int32Array(16);
  const output = new Int32Array(16);
  const blockBytes = new Uint8Array(64);

  input[0] = 0x61707865;
  input[1] = 0x3320646e;
  input[2] = 0x79622d32;
  input[3] = 0x6b206574;
  for (let i = 0; i < 8; i++) input[4 + i] = load32LE(key, i * 4);
  input[12] = ic;
  input[13] = load32LE(nonce, 0);
  input[14] = load32LE(nonce, 4);
  input[15] = load32LE(nonce, 8);

  let pos = 0;
  while (pos < mlen) {
    chachaBlock(output, input);
    for (let i = 0; i < 16; i++) store32LE(blockBytes, i * 4, output[i]);
    const toProcess = Math.min(64, mlen - pos);
    for (let i = 0; i < toProcess; i++) {
      c[pos + i] = m[pos + i] ^ blockBytes[i];
    }
    pos += 64;
    input[12] = (input[12] + 1) | 0;
  }
}

// ================================================================
// HChaCha20 — ported from keiyoushi Core.java
// ================================================================

function hchacha20(out: Uint8Array, inp: Uint8Array, k: Uint8Array): void {
  let x0 = 0x61707865;
  let x1 = 0x3320646e;
  let x2 = 0x79622d32;
  let x3 = 0x6b206574;

  let x4 = load32LE(k, 0);
  let x5 = load32LE(k, 4);
  let x6 = load32LE(k, 8);
  let x7 = load32LE(k, 12);
  let x8 = load32LE(k, 16);
  let x9 = load32LE(k, 20);
  let x10 = load32LE(k, 24);
  let x11 = load32LE(k, 28);
  let x12 = load32LE(inp, 0);
  let x13 = load32LE(inp, 4);
  let x14 = load32LE(inp, 8);
  let x15 = load32LE(inp, 12);

  for (let i = 0; i < 10; i++) {
    // Column rounds
    x0 = (x0 + x4) | 0;
    x12 = rotl32(x12 ^ x0, 16);
    x8 = (x8 + x12) | 0;
    x4 = rotl32(x4 ^ x8, 12);
    x0 = (x0 + x4) | 0;
    x12 = rotl32(x12 ^ x0, 8);
    x8 = (x8 + x12) | 0;
    x4 = rotl32(x4 ^ x8, 7);

    x1 = (x1 + x5) | 0;
    x13 = rotl32(x13 ^ x1, 16);
    x9 = (x9 + x13) | 0;
    x5 = rotl32(x5 ^ x9, 12);
    x1 = (x1 + x5) | 0;
    x13 = rotl32(x13 ^ x1, 8);
    x9 = (x9 + x13) | 0;
    x5 = rotl32(x5 ^ x9, 7);

    x2 = (x2 + x6) | 0;
    x14 = rotl32(x14 ^ x2, 16);
    x10 = (x10 + x14) | 0;
    x6 = rotl32(x6 ^ x10, 12);
    x2 = (x2 + x6) | 0;
    x14 = rotl32(x14 ^ x2, 8);
    x10 = (x10 + x14) | 0;
    x6 = rotl32(x6 ^ x10, 7);

    x3 = (x3 + x7) | 0;
    x15 = rotl32(x15 ^ x3, 16);
    x11 = (x11 + x15) | 0;
    x7 = rotl32(x7 ^ x11, 12);
    x3 = (x3 + x7) | 0;
    x15 = rotl32(x15 ^ x3, 8);
    x11 = (x11 + x15) | 0;
    x7 = rotl32(x7 ^ x11, 7);

    // Diagonal rounds
    x0 = (x0 + x5) | 0;
    x15 = rotl32(x15 ^ x0, 16);
    x10 = (x10 + x15) | 0;
    x5 = rotl32(x5 ^ x10, 12);
    x0 = (x0 + x5) | 0;
    x15 = rotl32(x15 ^ x0, 8);
    x10 = (x10 + x15) | 0;
    x5 = rotl32(x5 ^ x10, 7);

    x1 = (x1 + x6) | 0;
    x12 = rotl32(x12 ^ x1, 16);
    x11 = (x11 + x12) | 0;
    x6 = rotl32(x6 ^ x11, 12);
    x1 = (x1 + x6) | 0;
    x12 = rotl32(x12 ^ x1, 8);
    x11 = (x11 + x12) | 0;
    x6 = rotl32(x6 ^ x11, 7);

    x2 = (x2 + x7) | 0;
    x13 = rotl32(x13 ^ x2, 16);
    x8 = (x8 + x13) | 0;
    x7 = rotl32(x7 ^ x8, 12);
    x2 = (x2 + x7) | 0;
    x13 = rotl32(x13 ^ x2, 8);
    x8 = (x8 + x13) | 0;
    x7 = rotl32(x7 ^ x8, 7);

    x3 = (x3 + x4) | 0;
    x14 = rotl32(x14 ^ x3, 16);
    x9 = (x9 + x14) | 0;
    x4 = rotl32(x4 ^ x9, 12);
    x3 = (x3 + x4) | 0;
    x14 = rotl32(x14 ^ x3, 8);
    x9 = (x9 + x14) | 0;
    x4 = rotl32(x4 ^ x9, 7);
  }

  store32LE(out, 0, x0);
  store32LE(out, 4, x1);
  store32LE(out, 8, x2);
  store32LE(out, 12, x3);
  store32LE(out, 16, x12);
  store32LE(out, 20, x13);
  store32LE(out, 24, x14);
  store32LE(out, 28, x15);
}

// ================================================================
// Poly1305 — ported from TweetNaCl (poly1305-donna, 13-bit limbs)
// ================================================================
//
// Uses 10 limbs of 13 bits each (Uint16Array) so every intermediate
// product/sum stays well within Number.MAX_SAFE_INTEGER. This replaces
// an earlier 26-bit-limb port whose d_i sums overflowed 2^53 and
// silently corrupted the MAC. Reference: tweetnacl-js nacl-fast.js
// (floodyberry poly1305-donna).

interface Poly1305State {
  r: Uint16Array; // 10
  h: Uint16Array; // 10
  pad: Uint16Array; // 8
  buffer: Uint8Array; // 16
  leftover: number;
  fin: number;
}

function poly1305Init(key: Uint8Array): Poly1305State {
  const r = new Uint16Array(10);
  const h = new Uint16Array(10);
  const pad = new Uint16Array(8);

  let t0, t1, t2, t3, t4, t5, t6, t7;
  t0 = (key[0] & 0xff) | ((key[1] & 0xff) << 8);
  r[0] = t0 & 0x1fff;
  t1 = (key[2] & 0xff) | ((key[3] & 0xff) << 8);
  r[1] = ((t0 >>> 13) | (t1 << 3)) & 0x1fff;
  t2 = (key[4] & 0xff) | ((key[5] & 0xff) << 8);
  r[2] = ((t1 >>> 10) | (t2 << 6)) & 0x1f03;
  t3 = (key[6] & 0xff) | ((key[7] & 0xff) << 8);
  r[3] = ((t2 >>> 7) | (t3 << 9)) & 0x1fff;
  t4 = (key[8] & 0xff) | ((key[9] & 0xff) << 8);
  r[4] = ((t3 >>> 4) | (t4 << 12)) & 0x00ff;
  r[5] = (t4 >>> 1) & 0x1ffe;
  t5 = (key[10] & 0xff) | ((key[11] & 0xff) << 8);
  r[6] = ((t4 >>> 14) | (t5 << 2)) & 0x1fff;
  t6 = (key[12] & 0xff) | ((key[13] & 0xff) << 8);
  r[7] = ((t5 >>> 11) | (t6 << 5)) & 0x1f81;
  t7 = (key[14] & 0xff) | ((key[15] & 0xff) << 8);
  r[8] = ((t6 >>> 8) | (t7 << 8)) & 0x1fff;
  r[9] = (t7 >>> 5) & 0x007f;

  pad[0] = (key[16] & 0xff) | ((key[17] & 0xff) << 8);
  pad[1] = (key[18] & 0xff) | ((key[19] & 0xff) << 8);
  pad[2] = (key[20] & 0xff) | ((key[21] & 0xff) << 8);
  pad[3] = (key[22] & 0xff) | ((key[23] & 0xff) << 8);
  pad[4] = (key[24] & 0xff) | ((key[25] & 0xff) << 8);
  pad[5] = (key[26] & 0xff) | ((key[27] & 0xff) << 8);
  pad[6] = (key[28] & 0xff) | ((key[29] & 0xff) << 8);
  pad[7] = (key[30] & 0xff) | ((key[31] & 0xff) << 8);

  return { r, h, pad, buffer: new Uint8Array(16), leftover: 0, fin: 0 };
}

function poly1305Blocks(
  state: Poly1305State,
  m: Uint8Array,
  offset: number,
  bytes: number,
): void {
  const hibit = state.fin ? 0 : 1 << 11;
  const h = state.h;
  const r = state.r;

  let h0 = h[0],
    h1 = h[1],
    h2 = h[2],
    h3 = h[3],
    h4 = h[4],
    h5 = h[5],
    h6 = h[6],
    h7 = h[7],
    h8 = h[8],
    h9 = h[9];

  const r0 = r[0],
    r1 = r[1],
    r2 = r[2],
    r3 = r[3],
    r4 = r[4],
    r5 = r[5],
    r6 = r[6],
    r7 = r[7],
    r8 = r[8],
    r9 = r[9];

  let pos = offset;
  let t0, t1, t2, t3, t4, t5, t6, t7, c;
  let d0, d1, d2, d3, d4, d5, d6, d7, d8, d9;

  while (bytes >= 16) {
    t0 = (m[pos + 0] & 0xff) | ((m[pos + 1] & 0xff) << 8);
    h0 += t0 & 0x1fff;
    t1 = (m[pos + 2] & 0xff) | ((m[pos + 3] & 0xff) << 8);
    h1 += ((t0 >>> 13) | (t1 << 3)) & 0x1fff;
    t2 = (m[pos + 4] & 0xff) | ((m[pos + 5] & 0xff) << 8);
    h2 += ((t1 >>> 10) | (t2 << 6)) & 0x1fff;
    t3 = (m[pos + 6] & 0xff) | ((m[pos + 7] & 0xff) << 8);
    h3 += ((t2 >>> 7) | (t3 << 9)) & 0x1fff;
    t4 = (m[pos + 8] & 0xff) | ((m[pos + 9] & 0xff) << 8);
    h4 += ((t3 >>> 4) | (t4 << 12)) & 0x1fff;
    h5 += (t4 >>> 1) & 0x1fff;
    t5 = (m[pos + 10] & 0xff) | ((m[pos + 11] & 0xff) << 8);
    h6 += ((t4 >>> 14) | (t5 << 2)) & 0x1fff;
    t6 = (m[pos + 12] & 0xff) | ((m[pos + 13] & 0xff) << 8);
    h7 += ((t5 >>> 11) | (t6 << 5)) & 0x1fff;
    t7 = (m[pos + 14] & 0xff) | ((m[pos + 15] & 0xff) << 8);
    h8 += ((t6 >>> 8) | (t7 << 8)) & 0x1fff;
    h9 += (t7 >>> 5) | hibit;

    c = 0;

    d0 = c;
    d0 += h0 * r0;
    d0 += h1 * (5 * r9);
    d0 += h2 * (5 * r8);
    d0 += h3 * (5 * r7);
    d0 += h4 * (5 * r6);
    c = d0 >>> 13;
    d0 &= 0x1fff;
    d0 += h5 * (5 * r5);
    d0 += h6 * (5 * r4);
    d0 += h7 * (5 * r3);
    d0 += h8 * (5 * r2);
    d0 += h9 * (5 * r1);
    c += d0 >>> 13;
    d0 &= 0x1fff;

    d1 = c;
    d1 += h0 * r1;
    d1 += h1 * r0;
    d1 += h2 * (5 * r9);
    d1 += h3 * (5 * r8);
    d1 += h4 * (5 * r7);
    c = d1 >>> 13;
    d1 &= 0x1fff;
    d1 += h5 * (5 * r6);
    d1 += h6 * (5 * r5);
    d1 += h7 * (5 * r4);
    d1 += h8 * (5 * r3);
    d1 += h9 * (5 * r2);
    c += d1 >>> 13;
    d1 &= 0x1fff;

    d2 = c;
    d2 += h0 * r2;
    d2 += h1 * r1;
    d2 += h2 * r0;
    d2 += h3 * (5 * r9);
    d2 += h4 * (5 * r8);
    c = d2 >>> 13;
    d2 &= 0x1fff;
    d2 += h5 * (5 * r7);
    d2 += h6 * (5 * r6);
    d2 += h7 * (5 * r5);
    d2 += h8 * (5 * r4);
    d2 += h9 * (5 * r3);
    c += d2 >>> 13;
    d2 &= 0x1fff;

    d3 = c;
    d3 += h0 * r3;
    d3 += h1 * r2;
    d3 += h2 * r1;
    d3 += h3 * r0;
    d3 += h4 * (5 * r9);
    c = d3 >>> 13;
    d3 &= 0x1fff;
    d3 += h5 * (5 * r8);
    d3 += h6 * (5 * r7);
    d3 += h7 * (5 * r6);
    d3 += h8 * (5 * r5);
    d3 += h9 * (5 * r4);
    c += d3 >>> 13;
    d3 &= 0x1fff;

    d4 = c;
    d4 += h0 * r4;
    d4 += h1 * r3;
    d4 += h2 * r2;
    d4 += h3 * r1;
    d4 += h4 * r0;
    c = d4 >>> 13;
    d4 &= 0x1fff;
    d4 += h5 * (5 * r9);
    d4 += h6 * (5 * r8);
    d4 += h7 * (5 * r7);
    d4 += h8 * (5 * r6);
    d4 += h9 * (5 * r5);
    c += d4 >>> 13;
    d4 &= 0x1fff;

    d5 = c;
    d5 += h0 * r5;
    d5 += h1 * r4;
    d5 += h2 * r3;
    d5 += h3 * r2;
    d5 += h4 * r1;
    c = d5 >>> 13;
    d5 &= 0x1fff;
    d5 += h5 * r0;
    d5 += h6 * (5 * r9);
    d5 += h7 * (5 * r8);
    d5 += h8 * (5 * r7);
    d5 += h9 * (5 * r6);
    c += d5 >>> 13;
    d5 &= 0x1fff;

    d6 = c;
    d6 += h0 * r6;
    d6 += h1 * r5;
    d6 += h2 * r4;
    d6 += h3 * r3;
    d6 += h4 * r2;
    c = d6 >>> 13;
    d6 &= 0x1fff;
    d6 += h5 * r1;
    d6 += h6 * r0;
    d6 += h7 * (5 * r9);
    d6 += h8 * (5 * r8);
    d6 += h9 * (5 * r7);
    c += d6 >>> 13;
    d6 &= 0x1fff;

    d7 = c;
    d7 += h0 * r7;
    d7 += h1 * r6;
    d7 += h2 * r5;
    d7 += h3 * r4;
    d7 += h4 * r3;
    c = d7 >>> 13;
    d7 &= 0x1fff;
    d7 += h5 * r2;
    d7 += h6 * r1;
    d7 += h7 * r0;
    d7 += h8 * (5 * r9);
    d7 += h9 * (5 * r8);
    c += d7 >>> 13;
    d7 &= 0x1fff;

    d8 = c;
    d8 += h0 * r8;
    d8 += h1 * r7;
    d8 += h2 * r6;
    d8 += h3 * r5;
    d8 += h4 * r4;
    c = d8 >>> 13;
    d8 &= 0x1fff;
    d8 += h5 * r3;
    d8 += h6 * r2;
    d8 += h7 * r1;
    d8 += h8 * r0;
    d8 += h9 * (5 * r9);
    c += d8 >>> 13;
    d8 &= 0x1fff;

    d9 = c;
    d9 += h0 * r9;
    d9 += h1 * r8;
    d9 += h2 * r7;
    d9 += h3 * r6;
    d9 += h4 * r5;
    c = d9 >>> 13;
    d9 &= 0x1fff;
    d9 += h5 * r4;
    d9 += h6 * r3;
    d9 += h7 * r2;
    d9 += h8 * r1;
    d9 += h9 * r0;
    c += d9 >>> 13;
    d9 &= 0x1fff;

    c = ((c << 2) + c) | 0;
    c = (c + d0) | 0;
    d0 = c & 0x1fff;
    c = c >>> 13;
    d1 += c;

    h0 = d0;
    h1 = d1;
    h2 = d2;
    h3 = d3;
    h4 = d4;
    h5 = d5;
    h6 = d6;
    h7 = d7;
    h8 = d8;
    h9 = d9;

    pos += 16;
    bytes -= 16;
  }

  h[0] = h0;
  h[1] = h1;
  h[2] = h2;
  h[3] = h3;
  h[4] = h4;
  h[5] = h5;
  h[6] = h6;
  h[7] = h7;
  h[8] = h8;
  h[9] = h9;
}

function poly1305Update(
  state: Poly1305State,
  m: Uint8Array,
  offset: number,
  mlen: number,
): void {
  let pos = offset;
  let remaining = mlen;

  if (state.leftover > 0) {
    let want = 16 - state.leftover;
    if (want > remaining) want = remaining;
    for (let i = 0; i < want; i++) {
      state.buffer[state.leftover + i] = m[pos + i];
    }
    remaining -= want;
    pos += want;
    state.leftover += want;
    if (state.leftover < 16) return;
    poly1305Blocks(state, state.buffer, 0, 16);
    state.leftover = 0;
  }

  if (remaining >= 16) {
    const want = remaining - (remaining % 16);
    poly1305Blocks(state, m, pos, want);
    pos += want;
    remaining -= want;
  }

  if (remaining > 0) {
    for (let i = 0; i < remaining; i++) {
      state.buffer[state.leftover + i] = m[pos + i];
    }
    state.leftover += remaining;
  }
}

function poly1305Finalize(state: Poly1305State, mac: Uint8Array): void {
  const g = new Uint16Array(10);
  const h = state.h;
  let c, mask, f, i;

  if (state.leftover > 0) {
    i = state.leftover;
    state.buffer[i++] = 1;
    for (; i < 16; i++) state.buffer[i] = 0;
    state.fin = 1;
    poly1305Blocks(state, state.buffer, 0, 16);
  }

  c = h[1] >>> 13;
  h[1] &= 0x1fff;
  for (i = 2; i < 10; i++) {
    h[i] += c;
    c = h[i] >>> 13;
    h[i] &= 0x1fff;
  }
  h[0] += c * 5;
  c = h[0] >>> 13;
  h[0] &= 0x1fff;
  h[1] += c;
  c = h[1] >>> 13;
  h[1] &= 0x1fff;
  h[2] += c;

  g[0] = h[0] + 5;
  c = g[0] >>> 13;
  g[0] &= 0x1fff;
  for (i = 1; i < 10; i++) {
    g[i] = h[i] + c;
    c = g[i] >>> 13;
    g[i] &= 0x1fff;
  }
  g[9] -= 1 << 13;

  mask = (c ^ 1) - 1;
  for (i = 0; i < 10; i++) g[i] &= mask;
  mask = ~mask;
  for (i = 0; i < 10; i++) h[i] = (h[i] & mask) | g[i];

  h[0] = (h[0] | (h[1] << 13)) & 0xffff;
  h[1] = ((h[1] >>> 3) | (h[2] << 10)) & 0xffff;
  h[2] = ((h[2] >>> 6) | (h[3] << 7)) & 0xffff;
  h[3] = ((h[3] >>> 9) | (h[4] << 4)) & 0xffff;
  h[4] = ((h[4] >>> 12) | (h[5] << 1) | (h[6] << 14)) & 0xffff;
  h[5] = ((h[6] >>> 2) | (h[7] << 11)) & 0xffff;
  h[6] = ((h[7] >>> 5) | (h[8] << 8)) & 0xffff;
  h[7] = ((h[8] >>> 8) | (h[9] << 5)) & 0xffff;

  f = h[0] + state.pad[0];
  h[0] = f & 0xffff;
  for (i = 1; i < 8; i++) {
    f = (((h[i] + state.pad[i]) | 0) + (f >>> 16)) | 0;
    h[i] = f & 0xffff;
  }

  mac[0] = (h[0] >>> 0) & 0xff;
  mac[1] = (h[0] >>> 8) & 0xff;
  mac[2] = (h[1] >>> 0) & 0xff;
  mac[3] = (h[1] >>> 8) & 0xff;
  mac[4] = (h[2] >>> 0) & 0xff;
  mac[5] = (h[2] >>> 8) & 0xff;
  mac[6] = (h[3] >>> 0) & 0xff;
  mac[7] = (h[3] >>> 8) & 0xff;
  mac[8] = (h[4] >>> 0) & 0xff;
  mac[9] = (h[4] >>> 8) & 0xff;
  mac[10] = (h[5] >>> 0) & 0xff;
  mac[11] = (h[5] >>> 8) & 0xff;
  mac[12] = (h[6] >>> 0) & 0xff;
  mac[13] = (h[6] >>> 8) & 0xff;
  mac[14] = (h[7] >>> 0) & 0xff;
  mac[15] = (h[7] >>> 8) & 0xff;
}

// ================================================================
// SecretStream (XChaCha20-Poly1305) — ported from keiyoushi SecretStream.java
// ================================================================

const ABYTES = 17; // 1 tag + 16 poly1305 mac
const TAG_FINAL = 0x03;
const TAG_REKEY = 0x02;
const STREAM_HEADER_LENGTH = 24;
const PREFIX_LENGTH = 128;
const CHUNK_SIZE = 65536 + ABYTES;

const PAD0 = new Uint8Array(16);

interface SecretStreamState {
  k: Uint8Array; // 32 bytes
  nonce: Uint8Array; // 12 bytes
}

function secretStreamInitPull(
  header: Uint8Array,
  key: Uint8Array,
): SecretStreamState {
  const k = new Uint8Array(32);
  hchacha20(k, header.subarray(0, 16), key);
  const nonce = new Uint8Array(12);
  nonce[0] = 1; // counter reset: nonce[0]=1, nonce[1..3]=0
  nonce.set(header.subarray(16, 24), 4); // copy inonce from header[16..24]
  return { k, nonce };
}

function store64LE(dst: Uint8Array, offset: number, value: number): void {
  // value fits in 32 bits for our usage
  dst[offset] = value & 0xff;
  dst[offset + 1] = (value >>> 8) & 0xff;
  dst[offset + 2] = (value >>> 16) & 0xff;
  dst[offset + 3] = (value >>> 24) & 0xff;
  dst[offset + 4] = 0;
  dst[offset + 5] = 0;
  dst[offset + 6] = 0;
  dst[offset + 7] = 0;
}

interface PullResult {
  message: Uint8Array;
  tag: number;
}

function secretStreamPull(
  state: SecretStreamState,
  inp: Uint8Array,
  inlen: number,
): PullResult | null {
  if (inlen < ABYTES) return null;

  const mlen = inlen - ABYTES;

  // Generate Poly1305 key from ChaCha20 (64 bytes at counter=0)
  const block = new Uint8Array(64);
  chacha20StreamIETF(block, 64, state.nonce, state.k);
  const polyState = poly1305Init(block);
  block.fill(0);

  // No additional data for secretstream, so skip AD update.
  // (adlen=0, so the pad0 update with (0x10 - 0) & 0xf = 0 is a no-op)

  // Process the tag byte:
  // block[0] = in[0], then XOR with ChaCha20(nonce, IC=1)
  const tagBlock = new Uint8Array(64);
  tagBlock[0] = inp[0];
  chacha20StreamIETFXorIC(tagBlock, tagBlock, 64, state.nonce, 1, state.k);
  const tag = tagBlock[0];
  // For poly1305: use the original tag block with inp[0] in position 0
  tagBlock[0] = inp[0];
  poly1305Update(polyState, tagBlock, 0, 64);

  // Update poly1305 with ciphertext (inp[1..1+mlen])
  poly1305Update(polyState, inp, 1, mlen);

  // Pad to 16-byte boundary. Matches keiyoushi SecretStream.java / libsodium:
  // padLen = (0x10 - sizeof(block) + mlen) & 0xf, with block size 64.
  const padLen = (0x10 - 64 + mlen) & 0xf;
  poly1305Update(polyState, PAD0, 0, padLen);

  // Finalize length encoding
  const slen = new Uint8Array(8);
  store64LE(slen, 0, 0); // adlen = 0
  poly1305Update(polyState, slen, 0, 8);
  store64LE(slen, 0, 64 + mlen);
  poly1305Update(polyState, slen, 0, 8);

  // Compute and verify MAC
  const mac = new Uint8Array(16);
  poly1305Finalize(polyState, mac);

  const macStart = 1 + mlen;
  let diff = 0;
  for (let i = 0; i < 16; i++) diff |= mac[i] ^ inp[macStart + i];
  if (diff !== 0) return null;

  // Decrypt message: XOR ciphertext with ChaCha20 at IC=2
  const message = new Uint8Array(mlen);
  chacha20StreamIETFXorIC(message, inp.subarray(1, 1 + mlen), mlen, state.nonce, 2, state.k);

  // XOR inonce with mac[0:8]
  for (let i = 0; i < 8; i++) {
    state.nonce[4 + i] ^= mac[i];
  }

  // Increment counter
  incrementCounter(state);

  // Rekey if needed
  if ((tag & TAG_REKEY) !== 0 || isCounterZero(state)) {
    rekey(state);
  }

  return { message, tag };
}

function incrementCounter(state: SecretStreamState): void {
  for (let i = 0; i < 4; i++) {
    state.nonce[i] = (state.nonce[i] + 1) & 0xff;
    if (state.nonce[i] !== 0) break;
  }
}

function isCounterZero(state: SecretStreamState): boolean {
  for (let i = 0; i < 4; i++) {
    if (state.nonce[i] !== 0) return false;
  }
  return true;
}

function rekey(state: SecretStreamState): void {
  // newKeyAndInonce = key(32) || inonce(8)
  const buf = new Uint8Array(40);
  buf.set(state.k, 0);
  buf.set(state.nonce.subarray(4, 12), 32);

  // XOR with ChaCha20 stream at IC=0
  chacha20StreamIETFXorIC(buf, buf, 40, state.nonce, 0, state.k);

  // Update state
  state.k.set(buf.subarray(0, 32));
  state.nonce.set(buf.subarray(32, 40), 4);

  // Counter reset
  state.nonce[0] = 1;
  state.nonce[1] = 0;
  state.nonce[2] = 0;
  state.nonce[3] = 0;
}

/**
 * Decrypt an entire secretstream-encrypted payload.
 * Layout: [PREFIX_LENGTH padding][STREAM_HEADER_LENGTH header][encrypted chunks...]
 */
export function decryptSecretStream(
  streamKey: Uint8Array,
  payload: Uint8Array,
): Uint8Array | null {
  if (payload.length < PREFIX_LENGTH + STREAM_HEADER_LENGTH) return null;

  const header = payload.subarray(
    PREFIX_LENGTH,
    PREFIX_LENGTH + STREAM_HEADER_LENGTH,
  );
  const encrypted = payload.subarray(PREFIX_LENGTH + STREAM_HEADER_LENGTH);

  const state = secretStreamInitPull(header, streamKey);

  const chunks: Uint8Array[] = [];
  let offset = 0;

  while (offset < encrypted.length) {
    const remaining = encrypted.length - offset;
    const chunkLen = Math.min(CHUNK_SIZE, remaining);
    const chunk = encrypted.subarray(offset, offset + chunkLen);

    const result = secretStreamPull(state, chunk, chunkLen);
    if (!result) return null;

    chunks.push(result.message);
    offset += chunkLen;

    if (result.tag === TAG_FINAL) break;
  }

  const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
  const output = new Uint8Array(totalLen);
  let pos = 0;
  for (const c of chunks) {
    output.set(c, pos);
    pos += c.length;
  }
  return output;
}

// ================================================================
// Utility exports
// ================================================================

export function bufToHex(buf: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < buf.length; i++) {
    hex += buf[i].toString(16).padStart(2, "0");
  }
  return hex;
}

const B64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Pure-JS base64 that operates directly on raw bytes. We deliberately avoid
// the runtime's atob/btoa: the Paperback btoa polyfill UTF-8-encodes the input
// string, so any byte >= 0x80 (common in X25519 keys) gets mangled into a
// 2-byte sequence, corrupting the X-Client-Pubkey header and causing the
// server to reject page image requests with HTTP 400.
export function base64Decode(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 6) / 8));
  let bits = 0;
  let bitCount = 0;
  let oi = 0;
  for (let i = 0; i < clean.length; i++) {
    const idx = B64_CHARS.indexOf(clean[i]);
    if (idx < 0) continue;
    bits = (bits << 6) | idx;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      out[oi++] = (bits >> bitCount) & 0xff;
    }
  }
  return out;
}

export function base64Encode(buf: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < buf.length; i += 3) {
    const n = (buf[i] << 16) | (buf[i + 1] << 8) | buf[i + 2];
    out +=
      B64_CHARS[(n >> 18) & 0x3f] +
      B64_CHARS[(n >> 12) & 0x3f] +
      B64_CHARS[(n >> 6) & 0x3f] +
      B64_CHARS[n & 0x3f];
  }
  const rem = buf.length - i;
  if (rem === 1) {
    const n = buf[i] << 16;
    out += B64_CHARS[(n >> 18) & 0x3f] + B64_CHARS[(n >> 12) & 0x3f] + "==";
  } else if (rem === 2) {
    const n = (buf[i] << 16) | (buf[i + 1] << 8);
    out +=
      B64_CHARS[(n >> 18) & 0x3f] +
      B64_CHARS[(n >> 12) & 0x3f] +
      B64_CHARS[(n >> 6) & 0x3f] +
      "=";
  }
  return out;
}

export function getRandomBytes(n: number): Uint8Array {
  const crypto = (
    globalThis as unknown as {
      crypto: { getRandomValues: (a: Uint8Array) => Uint8Array };
    }
  ).crypto;
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return buf;
}
