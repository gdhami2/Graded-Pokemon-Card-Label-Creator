// Shared between script.js (main tool) and calibrate.js (watermark calibration).
// Both must normalize to the same canvas size or the watermark profile won't align.

// Standard PSA graded label: 73mm x 19mm at 600 DPI (1mm = 600/25.4 px)
const LABEL_WIDTH_MM = 73;
const LABEL_HEIGHT_MM = 19;
const LABEL_DPI = 600;
const TARGET_W = Math.round(LABEL_WIDTH_MM * LABEL_DPI / 25.4);
const TARGET_H = Math.round(LABEL_HEIGHT_MM * LABEL_DPI / 25.4);

const WATERMARK_PROFILE_URL = 'watermark-profile.png';

// The profile is stored as an RGBA PNG: RGB channels hold the estimated
// watermark color at each pixel, and the alpha channel holds the estimated
// blend strength (0 = untouched background, 255 = fully opaque watermark).
// Correction inverts the alpha composite rather than subtracting a delta, so
// clamp alpha below 1 to keep that inversion numerically stable.
const MAX_WATERMARK_ALPHA = 0.98;
