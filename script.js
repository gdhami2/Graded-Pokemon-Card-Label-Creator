const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const previewWrap = document.getElementById('preview-wrap');
const preview = document.getElementById('preview');
const filename = document.getElementById('filename');
const clearBtn = document.getElementById('clearBtn');
const downloadBtn = document.getElementById('downloadBtn');
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

const LABEL_MARGIN_X = 20;
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

function drawLabelText(ctx, width, height) {
  const maxWidth = width - LABEL_MARGIN_X * 2;
  let y = 44;

  const lines = [
    { text: setNameInput.value.trim(), maxSize: 34, minSize: 16, color: setNameColorInput.value, outline: setNameOutlineInput.value, lineWidth: 5, lineGap: 14 },
    { text: cardNameInput.value.trim(), maxSize: 50, minSize: 22, color: cardNameColorInput.value, outline: cardNameOutlineInput.value, lineWidth: 7, lineGap: 16 },
    { text: cardTypeInput.value.trim(), maxSize: 30, minSize: 14, color: cardTypeColorInput.value, outline: cardTypeOutlineInput.value, lineWidth: 5, lineGap: 12 },
    { text: cardNumberInput.value.trim(), maxSize: 30, minSize: 14, color: cardNumberColorInput.value, outline: cardNumberOutlineInput.value, lineWidth: 5, lineGap: 12 },
  ];

  lines.forEach((line) => {
    if (!line.text) return;
    const size = drawTextLine(ctx, line.text, y, line.maxSize, line.minSize, maxWidth, line.color, line.outline, line.lineWidth);
    y += size + line.lineGap;
  });
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
  outputName = `${currentFileName}-63x20mm.png`;
  preview.src = outputDataUrl;
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
  setNameInput.value = '';
  cardNameInput.value = '';
  cardTypeInput.value = '';
  cardNumberInput.value = '';
  previewWrap.classList.remove('visible');
  dropzone.style.display = 'block';
});

downloadBtn.addEventListener('click', () => {
  if (!outputDataUrl) return;
  const a = document.createElement('a');
  a.href = outputDataUrl;
  a.download = outputName;
  document.body.appendChild(a);
  a.click();
  a.remove();
});
