
# Tempo — Voice-to-Calendar (mobile web app)

Một web app dạng mobile (khung dọc, tối giản, dark mode, accent Brand Purple `#a855f7`) cho phép nhấn 1 nút để nói bằng tiếng Việt, AI parse ra danh sách task, duyệt từng task, rồi thêm vào Google Calendar của bạn.

## Design system (dark + Brand Purple)

Áp dụng DESIGN-minimax.md đảo sang dark:
- Canvas: `#0a0a0a` (near-black), surface `#141416`, elevated `#1c1c1f`, hairline `#2a2a2e`
- Text: `#ffffff` primary, `#a8aab2` muted
- Accent duy nhất: Brand Purple `#a855f7` (nút record, focus ring, progress, tick xác nhận)
- Typography: DM Sans toàn bộ, hero 40–56px với letter-spacing âm, body 16px
- Nút chính: pill bo tròn đầy, giữ ngôn ngữ "black pill" nhưng đổi sang purple pill cho primary trên nền tối
- Radius lớn (rounded-2xl/3xl), spacing rộng rãi, motion mượt (framer-motion transitions ~200–300ms)

## Flow

```text
┌ Home ────────────┐   ┌ Processing ─┐   ┌ Review ─────────┐   ┌ Done ──────┐
│  logo Tempo      │   │ waveform +   │   │ Card 1/N        │   │ ✓ Đã thêm  │
│                  │─▶ │ "đang nghe…" │─▶ │ title / giờ /   │─▶ │  N task    │
│    ⬤ record      │   │ rồi          │   │ độ dài, edit    │   │ Xem lịch → │
│  "Bấm để nói"    │   │ "đang parse" │   │ [Bỏ qua][Thêm]  │   │ Ghi tiếp   │
└──────────────────┘   └──────────────┘   └─────────────────┘   └────────────┘
```

1. **Home**: nút record tròn lớn ở giữa (purple với glow nhẹ), tap 1 lần bắt đầu, tap lại dừng. Waveform animation khi đang ghi. Timer đếm giây phía dưới.
2. **Processing**: gửi audio (WAV, capture bằng Web Audio API — không dùng MediaRecorder chunks) tới server function → STT (`openai/gpt-4o-mini-transcribe`) → parse task (Gemini `google/gemini-3-flash-preview`, JSON schema: `[{title, durationMin, explicitTime?}]`). Hiển thị 2 trạng thái: "Đang nghe" → "Đang phân tích".
3. **Review — duyệt từng task**: card lớn hiện task, giờ bắt đầu (đã tính slot trống kế tiếp trong Google Calendar hôm nay), độ dài (mặc định 30 phút, override nếu user nói khác). Inline edit tiêu đề/giờ/độ dài. Hai nút: "Bỏ qua" (outline) và "Thêm vào Calendar" (purple pill). Progress dot 1/N ở trên.
4. **Done**: xác nhận N task đã thêm, có link mở Google Calendar và nút "Ghi tiếp".

## Slot allocation (hôm nay)

- Sau khi parse xong, gọi Google Calendar `events.list` cho `primary` từ `now` đến `23:59` hôm nay (timezone Asia/Ho_Chi_Minh).
- Với mỗi task, tìm khoảng trống liên tiếp ≥ `durationMin` bắt đầu từ `max(now, cursor)`. Sau khi user approve một task, cursor nhảy tới `end` của task đó (để task tiếp theo tự né).
- Nếu user nói giờ cụ thể ("3h chiều", "lúc 10h"), dùng giờ đó bất kể xung đột — chỉ cảnh báo nhẹ nếu trùng.

## Google Calendar — hard-code tài khoản của bạn

Dùng Google Calendar connector (gateway-enabled). Connector này authenticate 1 tài khoản duy nhất ở cấp workspace — chính là điều bạn muốn: "hard-code tài khoản Google của tôi".
- Kết nối 1 lần qua Connectors → Google Calendar.
- Server function gọi `https://connector-gateway.lovable.dev/google_calendar/calendar/v3/calendars/primary/events` với 2 header: `Authorization: Bearer ${LOVABLE_API_KEY}` và `X-Connection-Api-Key: ${GOOGLE_CALENDAR_API_KEY}`.
- Không có màn "Sign in with Google" trong app.

## Technical details

**Stack**: TanStack Start hiện tại, không cần Lovable Cloud (không auth, không DB).

**Routes**:
- `src/routes/index.tsx` — toàn bộ flow trong 1 route, dùng state machine (`idle | recording | processing | reviewing | done`).

**Server functions** (`src/lib/*.functions.ts`):
- `transcribeAudio({ audioBase64, mime })` — POST tới Lovable AI `/v1/audio/transcriptions` với `openai/gpt-4o-mini-transcribe`, trả về `{ text }`.
- `parseTasks({ transcript })` — gọi Gemini với structured output, trả về `Task[] = { title, durationMin, explicitStart?: "HH:mm" }`.
- `listTodayEvents()` — gọi gateway `events.list`, trả về busy blocks còn lại trong ngày.
- `createEvent({ title, startISO, endISO })` — gateway `events.insert`, timezone `Asia/Ho_Chi_Minh`.

**Client**:
- Capture bằng Web Audio API + AudioContext (16 kHz mono WAV) — theo hướng dẫn ai-speech-to-text, tránh MediaRecorder timeslice và mp4 fragmented trên iOS Safari.
- Framer-motion cho transitions giữa các state.
- `lucide-react` icons: `Mic`, `Square`, `Check`, `X`, `Calendar`, `Clock`, `Pencil`.

**Design tokens**: cập nhật `src/styles.css` với palette dark + DM Sans, dùng `@theme inline`. Load DM Sans qua `<link>` trong `__root.tsx` (không `@import` URL trong CSS).

**Metadata**: set title "Tempo — Voice tasks to Calendar", description tiếng Việt trong `__root.tsx`.

## Setup bạn cần làm 1 lần

1. Cho phép link Google Calendar connector (mình sẽ nhắc trong lúc build).
2. Không cần gì thêm — `LOVABLE_API_KEY` đã có sẵn.

## Out of scope (phiên bản này)

- Multi-account Google, sign-in flow, lịch không phải hôm nay, recurring events, reminders/notifications, offline mode, lưu lịch sử recordings.
