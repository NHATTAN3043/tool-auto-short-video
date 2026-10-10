# ADR 0004 — Xuất cho CapCut bằng gói ZIP các track riêng

**Trạng thái:** Chấp nhận

## Bối cảnh

Sau POC (M7), người dùng cần đưa video sang CapCut để chỉnh tiếp. CapCut không có API hay định dạng import
dự án chính thức: file draft (`draft_content.json`) ở các bản mới đã bị mã hoá, và CapCut không nhận FCPXML/EDL.
Tự sinh draft sẽ gãy mỗi lần CapCut cập nhật.

## Quyết định

- Xuất một **gói ZIP** thay vì file dự án CapCut. Gói gồm: `video_khong_phu_de.mp4` (hình + tiếng gốc clip), mỗi lớp
  âm thanh có tiếng thành một WAV dài bằng video (`audio/giong_doc.wav`, `audio/nhac_nen.wav`, `audio/hieu_ung.wav`),
  `phu_de.srt` (CapCut nhập được thành phụ đề sửa được), clip từng cảnh `canh/canh_NN.mp4` và `HUONG_DAN.txt`.
- Mọi track bắt đầu ở 0 và dài bằng video, nên người dùng chỉ cần kéo vào timeline ở 00:00 là khớp.
- Các track được render bằng chính `ProjectVideo` qua `filterRenderPlan` (rule 8), chạy như một job `kind: "capcut"`
  trong worker (rule 9). Hai port mới: `ClipCutterPort` (adapter `ffmpeg`) và `ArchivePort` (adapter `archive-zip`, thư viện `yazl`).

## Hệ quả

- Hoạt động với mọi phiên bản CapCut (và cả Premiere, DaVinci…), không phụ thuộc định dạng nội bộ.
- Kiểu chữ và hiệu ứng pop của phụ đề không sang được CapCut (SRT chỉ có chữ và thời gian); người dùng chọn lại kiểu chữ.
- Hiệu ứng chuyển cảnh (fade) đã nằm sẵn trong video tổng; clip từng cảnh được cắt đúng ranh giới nên phần fade nằm ở đầu clip sau.
- Xuất gói tốn khoảng một lần render video, cộng vài lần render audio và cắt clip.
- Nếu sau này CapCut có định dạng import chính thức, chỉ cần thêm một bước đóng gói mới; các track vẫn dùng lại được.
