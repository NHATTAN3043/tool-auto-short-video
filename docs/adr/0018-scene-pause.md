# ADR 0018 — Khoảng nghỉ lấy hơi sau giọng đọc của từng cảnh

**Trạng thái:** Chấp nhận · Bổ sung cho ADR 0006 (TTS theo cảnh), 0011 (giọng các cảnh đều nhau)

## Bối cảnh

Thời lượng cảnh có voice riêng đúng bằng độ dài file giọng. Từ ADR 0011, ElevenLabs nhận `previous_text` /
`next_text` (request stitching), nên các file được đọc để nối liền nhau và gần như không còn khoảng lặng ở cuối.
Kết quả: hai cảnh liền nhau đọc dính liền, không có chỗ lấy hơi. Người dùng phải nhập tay thời lượng cảnh
(+0,5s mỗi cảnh) để tạo khoảng ngắt.

## Quyết định

- **Nghỉ trên timeline, không sửa file.** `project.style.scenePauseMs` (optional, 0–1500ms) được cộng vào thời lượng
  của cảnh có nguồn `scene-voice`. Voice vẫn phát từ đầu cảnh, phần còn lại là lặng, hình vẫn chạy. File giọng
  không bị cắt hay đệm thêm (luật 4), đổi khoảng nghỉ không tạo lại giọng (luật 3).
- **Theo dấu câu.** Lời cảnh kết thúc bằng `. ! ? …` nghỉ đủ mức; còn lại (dấu phẩy, không dấu, câu chạy sang cảnh
  sau) nghỉ 2/3 mức. Cảnh cuối cũng có nghỉ để video không cắt ngay sau chữ cuối.
- **Không áp dụng** cho cảnh nhập thời lượng tay (người dùng đã tự quyết), cho voice dự án một file (đã có nhịp
  nghỉ tự nhiên) và cho cảnh ước lượng.
- **Phụ đề** chia theo phần có tiếng (`TimelineEntry.pauseMs` cho biết phần nghỉ), câu cuối của cảnh giữ trên màn
  hình qua khoảng nghỉ.
- **Mặc định 300ms cho dự án mới.** Dự án cũ không có field nên là 0, thời lượng giữ nguyên. `schemaVersion` giữ 1,
  Postgres lưu project dạng jsonb nên không cần migration.

## Hệ quả

- Video dài thêm 0,2–0,3s mỗi cảnh với mức mặc định. Preview, render và gói CapCut cùng lấy từ `computeTimeline`
  nên khớp nhau.
- Khoảng lặng sẵn có trong file (nếu ElevenLabs để lại) vẫn được cộng thêm, nên chỗ nghỉ giữa các cảnh có thể chưa
  đều tuyệt đối. Nếu cần: đo khoảng lặng cuối file bằng ffmpeg `silencedetect` lúc tạo giọng, lưu vào asset và chỉ
  bù phần còn thiếu.
