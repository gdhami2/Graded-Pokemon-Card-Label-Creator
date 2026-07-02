const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const previewWrap = document.getElementById('preview-wrap');
const preview = document.getElementById('preview');
const filename = document.getElementById('filename');
const clearBtn = document.getElementById('clearBtn');
const downloadBtn = document.getElementById('downloadBtn');
const downloadPdfBtn = document.getElementById('downloadPdfBtn');
const watermarkRow = document.getElementById('watermarkRow');
const watermarkSlider = document.getElementById('watermarkSlider');
const watermarkValue = document.getElementById('watermarkValue');
const setNameInput = document.getElementById('setName');
const setNameColorInput = document.getElementById('setNameColor');
const setNameOutlineInput = document.getElementById('setNameOutline');
const cardNameInput = document.getElementById('cardName');
const cardNameColorInput = document.getElementById('cardNameColor');
const cardNameOutlineInput = document.getElementById('cardNameOutline');
const cardTypeInput = document.getElementById('cardType');
const cardTypeColorInput = document.getElementById('cardTypeColor');
const cardTypeOutlineInput = document.getElementById('cardTypeOutline');
const cardNumberInput = document.getElementById('cardNumber');
const cardNumberColorInput = document.getElementById('cardNumberColor');
const cardNumberOutlineInput = document.getElementById('cardNumberOutline');

const TEXT_FIELD_INPUTS = [
  setNameInput, setNameColorInput, setNameOutlineInput,
  cardNameInput, cardNameColorInput, cardNameOutlineInput,
  cardTypeInput, cardTypeColorInput, cardTypeOutlineInput,
  cardNumberInput, cardNumberColorInput, cardNumberOutlineInput,
];

const DEFAULT_WATERMARK_STRENGTH = 100;

let currentImage = null;
let currentFileName = 'image';
let outputDataUrl = null;
let outputName = 'image.png';
let downloadUrl = null;
let outputPdfName = 'image.pdf';
let downloadPdfUrl = null;

// Alpha-composite correction profile from watermark-profile.png: RGB
// channels hold the estimated watermark color at each pixel, and the alpha
// channel holds the estimated blend strength (0-255) at that pixel.
let watermarkProfile = null;

watermarkSlider.value = DEFAULT_WATERMARK_STRENGTH;
watermarkValue.textContent = DEFAULT_WATERMARK_STRENGTH;

(function loadWatermarkProfile() {
  const img = new Image();
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = TARGET_W;
      canvas.height = TARGET_H;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, TARGET_W, TARGET_H);
      const data = ctx.getImageData(0, 0, TARGET_W, TARGET_H).data;

      // A profile from the old delta-only calibrator has no real alpha
      // channel (every pixel opaque at 255), which the new blend-inversion
      // math would misread as "fully replace every pixel" — refuse to load
      // it instead of corrupting every image.
      let minAlpha = 255;
      for (let p = 3; p < data.length; p += 4) {
        if (data[p] < minAlpha) minAlpha = data[p];
      }
      if (minAlpha > 250) {
        console.warn('watermark-profile.png looks like it came from an older version of calibrate.html. Please regenerate it via calibrate.html before using watermark removal.');
        return;
      }

      watermarkProfile = data;
      watermarkRow.style.display = 'block';
    } catch (err) {
      // Some browsers block canvas pixel readback for local file:// pages.
      // Serving this folder over http (e.g. VS Code's Live Server) fixes it.
      console.warn('Could not read watermark-profile.png pixels:', err);
    }
  };
  // No profile yet (calibration hasn't been run) — silently skip.
  img.onerror = () => {};
  img.src = WATERMARK_PROFILE_URL;
})();

function applyWatermarkCorrection(imageData, strengthPercent) {
  if (!watermarkProfile || strengthPercent === 0) return;

  const strength = strengthPercent / 100;
  const data = imageData.data;
  for (let p = 0; p < data.length; p += 4) {
    let a = (watermarkProfile[p + 3] / 255) * strength;
    if (a <= 0) continue;
    a = Math.min(a, MAX_WATERMARK_ALPHA);

    const wr = watermarkProfile[p];
    const wg = watermarkProfile[p + 1];
    const wb = watermarkProfile[p + 2];
    const inv = 1 / (1 - a);

    data[p] = Math.max(0, Math.min(255, (data[p] - a * wr) * inv));
    data[p + 1] = Math.max(0, Math.min(255, (data[p + 1] - a * wg) * inv));
    data[p + 2] = Math.max(0, Math.min(255, (data[p + 2] - a * wb) * inv));
  }
}

