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
  const envelope = { rule, requestedPt: { widthPt: wantW, heightPt: wantH }, actualPt: actual };

  // When the stylesheet owns the size, the requested sheet is a fallback and a different size
  // is the point — but "different" is not "anything". A page box still has to be a page: finite,
  // positive, and the same on every page. Without that, 0x0 and a silently-Letter document both
  // pass as verified, which is the failure this file exists to catch.
  if (requested.preferCSSPageSize === true) {
    const unusable = actual.find((a) => !Number.isFinite(a.widthPt) || !Number.isFinite(a.heightPt) || a.widthPt <= 0 || a.heightPt <= 0);
    if (unusable) {
      return { ...envelope, matched: false, reason: `page box ${unusable.widthPt}x${unusable.heightPt}pt is not a page` };
    }
    const first = actual[0];
    const uneven = actual.find((a) => Math.abs(a.widthPt - first.widthPt) > TOLERANCE_PT || Math.abs(a.heightPt - first.heightPt) > TOLERANCE_PT);
    if (uneven) {
      return { ...envelope, matched: false, reason: `pages disagree on size: ${first.widthPt}x${first.heightPt}pt and ${uneven.widthPt}x${uneven.heightPt}pt` };
    }
    // Which size the stylesheet asked for is not knowable from the bytes, so this reports the
    // size it measured rather than claiming the CSS was honoured.
    return { ...envelope, matched: true, measuredOnly: true, reason: null };
  }

  const bad = actual.filter((a) => Math.abs(a.widthPt - wantW) > TOLERANCE_PT || Math.abs(a.heightPt - wantH) > TOLERANCE_PT);
  const matched = bad.length === 0;
  return {
    ...envelope,
    matched,
    reason: matched ? null : `page box ${actual[0].widthPt}x${actual[0].heightPt}pt is not the requested ${wantW}x${wantH}pt`,
  };
}
