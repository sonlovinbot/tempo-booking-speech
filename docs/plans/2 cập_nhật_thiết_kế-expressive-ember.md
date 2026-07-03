# Cập nhật thiết kế Tempo — MiniMax-dark + Brand Purple

## Context

Yêu cầu: áp dụng design system MiniMax (từ `DESIGN-minimax.md`) cho toàn dự án Tempo, ở **dark mode**, với **một màu nhấn duy nhất là Brand Purple `#a855f7`**.

**Phát hiện then chốt từ exploration:** design này **đã được dựng ~80%** trong `src/styles.css` — `:root` đã có sẵn palette tím MiniMax-dark đúng chuẩn (`--primary: oklch(62.09% 0.2334 302.2)` = `#a855f7`), font DM Sans, các utility `purple-glow` / `text-hero` / `text-display`, và `src/routes/index.tsx` đã dùng nút ghi âm tím, pill buttons, card viền hairline, `purple-glow` trên mọi CTA.

**Nhưng có một bug CSS khiến toàn bộ thiết kế tím không hiển thị:** dark mode bị khoá cứng qua `<html class="dark">`, và block `.dark` (styles.css dòng 107-140) **ghi đè `:root`** bằng palette xanh-xám mặc định còn sót của shadcn. Kết quả: `--primary` render ra xám gần-trắng trên nền ngả xanh — màu tím không bao giờ xuất hiện.

→ Việc chính là **hoà giải palette để màu tím render đúng**, tinh chỉnh token khớp chuẩn MiniMax-dark, và đưa vài bề mặt lệch thương hiệu (404 / error boundary / trang lỗi SSR) về đồng bộ.

**Quyết định thiết kế đã chốt với người dùng:**
1. Màu tím đóng vai trò **nút chính** (purple-forward): mọi CTA chính là pill tím + `purple-glow`. Đây là bản dịch dark-mode của "black pill" MiniMax (nút đen biến mất trên nền đen → thay bằng tím).
2. Phạm vi **toàn diện**, gồm cả các trang lỗi.

---

## 1. Hoà giải & tinh chỉnh palette — `src/styles.css` (thay đổi cốt lõi)

**Vấn đề:** block `.dark` (dòng 107-140) chứa palette xanh-xám shadcn, thắng `:root` do specificity cao hơn + `<html class="dark">` luôn bật.

**Giải pháp:** vì dark mode là vĩnh viễn (không có toggle), đặt **cùng một palette tím MiniMax-dark** vào cả `:root` và `.dark` để dù selector nào thắng cũng ra tím, tránh mọi rủi ro nhấp nháy/divergence. Cụ thể: **thay toàn bộ giá trị token màu trong block `.dark`** bằng palette tím (mirror `:root`), tinh chỉnh cho khớp chính xác spec MiniMax-dark:

| Token | Giá trị (oklch) | Hex mục tiêu | Ghi chú |
|---|---|---|---|
| `--background` | `oklch(0.09 0 0)` | `#0a0a0a` | canvas MiniMax-dark |
| `--foreground` | `oklch(1 0 0)` | `#ffffff` | ink |
| `--card` | `oklch(0.16 0 0)` | `~#141416` | surface |
| `--card-foreground` | `oklch(1 0 0)` | `#ffffff` | |
| `--popover` | `oklch(0.19 0 0)` | `~#1c1c1f` | elevated |
| `--popover-foreground` | `oklch(1 0 0)` | | |
| `--primary` | `oklch(62.09% 0.2334 302.2)` | `#a855f7` | **brand purple** |
| `--primary-foreground` | `oklch(1 0 0)` | `#ffffff` | chữ trắng trên tím |
| `--secondary` | `oklch(0.19 0 0)` | `~#1c1c1f` | |
| `--secondary-foreground` | `oklch(1 0 0)` | | |
| `--muted` | `oklch(0.17 0 0)` | `~#17181a` | |
| `--muted-foreground` | `oklch(0.72 0.01 260)` | `#a8aab2` | muted MiniMax |
| `--accent` | `oklch(62.09% 0.2334 302.2)` | `#a855f7` | = primary |
| `--accent-foreground` | `oklch(1 0 0)` | | |
| `--destructive` | `oklch(0.65 0.22 25)` | đỏ | |
| `--destructive-foreground` | `oklch(1 0 0)` | | |
| `--border` | `oklch(0.24 0 0)` | `#2a2a2e` | hairline MiniMax |
| `--input` | `oklch(0.19 0 0)` | `~#1c1c1f` | nền field hiện rõ |
| `--ring` | `oklch(62.09% 0.2334 302.2)` | `#a855f7` | focus tím |
| `--sidebar*` | đồng bộ nền tối + accent tím | | dọn màu xanh sót |
| `--chart-1..5` | giữ nguyên | | không dùng trong app |

- Đồng thời chỉnh `:root` (dòng 64-105) về **cùng bộ giá trị** trên để `:root` và `.dark` là một nguồn sự thật duy nhất (hiện `:root` đã gần đúng — chỉ tinh chỉnh `--card` 0.155→0.16, `--popover` 0.155→0.19 cho tách bậc surface/elevated).
- `.dark` không khai báo `--primary-glow`, `--surface-elevated`, `--hairline`, `--font-sans` → chúng fall through từ `:root`, giữ nguyên (đúng).
- **(Tuỳ chọn, low-priority)** đăng ký `--surface-elevated` và `--hairline` trong block `@theme inline` (dòng 21-62) thành `--color-surface-elevated` / `--color-hairline` để dùng như utility `bg-surface-elevated` / `border-hairline`. Không bắt buộc vì `index.tsx` đang dùng `bg-card`/`border-border`.

