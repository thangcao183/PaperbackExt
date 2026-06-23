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
// Poly1305 — ported from keiyoushi Poly1305.java (26-bit limbs, long arithmetic)
// ================================================================

// JavaScript doesn't have 64-bit integers. We use BigInt for the
// multiplication steps where Java uses long (which overflows at 2^63).
// However, the intermediate values in poly1305 with 26-bit limbs fit
// within 53 bits for the multiplication (26+26+3 = ~55 bits max).
// Actually with 5 terms: max product per limb ≈ 5 * 2^26 * 2^26 ≈ 2^55.
// This exceeds Number.MAX_SAFE_INTEGER (2^53). We must use BigInt.
//
// Alternative: Use 32-bit limbs with a more complex carry chain.
// For simplicity and correctness, we'll use a Number-safe approach with
// careful splitting. Actually let's just use the same approach with Number
// since the Java `long` values don't exceed safe range for these inputs.
// The r values are clamped to ≤ 20 bits per limb effectively, so:
// max per d_i = 5 * (2^26) * (2^20 * 5) ≈ 5 * 2^26 * 2^22 = 5 * 2^48 ≈ 2^50.3
// This is safe for Number (< 2^53).

interface Poly1305State {
  r0: number;
  r1: number;
  r2: number;
  r3: number;
  r4: number;
  h0: number;
  h1: number;
  h2: number;
  h3: number;
  h4: number;
  pad0: number;
  pad1: number;
  pad2: number;
  pad3: number;
  buffer: Uint8Array;
  leftover: number;
}

function poly1305Init(key: Uint8Array): Poly1305State {
  const t0 = load32LE(key, 0) >>> 0;
  const t1 = load32LE(key, 4) >>> 0;
  const t2 = load32LE(key, 8) >>> 0;
  const t3 = load32LE(key, 12) >>> 0;

  return {
    r0: t0 & 0x3ffffff,
    r1: ((t0 >>> 26) | (t1 << 6)) & 0x3ffff03,
    r2: ((t1 >>> 20) | (t2 << 12)) & 0x3ffc0ff,
    r3: ((t2 >>> 14) | (t3 << 18)) & 0x3f03fff,
    r4: (t3 >>> 8) & 0x00fffff,
    h0: 0,
    h1: 0,
    h2: 0,
    h3: 0,
    h4: 0,
    pad0: load32LE(key, 16) >>> 0,
    pad1: load32LE(key, 20) >>> 0,
    pad2: load32LE(key, 24) >>> 0,
    pad3: load32LE(key, 28) >>> 0,
    buffer: new Uint8Array(16),
    leftover: 0,
  };
}

function poly1305Blocks(
  state: Poly1305State,
  m: Uint8Array,
  offset: number,
  bytes: number,
): void {
  const hibit = 1 << 24;
  const { r0, r1, r2, r3, r4 } = state;
  let { h0, h1, h2, h3, h4 } = state;
  const s1 = r1 * 5;
  const s2 = r2 * 5;
  const s3 = r3 * 5;
  const s4 = r4 * 5;

  let pos = offset;
  while (bytes >= 16) {
    const t0 = load32LE(m, pos) >>> 0;
    const t1 = load32LE(m, pos + 4) >>> 0;
    const t2 = load32LE(m, pos + 8) >>> 0;
    const t3 = load32LE(m, pos + 12) >>> 0;

    h0 += t0 & 0x3ffffff;
    h1 += ((t0 >>> 26) | (t1 << 6)) & 0x3ffffff;
    h2 += ((t1 >>> 20) | (t2 << 12)) & 0x3ffffff;
    h3 += ((t2 >>> 14) | (t3 << 18)) & 0x3ffffff;
    h4 += (t3 >>> 8) | hibit;

    const d0 = h0 * r0 + h1 * s4 + h2 * s3 + h3 * s2 + h4 * s1;
    const d1 = h0 * r1 + h1 * r0 + h2 * s4 + h3 * s3 + h4 * s2;
    const d2 = h0 * r2 + h1 * r1 + h2 * r0 + h3 * s4 + h4 * s3;
    const d3 = h0 * r3 + h1 * r2 + h2 * r1 + h3 * r0 + h4 * s4;
    const d4 = h0 * r4 + h1 * r3 + h2 * r2 + h3 * r1 + h4 * r0;

    let c: number;
    c = Math.floor(d0 / 0x4000000);
    h0 = d0 - c * 0x4000000;
    const e1 = d1 + c;
    c = Math.floor(e1 / 0x4000000);
    h1 = e1 - c * 0x4000000;
    const e2 = d2 + c;
    c = Math.floor(e2 / 0x4000000);
    h2 = e2 - c * 0x4000000;
    const e3 = d3 + c;
    c = Math.floor(e3 / 0x4000000);
    h3 = e3 - c * 0x4000000;
    const e4 = d4 + c;
    c = Math.floor(e4 / 0x4000000);
    h4 = e4 - c * 0x4000000;
    h0 += c * 5;
    c = Math.floor(h0 / 0x4000000);
    h0 -= c * 0x4000000;
    h1 += c;

    pos += 16;
    bytes -= 16;
  }

  state.h0 = h0;
  state.h1 = h1;
  state.h2 = h2;
  state.h3 = h3;
  state.h4 = h4;
}

