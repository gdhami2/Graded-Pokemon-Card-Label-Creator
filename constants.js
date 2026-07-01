// Shared between script.js (main tool) and calibrate.js (watermark calibration).
// Both must normalize to the same canvas size or the watermark profile won't align.

// 63mm x 20mm at 300 DPI (1mm = 300/25.4 px)
const TARGET_W = Math.round(63 * 300 / 25.4);
const TARGET_H = Math.round(20 * 300 / 25.4);

const WATERMARK_PROFILE_URL = 'watermark-profile.png';

// The profile is stored as a single byte per pixel centered at 128. This
// scale lets it represent deltas beyond +/-127 (at reduced precision)
// instead of silently clipping strong corrections during calibration.
const WATERMARK_DELTA_SCALE = 2;
