# ADR 0019 — Video tự tải vào kho chung, cắt thành đoạn, AI mô tả từng đoạn

**Trạng thái:** Chấp nhận · Bổ sung cho ADR 0008 (thư viện chung), 0010 (Full AI), 0016 (file upload của dự án)

## Bối cảnh

Người dùng làm short bằng cách tải về video hay (1–5 phút, nhiều cảnh, tên file vô nghĩa) rồi tự cắt ghép. Full AI
không dùng được các video này: theo ADR 0016 nó chỉ biết file qua tên, chế độ vision chỉ thấy thumbnail giây thứ 1, và
luôn gán cả clip từ giây 0. Kho Pexels/Pixabay thiếu hình hợp cảnh, và Pexels đã ngừng cấp API key mới (tháng 9/2026).
Kế hoạch triển khai và nhật ký kiểm thử: `docs/plans/clip-analysis.md`.

## Quyết định

- **Video upload vào kho chung.** `LibraryMedia.source` có thêm `upload`, nhận diện bằng `upload:<contentHash>`, mỗi file
  lưu một lần dù upload từ dự án nào. Upload trong dự án tự copy video sang kho (ô "Lưu vào kho chung", mặc định bật;
  route nhận `?library=0`). Copy lỗi không làm hỏng upload, chỉ báo. Ảnh và âm thanh không vào kho.
- **Cắt đoạn bằng ffmpeg, không tốn phí.** `ClipFramesPort` (adapter `FfmpegClipFrames`): `scdet` trên bản thu nhỏ 320px,
  **so khung cách 250ms** (`fps=4`), ngưỡng 5, giải mã `-hwaccel auto -skip_frame noref`. `shotsFromCuts` (domain) gộp
  đoạn < 1,2s, chia đoạn > 8s, tối đa 48 đoạn mỗi clip. Mỗi đoạn một ảnh ở giữa đoạn, cạnh dài ≤ 480px, lưu ở
  `library/media/shots/<item>/<job>/frame-NNN.jpg`.
- **Mỗi đoạn một ảnh, đứng sau nhãn "Shot N", một lần gọi Claude cho cả clip** (`AiPort.describeShots`). Không ghép
  tấm lưới: `drawtext` cần fontconfig và đường dẫn font khác nhau giữa các máy. Claude trả mô tả (tiếng Việt), tag
  Anh + Việt và cờ `textOverlay` (chữ in sẵn, phụ đề, logo kênh khác). `buildClipAnalysis` từ chối cả câu trả lời
  nếu thiếu, thừa hoặc lặp số đoạn: phân tích sai một nửa sẽ đưa nhầm khoảnh khắc vào cảnh.
- **Chỉ chạy khi người dùng bấm.** Job `clip` (cột `render_jobs.clip`, migration `0007_clip_jobs`) chạy trong worker.
  Route ước tính chi phí theo độ dài từng video (`expectedShotCount` ~4s/đoạn để hiển thị, `maxShotCount` 1,2s/đoạn
  để giữ chỗ ngân sách), kiểm tra ngân sách trước khi xếp hàng; mỗi lệnh gọi trong worker đi qua CostGuard
  (`operation: describe_shots`). Clip lỗi không để lại file, không chặn clip khác. Full AI không bao giờ tự phân tích.
- **Tìm và chọn theo đoạn.** Video đã phân tích được tìm theo tag + mô tả của từng đoạn (`scoreShot`: mỗi từ trùng
  trong mô tả được nửa điểm so với tag), không còn theo tên file. Mỗi clip góp tối đa 3 đoạn vào kết quả. Ứng viên
  là một đoạn có `segment` và key `library:video:<id>#<n>`; trình duyệt chỉ gửi số đoạn, server đọc thời gian từ kho.
  Chọn đoạn → cảnh có `sourceStartMs` = đầu đoạn, `sourceEndMs` để trống (giọng dài hơn đoạn thì chạy tiếp sang đoạn
  sau, không lặp). Một lần chạy Full AI không dùng một đoạn cho hai cảnh. Vision chấm đoạn bằng ảnh của chính đoạn.
- **Đoạn có chữ/logo xếp sau, vẫn dùng được** (người dùng chọn): `selectionOrder` đặt chúng sau mọi ứng viên sạch;
  khi buộc phải dùng, cảnh đó có cảnh báo để kiểm tra.
- **File có cả trong dự án lẫn kho chỉ hiện một lần** (`ownTwinFilters`): bản của dự án khi chưa phân tích, item kho
  (theo đoạn) khi đã phân tích. Chỉ xét file nguồn `upload` của dự án, để bản copy của clip stock không giấu item kho.
- **Báo cảnh thiếu.** Kết quả Full AI có `missingScenes` (tuỳ chọn) khi lần chạy có bước tự chọn media: cảnh trống, lý
  do, ý đồ hình ảnh và từ khoá 3 thứ tiếng. Màn chạy Full AI nhắc số video tự tải của dự án chưa phân tích.
- Mọi field mới đều tuỳ chọn: file thư viện, kết quả Full AI và job cũ vẫn đọc được; `schemaVersion` giữ nguyên.

## Hệ quả

- Chi phí đo trên 5 short thật 2 phút, 4K HEVC: 138 đoạn, ước tính 0,253 → thật 0,262 USD (Claude Sonnet), khoảng
  0,05 USD và 90 giây mỗi clip (tách đoạn 6–25s, chụp ảnh ~1s/ảnh, gọi AI ~30–40s).
- Tách đoạn trên 2 clip đếm tay: 23/24 và 19/21 chỗ chuyển cảnh. Báo nhầm (cử động mạnh, cắt nhảy cùng nhân vật) chỉ
  thêm đoạn ngắn; ngưỡng thấp được chọn vì bỏ sót thì một đoạn chứa hai cảnh mà AI chỉ thấy ảnh của một.
- Dung lượng: mỗi video tự tải nằm ở dự án và ở kho (như stock, ADR 0008), cộng ~20–40 KB ảnh mỗi đoạn. Xoá item kho
  xoá luôn ảnh các đoạn; không có bước dọn tự động khác.
- Video thành phẩm của kênh khác có phụ đề và logo ở mọi khung: mọi đoạn bị gắn `textOverlay`, Full AI vẫn dùng nhưng
  cảnh báo. Ứng dụng không xoá chữ hay logo.
- Để sau: luồng "footage trước, viết script sau" dựa trên các đoạn đã phân tích; đo khoảng lặng cuối file giọng
  (ADR 0018); tạo ảnh/video bằng AI cho cảnh thiếu.
