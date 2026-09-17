// report.build: assemble, print over loopback, and PROVE the page size.
//
// pdf({ format: 'A4' }) was measured to produce US Letter (MediaBox 0 0 612 792), so the
// print always passes paperWidth/paperHeight in INCHES and the result is verified against
// the request. A file that exists is not a report of the size you asked for.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildHtml } from './html.js';
import { createReportServer } from './serve.js';
import { verifyPageBox } from '../browse/pagebox.js';
import { A4_INCHES } from '../browse/schema.js';
import { containedRead, artifactNameFor } from '../browse/capture.js';

export class ReportError extends Error {
  constructor(message, code) { super(message); this.name = 'ReportError'; this.code = code; }
}

// This is everything report.build decides before it starts the loopback server. Discovery
// must be able to ask the same question without opening a socket or touching an output file.
export function planReportBuild(opts = {}) {
  const items = Array.isArray(opts.items) ? opts.items : [];
  if (!opts.outFile) throw new ReportError('report.build requires { outFile }', 'EBADVAL');
  const paper = { ...A4_INCHES, ...(opts.paper || {}) };
  if (opts.paper && 'format' in opts.paper) {
    throw new ReportError('pdf format is ENOTSUP: it was measured to yield US Letter. Pass paperWidth/paperHeight in inches.', 'ENOTSUP');
  }
  return { items, paper };
}

export function createReport({ session, assertInside, deps = {} } = {}) {
  async function build(opts = {}) {
    const { items, paper } = planReportBuild(opts);

    const server = createReportServer();
    const figures = new Map();
    for (const item of items) {
      if (item.figure && item.figure.buf) figures.set(item.url, server.register(item.figure.buf, item.figure.mime));
    }
    server.setDocument(buildHtml({ title: opts.title, items, figures }));

    const live = await server.listen();
    let res;
    const pdfName = artifactNameFor(0, {}).replace(/\.png$/, '.pdf');
    try {
      // Images are fetched at PRINT time, so the server must outlive page.pdf().
      res = await session.run(
        // detect:false — this is our own assembled HTML on loopback, not a remote origin.
        // A report that lists blocked pages renders the word "blocked" and would otherwise
        // be flagged as blocked itself.
        { urls: [live.origin], pdf: paper, timeoutMs: opts.timeoutMs || 25000, detect: false },
        { browseCaps: opts.browseCaps || {}, pdfNames: [pdfName] },
      );
    } finally {
      await live.close();
    }

    const item = (res.items || [])[0] || {};
    if (!item.ok) throw new ReportError(`the report page did not render: ${item.error || item.code || 'unknown'}`, item.code || 'ERENDER');
    if (!item.pdfName) return { ok: false, code: 'ENOPDF', error: 'the run wrote no pdf artifact' };
    // Same containment as a screenshot: host-generated name, read jailed under the session.
    const buf = deps.readPdf ? await deps.readPdf(res) : await containedRead(res.pwd, item.pdfName, deps);
    const box = verifyPageBox(buf, paper);
    const dest = assertInside ? assertInside(opts.outFile) : opts.outFile;
    await (deps.writeFileImpl || writeFile)(dest, buf);
    return {
      ok: box.matched,
      path: dest,
      bytes: buf.length,
      pageBox: box,
      code: box.matched ? null : 'EPAGEBOX',
      error: box.matched ? null : box.reason,
    };
  }
  return Object.freeze({ build });
}