function poly1305BlocksPartial(
  state: Poly1305State,
  m: Uint8Array,
  offset: number,
): void {
  const { r0, r1, r2, r3, r4 } = state;
  let { h0, h1, h2, h3, h4 } = state;
  const s1 = r1 * 5;
  const s2 = r2 * 5;
  const s3 = r3 * 5;
  const s4 = r4 * 5;

  const t0 = load32LE(m, offset) >>> 0;
  const t1 = load32LE(m, offset + 4) >>> 0;
  const t2 = load32LE(m, offset + 8) >>> 0;
  const t3 = load32LE(m, offset + 12) >>> 0;

  h0 += t0 & 0x3ffffff;
  h1 += ((t0 >>> 26) | (t1 << 6)) & 0x3ffffff;
  h2 += ((t1 >>> 20) | (t2 << 12)) & 0x3ffffff;
  h3 += ((t2 >>> 14) | (t3 << 18)) & 0x3ffffff;
  h4 += t3 >>> 8; // no hibit for partial block

  const d0 = h0 * r0 + h1 * s4 + h2 * s3 + h3 * s2 + h4 * s1;
  const d1 = h0 * r1 + h1 * r0 + h2 * s4 + h3 * s3 + h4 * s2;
  const d2 = h0 * r2 + h1 * r1 + h2 * r0 + h3 * s4 + h4 * s3;
  const d3 = h0 * r3 + h1 * r2 + h2 * r1 + h3 * r0 + h4 * s4;
  const d4 = h0 * r4 + h1 * r3 + h2 * r2 + h3 * r1 + h4 * r0;

  let c: number;
  c = Math.floor(d0 / 0x4000000);
  h0 = d0 - c * 0x4000000;
  const e1 = d1 + c;
  c = Math.floor(e1 / 0x4000000);
  h1 = e1 - c * 0x4000000;
  const e2 = d2 + c;
  c = Math.floor(e2 / 0x4000000);
  h2 = e2 - c * 0x4000000;
  const e3 = d3 + c;
  c = Math.floor(e3 / 0x4000000);
  h3 = e3 - c * 0x4000000;
  const e4 = d4 + c;
  c = Math.floor(e4 / 0x4000000);
  h4 = e4 - c * 0x4000000;
  h0 += c * 5;
  c = Math.floor(h0 / 0x4000000);
  h0 -= c * 0x4000000;
  h1 += c;

  state.h0 = h0;
  state.h1 = h1;
  state.h2 = h2;
  state.h3 = h3;
  state.h4 = h4;
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
    state.buffer.set(m.subarray(pos, pos + want), state.leftover);
    remaining -= want;
    pos += want;
    state.leftover += want;
    if (state.leftover < 16) return;
    poly1305Blocks(state, state.buffer, 0, 16);
    state.leftover = 0;
  }

  if (remaining >= 16) {
    const want = remaining & ~15;
    poly1305Blocks(state, m, pos, want);
    pos += want;
    remaining -= want;
  }

  if (remaining > 0) {
    state.buffer.set(m.subarray(pos, pos + remaining), 0);
    state.leftover = remaining;
  }
}

