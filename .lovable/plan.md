## Vấn đề
Server trả `ok: false` cho mật khẩu bạn gõ → giá trị `SITE_PASSWORD` đang lưu không khớp chính xác (nhiều khả năng dính khoảng trắng / xuống dòng khi paste).

## Kế hoạch
1. Gọi `update_secret` cho `SITE_PASSWORD` để mở form bảo mật, bạn nhập lại mật khẩu mong muốn (VD `Cong_149`), không kèm khoảng trắng đầu/cuối.
2. Không đụng vào code — logic so khớp (SHA-256 + `timingSafeEqual`) đã đúng.
3. Sau khi lưu, thử vào lại `/unlock` và nhập mật khẩu — sẽ vào được.

## Ghi chú
- Nếu vẫn lỗi sau khi cập nhật, mình sẽ thêm `.trim()` phía server như biện pháp phòng hờ.
