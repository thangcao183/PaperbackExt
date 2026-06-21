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
 * Descramble a Mangago-style grid-scrambled image.
 *
 * 1:1 port of the keiyoushi/Aidoku algorithm: the page is a `cols × cols`
 * grid; SOURCE cell `idx` belongs at DESTINATION cell `keyArr[idx]`. We copy
 * each source cell rectangle to its destination with 9-arg `drawImage`, which
 * operates in image coordinates — so (unlike getImageData/putImageData) there
 * is NO Y-up/Y-down flip to worry about, and it matches the reference exactly.
 *
 * `keyArr` is the integer list from the per-image descrambling key (the site's
 * `key.split("a")`). Returns the re-encoded image bytes; on any problem the
 * original bytes are returned.
 */
export async function descrambleMangago(
  data: ArrayBuffer,
  mimeType: string,
  keyArr: number[],
  cols: number,
): Promise<ArrayBuffer> {
  if (cols <= 0) return data;
  const tileCount = cols * cols;
  if (keyArr.length < tileCount - 1) return data;

  const src = await loadImageFromBuffer(data, mimeType);
  const width = src.naturalWidth || src.width;
  const height = src.naturalHeight || src.height;
  if (!width || !height) return data;

  const uw = (width / cols) | 0;
  const uh = (height / cols) | 0;
  if (uw === 0 || uh === 0) return data;

  const canvas = new HTMLCanvasElement();
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return data;

  // Draw the full scrambled image first so any right/bottom remainder
  // outside the cols×cols grid survives untouched (matches the reference).
  ctx.drawImage(src, 0, 0, width, height);

  for (let idx = 0; idx < tileCount; idx++) {
    let keyval = keyArr[idx] ?? 0;
    if (!Number.isFinite(keyval) || keyval < 0 || keyval >= tileCount) {
      keyval = idx;
    }
    const sy = ((idx / cols) | 0) * uh;
    const sx = (idx % cols) * uw;
    const dy = ((keyval / cols) | 0) * uh;
    const dx = (keyval % cols) * uw;
    // source cell idx -> destination cell keyval
    ctx.drawImage(src, sx, sy, uw, uh, dx, dy, uw, uh);
  }

  return decodeDataUrlToArrayBuffer(canvas.toDataURL(mimeType));
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

/**
 * Descramble a VIZ (viz.com) page image.
 *
 * Faithful in-process port of VizImageInterceptor.kt. The scramble is NOT a
 * simple equal-tile grid: the served JPEG is laid out as a `10 × 15` cell grid
 * with a 10px gutter between every cell, and the descrambled output is a
 * cropped `newWidth × newHeight` image with NO gutters. Four straight border
 * copies frame the page; the inner `8 × 13` region is remapped cell-by-cell
 * from source index `m` to destination index `key[m]`.
 *
 * `key` is the integer list parsed from the EXIF ImageUniqueID tag, and
 * `metaW`/`metaH` are the EXIF PixelX/Y dimensions used as a floor for the
 * crop. Returns null on any failure so the caller can fall back to raw bytes.
 */
export async function descrambleViz(
  data: ArrayBuffer,
  mimeType: string,
  key: number[],
  metaW: number,
  metaH: number,
): Promise<ArrayBuffer | null> {
  const CELL_WIDTH_COUNT = 10;
  const CELL_HEIGHT_COUNT = 15;
  const INNER_CELL_COUNT = CELL_WIDTH_COUNT - 2; // 8
  const WIDTH_CUT = 90;
  const HEIGHT_CUT = 140;
  const GUTTER = 10;

  const src = await loadImageFromBuffer(data, mimeType);
  const width = src.naturalWidth || src.width;
  const height = src.naturalHeight || src.height;
  if (!width || !height) return null;

  const newWidth = Math.max(width - WIDTH_CUT, metaW);
  const newHeight = Math.max(height - HEIGHT_CUT, metaH);
  if (newWidth <= 0 || newHeight <= 0) return null;
  const blockWidth = Math.floor(newWidth / CELL_WIDTH_COUNT);
  const blockHeight = Math.floor(newHeight / CELL_HEIGHT_COUNT);
  if (blockWidth <= 0 || blockHeight <= 0) return null;

  // Decode the full scrambled source into a Y-down RGBA buffer.
  const srcCanvas = new HTMLCanvasElement();
  srcCanvas.width = width;
  srcCanvas.height = height;
  const srcCtx = srcCanvas.getContext("2d");
  if (!srcCtx) return null;
  srcCtx.drawImage(src, 0, 0, width, height);

  const srcStride = width * 4;
  const srcYup = srcCtx.getImageData(0, 0, width, height).data;
  const srcStd = new Uint8ClampedArray(srcYup.length);
  for (let y = 0; y < height; y++) {
    srcStd.set(
      srcYup.subarray(y * srcStride, (y + 1) * srcStride),
      (height - 1 - y) * srcStride,
    );
  }

  // Destination Y-down RGBA buffer (cropped reassembled image).
  const dstStride = newWidth * 4;
  const dstStd = new Uint8ClampedArray(newHeight * dstStride);

  // Copy a `w × h` rectangle from the source buffer at (sx, sy) to the
  // destination buffer at (dx, dy). Clipped to both buffers; pure blit, no
  // scaling (mirrors Canvas.drawBitmap with equal-size src/dst rects).
  const blit = (
    sx: number,
    sy: number,
    dx: number,
    dy: number,
    w: number,
    h: number,
  ): void => {
    if (w <= 0 || h <= 0) return;
    for (let row = 0; row < h; row++) {
      const ssy = sy + row;
      const ddy = dy + row;
      if (ssy < 0 || ssy >= height || ddy < 0 || ddy >= newHeight) continue;
      let copyW = w;
      if (sx + copyW > width) copyW = width - sx;
      if (dx + copyW > newWidth) copyW = newWidth - dx;
      if (sx < 0 || dx < 0 || copyW <= 0) continue;
      const sOff = (ssy * width + sx) * 4;
      const dOff = (ddy * newWidth + dx) * 4;
      dstStd.set(srcStd.subarray(sOff, sOff + copyW * 4), dOff);
    }
  };

  // Top border.
  blit(0, 0, 0, 0, newWidth, blockHeight);
  // Left border.
  blit(
    0,
    blockHeight + GUTTER,
    0,
    blockHeight,
    blockWidth,
    newHeight - 2 * blockHeight,
  );
  // Bottom border.
  blit(
    0,
    (CELL_HEIGHT_COUNT - 1) * (blockHeight + GUTTER),
    0,
    (CELL_HEIGHT_COUNT - 1) * blockHeight,
    newWidth,
    height - (CELL_HEIGHT_COUNT - 1) * (blockHeight + GUTTER),
  );
  // Right border.
  blit(
    (CELL_WIDTH_COUNT - 1) * (blockWidth + GUTTER),
    blockHeight + GUTTER,
    (CELL_WIDTH_COUNT - 1) * blockWidth,
    blockHeight,
    blockWidth + (newWidth - CELL_WIDTH_COUNT * blockWidth),
    newHeight - 2 * blockHeight,
  );

  // Inner cells: source cell m -> destination cell key[m].
  for (let m = 0; m < key.length; m++) {
    const y = key[m];
    blit(
      ((m % INNER_CELL_COUNT) + 1) * (blockWidth + GUTTER),
      (Math.floor(m / INNER_CELL_COUNT) + 1) * (blockHeight + GUTTER),
      ((y % INNER_CELL_COUNT) + 1) * blockWidth,
      (Math.floor(y / INNER_CELL_COUNT) + 1) * blockHeight,
      blockWidth,
      blockHeight,
    );
  }

  // Flip back to Y-up before putImageData.
  const dstYup = new Uint8ClampedArray(dstStd.length);
  for (let y = 0; y < newHeight; y++) {
    dstYup.set(
      dstStd.subarray(y * dstStride, (y + 1) * dstStride),
      (newHeight - 1 - y) * dstStride,
    );
  }

  const outCanvas = new HTMLCanvasElement();
  outCanvas.width = newWidth;
  outCanvas.height = newHeight;
  const outCtx = outCanvas.getContext("2d");
  if (!outCtx) return null;
  outCtx.putImageData(new ImageData(dstYup, newWidth, newHeight), 0, 0);

  return decodeDataUrlToArrayBuffer(outCanvas.toDataURL(mimeType));
}

/**
 * Reassemble a K Manga page image.
 *
 * Unlike a plain equal-tile grid, K Manga shuffles a **4×4** grid of cells
 * that covers only the TOP-LEFT region of the image. The cell size is the
 * upstream block math (ImageInterceptor.kt), NOT `floor(W/4)`:
 *   blockWidth  = floor(floor(W / 8) * 8 / 4)
 *   blockHeight = floor(floor(H / 8) * 8 / 4)
 * The right/bottom remainder outside the `4*blockWidth × 4*blockHeight`
 * region is passed through unchanged.
 *
 * `sourceOrder[i]` is the SOURCE cell index (0..15, row-major over the 4×4
 * grid) whose pixels belong in DESTINATION cell `i`, i.e.
 * `clean[i] = scrambled[sourceOrder[i]]`.
 *
 * Returns the re-encoded image bytes in `mimeType`.
 */
export async function remapKMangaCells(
  data: ArrayBuffer,
  mimeType: string,
  sourceOrder: number[],
): Promise<ArrayBuffer> {
  if (sourceOrder.length !== 16) return data;

  const src = await loadImageFromBuffer(data, mimeType);
  const width = src.naturalWidth || src.width;
  const height = src.naturalHeight || src.height;
  if (!width || !height) return data;

  // Exact upstream block geometry (integer division at each step).
  const blockWidth = ((((width / 8) | 0) * 8) / 4) | 0;
  const blockHeight = ((((height / 8) | 0) * 8) / 4) | 0;
  if (blockWidth <= 0 || blockHeight <= 0) return data;

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
  // Pre-copy so the untouched right/bottom remainder survives the cell blits.
  const dstStd = new Uint8ClampedArray(srcStd);

  const rowBytes = blockWidth * 4;
  for (let i = 0; i < 16; i++) {
    const srcIdx = sourceOrder[i] ?? i;
    const srcCol = srcIdx % 4;
    const srcRow = (srcIdx / 4) | 0;
    const dstCol = i % 4;
    const dstRow = (i / 4) | 0;
    for (let y = 0; y < blockHeight; y++) {
      const srcOff = ((srcRow * blockHeight + y) * width + srcCol * blockWidth) * 4;
      const dstOff = ((dstRow * blockHeight + y) * width + dstCol * blockWidth) * 4;
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
