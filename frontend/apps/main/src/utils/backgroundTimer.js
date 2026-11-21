// Hẹn giờ không bị Chrome hãm khi tab ẩn. Tab chạy nền lâu thì setTimeout chuỗi chỉ chạy mỗi phút
// một lần (intensive throttling), trong khi cuộc gọi Facebook chỉ đổ chuông khoảng 60 giây: thanh
// báo cuộc gọi đến sẽ lỡ. Timer trong Web Worker không bị hãm như vậy, nên khi tab ẩn ta hẹn giờ
// trong một worker nhỏ (CSP của Libredesk cho phép worker-src blob:). Tab đang hiện thì dùng
// setTimeout như thường. Không tạo được worker thì cũng quay về setTimeout.
const WORKER_SOURCE = `const timers = new Map()
onmessage = (e) => {
  const { id, ms, cancel } = e.data
  clearTimeout(timers.get(id))
  timers.delete(id)
  if (!cancel) timers.set(id, setTimeout(() => { timers.delete(id); postMessage(id) }, ms))
}`

let worker = null // null: chưa tạo; false: không tạo được
let nextId = 0
const pending = new Map()

function fallBack () {
  worker = false
  // Worker hỏng giữa chừng: chạy các hẹn còn lại bằng setTimeout để vòng hỏi không dừng.
  for (const fn of pending.values()) setTimeout(fn, 0)
  pending.clear()
}

function getWorker () {
  if (worker !== null) return worker
  try {
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }))
    worker = new Worker(url)
    URL.revokeObjectURL(url)
    worker.onmessage = (e) => {
      const fn = pending.get(e.data)
      pending.delete(e.data)
      fn?.()
    }
    worker.onerror = fallBack
  } catch {
    worker = false
  }
  return worker
}

// later(fn, ms) gọi fn sau ms; trả hàm huỷ.
export function later (fn, ms) {
  const w = typeof document !== 'undefined' && document.hidden ? getWorker() : false
  if (!w) {
    const handle = setTimeout(fn, ms)
    return () => clearTimeout(handle)
  }
  const id = ++nextId
  pending.set(id, fn)
  w.postMessage({ id, ms })
  return () => {
    if (pending.delete(id) && worker) worker.postMessage({ id, cancel: true })
  }
}

// Chỉ cho test: quên worker đã tạo.
export function resetBackgroundTimer () {
  worker = null
  pending.clear()
}
