export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <title>Trang không tải được · Tempo</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#0a0a0a" />
    <style>
      body { font: 15px/1.5 "DM Sans", system-ui, -apple-system, sans-serif; background: #0a0a0a; color: #ffffff; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; letter-spacing: -0.01em; -webkit-font-smoothing: antialiased; }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 2rem; }
      .badge { width: 56px; height: 56px; margin: 0 auto 1.25rem; border-radius: 9999px; display: grid; place-items: center; background: rgba(168, 85, 247, 0.12); border: 1px solid rgba(168, 85, 247, 0.4); }
      .badge svg { width: 26px; height: 26px; stroke: #a855f7; }
      h1 { font-size: 1.25rem; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 0.5rem; }
      p { color: #a8aab2; margin: 0 0 1.5rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a, button { height: 44px; padding: 0 1.5rem; border-radius: 9999px; font: inherit; font-weight: 600; cursor: pointer; text-decoration: none; border: 1px solid transparent; display: inline-flex; align-items: center; }
      .primary { background: #a855f7; color: #ffffff; box-shadow: 0 16px 40px -18px rgba(168, 85, 247, 0.9), 0 0 0 1px rgba(168, 85, 247, 0.35); }
      .secondary { background: transparent; color: #ffffff; border-color: #2a2a2e; font-weight: 500; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="badge">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>
      </div>
      <h1>Trang không tải được</h1>
      <p>Đã có lỗi xảy ra. Bạn có thể thử lại hoặc quay về trang chủ.</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()">Thử lại</button>
        <a class="secondary" href="/">Về trang chủ</a>
      </div>
    </div>
  </body>
</html>`;
}
