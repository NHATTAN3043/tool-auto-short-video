# ADR 0017 — Logo kênh hình tròn vẽ trong composition

**Trạng thái:** Chấp nhận · Bổ sung cho ADR 0002 (renderer Remotion), 0004 (gói CapCut)

## Bối cảnh

Video đăng lên TikTok, Shorts, Reels hay bị tải về rồi đăng lại dưới kênh khác. Người dùng cần gắn logo kênh dạng
hình tròn ở một góc, hiện suốt video, để video đăng lại vẫn mang tên kênh.

## Quyết định

- **Lưu trong `project.style.watermark`** (optional, nên file cũ vẫn hợp lệ và `schemaVersion` giữ nguyên 1): ảnh
  logo là một asset ảnh của dự án, cùng với góc, kích thước, khoảng cách tới mép (tỉ lệ khung), độ rõ và viền.
  Logo là cài đặt theo từng dự án; chưa có logo mặc định dùng chung cho cả kênh.
- **Không xử lý file:** ảnh gốc không bị cắt hay ghép bằng ffmpeg (rule 4). `buildRenderPlan` tính ô pixel
  (`RenderPlanWatermark`), `WatermarkLayer` vẽ `<Img>` với `border-radius: 50%` và `object-fit: cover`, nằm trên cùng,
  không mờ theo chuyển cảnh. Preview và render dùng cùng một plan nên giống hệt nhau (rule 8).
- **Mặc định ở góc trên trái**, cách mép ngang 4% và mép trên 7%, để tránh tab "Following/For You". Đổi sang góc dưới
  mà không tự chỉnh khoảng cách thì lấy khoảng cách an toàn 22% từ đáy, để tránh tên kênh, mô tả và cột nút
  like/comment.
- **Gói CapCut** có logo nằm sẵn trong `video_khong_phu_de.mp4` (layer `watermark` của `filterRenderPlan`), để video
  không bị lấy ra mà không có logo. Các track âm thanh không có logo.
- Asset đang làm logo **không bao giờ được đề xuất làm hình của cảnh**, ở cả ô tìm media, Full AI và danh sách chọn
  media của cảnh.

## Hệ quả

- Không cần API key, không tốn chi phí, chạy được ở Manual mode.
- Người cố tình xoá logo vẫn crop hoặc che được; logo chạy giữa các góc để chống crop là việc để sau.
- Mỗi dự án phải chọn logo riêng. Logo mặc định của kênh trong Cài đặt có thể thêm sau mà không đổi schema: chỉ cần
  copy ảnh vào dự án lúc tạo và điền `style.watermark`.
