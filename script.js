const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const previewWrap = document.getElementById('preview-wrap');
const preview = document.getElementById('preview');
const filename = document.getElementById('filename');
const clearBtn = document.getElementById('clearBtn');
const downloadBtn = document.getElementById('downloadBtn');
const downloadPdfBtn = document.getElementById('downloadPdfBtn');

const spriteControls = document.getElementById('spriteControls');
const spriteScaleInput = document.getElementById('spriteScale');
const spriteScaleValue = document.getElementById('spriteScaleValue');
const spriteOffsetXInput = document.getElementById('spriteOffsetX');
const spriteOffsetYInput = document.getElementById('spriteOffsetY');
const mirrorSpriteInput = document.getElementById('mirrorSprite');

const borderColorInput = document.getElementById('borderColor');
const bgTypeSelect = document.getElementById('bgType');
const bgColor1Input = document.getElementById('bgColor1');
const bgColor2Input = document.getElementById('bgColor2');
const bgColor2Row = document.getElementById('bgColor2Row');

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

let currentSprite = null; // background-removed sprite, cached as an offscreen canvas
let currentFileName = 'label';
let outputDataUrl = null;
let outputName = 'label.png';
let downloadUrl = null;
let outputPdfName = 'label.pdf';
let downloadPdfUrl = null;

// Font sizes/margins are defined in mm and converted to px via the label's
// actual DPI, so they stay physically correct if the target size/DPI ever
// changes again (hardcoded pixel values silently went stale — and the text
// rendered at half its intended physical size — the last time DPI doubled).
const MM_TO_PX = LABEL_DPI / 25.4;
function mm(value) {
  return value * MM_TO_PX;
}

// Print trim tolerance: keep all label content at least this far from every
// edge (satisfies both "2-3mm safe margin for trimming" and "important text
// at least 1.5-2mm from the edge").
const SAFE_MARGIN_MM = 2;
const SAFE_MARGIN_PX = mm(SAFE_MARGIN_MM);
const LABEL_MARGIN_X = SAFE_MARGIN_PX;
const LABEL_FONT_STACK = '"Fredoka", Arial, sans-serif';

const BORDER_WIDTH_MM = 1.1;
const SPRITE_TEXT_GAP_MM = 2;

// The sprite box's width isn't tied to its height (which is already maxed
// out against the label's safe margins) — it gets its own generous share of
// the label's width instead of being forced into a square, so wide sprites
// (and the sprite in general) get as much room as possible while still
// leaving the text column usable.
const SPRITE_BOX_WIDTH_FRACTION = 0.35;

