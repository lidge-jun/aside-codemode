// Assemble a paged HTML document. Figures are referenced by the names the server
// registered, never by a caller-supplied path.
function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildHtml({ title = 'Report', items = [], figures = new Map() } = {}) {
  const sections = items.map((item) => {
    const fig = figures.get(item.url);
    return [
      '<section class="item">',
      `<h2>${esc(item.title || item.url)}</h2>`,
      `<p class="url">${esc(item.url)}</p>`,
      item.ok ? '' : `<p class="bad">${esc(item.code || 'failed')}: ${esc(item.error || '')}</p>`,
      fig ? `<img src="/${esc(fig)}" alt="${esc(item.url)}">` : '',
      item.data ? `<pre>${esc(JSON.stringify(item.data, null, 2))}</pre>` : '',
      '</section>',
    ].join('');
  }).join('\n');
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<title>${esc(title)}</title>`,
    '<style>',
    '@page { margin: 14mm; }',
    'body { font: 12pt/1.5 system-ui, sans-serif; color: #111; }',
    'h1 { font-size: 20pt; margin: 0 0 12pt; }',
    'h2 { font-size: 13pt; margin: 0 0 4pt; }',
    '.item { page-break-inside: avoid; border-top: 1px solid #ddd; padding: 10pt 0; }',
    '.url { color: #666; font-size: 9pt; margin: 0 0 6pt; word-break: break-all; }',
    '.bad { color: #a00; }',
    'img { max-width: 100%; height: auto; }',
    'pre { background: #f6f6f6; padding: 8pt; font-size: 9pt; white-space: pre-wrap; }',
    '</style></head><body>',
    `<h1>${esc(title)}</h1>`,
    sections,
    '</body></html>',
  ].join('\n');
}
