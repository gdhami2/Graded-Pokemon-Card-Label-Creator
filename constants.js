// Standard PSA graded label: 73mm x 19mm at 600 DPI (1mm = 600/25.4 px)
const LABEL_WIDTH_MM = 73;
const LABEL_HEIGHT_MM = 19;
const LABEL_DPI = 600;
const TARGET_W = Math.round(LABEL_WIDTH_MM * LABEL_DPI / 25.4);
const TARGET_H = Math.round(LABEL_HEIGHT_MM * LABEL_DPI / 25.4);