// Canvas text doesn't trigger a webfont download the way DOM text does, and
// drawing before it's loaded silently falls back to the next font in the
// stack. Explicitly load it, then re-render once it's actually available.
document.fonts.load(`700 100px ${LABEL_FONT_STACK}`).then(() => {
  processImage();
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

// maxWidth is the text column's available width — narrower than the full
// label width since the sprite box now occupies the right side.
function drawLabelText(ctx, maxWidth) {
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

// A faint diagonal hairline pattern (a printed-foil look), drawn by rotating
// the canvas and stroking evenly spaced lines — canvas has no equivalent of
// CSS's repeating-linear-gradient, so this is done as literal strokes.
function drawFoilPattern(ctx, width, height, color) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();

  ctx.translate(width / 2, height / 2);
  ctx.rotate(Math.PI / 4);

  const diagonal = Math.sqrt(width * width + height * height);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.08;
  ctx.lineWidth = mm(0.15);

  const spacing = mm(1.3);
  for (let x = -diagonal; x <= diagonal; x += spacing) {
    ctx.beginPath();
    ctx.moveTo(x, -diagonal);
    ctx.lineTo(x, diagonal);
    ctx.stroke();
  }
  ctx.restore();
}

// Radiating rays from center — the classic Pokemon "Rare Holo" card look.
function drawStarburstPattern(ctx, width, height, color) {
  const cx = width / 2;
  const cy = height / 2;
  const maxR = Math.sqrt(cx * cx + cy * cy) * 1.2;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();

  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.12;
  ctx.lineWidth = mm(0.25);

  const rayCount = 56;
  for (let i = 0; i < rayCount; i++) {
    const angle = (i / rayCount) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * maxR, cy + Math.sin(angle) * maxR);
    ctx.stroke();
  }
  ctx.restore();
}

// A hard diagonal line dividing the label into two color blocks.
function drawColorSplit(ctx, width, height, color1, color2) {
  ctx.fillStyle = color1;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = color2;
  ctx.beginPath();
  ctx.moveTo(width * 0.62, 0);
  ctx.lineTo(width, 0);
  ctx.lineTo(width, height);
  ctx.lineTo(width * 0.42, height);
  ctx.closePath();
  ctx.fill();
}

// A grid of small dots — the same "printed texture" idea as the foil
// hairlines, but a halftone look instead of diagonal lines.
function drawHalftonePattern(ctx, width, height, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.14;

  const spacing = mm(1.1);
  const radius = mm(0.22);
  for (let y = spacing / 2; y < height; y += spacing) {
    for (let x = spacing / 2; x < width; x += spacing) {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawBackground(ctx, width, height) {
  const type = bgTypeSelect.value;
  const color1 = bgColor1Input.value;
  const color2 = bgColor2Input.value;

  if (type === 'gradient') {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, color1);
    gradient.addColorStop(1, color2);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  } else if (type === 'split') {
    drawColorSplit(ctx, width, height, color1, color2);
  } else {
    ctx.fillStyle = color1;
    ctx.fillRect(0, 0, width, height);
    if (type === 'pattern') {
      drawFoilPattern(ctx, width, height, '#000000');
    } else if (type === 'starburst') {
      drawStarburstPattern(ctx, width, height, color2);
    } else if (type === 'halftone') {
      drawHalftonePattern(ctx, width, height, color2);
    }
  }
}

function drawBorder(ctx, width, height) {
  const borderWidthPx = mm(BORDER_WIDTH_MM);
  ctx.save();
  ctx.strokeStyle = borderColorInput.value;
  ctx.lineWidth = borderWidthPx;
  ctx.strokeRect(borderWidthPx / 2, borderWidthPx / 2, width - borderWidthPx, height - borderWidthPx);
  ctx.restore();
}

// Scale 100% contain-fits the whole sprite in its box; higher values zoom in
// and let the box's clip cut parts away, with the offset sliders choosing
// which part stays visible. The box isn't forced to be square — it's sized
// independently in each dimension so non-square sprites (or a wide box) can
// render larger instead of being capped by whichever side is shortest.
function drawSprite(ctx, boxX, boxY, boxWidth, boxHeight) {
  if (!currentSprite) return;

  const spriteW = currentSprite.width;
  const spriteH = currentSprite.height;
  const baseScale = Math.min(boxWidth / spriteW, boxHeight / spriteH);
  const userScale = Number(spriteScaleInput.value) / 100;
  const scale = baseScale * userScale;

  const drawWidth = spriteW * scale;
  const drawHeight = spriteH * scale;

  const offsetXFrac = Number(spriteOffsetXInput.value) / 100;
  const offsetYFrac = Number(spriteOffsetYInput.value) / 100;

  const centerX = boxX + boxWidth / 2 + offsetXFrac * boxWidth;
  const centerY = boxY + boxHeight / 2 + offsetYFrac * boxHeight;

  ctx.save();
  ctx.beginPath();
  ctx.rect(boxX, boxY, boxWidth, boxHeight);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  if (mirrorSpriteInput.checked) {
    // Flip around the sprite's own center so mirroring doesn't shift its position.
    ctx.translate(centerX, 0);
    ctx.scale(-1, 1);
    ctx.translate(-centerX, 0);
  }
  ctx.drawImage(currentSprite, centerX - drawWidth / 2, centerY - drawHeight / 2, drawWidth, drawHeight);
  ctx.restore();
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

function processImage() {
  const canvas = document.createElement('canvas');
  canvas.width = TARGET_W;
  canvas.height = TARGET_H;
  const ctx = canvas.getContext('2d');

  drawBackground(ctx, TARGET_W, TARGET_H);

  const spriteBoxHeight = TARGET_H - 2 * SAFE_MARGIN_PX;
  const spriteBoxWidth = TARGET_W * SPRITE_BOX_WIDTH_FRACTION;
  const spriteBoxX = TARGET_W - SAFE_MARGIN_PX - spriteBoxWidth;
  const spriteBoxY = SAFE_MARGIN_PX;
  const textMaxWidth = spriteBoxX - mm(SPRITE_TEXT_GAP_MM) - LABEL_MARGIN_X;

  drawSprite(ctx, spriteBoxX, spriteBoxY, spriteBoxWidth, spriteBoxHeight);
  drawBorder(ctx, TARGET_W, TARGET_H);
  drawLabelText(ctx, textMaxWidth);

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

function handleSpriteFile(file) {
  if (!file || !file.type.startsWith('image/')) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      currentSprite = img;
      currentFileName = file.name.replace(/\.[^.]+$/, '');
      filename.textContent = file.name;

      spriteScaleInput.value = 100;
      spriteOffsetXInput.value = 0;
      spriteOffsetYInput.value = 0;
      spriteScaleValue.textContent = 100;
      mirrorSpriteInput.checked = false;
      spriteControls.style.display = 'block';

      processImage();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

dropzone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  handleSpriteFile(fileInput.files[0]);
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
  handleSpriteFile(e.dataTransfer.files[0]);
});

spriteScaleInput.addEventListener('input', () => {
  spriteScaleValue.textContent = spriteScaleInput.value;
  processImage();
});
spriteOffsetXInput.addEventListener('input', () => processImage());
spriteOffsetYInput.addEventListener('input', () => processImage());
mirrorSpriteInput.addEventListener('change', () => processImage());

borderColorInput.addEventListener('input', () => processImage());

const BG_TYPES_USING_COLOR2 = ['gradient', 'starburst', 'split', 'halftone'];
bgTypeSelect.addEventListener('change', () => {
  bgColor2Row.style.display = BG_TYPES_USING_COLOR2.includes(bgTypeSelect.value) ? 'flex' : 'none';
  processImage();
});
bgColor1Input.addEventListener('input', () => processImage());
bgColor2Input.addEventListener('input', () => processImage());

TEXT_FIELD_INPUTS.forEach((el) => {
  el.addEventListener('input', () => processImage());
});

clearBtn.addEventListener('click', () => {
  currentSprite = null;
  currentFileName = 'label';
  fileInput.value = '';
  filename.textContent = '';
  spriteControls.style.display = 'none';
  spriteScaleInput.value = 100;
  spriteOffsetXInput.value = 0;
  spriteOffsetYInput.value = 0;
  spriteScaleValue.textContent = 100;
  mirrorSpriteInput.checked = false;

  setNameInput.value = '';
  cardNameInput.value = '';
  cardTypeInput.value = '';
  cardNumberInput.value = '';

  processImage();
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

processImage();
