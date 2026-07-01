const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const status = document.getElementById('status');
const resultWrap = document.getElementById('result-wrap');
const resultCanvas = document.getElementById('resultCanvas');
const downloadBtn = document.getElementById('downloadBtn');

const MIN_SAMPLES = 8;

// Percentile of the per-pixel sample variance treated as the "unaffected
// background" reference level. Most of the label isn't covered by the
// watermark, so most pixels should sit near the top of the variance
// distribution; only pixels under the watermark get suppressed below it.
const BASELINE_VARIANCE_PERCENTILE = 0.9;

// Alpha below this is treated as "confidently untouched by the watermark",
// used to estimate the background's own baseline color per channel.
const CONFIDENT_BACKGROUND_ALPHA = 0.05;

let profileDataUrl = null;

function setStatus(text) {
  status.textContent = text;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Draws each sample onto a common TARGET_W x TARGET_H canvas (matching the
// main tool's normalization) and returns its raw RGBA pixel data.
function toRGBA(img) {
  const canvas = document.createElement('canvas');
  canvas.width = TARGET_W;
  canvas.height = TARGET_H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, TARGET_W, TARGET_H);
  return ctx.getImageData(0, 0, TARGET_W, TARGET_H).data;
}

// The watermark is modeled as a per-pixel alpha composite over an unknown,
// varying background: observed = background*(1-a) + watermarkColor*a. Across
// many differently-designed samples, the background at a given pixel behaves
// like independent draws from some distribution, and compositing scales down
// their spread by (1-a). So pixels under the watermark show suppressed
// variance across the sample set relative to unaffected pixels — which lets
// us solve for both the alpha matte and the watermark's color without ever
// having an unwatermarked sample to compare against.
function estimateWatermark(samples, width, height) {
  const n = samples.length;
  const pixelCount = width * height;

  const meanR = new Float64Array(pixelCount);
  const meanG = new Float64Array(pixelCount);
  const meanB = new Float64Array(pixelCount);
  const variance = new Float64Array(pixelCount);

  for (let p = 0; p < pixelCount; p++) {
    const i = p * 4;
    let sumR = 0, sumG = 0, sumB = 0;
    for (let k = 0; k < n; k++) {
      sumR += samples[k][i];
      sumG += samples[k][i + 1];
      sumB += samples[k][i + 2];
    }
    const mr = sumR / n, mg = sumG / n, mb = sumB / n;
    meanR[p] = mr; meanG[p] = mg; meanB[p] = mb;

    let varSum = 0;
    for (let k = 0; k < n; k++) {
      const dr = samples[k][i] - mr;
      const dg = samples[k][i + 1] - mg;
      const db = samples[k][i + 2] - mb;
      varSum += dr * dr + dg * dg + db * db;
    }
    variance[p] = varSum / n;
  }

  const sortedVariance = Float64Array.from(variance).sort();
  const baseline = sortedVariance[Math.floor(pixelCount * BASELINE_VARIANCE_PERCENTILE)] || 1;

  const alpha = new Float64Array(pixelCount);
  for (let p = 0; p < pixelCount; p++) {
    const ratio = variance[p] / baseline;
    alpha[p] = ratio >= 1 ? 0 : 1 - Math.sqrt(ratio);
  }

  function medianBackground(meanChannel) {
    const values = [];
    for (let p = 0; p < pixelCount; p++) {
      if (alpha[p] < CONFIDENT_BACKGROUND_ALPHA) values.push(meanChannel[p]);
    }
    if (!values.length) return 128;
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  }
  const muR = medianBackground(meanR);
  const muG = medianBackground(meanG);
  const muB = medianBackground(meanB);

  const colorR = new Float64Array(pixelCount);
  const colorG = new Float64Array(pixelCount);
  const colorB = new Float64Array(pixelCount);
  for (let p = 0; p < pixelCount; p++) {
    const a = alpha[p];
    if (a < CONFIDENT_BACKGROUND_ALPHA) {
      colorR[p] = muR; colorG[p] = muG; colorB[p] = muB;
    } else {
      colorR[p] = (meanR[p] - (1 - a) * muR) / a;
      colorG[p] = (meanG[p] - (1 - a) * muG) / a;
      colorB[p] = (meanB[p] - (1 - a) * muB) / a;
    }
  }

  return { alpha, colorR, colorG, colorB };
}

function renderProfile(watermark, width, height) {
  resultCanvas.width = width;
  resultCanvas.height = height;
  const ctx = resultCanvas.getContext('2d');
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  for (let p = 0; p < width * height; p++) {
    data[p * 4] = Math.max(0, Math.min(255, Math.round(watermark.colorR[p])));
    data[p * 4 + 1] = Math.max(0, Math.min(255, Math.round(watermark.colorG[p])));
    data[p * 4 + 2] = Math.max(0, Math.min(255, Math.round(watermark.colorB[p])));
    data[p * 4 + 3] = Math.max(0, Math.min(255, Math.round(watermark.alpha[p] * 255)));
  }

  ctx.putImageData(imageData, 0, 0);
  profileDataUrl = resultCanvas.toDataURL('image/png');
  resultWrap.classList.add('visible');
}

async function handleFiles(fileList) {
  const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
  if (files.length < MIN_SAMPLES) {
    setStatus(`Need at least ${MIN_SAMPLES} sample images (got ${files.length}).`);
    return;
  }

  resultWrap.classList.remove('visible');
  setStatus(`Loading ${files.length} images...`);
  const images = await Promise.all(files.map(loadImage));

  setStatus(`Analyzing ${images.length} images...`);
  const samples = images.map(toRGBA);

  const watermark = estimateWatermark(samples, TARGET_W, TARGET_H);

  renderProfile(watermark, TARGET_W, TARGET_H);
  setStatus(`Done. Estimated from ${images.length} images.`);
}

dropzone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  handleFiles(fileInput.files);
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
  handleFiles(e.dataTransfer.files);
});

downloadBtn.addEventListener('click', () => {
  if (!profileDataUrl) return;
  const a = document.createElement('a');
  a.href = profileDataUrl;
  a.download = 'watermark-profile.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
});
