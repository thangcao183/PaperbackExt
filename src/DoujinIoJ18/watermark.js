/*
 * Doujin.io watermark removal.
 *
 * Port of upstream keiyoushi `WatermarkRemover.kt` (PR #18164), which itself
 * reverse-engineers the site's `drmwasm_bg-*.wasm` module.
 *
 * The served JPEG is the *watermarked* page. Hidden inside it — in an APP10
 * (0xFFEA) marker segment tagged "MILF" — is an AES-ECB encrypted blob that,
 * once decrypted, contains a small clean JPEG patch plus the rectangle it
 * belongs in. Compositing that patch over the watermarked area restores the
 * original page.
 *
 * Plaintext layout (as produced by the wasm module):
 *
 *   u32_be(totalSize) | JPEG bytes | u32_le(x) u32_le(y) u32_le(w) u32_le(h)
 *
 * where the JPEG runs from offset 4 up to `4 + totalSize - 16` (the trailing
 * 16 bytes being the four little-endian u32 rectangle fields).
 *
 * The AES key is per-chapter and comes from `/api/mangas/{manga}/{chapter}/chm`
 * as a `chmkeys` int array; `main.ts` passes it through the image URL fragment.
 *
 * Compositing uses the shared canvas helpers. Only the 4-argument
 * `drawImage(img, x, y, w, h)` form is used — Paperback's canvas polyfill does
 * not reliably honour the 9-argument source-crop form, and
 * `getImageData`/`putImageData` apply an unreliable Y-axis origin (see
 * `src/utils/descramble/canvas.ts` for the full caveat). Here the overlay is a
 * separate image drawn at its own offset, so no source-cropping is needed at all.
 */
import { decodeDataUrlToArrayBuffer, loadImageFromBuffer, } from "../utils/descramble/canvas";
function bufferOf(bytes) {
    const out = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(out).set(bytes);
    return out;
}
/**
 * Locate the encrypted payload hidden in a JPEG marker segment.
 *
 * Walks the JPEG marker chain looking for a segment whose payload begins with
 * the ASCII tag "MILF"; the ciphertext starts 7 bytes in (4-byte tag + 3 bytes
 * the wasm module reserves). Mirrors upstream `extractCiphertext`.
 */
function extractCiphertext(data) {
    let offset = 2; // skip SOI (FFD8)
    while (offset + 1 < data.length) {
        if (data[offset] !== 0xff) {
            offset++;
            continue;
        }
        const marker = data[offset + 1];
        offset += 2;
        if (marker === 0xd9)
            break; // EOI
        if (marker === 0xda)
            break; // SOS — entropy-coded data follows
        // SOI and RSTn markers are standalone (no length field).
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7))
            continue;
        if (offset + 1 >= data.length)
            break;
        // Segment length is a big-endian u16 that includes its own two bytes.
        const length = (data[offset] << 8) | data[offset + 1];
        const payloadStart = offset + 2;
        const payloadEnd = offset + length;
        if (length < 2 || payloadEnd > data.length)
            break;
        const payload = data.subarray(payloadStart, payloadEnd);
        if (payload.length >= 8 &&
            payload[0] === 0x4d && // 'M'
            payload[1] === 0x49 && // 'I'
            payload[2] === 0x4c && // 'L'
            payload[3] === 0x46 // 'F'
        ) {
            return payload.subarray(7);
        }
        offset = payloadEnd;
    }
    return undefined;
}
/**
 * AES-ECB decrypt with no padding.
 *
 * WebCrypto exposes no ECB mode, but CBC with a zero IV decrypts block *i* to
 * `D(c[i]) XOR c[i-1]`, so XORing the previous ciphertext block back out
 * recovers the true ECB plaintext. Upstream uses NoPadding and the ciphertext
 * is always a whole number of blocks; WebCrypto nonetheless insists on
 * stripping a PKCS7 pad, so a synthetic trailing block that decrypts to a full
 * pad block is appended for it to consume.
 *
 * Verified off-device against Node's `aes-128-ecb` and `aes-256-ecb` for 1, 2,
 * 5 and 16-block inputs.
 */