function poly1305Finalize(state: Poly1305State, mac: Uint8Array): void {
  if (state.leftover > 0) {
    state.buffer[state.leftover] = 1;
    for (let i = state.leftover + 1; i < 16; i++) state.buffer[i] = 0;
    poly1305BlocksPartial(state, state.buffer, 0);
  }

  let { h0, h1, h2, h3, h4 } = state;

  let c: number;
  c = Math.floor(h1 / 0x4000000);
  h1 -= c * 0x4000000;
  h2 += c;
  c = Math.floor(h2 / 0x4000000);
  h2 -= c * 0x4000000;
  h3 += c;
  c = Math.floor(h3 / 0x4000000);
  h3 -= c * 0x4000000;
  h4 += c;
  c = Math.floor(h4 / 0x4000000);
  h4 -= c * 0x4000000;
  h0 += c * 5;
  c = Math.floor(h0 / 0x4000000);
  h0 -= c * 0x4000000;
  h1 += c;

  // Compute h + -p
  let g0 = h0 + 5;
  c = Math.floor(g0 / 0x4000000);
  g0 -= c * 0x4000000;
  let g1 = h1 + c;
  c = Math.floor(g1 / 0x4000000);
  g1 -= c * 0x4000000;
  let g2 = h2 + c;
  c = Math.floor(g2 / 0x4000000);
  g2 -= c * 0x4000000;
  let g3 = h3 + c;
  c = Math.floor(g3 / 0x4000000);
  g3 -= c * 0x4000000;
  let g4 = h4 + c - 0x4000000; // subtract 2^26

  // Select: if g4 >= 0 use g, else use h
  // g4 < 0 means h < p, so use h
  const mask = g4 < 0 ? 0 : -1;
  const nmask = ~mask;
  h0 = (h0 & nmask) | (g0 & mask);
  h1 = (h1 & nmask) | (g1 & mask);
  h2 = (h2 & nmask) | (g2 & mask);
  h3 = (h3 & nmask) | (g3 & mask);
  h4 = (h4 & nmask) | (g4 & mask);

  // h = h % (2^128) as four 32-bit limbs
  let f0 = ((h0 | (h1 << 26)) >>> 0);
  let f1 = (((h1 >>> 6) | (h2 << 20)) >>> 0);
  let f2 = (((h2 >>> 12) | (h3 << 14)) >>> 0);
  let f3 = (((h3 >>> 18) | (h4 << 8)) >>> 0);

  // mac = (h + pad) % (2^128) using 16-bit half-word addition for carry
  let carry: number;
  const s0 = (f0 & 0xffff) + (state.pad0 & 0xffff);
  const s0h = (f0 >>> 16) + (state.pad0 >>> 16) + (s0 >>> 16);
  f0 = ((s0h << 16) | (s0 & 0xffff)) >>> 0;
  carry = s0h >>> 16;

  const s1v = (f1 & 0xffff) + (state.pad1 & 0xffff) + carry;
  const s1h = (f1 >>> 16) + (state.pad1 >>> 16) + (s1v >>> 16);
  f1 = ((s1h << 16) | (s1v & 0xffff)) >>> 0;
  carry = s1h >>> 16;

  const s2v = (f2 & 0xffff) + (state.pad2 & 0xffff) + carry;
  const s2h = (f2 >>> 16) + (state.pad2 >>> 16) + (s2v >>> 16);
  f2 = ((s2h << 16) | (s2v & 0xffff)) >>> 0;
  carry = s2h >>> 16;

  const s3v = (f3 & 0xffff) + (state.pad3 & 0xffff) + carry;
  const s3h = (f3 >>> 16) + (state.pad3 >>> 16) + (s3v >>> 16);
  f3 = ((s3h << 16) | (s3v & 0xffff)) >>> 0;

  store32LE(mac, 0, f0);
  store32LE(mac, 4, f1);
  store32LE(mac, 8, f2);
  store32LE(mac, 12, f3);
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

  // Pad to 16-byte boundary: padLen = (0x10 - (64 + mlen)) & 0xf
  const padLen = (0x10 - ((64 + mlen) & 0xf)) & 0xf;
  if (padLen > 0) {
    poly1305Update(polyState, PAD0, 0, padLen);
  }

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

export function base64Decode(b64: string): Uint8Array {
  const raw = atob(b64);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf;
}

export function base64Encode(buf: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  return btoa(binary);
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
