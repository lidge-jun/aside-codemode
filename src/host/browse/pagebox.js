// PDF page-box reader. Exists because pdf({ format: 'A4' }) silently produces US Letter:
// measured MediaBox 0 0 612 792 for the format shortcut versus 0 0 595.91998 841.91998 when
// paperWidth/paperHeight are passed in inches (001 E4, reproduced 3/3).
//
// A report that merely produced a file is not a report of the requested size, so this is the
// check that turns 'the file exists' into 'the page is the size you asked for'.
const PT_PER_INCH = 72;
const TOLERANCE_PT = 1;

export function readMediaBoxes(buf) {
  const s = Buffer.from(buf).toString('latin1');
  const out = [];
  for (const m of s.matchAll(/\/MediaBox\s*\[\s*([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s*\]/g)) {
    out.push({ x0: Number(m[1]), y0: Number(m[2]), x1: Number(m[3]), y1: Number(m[4]) });
  }
  return out;
}

export function verifyPageBox(buf, requested) {
  const boxes = readMediaBoxes(buf);
  const rule = requested.preferCSSPageSize === true ? 'css-page-size' : 'requested-paper-size';
  if (boxes.length === 0) return { matched: false, rule, reason: 'no MediaBox found', boxes: [] };
  const wantW = requested.paperWidth * PT_PER_INCH;
  const wantH = requested.paperHeight * PT_PER_INCH;
  const actual = boxes.map((b) => ({ widthPt: b.x1 - b.x0, heightPt: b.y1 - b.y0 }));
  const bad = actual.filter((a) => Math.abs(a.widthPt - wantW) > TOLERANCE_PT || Math.abs(a.heightPt - wantH) > TOLERANCE_PT);
  const matched = requested.preferCSSPageSize === true || bad.length === 0;
  return {
    matched,
    rule,
    requestedPt: { widthPt: wantW, heightPt: wantH },
    actualPt: actual,
    reason: matched ? null : `page box ${actual[0].widthPt}x${actual[0].heightPt}pt is not the requested ${wantW}x${wantH}pt`,
  };
}
