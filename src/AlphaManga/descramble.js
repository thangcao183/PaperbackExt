/*
 * Alpha Manga page-image descrambling.
 *
 * Port of upstream keiyoushi `ImageInterceptor.kt` (PR #18522), which
 * reverse-engineers the site's `createData` wasm export.
 *
 * The served WebP is a tile-scrambled image that also carries a small overlap
 * border ("bleed") around every tile. Reassembly needs, per tile: a source
 * crop, a 90-degree-multiple rotation, and an optional horizontal mirror. The
 * per-page key comes from the viewer element's `placeholder` data-URL and is
 * handed to the interceptor through the image URL fragment.
 *
 * Key layout (verified off-device against a real chapter):
 *   8 bytes per tile: v = u32le(off), ha = u32le(off + 4)
 *   From the FIRST tile: tileSize = (ha >>> 24) & 0xFF, w = (v >>> 27) & 7
 *   Per tile: flip = v & 1, rot = (v >>> 1) & 3,
 *             destTop = (v >>> 3) & 4095, destLeft = (v >>> 15) & 4095,
 *             srcRow = (ha >>> 8) & 0xFF, srcCol = (ha >>> 16) & 0xFF
 *
 * !!! POLYFILL RISK — READ BEFORE EDITING !!!
 * Paperback's in-process canvas polyfill has never been exercised with
 * `save`/`restore`/`translate`/`rotate`/`scale` anywhere in this repository, so
 * this is the first source to depend on them. Two deliberate choices limit the
 * blast radius:
 *
 *   1. The source crop uses ONLY the 4-argument `drawImage(img, x, y, w, h)`
 *      form via a tile-sized scratch canvas (the same technique as
 *      `src/utils/descramble/canvas.ts`), because the 9-argument source-crop
 *      form is KNOWN to be unreliable here — it can ignore the source
 *      sub-rectangle entirely. Upstream's Android code uses the equivalent of
 *      the 9-arg form; we must not.
 *   2. Every failure path returns the ORIGINAL bytes, so a polyfill gap
 *      degrades to "page still scrambled" rather than a broken/blank reader.
 *
 * If rotation turns out to be a no-op in the polyfill, pages will still render
 * scrambled and this module needs a pixel-level fallback instead.
 */
import { decodeDataUrlToArrayBuffer, loadImageFromBuffer, } from "../utils/descramble/canvas";
/** Read a little-endian u32. */
function readU32LE(bytes, offset) {
    return (((bytes[offset + 3] << 24) |
        (bytes[offset + 2] << 16) |
        (bytes[offset + 1] << 8) |
        bytes[offset]) >>>
        0);
}
/** Read a little-endian u16. */
function readU16LE(bytes, offset) {
    return ((bytes[offset + 1] << 8) | bytes[offset]) & 0xffff;
}
/**
 * Split the viewer's `placeholder` PNG data-URL into one descrambling key per
 * page.
 *
 * The payload is a PNG whose pixel data is a concatenation of
 * `u16le(tileCount) | tileCount * 8 bytes` records, one per page, starting at
 * byte 33 (immediately after the PNG signature and IHDR chunk). Verified
 * off-device: a 28-page chapter yields exactly 28 keys of 35 tiles each.
 */
export function extractPageKeys(placeholder) {
    const marker = placeholder.indexOf("base64,");
    if (marker < 0)
        return [];
    const decoded = Application.base64Decode(placeholder.slice(marker + 7));
    let raw;
    if (typeof decoded === "string") {
        raw = new Uint8Array(decoded.length);
        for (let i = 0; i < decoded.length; i++)
            raw[i] = decoded.charCodeAt(i);
    }
    else {
        raw = new Uint8Array(decoded);
    }
    const keys = [];
    let pos = 33; // right after the PNG signature + IHDR chunk
    while (pos + 2 <= raw.length) {
        const count = readU16LE(raw, pos);
        const length = count * 8;
        const start = pos + 2;
        const end = start + length;
        if (length <= 0 || end > raw.length)
            break;
        keys.push(raw.subarray(start, end));
        pos = end;
    }
    return keys;
}
/** Encode a key as the `#key=` URL fragment the interceptor reads back. */
export function encodeKeyFragment(key) {
    let hex = "";
    for (let i = 0; i < key.length; i++) {
        hex += key[i].toString(16).padStart(2, "0");
    }
    return `#key=${hex}`;
}
/** Recover the key bytes from an image URL's `#key=` fragment. */
export function parseKeyFragment(url) {
    const fragment = url.split("#")[1];
    if (!fragment)
        return undefined;
    const match = fragment.match(/(?:^|&)key=([0-9a-fA-F]+)/);
    if (!match)
        return undefined;
    const hex = match[1];
    if (hex.length < 16 || hex.length % 2 !== 0)
        return undefined;
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return out;
}
/**
 * Reassemble a scrambled Alpha Manga page.
 *
 * Mirrors the upstream `unscramble` ("createData") geometry exactly. Returns
 * the original bytes unchanged whenever anything looks wrong, so a bad key or a
 * missing polyfill feature never breaks the reader outright.
 */
