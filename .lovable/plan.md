## Mục tiêu

Thêm 3 tùy chọn cho mỗi task ở màn hình Review, và đồng bộ chúng vào Google Calendar khi bấm "Thêm vào Calendar":

1. **Nhắc hẹn** (`reminderMin`) — mặc định 30 phút trước, cho phép chọn: Tắt / 5 / 10 / 15 / 30 / 60 phút.
2. **Mô tả** (`description`) — ô textarea, tự động điền từ transcript nếu AI trích được.
3. **Google Meet** (`addMeet`) — công tắc bật/tắt, mặc định TẮT. Khi bật, event tạo kèm link Meet và hiển thị link đó ở màn Done.

## Thay đổi

### 1. `src/lib/tempo.functions.ts`

- Mở rộng `ParsedTask` + prompt Gemini để trích thêm `description` (tối đa ~200 ký tự, null nếu người dùng không nói gì thêm ngoài tiêu đề). Không đưa reminder / meet vào AI — người dùng chỉnh trực tiếp trong UI.
- `createEvent` nhận thêm:
  - `description?: string`
  - `reminderMin?: number | null` (null = tắt, không thêm reminder override)
  - `addMeet?: boolean`
- Trong body gửi Google Calendar:
  - `description` khi có.
  - `reminders: { useDefault: false, overrides: [{ method: "popup", minutes }] }` khi `reminderMin != null`; nếu tắt thì `reminders: { useDefault: false, overrides: [] }`.
  - Khi `addMeet=true`: thêm `conferenceData: { createRequest: { requestId: <uuid>, conferenceSolutionKey: { type: "hangoutsMeet" } } }` và gọi endpoint với query `?conferenceDataVersion=1`.
- Trả về thêm `meetLink: string | null` (đọc từ `conferenceData.entryPoints[].uri` với type `video`, fallback `hangoutLink`).

### 2. `src/routes/index.tsx`

- `ReviewTask` type thêm: `description: string`, `reminderMin: number | null` (mặc định 30), `addMeet: boolean` (mặc định false).
- Khi build danh sách review từ `parsed`, gán mặc định trên và lấy `description` từ AI nếu có.
- `ReviewView`:
  - Thêm khối "Mô tả": ô textarea 3 dòng, placeholder "Thêm ghi chú…", `bg-input rounded-xl`.
  - Thêm hàng "Nhắc hẹn": `<select>` styled pill dark, options: Tắt / 5 phút / 10 phút / 15 phút / 30 phút / 1 giờ trước.
  - Thêm hàng "Google Meet": nút toggle nhỏ (dùng `Switch` từ shadcn hoặc button pill tự vẽ) + icon video, hiện chữ "Tạo link Meet".
- `approve()` truyền các field mới xuống `createEvent`; nếu server trả `meetLink`, lưu vào state task và hiển thị link ở `DoneView` (nút "Mở Google Meet" tách riêng với nút "Xem trên Google Calendar").
- `DoneView`: nếu có meetLink của event cuối, render thêm nút link Meet.

### 3. UI/UX chi tiết

- Giữ layout hiện tại (card dark, purple accent). Ba khối mới nằm dưới hàng "Thời lượng", cách nhau `space-y-3`.
- Nhắc hẹn dùng `<select>` native styled: `bg-input border border-border rounded-full px-3 py-1 text-sm`.
- Meet toggle: pill có icon `Video` + label, active = `bg-primary text-primary-foreground`, inactive = `bg-secondary text-muted-foreground`. Không dùng shadcn Switch để tránh phụ thuộc thêm.
- Mô tả: textarea `min-h-20 max-h-40 resize-none`.
- Motion: các khối mới fade-in cùng card, không thêm animation riêng.

## Ngoài phạm vi

- Chỉnh sửa reminder/meet sau khi đã tạo event.
- Nhiều reminder cùng lúc, reminder email.
- Attendees / mời khách vào Meet.
- Lưu preferences (reminder mặc định) giữa các phiên.

## Rủi ro & lưu ý

- Google Calendar yêu cầu `conferenceDataVersion=1` trong query param mới tạo được Meet — nếu quên, event tạo thành công nhưng không có link.
- `requestId` cho `createRequest` phải unique mỗi lần tạo → dùng `crypto.randomUUID()` server-side.
- Nếu tài khoản Google Workspace bị giới hạn quyền tạo Meet, response vẫn 200 nhưng `conferenceData` có `status.statusCode = "failure"` → surface warning nhẹ ở Done ("Không tạo được Meet") thay vì crash.