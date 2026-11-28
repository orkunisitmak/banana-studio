// Generated SVG may be opened directly from a signed URL. Accept a passive
// vector vocabulary, never embedded documents, events, scripts or external CSS.
const elements = new Set('svg g defs title desc path rect circle ellipse line polyline polygon text tspan linearGradient radialGradient stop clipPath mask pattern use symbol'.split(' '));
const paint = new Set('fill stroke color stop-color stop-opacity fill-rule clip-rule fill-opacity stroke-opacity stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset opacity clip-path mask font-family font-size font-style font-weight text-anchor dominant-baseline letter-spacing'.split(' '));
const attributes = new Set('id version width height viewBox x y x1 y1 x2 y2 cx cy r rx ry fx fy d points transform offset gradientUnits gradientTransform spreadMethod clipPathUnits maskUnits maskContentUnits patternUnits patternContentUnits patternTransform preserveAspectRatio dx dy rotate textLength lengthAdjust'.split(' '));
const safeValue = (value:string) => /^[\w\s.,%#()+-]*$/.test(value) && (!/url\s*\(/i.test(value) || /^url\(#[\w.-]+\)$/.test(value));
export function isPassiveSvg(bytes: Buffer): boolean {
  if (bytes.length > 8 * 1024 * 1024) return false;
  const xml = bytes.toString('utf8').trim().replace(/^<\?xml\s+version=(?:"1\.0"|'1\.0')(?:\s+encoding=(?:"UTF-8"|'UTF-8'))?\s*\?>\s*/i,'');
  if (!xml.startsWith('<svg') || xml.includes('\0')) return false;
  const token = /<\/(\w+)\s*>|<(\w+)((?:\s+[\w:-]+\s*=\s*(?:"[^"<>]*"|'[^'<>]*'))*)\s*(\/?)>|([^<]+)/gy;
  const attr = /\s+([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gy;
  const stack:string[] = [];
  let offset = 0;
  while (offset < xml.length) {
    if (stack.length && xml.startsWith('<!--',offset)) {
      const end = xml.indexOf('--',offset + 4);
      if (end === -1 || xml[end + 2] !== '>') return false;
      offset = end + 3;
      continue;
    }
    token.lastIndex = offset;
    const next = token.exec(xml);
    if (!next || (offset && !stack.length)) return false;
    offset = token.lastIndex;
    const [, close, tag, params, single, text] = next;
    if (text !== undefined) { if (/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-fA-F]+;)/.test(text)) return false; continue; }
    if (close) { if (stack.pop() !== close) return false; continue; }
    if (!elements.has(tag)) return false;
    const seen = new Set<string>();
    attr.lastIndex = 0;
    let item;
    while ((item = attr.exec(params))) {
      const name = item[1], value = item[2] ?? item[3];
      if (seen.has(name)) return false;
      seen.add(name);
      if (name === 'xmlns' && tag === 'svg' && value === 'http://www.w3.org/2000/svg') continue;
      if (name === 'xmlns:xlink' && tag === 'svg' && value === 'http://www.w3.org/1999/xlink') continue;
      if (name === 'href' || name === 'xlink:href') { if (!/^#[\w.-]+$/.test(value)) return false; continue; }
      if (name === 'style') {
        if (!value.split(';').filter(s=>s.trim()).every(decl => { const pair = /^\s*([\w-]+)\s*:\s*([^:]+?)\s*$/.exec(decl); return pair && paint.has(pair[1]) && safeValue(pair[2]); })) return false;
      } else if ((!attributes.has(name) && !paint.has(name)) || !safeValue(value)) return false;
    }
    if (!single) stack.push(tag);
  }
  return !stack.length;
}
