/*
 * Shared image-descrambling helpers for Paperback v0.9.
 *
 * Paperback's runtime polyfills `Image`, `HTMLCanvasElement` and `ImageData`
 * as direct in-process constructors, so descrambling runs straight inside a
 * source's `interceptResponse` — NO `Application.executeInWebView` round-trip
 * is needed (that path is slow and flaky per image, and was the reason
 * scrambled pages sometimes fell through undecoded).
 *
 * Platform notes:
 *   - `Blob` / `URL` / `OffscreenCanvas` are NOT polyfilled, so raw bytes
 *     cross the boundary as `data:` URLs (base64).
 *   - The helpers below use 9-arg `drawImage(src, sx,sy,sw,sh, dx,dy,dw,dh)`,
 *     mirroring the keiyoushi (`drawBitmap`) and Aidoku (`draw_image_rect`)
 *     reference algorithms. We deliberately avoid `getImageData`/`putImageData`:
 *     their Y-axis origin in the polyfill is unreliable, and an unneeded Y-flip
 *     silently re-scrambles the output (this was the original Mangago bug).
 *
 *   - !!! VERIFIED POLYFILL CAVEAT (Comix, 2026-06) !!!
 *     The 9-arg `drawImage` source-crop is NOT reliable in this polyfill — the
 *     `sx,sy,sw,sh` source sub-rectangle can be IGNORED, redrawing the full
 *     image per tile (a no-op remap). This was proven against a real scrambled
 *     Comix page whose permutation math was independently confirmed correct
 *     (off-device seam-continuity reconstruction reproduced the page perfectly).
 *     The robust workaround — used by `src/Comix/main.ts` — is to crop with
 *     ONLY the 4-arg `drawImage(img, x, y, w, h)` form: draw the full image into
 *     a tile-sized scratch canvas shifted by `(-srcX0, -srcY0)` so just the
 *     wanted tile lands in bounds, then draw that scratch 1:1 to the destination.
 *     The 9-arg helpers in THIS file are retained only for sources confirmed
 *     working with them (e.g. Mangago); prefer the 4-arg scratch-crop technique
 *     for any new tile remap.
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
 * Returns the re-encoded image bytes in `outputMimeType` (defaults to
 * `mimeType`). The source bytes are decoded with `mimeType`, so it must reflect
 * the ACTUAL image format of `data` (e.g. "image/webp"); a wrong MIME can make
 * the polyfilled decoder yield zero dimensions and silently pass the scrambled
 * bytes straight through.
 */
export async function remapTilesByLookup(
  data: ArrayBuffer,
  mimeType: string,
  cols: number,
  rows: number,
  lookup: number[],
  outputMimeType: string = mimeType,
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
  // Draw the full image first so the right/bottom remainder survives, then
  // copy each source tile to its destination with 9-arg drawImage (image
  // coordinates — no getImageData/Y-flip, matching the reference algorithms).
  ctx.drawImage(src, 0, 0, width, height);
  for (let i = 0; i < lookup.length; i++) {
    const dstRow = (i / cols) | 0;
    const dstCol = i % cols;
    const srcIdx = lookup[i] ?? i;
    const srcRow = (srcIdx / cols) | 0;
    const srcCol = srcIdx % cols;
    ctx.drawImage(
      src,
      srcCol * tw,
      srcRow * th,
      tw,
      th,
      dstCol * tw,
      dstRow * th,
      tw,
      th,
    );
  }

  return decodeDataUrlToArrayBuffer(canvas.toDataURL(outputMimeType));
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

  // Reassemble onto a cropped newWidth × newHeight output canvas using 9-arg
  // drawImage rect copies (image coordinates — no getImageData/Y-flip).
  const outCanvas = new HTMLCanvasElement();
  outCanvas.width = newWidth;
  outCanvas.height = newHeight;
  const outCtx = outCanvas.getContext("2d");
  if (!outCtx) return null;

  // Copy a `w × h` rectangle from the source image at (sx, sy) to the output
  // canvas at (dx, dy). Clamps to both source and destination bounds and keeps
  // equal src/dst size (no scaling, mirrors Canvas.drawBitmap).
  const blit = (
    sx: number,
    sy: number,
    dx: number,
    dy: number,
    w: number,
    h: number,
  ): void => {
    let cw = w;
    let ch = h;
    if (sx + cw > width) cw = width - sx;
    if (dx + cw > newWidth) cw = newWidth - dx;
    if (sy + ch > height) ch = height - sy;
    if (dy + ch > newHeight) ch = newHeight - dy;
    if (sx < 0 || sy < 0 || dx < 0 || dy < 0 || cw <= 0 || ch <= 0) return;
    outCtx.drawImage(src, sx, sy, cw, ch, dx, dy, cw, ch);
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
  // Full image first (remainder + region outside the 4×4 grid), then remap
  // each cell with 9-arg drawImage (no getImageData/Y-flip).
  ctx.drawImage(src, 0, 0, width, height);
  for (let i = 0; i < 16; i++) {
    const srcIdx = sourceOrder[i] ?? i;
    const srcCol = srcIdx % 4;
    const srcRow = (srcIdx / 4) | 0;
    const dstCol = i % 4;
    const dstRow = (i / 4) | 0;
    ctx.drawImage(
      src,
      srcCol * blockWidth,
      srcRow * blockHeight,
      blockWidth,
      blockHeight,
      dstCol * blockWidth,
      dstRow * blockHeight,
      blockWidth,
      blockHeight,
    );
  }

  return decodeDataUrlToArrayBuffer(canvas.toDataURL(mimeType));
}
