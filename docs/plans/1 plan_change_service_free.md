# Kế hoạch: Rời Lovable → Groq (STT) + DeepSeek (parse) + Google Calendar đăng nhập web

## Bối cảnh

Toàn bộ AI + Calendar hiện đi qua **Lovable gateway** (tốn phí, phụ thuộc Lovable). Mục tiêu rời hẳn Lovable:
- **STT** → Groq Whisper (miễn phí).
- **Parse task** → DeepSeek.
- **Google Calendar** → gọi API Google trực tiếp, **đăng nhập Google trên web** (modal + popup) rồi **lưu token** để lần sau tự dùng. Chấp nhận tạo OAuth credential trên Google Cloud 1 lần.

**Đã kiểm chứng:** Groq **không còn host DeepSeek** (`deepseek-r1-distill-llama-70b` shutdown 02/10/2025) → parse phải dùng **API riêng của DeepSeek** (2 key). Nguồn: [Groq deprecations](https://console.groq.com/docs/deprecations).

## Quyết định đã chốt
1. **STT → Groq Whisper** `whisper-large-v3` (free tier), `GROQ_API_KEY`. Giữ nguyên pipeline ghi âm của client.
2. **Parse → DeepSeek** `deepseek-chat` qua `api.deepseek.com`, `DEEPSEEK_API_KEY`. Giữ nguyên system prompt tiếng Việt + JSON mode + chuẩn hoá task.
3. **Calendar → đăng nhập Google trên web (OAuth), lưu refresh token vào cookie phiên.** Không nhập token thủ công. Modal + popup, mỗi browser mới kết nối 1 lần; hết hạn thì bấm kết nối lại.

## Ràng buộc runtime (quan trọng)
Deploy Cloudflare Workers (Nitro). Chỉ dùng API web chuẩn: `fetch`, `FormData`, `Blob`, Web Crypto, `useSession` (Workers-safe). **KHÔNG** `node:*`, **KHÔNG** SDK `googleapis`. Mọi việc với Google là `fetch` thẳng tới endpoint OAuth/Calendar. Cache token trong biến module chỉ best-effort → nguồn chân lý là refresh token trong cookie. Không thêm package nào (Groq/DeepSeek đều OpenAI-compatible).

---

## Thay đổi code

### A) `src/lib/tempo.functions.ts` — STT (Groq) + Parse (DeepSeek) + đổi nguồn token Calendar

Hằng số (dòng 5-8):
```ts
const GROQ_BASE = "https://api.groq.com/openai/v1";
const DEEPSEEK_BASE = "https://api.deepseek.com";
const GCAL_BASE = "https://www.googleapis.com/calendar/v3";
const TZ = "Asia/Ho_Chi_Minh";
```

**`transcribeAudio` → Groq:** key `process.env.GROQ_API_KEY` (thiếu → `throw "GROQ_API_KEY chưa được cấu hình"`); endpoint `POST ${GROQ_BASE}/audio/transcriptions`; `form.append("model", "whisper-large-v3")`; header **chỉ** `Authorization: Bearer <key>` (KHÔNG set `Content-Type`). Giữ nguyên FormData (`file` Blob `recording.<ext>`, `language: "vi"`) và mapping `{ text }`. *(Muốn nhanh/nhẹ hơn: `whisper-large-v3-turbo`.)*

**`parseTasks` → DeepSeek:** key `process.env.DEEPSEEK_API_KEY` (thiếu → `throw "DEEPSEEK_API_KEY chưa được cấu hình"`); endpoint `POST ${DEEPSEEK_BASE}/chat/completions`; `model: "deepseek-chat"`; header `Authorization: Bearer <key>` + `Content-Type: application/json`; giữ `response_format: { type: "json_object" }` (prompt đã chứa "JSON"). Giữ nguyên toàn bộ tính giờ Sài Gòn, system prompt, và chuẩn hoá task JS.

**`listTodayEvents` / `createEvent` → Google trực tiếp:** thay `gcalHeaders()` cũ (2 header Lovable) bằng:
```ts
async function gcalHeaders() {
  const { getAccessToken } = await import("./google.server");
  const token = await getAccessToken();
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}
```
và đổi 2 call site thành `headers: await gcalHeaders()`. URL (từ `GCAL_BASE`), request body, parse response, `crypto.randomUUID()` cho Meet — **giữ nguyên** (Lovable connector vốn mirror Google Calendar v3).

### B) `src/lib/google.server.ts` — MỚI, server-only (OAuth + lưu token)
Import động trong handler (`await import("./google.server")`). Chứa:
- `sessionConfig()`: `useSession` (`@tanstack/react-start/server`), cookie `tempo-google`, `password: process.env.SESSION_SECRET` (≥ 32 ký tự), `httpOnly/secure/sameSite=lax`.
- `buildAuthUrl(redirectUri)`: URL `https://accounts.google.com/o/oauth2/v2/auth` với `response_type=code`, `access_type=offline`, `prompt=consent`, `scope=https://www.googleapis.com/auth/calendar`, `client_id=process.env.GOOGLE_CLIENT_ID`, `redirect_uri`.
- `exchangeCode(code, redirectUri)`: `POST https://oauth2.googleapis.com/token` (grant_type=authorization_code, client_id/secret, code, redirect_uri) → lấy `refresh_token` → lưu vào cookie (`session.update({ refreshToken })`).
- `getAccessToken()`: đọc `refreshToken` từ cookie; không có → `throw` mã `GOOGLE_NOT_CONNECTED` ("Chưa kết nối Google Calendar"). Có → `POST oauth2.googleapis.com/token` (grant_type=refresh_token) → `access_token` (cache in-memory theo `expires_in`, best-effort). Gặp `invalid_grant` (hết hạn/thu hồi) → xoá cookie + throw `GOOGLE_NOT_CONNECTED`.
- `isConnected()` / `disconnect()`: đọc/ xoá cookie.

Chỉ `fetch` + `URLSearchParams` + `useSession` → Workers-safe.

### C) `src/lib/google.functions.ts` — MỚI, server functions (RPC)
`getGoogleAuthUrl({ redirectUri })`, `connectGoogle({ code, redirectUri })`, `googleStatus()` → `{ connected }`, `disconnectGoogle()`. Mỗi hàm `await import("./google.server")`.

### D) `src/routes/auth.callback.tsx` — MỚI, route `/auth/callback` (đích của popup)
Google redirect popup về đây kèm `?code` (hoặc `?error`). Component client đọc `code`, gọi `connectGoogle({ code, redirectUri })` khi mount để đổi code→token + set cookie. Xong:
- Nếu mở từ popup (`window.opener`): `window.opener.postMessage("google-connected", location.origin)` rồi `window.close()`.
- Nếu không phải popup (fallback): `router.navigate({ to: "/" })`.
- `?error`/thất bại → thông báo ngắn tiếng Việt rồi đóng/điều hướng.

### E) `src/routes/index.tsx` + modal kết nối — modal khi LẦN ĐẦU cần lịch trên mỗi browser mới
- **Thời điểm:** đúng lúc luồng chạm bước lịch lần đầu (ngay trước `listTodayEvents`, tức sau khi ghi âm xong) — KHÔNG hỏi lúc mới vào trang. Gọi `googleStatus()`; nếu `connected=false` → **hiện modal "Kết nối Google Calendar"**.
- **Modal + popup (giữ task đang xử lý):** nút "Đăng nhập bằng Google" → `getGoogleAuthUrl({ redirectUri: \`${location.origin}/auth/callback\` })` rồi **`window.open(url, "google-oauth", "popup,width=480,height=640")`** (KHÔNG redirect cả trang → không mất audio/tasks vừa parse). Trang chính nghe `message === "google-connected"` (kiểm tra `origin`) hoặc popup đóng → gọi lại `googleStatus()`; đã kết nối → đóng modal + **tiếp tục** `listTodayEvents` → review bình thường.
- **Token hết hạn giữa chừng:** bắt `GOOGLE_NOT_CONNECTED` từ `listTodayEvents`/`createEvent` → mở lại modal → kết nối xong retry đúng bước đang dở.
- Token lưu cookie theo **từng browser** → mỗi browser mới thấy modal đúng 1 lần. STT/parse không phụ thuộc Google → vẫn chạy. Pipeline ghi âm, `findSlot`, review UI, Meet toggle **giữ nguyên**. Modal theo phong cách UI hiện tại (`motion/react`), inline trong `index.tsx` hoặc `src/components/google-connect-modal.tsx`.

*(Không cần `VITE_` client env: `client_id` ghép trong server fn; client chỉ gửi `redirectUri` từ `location.origin`.)*

---

## Biến môi trường

**Thêm:**
| Biến | Dùng ở | Ghi chú |
| --- | --- | --- |
| `GROQ_API_KEY` | `transcribeAudio` | console.groq.com |
| `DEEPSEEK_API_KEY` | `parseTasks` | platform.deepseek.com |
| `GOOGLE_CLIENT_ID` | `google.server` | OAuth Web client (mục dưới) |
| `GOOGLE_CLIENT_SECRET` | `google.server` | OAuth Web client |
| `SESSION_SECRET` | `google.server` (cookie) | chuỗi ngẫu nhiên **≥ 32 ký tự** |

**Gỡ** (sau khi verify): `LOVABLE_API_KEY`, `GOOGLE_CALENDAR_API_KEY`. **Không cần** `GOOGLE_REFRESH_TOKEN` (token nằm trong cookie).
**Set ở:** Lovable secret store (production) + `.dev.vars` gốc repo (local, đã .gitignore). Lỗi thiếu biến giữ tiếng Việt.

---

## Hướng dẫn tạo Google OAuth Web client (1 lần — KHÔNG cần OAuth Playground)

> Google bắt buộc có OAuth client để ghi lịch riêng (API key không ghi được). Chỉ tạo 1 lần; app tự lo lấy & lưu token.

**B1.** console.cloud.google.com → tạo/chọn project.
**B2.** APIs & Services → Library → **Enable "Google Calendar API"**.
**B3.** OAuth consent screen → **External** → điền App name + email → thêm scope `https://www.googleapis.com/auth/calendar` → **Test users**: thêm Gmail của bạn.
**B4.** Credentials → Create Credentials → **OAuth client ID** → type **Web application** → **Authorized redirect URIs** thêm:
- `http://localhost:<port>/auth/callback` (port do `vite dev` in ra)
- `https://<domain-production>/auth/callback`
→ copy **Client ID** → `GOOGLE_CLIENT_ID`, **Client secret** → `GOOGLE_CLIENT_SECRET`.
**B5. ⚠️ Tránh hết hạn 7 ngày:** ở "Testing", refresh token scope nhạy cảm **hết hạn sau 7 ngày**. Để bền: OAuth consent screen → **Publish App** (Production). App cá nhân không cần Google verify, chỉ hiện cảnh báo "unverified" 1 lần. (Nếu để Testing thì ~7 ngày phải bấm "Kết nối" lại — vẫn 1 click.)

Sau đó: mở app → bấm **"Kết nối Google Calendar"** (modal) → đăng nhập ở popup → xong; app tự lưu token, lần sau tự dùng lại.

---

## Kiểm thử (end-to-end)
Chạy từ gốc repo (lưu ý `bun` có thể không có trong PATH → dùng `node_modules/.bin/*`).
1. **Type check:** `node_modules/.bin/tsc --noEmit` → 0 lỗi.
2. Tạo `.dev.vars` đủ 5 biến. **Chạy:** `node_modules/.bin/vite dev` → mở URL localhost (đăng ký đúng port này ở B4).
3. **Kết nối Google:** bước lịch đầu tiên → modal hiện → popup đăng nhập → về `/`, `googleStatus()` = connected (cookie `tempo-google` set); popup không làm mất tasks đang parse.
4. **STT (Groq):** nói *"Họp nhóm 3 giờ chiều mai trong một tiếng"* → text đúng. Thiếu `GROQ_API_KEY` → lỗi tiếng Việt.
5. **Parse (DeepSeek):** review card đúng tiêu đề/ngày mai/15:00/60 phút. Thử *"từ 9 tới 10 giờ"*, *"thứ Sáu tuần sau"* → resolve đúng giờ Sài Gòn.
6. **List hôm nay:** đặt 1 event thật hôm nay → task auto-schedule né block bận.
7. **Tạo event (không Meet):** duyệt → mở `htmlLink` thấy event + nhắc popup 30 phút.
8. **Tạo event (có Meet):** bật "Tạo link" → có nút "Mở Google Meet", `meetStatus=success`.
9. **Ngắt/hết hạn:** `disconnectGoogle()` (hoặc xoá cookie) → bước lịch báo `GOOGLE_NOT_CONNECTED` → modal hiện lại.

## Rủi ro
- **Refresh token hết hạn 7 ngày (Testing):** khắc phục = Publish Production (B5). Nếu để Testing, client tự mời "Kết nối" lại (1 click) khi gặp `invalid_grant`.
- **Cache token trên Workers** best-effort: isolate mới refresh lại token 1 lần (~200ms), vô hại.
- **DeepSeek chậm/quá tải:** chạy sau spinner "Đang hiểu nội dung…"; JSON hỏng có `try/catch → {}` đỡ. *(Tuỳ chọn: `max_tokens` + timeout.)*
- **Groq rate limit** free tier: 1 người dùng dư sức; chạm giới hạn → `whisper-large-v3-turbo`.
- **Set-cookie qua popup:** popup `/auth/callback` gọi server fn `connectGoogle` (client-initiated) để set cookie ổn định, tránh phụ thuộc set-cookie khi SSR.
- **Popup bị chặn:** gọi `window.open` NGAY trong sự kiện click; nếu trả `null` → fallback redirect cả trang (chấp nhận mất task đang parse — hiếm).

## File đụng tới
- Sửa: `src/lib/tempo.functions.ts` (STT→Groq, parse→DeepSeek, calendar auth), `src/routes/index.tsx` (modal + popup + trạng thái/retry).
- Tạo mới: `src/lib/google.server.ts`, `src/lib/google.functions.ts`, `src/routes/auth.callback.tsx`; tuỳ chọn tách `src/components/google-connect-modal.tsx`.
- `.dev.vars` (mới, không commit). Tuỳ chọn: cập nhật `CLAUDE.md` (env/providers + dùng lại `useSession`/`SESSION_SECRET`).
