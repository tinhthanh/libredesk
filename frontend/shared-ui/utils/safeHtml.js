// safeHtml strips the elements an HTML message must never carry before it reaches <Letter>
// (vue-letter / lettersanitizer). lettersanitizer keeps <style> blocks and rebuilds them from
// the browser's CSS text, which turns CSS escapes such as \3C/style\3E back into a literal
// </style>: once the result is put in the page with innerHTML, whatever follows runs as HTML
// (an <img onerror>). Message HTML comes from customers (email), from the gateway and from
// AI output, so <style> and every other element that can load or run code goes here, and svg
// and math go too (their foreign content is how a re-parse can create elements the first
// parse didn't have). The document is parsed again until nothing more is removed, so the
// output, parsed once more by lettersanitizer, has none of them either.
const DROP = [
  'style',
  'link',
  'meta',
  'base',
  'script',
  'noscript',
  'template',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'form',
  'svg',
  'math'
].join(',')

const MAX_PASSES = 4

export function safeHtml(html) {
  if (typeof html !== 'string' || html === '') return ''
  if (!html.includes('<')) return html
  let current = html
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const doc = new DOMParser().parseFromString(current, 'text/html')
    const found = doc.querySelectorAll(DROP)
    found.forEach((el) => el.remove())
    const next = doc.body.innerHTML
    if (found.length === 0) return next
    current = next
  }
  // Still finding some after several passes: something is crafted, keep the text only.
  return new DOMParser().parseFromString(current, 'text/html').body.textContent || ''
}