// Font sizes/margins are defined in mm and converted to px via the label's
// actual DPI, so they stay physically correct if the target size/DPI ever
// changes again (hardcoded pixel values silently went stale — and the text
// rendered at half its intended physical size — the last time DPI doubled).
const MM_TO_PX = LABEL_DPI / 25.4;
function mm(value) {
  return value * MM_TO_PX;
}

// Print trim tolerance: keep all label text at least this far from every
// edge (satisfies both "2-3mm safe margin for trimming" and "important text
// at least 1.5-2mm from the edge").
const SAFE_MARGIN_MM = 2;
const SAFE_MARGIN_PX = mm(SAFE_MARGIN_MM);
const LABEL_MARGIN_X = SAFE_MARGIN_PX;
const LABEL_FONT_STACK = '"Fredoka", Arial, sans-serif';

// Canvas text doesn't trigger a webfont download the way DOM text does, and
// drawing before it's loaded silently falls back to the next font in the
// stack. Explicitly load it, then re-render once it's actually available.
document.fonts.load(`700 100px ${LABEL_FONT_STACK}`).then(() => {
  if (currentImage) processImage(Number(watermarkSlider.value));
}).catch(() => {
  // Offline or blocked — the Arial/sans-serif fallback in LABEL_FONT_STACK still renders fine.
});

