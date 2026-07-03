# Deploy Tempo lên Vercel

Hướng dẫn deploy app **Tempo** (TanStack Start + Nitro) lên **Vercel**, kèm phần
kiểm tra bảo mật cơ bản.

> **Tóm tắt kỹ thuật:** app dùng TanStack Start build bằng Nitro. Mặc định Nitro
> target **Cloudflare** (cho Lovable). Ta đã pin thêm **preset `vercel`** trong
> [`vite.config.ts`](../vite.config.ts) để build ra **Vercel Build Output API**
> (`.vercel/output`). Bản build trên Lovable **vẫn tự ép về Cloudflare**, nên
> deploy Vercel và sync Lovable cùng tồn tại, không xung đột.

---

## 1. Những gì đã được cấu hình sẵn trong repo

| File | Thay đổi |
| --- | --- |
| [`vite.config.ts`](../vite.config.ts) | Thêm `nitro: { preset: "vercel" }` → build ra `.vercel/output`. |
| [`vercel.json`](../vercel.json) | Pin `installCommand: bun install`, `buildCommand: bun run build`, `framework: null`. |
| [`.gitignore`](../.gitignore) | Bỏ qua `.vercel/`, `.env`, `.env.*` (giữ lại `.env.example`). |
| [`src/server.ts`](../src/server.ts) | Thêm **HTTP security headers** cho mọi response (chi tiết ở §6). |

Không cần chỉnh gì thêm về build. Việc còn lại chỉ là **tạo project trên Vercel**
và **khai báo biến môi trường**.

---

## 2. Chuẩn bị

