const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const status = document.getElementById('status');
const resultWrap = document.getElementById('result-wrap');
const resultCanvas = document.getElementById('resultCanvas');
const downloadBtn = document.getElementById('downloadBtn');

const MIN_SAMPLES = 3;
const POISSON_ITERATIONS = 4000;
const ITERATIONS_PER_CHUNK = 40;

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
// main tool's normalization) and returns its luminance field.
function toLuminance(img) {
  const canvas = document.createElement('canvas');
  canvas.width = TARGET_W;
  canvas.height = TARGET_H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, TARGET_W, TARGET_H);
  const { data } = ctx.getImageData(0, 0, TARGET_W, TARGET_H);

  const lum = new Float32Array(TARGET_W * TARGET_H);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    lum[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return lum;
}

// For each pixel, the horizontal/vertical gradient is dominated by the
// watermark's structure once we take the median across many differently-
// backgrounded samples — the varying background gradients cancel out
// around a median of ~0, while the watermark's consistent edges don't.
function computeMedianGradients(luminanceFields, width, height) {
  const n = luminanceFields.length;
  const gx = new Float32Array(width * height);
  const gy = new Float32Array(width * height);
  const buf = new Float32Array(n);

  function median(values, count) {
    const sorted = values.slice(0, count).sort((a, b) => a - b);
    const mid = count >> 1;
    return count % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;

      if (x < width - 1) {
        for (let k = 0; k < n; k++) {
          buf[k] = luminanceFields[k][idx + 1] - luminanceFields[k][idx];
        }
        gx[idx] = median(buf, n);
      }

      if (y < height - 1) {
        for (let k = 0; k < n; k++) {
          buf[k] = luminanceFields[k][idx + width] - luminanceFields[k][idx];
        }
        gy[idx] = median(buf, n);
      }
    }
  }

  return { gx, gy };
}

function computeDivergence(gx, gy, width, height) {
  const div = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const gxHere = x < width - 1 ? gx[idx] : 0;
      const gxPrev = x > 0 ? gx[idx - 1] : 0;
      const gyHere = y < height - 1 ? gy[idx] : 0;
      const gyPrev = y > 0 ? gy[idx - width] : 0;
      div[idx] = (gxHere - gxPrev) + (gyHere - gyPrev);
    }
  }
  return div;
}

// Solves the Poisson equation (Laplacian(W) = div) with zero-Dirichlet
// boundaries via chunked Gauss-Seidel relaxation, yielding to the browser
// between chunks so the page stays responsive.
function poissonReconstruct(div, width, height, iterations, onProgress) {
  return new Promise((resolve) => {
    const w = new Float32Array(width * height);

    function runChunk(done) {
      const target = Math.min(done + ITERATIONS_PER_CHUNK, iterations);
      for (let it = done; it < target; it++) {
        for (let y = 1; y < height - 1; y++) {
          for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;
            w[idx] = (w[idx - 1] + w[idx + 1] + w[idx - width] + w[idx + width] - div[idx]) / 4;
          }
        }
      }

      onProgress(target, iterations);

      if (target < iterations) {
        setTimeout(() => runChunk(target), 0);
      } else {
        resolve(w);
      }
    }

    runChunk(0);
  });
}

function renderProfile(w, width, height) {
  resultCanvas.width = width;
  resultCanvas.height = height;
  const ctx = resultCanvas.getContext('2d');
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  for (let p = 0; p < w.length; p++) {
    const byte = Math.max(0, Math.min(255, Math.round(w[p] / WATERMARK_DELTA_SCALE + 128)));
    data[p * 4] = byte;
    data[p * 4 + 1] = byte;
    data[p * 4 + 2] = byte;
    data[p * 4 + 3] = 255;
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
  const luminanceFields = images.map(toLuminance);

  const { gx, gy } = computeMedianGradients(luminanceFields, TARGET_W, TARGET_H);
  const div = computeDivergence(gx, gy, TARGET_W, TARGET_H);

  const w = await poissonReconstruct(div, TARGET_W, TARGET_H, POISSON_ITERATIONS, (done, total) => {
    setStatus(`Reconstructing watermark pattern... ${Math.round((done / total) * 100)}%`);
  });

  renderProfile(w, TARGET_W, TARGET_H);
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
