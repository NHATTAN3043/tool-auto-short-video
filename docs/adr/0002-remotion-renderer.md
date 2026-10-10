# ADR 0002 — Render bằng Remotion, một composition cho cả preview và render

**Trạng thái:** Chấp nhận

## Bối cảnh

Cần dựng video dọc 1080×1920 từ cảnh, phụ đề tiếng Việt và âm thanh, đồng thời có preview trong trình duyệt
giống hệt file xuất ra. Dựng bằng FFmpeg filter thuần thì khó làm phụ đề đẹp, hiệu ứng và preview.

## Quyết định

- Dùng **Remotion 4** (React). Composition duy nhất là `ProjectVideo` trong `packages/video`, chỉ nhận `RenderPlan`.
  Preview (`@remotion/player`, M7) và worker (`@remotion/renderer`) dùng chung composition đó.
- Mọi package `remotion` / `@remotion/*` ghim **cùng một phiên bản chính xác** (hiện 4.0.532).
- Render trong worker qua adapter `renderer-remotion`: bundle một lần mỗi tiến trình, phục vụ file dự án bằng HTTP
  cục bộ, xuất H.264 + AAC, `yuv420p`, `colorSpace: bt709`, CRF 20.
- Font Be Vietnam Pro (SIL OFL) đóng gói trong repo để render không cần mạng.

## Hệ quả

- **Giấy phép Remotion:** miễn phí cho cá nhân và công ty tối đa 3 người. Lớn hơn thì cần mua license
  (kiểm tra remotion.dev/license).
- Cần Chrome: Remotion tự tải Chrome Headless Shell lần đầu (cần mạng tới storage.googleapis.com), hoặc trỏ
  `STUDIO_BROWSER_EXECUTABLE` tới Chrome/Edge có sẵn. Sau đó render chạy offline.
- Render chậm hơn FFmpeg thuần (khoảng 80 giây cho video 17 giây trên máy dev, gồm cả bundle).
- Đổi engine render sau này chỉ cần một adapter mới đọc `RenderPlan`; domain, services và UI không đổi.