**Không cần đổi font** — DM Sans đã nạp sẵn qua Google Fonts trong `__root.tsx` (dòng 104-114) và đặt làm `--font-sans`. Các utility `text-hero` (80px, -0.035em) / `text-display` (56px) đã khớp chuẩn hero-display/display-lg của MiniMax. Giữ nguyên.

---

## 2. Tinh chỉnh màn hình chính — `src/routes/index.tsx`

Màn hình chính **đã đúng ngôn ngữ MiniMax purple-forward** (pill `rounded-full`, `bg-primary` + `purple-glow` trên CTA, card `rounded-3xl border border-border`, field `bg-input border border-border`, label uppercase `tracking-wider`). Sau khi sửa token ở mục 1, nó sẽ **tự render đúng màu tím**. Chỉ cần polish nhẹ, không đổi cấu trúc:

- Rà **tương phản** sau khi tím hiện: chữ trắng trên `bg-primary`, `text-primary` trên nền tối — xác nhận đạt AA cho text semibold.
- Thống nhất **focus ring** cho input/select/textarea/nút: dùng `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0` (token `--ring` giờ là tím) thay cho chỉ `focus:border-primary/60` ở vài chỗ, để có vòng focus tím rõ ràng (đáp ứng bàn phím — quality floor).
- Giữ nguyên nút ghi âm (`h-40 w-40 rounded-full bg-primary purple-glow` + `animate-ring`), visualizer `bg-primary/80`, logo tile — đây là các "khoảnh khắc nhận diện" của brand, sẽ toả sáng khi tím render.
- Kiểm tra `prefers-reduced-motion`: nếu chưa có, thêm ngắt các `animate-orb/ring/float` khi user bật giảm chuyển động (thêm `@media (prefers-reduced-motion: reduce)` trong styles.css tắt các animation này). Quality floor.

---

## 3. Đồng bộ các bề mặt lỗi (đang lệch thương hiệu)

### a) `src/routes/__root.tsx` — `NotFoundComponent` (dòng 16-36) & `ErrorComponent` (dòng 38-74)
Hiện dùng chữ **tiếng Anh** + nút `rounded-md bg-primary hover:bg-primary/90` (không phải pill). Sửa:
- Chuyển copy sang **tiếng Việt**: 404 → "Không tìm thấy trang" / "Trang bạn tìm không tồn tại"; error → "Trang không tải được" / "Đã có lỗi xảy ra, vui lòng thử lại".
- Nút → **pill** khớp app: chính `rounded-full bg-primary text-primary-foreground hover:brightness-110` (+ `purple-glow` nếu muốn nhất quán), phụ `rounded-full border border-border hover:bg-secondary`.
- Nền đã là `bg-background` → tự thành `#0a0a0a` sau mục 1.

### b) `src/lib/error-page.ts` — `renderErrorPage()` (HTML SSR thảm hoạ)
Chuỗi HTML độc lập với `<style>` inline, **hard-code theme sáng** (`background:#fafafa; color:#111;` + nút đen) — chói mắt và lệch brand khi có sự cố. Sửa **giá trị CSS inline** (không dùng token vì đây là HTML thô):
- `background: #0a0a0a; color: #ffffff;`
- Viền/hairline: `#2a2a2e`; text phụ: `#a8aab2`.
- Nút: nền `#a855f7`, chữ trắng, `border-radius: 9999px` (pill).
- `font-family: "DM Sans", system-ui, sans-serif;`
- Giữ nội dung tiếng Việt hiện có.
- (`theme-color` meta đã là `#0a0a0a` — không cần đổi.)

---

## 4. Files sẽ chỉnh sửa

- `src/styles.css` — **cốt lõi**: viết lại block `.dark` (và đồng bộ `:root`) thành palette tím MiniMax-dark; thêm `@media (prefers-reduced-motion)`; (tuỳ chọn) đăng ký `--color-surface-elevated`/`--color-hairline` trong `@theme inline`.
- `src/routes/index.tsx` — polish focus ring + tương phản (không đổi cấu trúc).
- `src/routes/__root.tsx` — Việt hoá + pill hoá `NotFoundComponent` & `ErrorComponent`.
- `src/lib/error-page.ts` — recolor HTML SSR sang dark + tím.

**Không đụng tới:** `src/routeTree.gen.ts` (auto-gen), `src/components/ui/*` (tự retheme qua token — app không import trực tiếp trừ Toaster), cấu hình Vite/plugins.

---

## 5. Kiểm thử (end-to-end)

1. `bun dev` → mở `localhost` (thường `:3000`). Xác nhận **màu tím render**: nền `#0a0a0a`, nút ghi âm tròn **tím** + glow, hero "Tempo" chữ tím, mọi CTA là pill tím.
2. Dùng skill `/browse` (KHÔNG dùng `mcp__claude-in-chrome__*`) chụp lần lượt các phase: idle → recording → processing → review → done → error, kiểm tra tím nhất quán + focus ring hiện khi tab bàn phím.
3. Vào URL không tồn tại (vd `/xyz`) → xác nhận trang 404 dark/tím/tiếng Việt với nút pill.
4. Rà `error-page.ts` bằng mắt (hoặc render tạm) → nền tối, nút tím.
5. `bunx tsc --noEmit` (không có script typecheck sẵn) + `bun run lint` → sạch.
6. `bun run build` → build pass (Nitro/Cloudflare).

**Lưu ý Lovable git sync:** không rebase/force-push/amend commit đã đẩy; giữ nhánh `main` ở trạng thái chạy được. Commit theo từng bước nhỏ.
