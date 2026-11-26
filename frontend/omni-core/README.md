# omni-core

Logic thuần của omnichannel, dùng chung giữa hai giao diện:

- Libredesk (fork này, Vue): import qua alias `@omni-core` (`vite.config.js`, `jsconfig.json`).
- Màn Omnichannel của app Vetgo (petlandvn, Angular): git submodule trỏ vào repo này, ghim theo commit, path TS
  `@omni-core` trỏ vào `frontend/omni-core/src/index.ts`.

Sửa quy tắc ở đây một lần thì cả hai giao diện cùng theo. Trước đây app Vetgo chép tay từ các file JS của
Libredesk nên hai bên lệch dần.

## Có gì

| Tệp | Nội dung |
|---|---|
| `src/channel.ts` | Kênh và tài khoản suy từ tên inbox gateway (`omniChannel`, `inboxAccount`, `accountListed`), thu hồi, cảm xúc |
| `src/message.ts` | Tin nhóm `[Người gửi]: `, ghi chú chủ tài khoản, sticker, trả lời trích dẫn (`quoteHTML`, `replyQuote`, `customerQuote`) |
| `src/rich.ts` | Đọc tin để vẽ: loại dòng xem trước (`previewParts`), ghi chú sự kiện của gateway (`eventNote`, theo dấu `meta.omni_event`), tin có cấu trúc (`richCard`: link, danh thiếp, bình chọn, vị trí, cuộc gọi, video lớn...), lời mời kết bạn Zalo còn đồng ý được không (`friendRequestState`), nhãn tệp thừa. Trả `kind`; icon, chữ nút do giao diện chọn |
| `src/accounts.ts` | Tài khoản kênh: trạng thái, lý do, lịch sử kết nối, Zalo OA, Fanpage Web, canary, bộ cài SMS |
| `src/calls.ts` | Cuộc gọi Zalo, Fanpage Web, điện thoại chi nhánh: mã trạng thái, thời lượng, ring_id, camera của khách, upsample PCM |
| `src/early-updates.ts` | Giữ cập nhật tin tới trước khi tin có trong danh sách |
| `src/types.ts` | Kiểu tối thiểu các hàm đọc (chỉ các trường dùng tới) |

## Quy tắc

- **TypeScript thuần, không phụ thuộc gì**: không import `vue`, Angular, axios, không gọi API, không đụng DOM hay
  `window`. Trạng thái phản ứng, client HTTP, WebRTC, micro, âm thanh ở lại từng giao diện.
- **Trả mã, không trả chữ hay màu**: vd. `accountStatus()` trả `'disconnected'`, `historyEntries()` trả `level`,
  `callStatusCode()` trả `'end.no_answer'`. Libredesk đổi mã ra biến thể badge, lớp Tailwind, khoá i18n; app Vetgo
  đổi theo cách của nó.
- **Không build**: Vite (Libredesk) và Angular (app Vetgo) đọc thẳng source TS. Mã phải biên dịch được với
  `tsconfig.json` ở đây (strict, `noUncheckedIndexedAccess`) và cả cấu hình lỏng của app.
- **Tương thích ngược**: app Vetgo và Libredesk của từng phòng khám không deploy cùng lúc, và cả hai đọc dữ liệu
  của gateway đang chạy. Đổi định dạng thì đọc được cả dạng cũ.
- Giữ tên hàm, chữ ký đã export; đổi tên thì để tên cũ làm alias một thời gian và báo bên app Vetgo.

## Kiểm

```bash
cd frontend
pnpm typecheck:omni-core
pnpm exec vitest run omni-core
```

CI: `.github/workflows/omni-core.yml` chạy typecheck và toàn bộ unit test frontend cho PR vào nhánh `omnichannel`.

## Đổi logic

1. PR vào nhánh `omnichannel` của fork, sửa `omni-core` cùng chỗ dùng nó trong Vue.
2. Sau khi merge: repo omnichannel đổi `LIBREDESK_REF` trong `libredesk-ui/Dockerfile` (như mọi thay đổi giao diện).
3. Repo app Vetgo bump submodule (Dependabot `gitsubmodule` mở PR), chạy test omnichannel của app.
