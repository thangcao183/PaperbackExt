/*
 * Shared image-descrambling helpers for Paperback v0.9.
 *
 * Paperback's runtime polyfills `Image`, `HTMLCanvasElement` and `ImageData`
 * as direct in-process constructors, so descrambling runs straight inside a
 * source's `interceptResponse` — NO `Application.executeInWebView` round-trip
 * is needed (that path is slow and flaky per image, and was the reason
 * scrambled pages sometimes fell through undecoded).
 *
 * Two platform quirks (verified against the working inkdex extensions):
 *   1. `Blob` / `URL` / `OffscreenCanvas` are NOT polyfilled, so raw bytes
 *      cross the boundary as `data:` URLs (base64).
 *   2. `getImageData` / `putImageData` are **Y-up** (origin at bottom-left),
 *      i.e. the returned pixel buffer is row-reversed relative to the image.
 *      We flip to standard Y-down before remapping and flip back before
 *      `putImageData`, otherwise the output is itself scrambled.
 */

/** Decode a JPEG/PNG/WebP `ArrayBuffer` into a polyfilled `Image`. */
export async function loadImageFromBuffer(
  data: ArrayBuffer,
  mimeType: string,
): Promise<HTMLImageElement> {
  const b64 = Application.base64Encode(data);
  const b64Str =
    typeof b64 === "string" ? b64 : Application.arrayBufferToASCIIString(b64);
  const dataUrl = `data:${mimeType};base64,${b64Str}`;

  const img = new Image();
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    if (img.complete && img.naturalWidth > 0) {
      resolve(img);
      return;
    }
    img.onload = () => resolve(img);
    img.onerror = (event) => {
      const msg = typeof event === "string" ? event : "image load failed";
      reject(new Error(msg));
    };
    img.src = dataUrl;
    if (img.complete && img.naturalWidth > 0) resolve(img);
  });
}

/** Decode a `data:...;base64,...` URL (from `canvas.toDataURL`) back to bytes. */
export function decodeDataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("toDataURL returned malformed data URL");
  const payload = dataUrl.slice(comma + 1);
  const decoded = Application.base64Decode(payload);
  if (typeof decoded === "string") {
    const buf = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) buf[i] = decoded.charCodeAt(i);
    return buf.buffer;
  }
  return decoded;
}

/**
 * Reassemble a tile-scrambled image.
 *
 * The image is divided into a `cols × rows` grid of equal tiles (tile size is
 * `floor(W/cols) × floor(H/rows)`; any right/bottom remainder is left as-is).
 * `lookup[i]` is the SOURCE tile index whose pixels belong in DESTINATION tile
 * `i` (row-major). i.e. `clean[i] = scrambled[lookup[i]]`.
 *
 * Returns the re-encoded image bytes in `mimeType`.
 */
export async function remapTilesByLookup(
  data: ArrayBuffer,
  mimeType: string,
  cols: number,
  rows: number,
  lookup: number[],
): Promise<ArrayBuffer> {
  if (cols <= 0 || rows <= 0 || lookup.length !== cols * rows) {
    return data;
  }

  const src = await loadImageFromBuffer(data, mimeType);
  const width = src.naturalWidth || src.width;
  const height = src.naturalHeight || src.height;
  if (!width || !height) return data;

  const tw = (width / cols) | 0;
  const th = (height / rows) | 0;
  if (tw === 0 || th === 0) return data;

  const canvas = new HTMLCanvasElement();
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return data;
  ctx.drawImage(src, 0, 0, width, height);

  const stride = width * 4;
  // getImageData is Y-up: flip rows to standard Y-down for the remap.
  const srcYup = ctx.getImageData(0, 0, width, height).data;
  const srcStd = new Uint8ClampedArray(srcYup.length);
  for (let y = 0; y < height; y++) {
    srcStd.set(
      srcYup.subarray(y * stride, (y + 1) * stride),
      (height - 1 - y) * stride,
    );
  }
  // Pre-copy so the untouched right/bottom margin survives the tile blits.
  const dstStd = new Uint8ClampedArray(srcStd);

  const rowBytes = tw * 4;
  for (let i = 0; i < lookup.length; i++) {
    const dstRow = (i / cols) | 0;
    const dstCol = i % cols;
    const srcIdx = lookup[i] ?? i;
    const srcRow = (srcIdx / cols) | 0;
    const srcCol = srcIdx % cols;
    for (let y = 0; y < th; y++) {
      const srcOff = ((srcRow * th + y) * width + srcCol * tw) * 4;
      const dstOff = ((dstRow * th + y) * width + dstCol * tw) * 4;
      dstStd.set(srcStd.subarray(srcOff, srcOff + rowBytes), dstOff);
    }
  }

  // Flip back to Y-up before handing pixels to putImageData.
  const dstYup = new Uint8ClampedArray(dstStd.length);
  for (let y = 0; y < height; y++) {
    dstYup.set(
      dstStd.subarray(y * stride, (y + 1) * stride),
      (height - 1 - y) * stride,
    );
  }
  ctx.putImageData(new ImageData(dstYup, width, height), 0, 0);

  return decodeDataUrlToArrayBuffer(canvas.toDataURL(mimeType));
}