export async function descrambleAlphaManga(data, key, mimeType) {
    if (key.length < 8 || key.length % 8 !== 0)
        return data;
    const v0 = readU32LE(key, 0);
    const ha0 = readU32LE(key, 4);
    const tileSize = (ha0 >>> 24) & 0xff;
    const w = (v0 >>> 27) & 7;
    if (tileSize === 0)
        return data;
    const src = await loadImageFromBuffer(data, mimeType);
    const srcWidth = src.naturalWidth || src.width;
    const srcHeight = src.naturalHeight || src.height;
    if (!srcWidth || !srcHeight)
        return data;
    const cols = Math.ceil(srcWidth / tileSize);
    const rows = Math.ceil(srcHeight / tileSize);
    const r = w * 2; // total bleed per tile (w on each side)
    const t = tileSize - r; // tile size without the bleed
    const outW = srcWidth - cols * r;
    const outH = srcHeight - rows * r;
    if (outW <= 0 || outH <= 0)
        return data;
    const canvas = new HTMLCanvasElement();
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx)
        return data;
    const lastCol = cols - 1;
    const lastRow = rows - 1;
    const tileCount = (key.length / 8) | 0;
    for (let idx = 0; idx < tileCount; idx++) {
        const off = idx * 8;
        const v = readU32LE(key, off);
        const ha = readU32LE(key, off + 4);
        const flip = v & 1; // mirror flag
        const rot = (v >>> 1) & 3; // rotation: 0..3 -> 0/-90/-180/-270 degrees
        const destTop = (v >>> 3) & 4095; // destination top (before the -w shift)
        const destLeft = (v >>> 15) & 4095; // destination left (before the -w shift)
        const srcRow = (ha >>> 8) & 0xff;
        const srcCol = (ha >>> 16) & 0xff;
        // Edge tiles are short: they only span the remaining output extent.
        const spanX = (t !== 0 && Math.floor(destLeft / t) === lastCol ? outW - destLeft : t) + r;
        const spanY = (t !== 0 && Math.floor(destTop / t) === lastRow ? outH - destTop : t) + r;
        // A 90/270-degree rotation swaps the drawn width and height.
        const dw = rot % 2 === 1 ? spanY : spanX;
        const dh = rot % 2 === 1 ? spanX : spanY;
        const dx = destLeft - w;
        const dy = destTop - w;
        const sx = Math.min(Math.max(srcCol * tileSize, 0), srcWidth);
        const sy = Math.min(Math.max(srcRow * tileSize, 0), srcHeight);
        const cropW = Math.max(Math.min(dw, srcWidth - sx), 0);
        const cropH = Math.max(Math.min(dh, srcHeight - sy), 0);
        if (cropW <= 0 || cropH <= 0)
            continue;
        // Step 1: crop the tile with the PROVEN 4-arg technique — draw the whole
        // image into a tile-sized scratch shifted by (-sx, -sy) so only the wanted
        // rectangle lands in bounds. Never use the 9-arg source-crop form here.
        const scratch = new HTMLCanvasElement();
        scratch.width = cropW;
        scratch.height = cropH;
        const sctx = scratch.getContext("2d");
        if (!sctx)
            continue;
        sctx.clearRect(0, 0, cropW, cropH);
        sctx.drawImage(src, -sx, -sy, srcWidth, srcHeight);
        // Step 2: place the cropped tile, rotating/mirroring about its centre.
        ctx.save();
        ctx.translate(dx + dw / 2, dy + dh / 2);
        if (rot !== 0)
            ctx.rotate((-90 * rot * Math.PI) / 180);
        if (flip !== 0)
            ctx.scale(-1, 1);
        ctx.drawImage(scratch, -cropW / 2, -cropH / 2, cropW, cropH);
        ctx.restore();
    }
    return decodeDataUrlToArrayBuffer(canvas.toDataURL("image/webp"));
}