// Shrinks the font until the text fits the available width, so long card
// names don't run off the edge of the label.
function fitFontSize(ctx, text, maxSize, minSize, maxWidth) {
  let size = maxSize;
  while (size > minSize) {
    ctx.font = `bold ${size}px ${LABEL_FONT_STACK}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  return size;
}

function drawTextLine(ctx, text, y, maxSize, minSize, maxWidth, textColor, outlineColor, lineWidth) {
  if (!text) return 0;

  const size = fitFontSize(ctx, text, maxSize, minSize, maxWidth);
  ctx.font = `bold ${size}px ${LABEL_FONT_STACK}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = outlineColor;
  ctx.fillStyle = textColor;
  ctx.strokeText(text, LABEL_MARGIN_X, y);
  ctx.fillText(text, LABEL_MARGIN_X, y);

  return size;
}

// Set name, card type, and card number all share one size; card name is
// scaled up as the label's focal point. The shared size is solved from the
// usable vertical band (label height minus top/bottom safe margins) so all
// four lines are as large as they can be while still fitting inside it —
// tied to LABEL_HEIGHT_MM/SAFE_MARGIN_MM so it stays correct (and maximal)
// if the label's physical size ever changes again.
const USABLE_HEIGHT_MM = LABEL_HEIGHT_MM - 2 * SAFE_MARGIN_MM;
const CARD_NAME_SCALE = 1.4; // how much bigger the card name is than the other three lines
const GAP_SCALE = 0.3; // line gap as a fraction of the base font size
const SIZE_BUFFER = 0.95; // leave a little headroom for glyph overshoot beyond the nominal font size
const BASE_FONT_MM = (USABLE_HEIGHT_MM * SIZE_BUFFER) / (3 + CARD_NAME_SCALE + 3 * GAP_SCALE);
const CARD_NAME_FONT_MM = BASE_FONT_MM * CARD_NAME_SCALE;
const LINE_GAP_MM = BASE_FONT_MM * GAP_SCALE;

function drawLabelText(ctx, width, height) {
  const maxWidth = width - LABEL_MARGIN_X * 2;

  const baseSize = mm(BASE_FONT_MM);
  const cardNameSize = mm(CARD_NAME_FONT_MM);
  const lineGap = mm(LINE_GAP_MM);

  const lines = [
    { text: setNameInput.value.trim(), maxSize: baseSize, minSize: baseSize * 0.5, color: setNameColorInput.value, outline: setNameOutlineInput.value, lineWidth: baseSize * 0.15, lineGap },
    { text: cardNameInput.value.trim(), maxSize: cardNameSize, minSize: cardNameSize * 0.5, color: cardNameColorInput.value, outline: cardNameOutlineInput.value, lineWidth: cardNameSize * 0.15, lineGap },
    { text: cardTypeInput.value.trim(), maxSize: baseSize, minSize: baseSize * 0.5, color: cardTypeColorInput.value, outline: cardTypeOutlineInput.value, lineWidth: baseSize * 0.15, lineGap },
    { text: cardNumberInput.value.trim(), maxSize: baseSize, minSize: baseSize * 0.5, color: cardNumberColorInput.value, outline: cardNumberOutlineInput.value, lineWidth: baseSize * 0.15, lineGap },
  ];

  let y = null;
  lines.forEach((line) => {
    if (!line.text) return;
    if (y === null) {
      // First visible line: measure its actual rendered ascent so its top
      // sits exactly at the top safe margin, rather than guessing an offset.
      const size = fitFontSize(ctx, line.text, line.maxSize, line.minSize, maxWidth);
      ctx.font = `bold ${size}px ${LABEL_FONT_STACK}`;
      const ascent = ctx.measureText(line.text).actualBoundingBoxAscent || size * 0.75;
      y = SAFE_MARGIN_PX + ascent;
    }
    const size = drawTextLine(ctx, line.text, y, line.maxSize, line.minSize, maxWidth, line.color, line.outline, line.lineWidth);
    y += size + line.lineGap;
  });
}

// Pixel dimensions alone don't tell a printer the physical size to print
// at — "print actual size" falls back to a default (often 96 DPI) unless the
// file itself declares its DPI via PNG's pHYs chunk, which canvas.toDataURL
// never writes. Without this, a correctly-sized-in-pixels label still prints
// far too big. CRC-32 (IEEE 802.3) is required to make the injected chunk
// valid per the PNG spec.
let crc32Table = null;
function crc32(bytes) {
  if (!crc32Table) {
    crc32Table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      crc32Table[n] = c;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = crc32Table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildPngChunk(type, data) {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

// Inserts a pHYs chunk (physical pixel density) right after the mandatory
// IHDR chunk, which is always exactly 33 bytes (8-byte signature + 25-byte
// IHDR chunk) at the start of every PNG.
function withPngDpi(dataUrl, dpi) {
  const binary = atob(dataUrl.split(',')[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const pixelsPerMeter = Math.round(dpi / 0.0254);
  const physData = new Uint8Array(9);
  const physView = new DataView(physData.buffer);
  physView.setUint32(0, pixelsPerMeter);
  physView.setUint32(4, pixelsPerMeter);
  physData[8] = 1; // unit specifier: 1 = meters
  const physChunk = buildPngChunk('pHYs', physData);

  const IHDR_END = 33;
  const out = new Uint8Array(bytes.length + physChunk.length);
  out.set(bytes.subarray(0, IHDR_END), 0);
  out.set(physChunk, IHDR_END);
  out.set(bytes.subarray(IHDR_END), IHDR_END + physChunk.length);
  return out;
}

// Even correct DPI metadata only helps if the software printing the file
// actually reads it — browsers and many consumer photo viewers don't, and
// just map image pixels 1:1 to 96 CSS px, regardless of embedded DPI. A PDF
// sidesteps that entirely: its page size is an explicit physical dimension
// (in points) that any print pipeline must honor, not a metadata hint.
function textToBytes(str) {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
  return bytes;
}

function concatBytes(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

// Builds a minimal single-page PDF with the canvas embedded as an
// uncompressed RGB image XObject (no lossy re-encoding), scaled via the
// content stream's transform matrix to exactly fill a MediaBox sized to the
// label's real physical dimensions.
function buildLabelPdf(canvas, widthMm, heightMm) {
  const w = canvas.width;
  const h = canvas.height;
  const rgba = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i];
    rgb[j + 1] = rgba[i + 1];
    rgb[j + 2] = rgba[i + 2];
  }

  const PT_PER_MM = 72 / 25.4;
  const pageW = (widthMm * PT_PER_MM).toFixed(3);
  const pageH = (heightMm * PT_PER_MM).toFixed(3);

  const objects = [
    textToBytes('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'),
    textToBytes('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'),
    textToBytes(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`),
    concatBytes([
      textToBytes(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${rgb.length} >>\nstream\n`),
      rgb,
      textToBytes('\nendstream\nendobj\n'),
    ]),
  ];
  const content = textToBytes(`q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`);
  objects.push(concatBytes([
    textToBytes(`5 0 obj\n<< /Length ${content.length} >>\nstream\n`),
    content,
    textToBytes('\nendstream\nendobj\n'),
  ]));

  const header = textToBytes('%PDF-1.4\n');
  let offset = header.length;
  const objectOffsets = [];
  for (const obj of objects) {
    objectOffsets.push(offset);
    offset += obj.length;
  }
  const xrefOffset = offset;

  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const objOffset of objectOffsets) {
    xref += String(objOffset).padStart(10, '0') + ' 00000 n \n';
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return concatBytes([header, ...objects, textToBytes(xref), textToBytes(trailer)]);
}

function processImage(watermarkStrength) {
  if (!currentImage) return;

  const canvas = document.createElement('canvas');
  canvas.width = TARGET_W;
  canvas.height = TARGET_H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(currentImage, 0, 0, TARGET_W, TARGET_H);

  const imageData = ctx.getImageData(0, 0, TARGET_W, TARGET_H);
  applyWatermarkCorrection(imageData, watermarkStrength);
  ctx.putImageData(imageData, 0, 0);

  drawLabelText(ctx, TARGET_W, TARGET_H);

  outputDataUrl = canvas.toDataURL('image/png');
  outputName = `${currentFileName}-${LABEL_WIDTH_MM}x${LABEL_HEIGHT_MM}mm.png`;
  preview.src = outputDataUrl;

  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  const pngBytes = withPngDpi(outputDataUrl, LABEL_DPI);
  downloadUrl = URL.createObjectURL(new Blob([pngBytes], { type: 'image/png' }));

  outputPdfName = `${currentFileName}-${LABEL_WIDTH_MM}x${LABEL_HEIGHT_MM}mm.pdf`;
  if (downloadPdfUrl) URL.revokeObjectURL(downloadPdfUrl);
  const pdfBytes = buildLabelPdf(canvas, LABEL_WIDTH_MM, LABEL_HEIGHT_MM);
  downloadPdfUrl = URL.createObjectURL(new Blob([pdfBytes], { type: 'application/pdf' }));
}

function showFile(file) {
  if (!file || !file.type.startsWith('image/')) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      currentImage = img;
      currentFileName = file.name.replace(/\.[^.]+$/, '');

      processImage(Number(watermarkSlider.value));

      filename.textContent = file.name;
      previewWrap.classList.add('visible');
      dropzone.style.display = 'none';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

dropzone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  showFile(fileInput.files[0]);
});

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('dragover');
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  showFile(file);
});

watermarkSlider.addEventListener('input', () => {
  watermarkValue.textContent = watermarkSlider.value;
  processImage(Number(watermarkSlider.value));
});

TEXT_FIELD_INPUTS.forEach((el) => {
  el.addEventListener('input', () => processImage(Number(watermarkSlider.value)));
});

clearBtn.addEventListener('click', () => {
  fileInput.value = '';
  preview.src = '';
  currentImage = null;
  outputDataUrl = null;
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = null;
  if (downloadPdfUrl) URL.revokeObjectURL(downloadPdfUrl);
  downloadPdfUrl = null;
  setNameInput.value = '';
  cardNameInput.value = '';
  cardTypeInput.value = '';
  cardNumberInput.value = '';
  previewWrap.classList.remove('visible');
  dropzone.style.display = 'block';
});

downloadBtn.addEventListener('click', () => {
  if (!downloadUrl) return;
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = outputName;
  document.body.appendChild(a);
  a.click();
  a.remove();
});

downloadPdfBtn.addEventListener('click', () => {
  if (!downloadPdfUrl) return;
  const a = document.createElement('a');
  a.href = downloadPdfUrl;
  a.download = outputPdfName;
  document.body.appendChild(a);
  a.click();
  a.remove();
});