- Tài khoản [Vercel](https://vercel.com) (free tier là đủ).
- Repo đã push lên GitHub/GitLab/Bitbucket (khuyến nghị) **hoặc** cài
  [Vercel CLI](https://vercel.com/docs/cli): `bun add -g vercel`.
- Đủ 5 secret (xem §3).

---

## 3. Biến môi trường (Environment Variables)

Khai báo trong **Vercel → Project → Settings → Environment Variables**. Chọn cả 3
môi trường **Production / Preview / Development** cho mỗi biến.

| Biến | Bắt buộc | Lấy ở đâu | Ghi chú |
| --- | :---: | --- | --- |
| `GROQ_API_KEY` | ✅ | https://console.groq.com/keys | Speech-to-text (Whisper). |
| `DEEPSEEK_API_KEY` | ✅ | https://platform.deepseek.com/api_keys | Phân tích task. |
| `GOOGLE_CLIENT_ID` | ✅ | Google Cloud Console → OAuth client (Web) | Xem §5. |
| `GOOGLE_CLIENT_SECRET` | ✅ | Cùng OAuth client ở trên | **Không** để lộ ra client. |
| `SESSION_SECRET` | ✅ | Tự sinh: `openssl rand -base64 32` | ≥ 32 ký tự ngẫu nhiên. Mã hoá cookie `tempo-google`. |

> ⚠️ **Không** đặt tiền tố `VITE_` cho các biến này — biến `VITE_*` sẽ bị nhét vào
> **client bundle** và lộ secret. Các server function đọc chúng qua `process.env`
> ở phía server nên giữ nguyên tên như trên.

---

## 4. Deploy

### Cách A — Git integration (khuyến nghị)

1. Vercel Dashboard → **Add New… → Project** → chọn repo.
2. Vercel tự đọc [`vercel.json`](../vercel.json):
   - **Framework Preset:** Other
   - **Install Command:** `bun install`
   - **Build Command:** `bun run build`
   - **Output Directory:** *(để trống — Vercel tự nhận `.vercel/output`)*
3. Mở **Environment Variables**, dán 5 biến ở §3.
4. Bấm **Deploy**. Mỗi lần push lên nhánh chính → Vercel tự build lại (Preview cho
   các nhánh khác / PR).

### Cách B — Vercel CLI

```bash
vercel login
vercel link            # liên kết thư mục với 1 project Vercel
# Thêm secret cho từng môi trường (lặp lại cho mỗi biến ở §3):
vercel env add GROQ_API_KEY
vercel env add DEEPSEEK_API_KEY
vercel env add GOOGLE_CLIENT_ID
vercel env add GOOGLE_CLIENT_SECRET
vercel env add SESSION_SECRET

vercel                 # deploy preview
vercel --prod          # deploy production
```

---

## 5. Cấu hình Google OAuth (BẮT BUỘC sau khi có domain)

App kết nối Google Calendar bằng OAuth per-browser; redirect URI được tính động là
`https://<domain>/auth/callback`. Sau khi biết domain Vercel:

1. [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services →
   Credentials** → mở OAuth client (Web application).
2. **Authorized redirect URIs** — thêm (giữ cả cái localhost để dev tiếp):
   ```
   http://localhost:<port-dev>/auth/callback
   https://<domain-của-bạn>.vercel.app/auth/callback
   https://<custom-domain>/auth/callback   ← nếu có domain riêng
   ```
3. **Enable** "Google Calendar API" (APIs & Services → Library).
4. **OAuth consent screen:** ở chế độ *Testing*, refresh token **hết hạn sau 7
   ngày** → user phải kết nối lại. Muốn dùng lâu dài, **Publish** app (hoặc thêm
   user vào danh sách Test users để test).

> Sau khi đổi redirect URI, thay đổi có hiệu lực gần như ngay; nếu lỗi
> `redirect_uri_mismatch`, kiểm tra khớp **chính xác** cả `https` lẫn dấu `/`.

---

## 6. Kiểm tra bảo mật cơ bản (Security Review)

Đã rà soát codebase. Bảng dưới liệt kê các **test case bảo mật**, kết quả hiện tại,
và khắc phục.

| # | Test case | Khu vực | Mức độ | Kết quả | Ghi chú / Khắc phục |
| :-: | --- | --- | :-: | :-: | --- |
| 1 | Secret **không** lọt vào client bundle | Secrets | Cao | ✅ Đạt | Keys chỉ đọc `process.env` trong `*.server.ts` / server fn; không có `VITE_*` chứa secret. |
| 2 | Không commit file bí mật | Secrets | Cao | ✅ Đạt | `.dev.vars`/`.env*` đã gitignore & **không** bị git track (đã verify). |
| 3 | Cookie phiên được bảo vệ | Session | Cao | ✅ Đạt | `httpOnly` + `secure` + `sameSite=lax` + mã hoá bằng `SESSION_SECRET` (`google.server.ts`). |
| 4 | Validate & giới hạn input | Input | TB | ✅ Đạt | Zod cho mọi server fn (audio ≤ 7 MB, transcript ≤ 10k, title ≤ 300…). |
| 5 | Chống SSRF | Network | TB | ✅ Đạt | Server chỉ `fetch` tới host cố định (Groq/DeepSeek/Google); không có URL do user điều khiển. |
| 6 | Validate origin của `postMessage` | Client | TB | ✅ Đạt | Listener kiểm tra `e.origin === window.location.origin` (`index.tsx`). |
| 7 | Chống XSS | Output | Cao | ✅ Đạt | React auto-escape; trang lỗi SSR là HTML tĩnh; `dangerouslySetInnerHTML` chỉ ở `chart.tsx` (config của dev, không phải input user). |
| 8 | Supply-chain dependency | Build | TB | ✅ Đạt | `bunfig.toml` bật `minimumReleaseAge = 24h`. |
| 9 | Ép HTTPS + HSTS | Transport | TB | ✅ Đạt | Vercel ép HTTPS; header `Strict-Transport-Security` đã thêm (xem #10). |
| 10 | HTTP security headers | Headers | TB | ✅ **Đã khắc phục** | Thêm `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `HSTS`, `Permissions-Policy` trong `src/server.ts`. `Permissions-Policy` cho phép `microphone=(self)` vì đây là tính năng lõi. |
| 11 | OAuth có tham số `state` (chống CSRF) | OAuth | TB | ❌ **Chưa có** | `buildAuthUrl` chưa gửi `state`. **Khuyến nghị:** sinh `state` ngẫu nhiên, lưu tạm, verify ở callback. |
| 12 | Rate limit cho endpoint gọi API trả phí | Abuse | TB–Cao | ⚠️ **Chưa có** | `transcribeAudio`/`parseTasks` public → có thể bị lạm dụng, đốt quota/chi phí Groq & DeepSeek. **Khuyến nghị:** rate limit theo IP, hoặc thêm Cloudflare Turnstile / captcha. |
| 13 | Không rò rỉ lỗi upstream cho client | Info leak | Thấp | ⚠️ Nên sửa | Thông báo lỗi kèm `txt.slice(0,200)` từ provider. **Khuyến nghị:** log ở server, trả message chung cho user. |
| 14 | Content-Security-Policy | Headers | Thấp | ⚠️ Chưa có | Chưa đặt CSP (dễ vỡ app nếu sai). **Khuyến nghị:** thêm CSP `default-src 'self'` + allowlist khi có thời gian test kỹ. |
| 15 | `SESSION_SECRET` đủ mạnh | Config | Cao | ⚙️ Cấu hình | Phải là chuỗi ngẫu nhiên ≥ 32 ký tự (`openssl rand -base64 32`); không tái dùng giá trị mẫu. |
| 16 | App public, không cổng đăng nhập | Design | Info | ℹ️ Theo thiết kế | Cố ý mở public; Calendar được bảo vệ bằng refresh token trong cookie mã hoá — chỉ chủ trình duyệt đã kết nối mới gọi được. |

**Kết luận:** đủ an toàn để deploy. Ưu tiên xử lý tiếp #12 (rate limit — quan
trọng nhất vì liên quan chi phí) rồi #11 (OAuth `state`).

---

## 7. Checklist sau deploy

- [ ] Trang chủ `https://<domain>/` load được (không màn hình lỗi).
- [ ] Ghi âm → transcribe ra tiếng Việt.
- [ ] Parse ra được danh sách task có ngày/giờ.
- [ ] Modal "Kết nối Google Calendar" → popup OAuth chạy xong, tự đóng.
- [ ] Thêm được event vào Google Calendar.
- [ ] Kiểm tra header bảo mật:
      `curl -sI https://<domain>/ | grep -iE "x-frame|x-content|referrer|strict-transport|permissions"`
- [ ] DevTools → Application → Cookies: cookie `tempo-google` có `HttpOnly` + `Secure`.

---

## 8. Xử lý sự cố

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
| --- | --- | --- |
| `redirect_uri_mismatch` | Chưa thêm domain vào Google OAuth | §5 — thêm đúng `https://<domain>/auth/callback`. |
| Lỗi "… chưa được cấu hình" | Thiếu env trên Vercel | §3 — kiểm tra đủ 5 biến, đúng môi trường; **redeploy** sau khi thêm env. |
| Kết nối Google rồi vẫn hỏi lại sau ~7 ngày | OAuth consent ở chế độ *Testing* | §5.4 — Publish app. |
| Build fail trên Vercel | Sai install/build command | Đảm bảo Vercel dùng `bun install` + `bun run build` (đã có trong `vercel.json`). |
| Đổi env nhưng không ăn | Env chỉ áp dụng cho build mới | Vào **Deployments → Redeploy**. |

> **Lưu ý về Lovable:** đừng force-push / rebase / amend commit đã push — nhánh
> chính vẫn sync sang Lovable. `vite.config.ts` pin `preset: "vercel"` **không** ảnh
> hưởng build Lovable (Lovable tự ép Cloudflare), nên hai bên chạy song song an toàn.