async function aesEcbDecrypt(ciphertext, key) {
    if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) {
        throw new Error("Watermark ciphertext is not a multiple of the AES block size");
    }
    const subtle = globalThis.crypto
        .subtle;
    const cryptoKey = await subtle.importKey("raw", bufferOf(key), { name: "AES-CBC" }, false, ["encrypt", "decrypt"]);
    // Under CBC the appended block decrypts to D(block) XOR lastCiphertextBlock,
    // so encrypting (0x10 XOR lastBlock) yields a block that decrypts to the
    // 16-byte PKCS7 pad WebCrypto then strips.
    const lastBlock = ciphertext.subarray(ciphertext.length - 16);
    const padSource = new Uint8Array(16);
    for (let i = 0; i < 16; i++)
        padSource[i] = 0x10 ^ lastBlock[i];
    const zeroIv = new Uint8Array(16);
    const encrypted = new Uint8Array(await subtle.encrypt({ name: "AES-CBC", iv: bufferOf(zeroIv) }, cryptoKey, bufferOf(padSource)));
    const syntheticBlock = encrypted.subarray(0, 16);
    const extended = new Uint8Array(ciphertext.length + 16);
    extended.set(ciphertext, 0);
    extended.set(syntheticBlock, ciphertext.length);
    const cbc = new Uint8Array(await subtle.decrypt({ name: "AES-CBC", iv: bufferOf(zeroIv) }, cryptoKey, bufferOf(extended)));
    // Undo the CBC chaining to get ECB: plain[i] = cbc[i] XOR ciphertext[i-16].
    // (Block 0 used the zero IV, so it is already correct.)
    const out = new Uint8Array(ciphertext.length);
    out.set(cbc.subarray(0, ciphertext.length));
    for (let i = 16; i < out.length; i++) {
        out[i] ^= ciphertext[i - 16];
    }
    return out;
}
/** Read a big-endian u32. */
function readU32BE(bytes, offset) {
    return (((bytes[offset] << 24) |
        (bytes[offset + 1] << 16) |
        (bytes[offset + 2] << 8) |
        bytes[offset + 3]) >>>
        0);
}
/** Read a little-endian u32. */
function readU32LE(bytes, offset) {
    return (((bytes[offset + 3] << 24) |
        (bytes[offset + 2] << 16) |
        (bytes[offset + 1] << 8) |
        bytes[offset]) >>>
        0);
}
/**
 * Remove the watermark from a Doujin.io page image.
 *
 * `keyBytes` is the chapter's `chmkeys` array converted to bytes. Returns the
 * recomposed JPEG bytes, or the original bytes when the image carries no
 * embedded patch (not every page is watermarked).
 */
export async function removeWatermark(data, keyBytes) {
    const image = new Uint8Array(data);
    const ciphertext = extractCiphertext(image);
    if (!ciphertext)
        return data;
    const plaintext = await aesEcbDecrypt(ciphertext, keyBytes);
    if (plaintext.length < 20)
        return data;
    // u32_be(size) | JPEG | u32_le(x, y, width, height)
    const totalSize = readU32BE(plaintext, 0);
    const jpegStart = 4;
    const jpegEnd = jpegStart + totalSize - 16;
    if (totalSize < 16 ||
        jpegEnd <= jpegStart ||
        jpegEnd + 16 > plaintext.length) {
        return data;
    }
    const x = readU32LE(plaintext, jpegEnd);
    const y = readU32LE(plaintext, jpegEnd + 4);
    const width = readU32LE(plaintext, jpegEnd + 8);
    const height = readU32LE(plaintext, jpegEnd + 12);
    if (width === 0 || height === 0)
        return data;
    const overlayBytes = plaintext.subarray(jpegStart, jpegEnd);
    const base = await loadImageFromBuffer(data, "image/jpeg");
    const baseWidth = base.naturalWidth || base.width;
    const baseHeight = base.naturalHeight || base.height;
    if (!baseWidth || !baseHeight)
        return data;
    const overlay = await loadImageFromBuffer(bufferOf(overlayBytes), "image/jpeg");
    const canvas = new HTMLCanvasElement();
    canvas.width = baseWidth;
    canvas.height = baseHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx)
        return data;
    // Both draws use only the 4-arg drawImage form (polyfill-safe).
    ctx.drawImage(base, 0, 0, baseWidth, baseHeight);
    ctx.drawImage(overlay, x, y, width, height);
    return decodeDataUrlToArrayBuffer(canvas.toDataURL("image/jpeg"));
}
