import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import en from '../../../../../i18n/en-US.json'
import vi from '../../../../../i18n/vi-VN.json'

// Trình biên dịch mà vue-i18n dùng (bản Node của vue-i18n chỉ cảnh báo, còn trình
// duyệt thì ném lỗi và trang trắng). Một "@" chưa viết thành {'@'} là đủ hỏng trang.
const fromVueI18n = createRequire(realpathSync(createRequire(import.meta.url).resolve('vue-i18n')))
const { baseCompile } = fromVueI18n('@intlify/message-compiler')

describe.each([
  ['en-US', en],
  ['vi-VN', vi]
])('%s messages', (_locale, messages) => {
  it('compile', () => {
    const broken = []
    for (const [key, text] of Object.entries(messages)) {
      baseCompile(text, { onError: (e) => broken.push(`${key}: ${e.message}`) })
    }
    expect(broken).toEqual([])
  })
})
