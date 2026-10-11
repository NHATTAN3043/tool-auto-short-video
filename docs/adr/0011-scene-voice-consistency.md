# ADR 0011 — Giọng các cảnh đều nhau: ngữ cảnh, chuẩn hoá âm lượng, tạo lại theo yêu cầu

**Trạng thái:** Chấp nhận

## Bối cảnh

Giọng AI được tạo riêng từng cảnh (ADR 0006). Trên dữ liệu thật, các cảnh của cùng một video lệch nhau rõ:
tốc độ 3,45 → 5,38 từ/giây, độ to −22,2 → −26,2 LUFS. Mỗi lệnh TTS không biết câu trước, câu sau, và file
ElevenLabs trả về được lưu nguyên. Người dùng cũng không có cách lấy một bản đọc khác khi lời không đổi,
và không gán được file voice tự thu cho một cảnh.

## Quyết định

- **Ngữ cảnh.** `TtsPort.synthesize` nhận `SpeechContext` (lời cảnh trước và sau). Adapter ElevenLabs gửi
  `previous_text` / `next_text`, trừ model `eleven_v3`: theo tài liệu ElevenLabs, model này không hỗ trợ
  request stitching. Ngữ cảnh không vào `contentHash`, nên giọng cũ không bị đánh dấu "Lời đã đổi".
- **Chuẩn hoá âm lượng.** Port `AudioNormalizerPort`, adapter ffmpeg: đo độ to (`loudnorm` chỉ để đo), tăng
  hoặc giảm mức về −16 LUFS kèm `alimiter` giữ đỉnh dưới −1,5 dBFS, đo lại và bù thêm một lần nếu còn lệch quá
  0,5 LU. Xuất MP3 44,1 kHz 128 kbit/s. Không dùng `loudnorm` để áp mức: câu TTS 2–3 giây có đỉnh nhọn
  (phụ âm bật) nên ở chế độ tuyến tính `loudnorm` bị giới hạn đỉnh chặn lại (−24,7 LUFS, đỉnh −4,4 dBTP chỉ
  lên được −21,8), còn ở chế độ động thì không đủ thời lượng để ổn định. Đo trên 26 giọng thật: −16,4 → −15,5
  LUFS, đỉnh ≤ −1,7 dBFS. Mỗi giọng mới được chuẩn hoá trước khi lưu. Chuẩn hoá lỗi thì giữ file gốc, vì file
  đó đã trả tiền. Asset có `loudnessNormalized: true`.
- **Giọng cũ cân bằng miễn phí.** Job `tts` với `voice.normalizeOnly` chạy ffmpeg trên các giọng AI chưa cân
  bằng. Job này tạo **file và asset mới** cùng `contentHash`, file cũ giữ nguyên. Voice người dùng tải lên
  không bao giờ bị chuẩn hoá (luật 4).
- **Tạo lại theo yêu cầu.** Job `tts` với `voice.regenerate` tạo bản đọc mới cho cảnh có lời, kể cả khi giọng
  vẫn khớp hoặc là file tải lên (có hộp xác nhận chi phí). Bản cũ vẫn nằm trong asset của dự án.
- **Voice riêng của cảnh** được chọn hoặc tải lên ngay trong cảnh, qua `updateScene({ voiceAssetId })` có sẵn.
- Mọi field mới đều tuỳ chọn (`RenderJob.voice`, `MediaAsset.loudnessNormalized`): file `schemaVersion: 1`
  cũ vẫn hợp lệ. Postgres cần migration `0006_tts_job_options` (thêm cột `render_jobs.voice`, cho phép null).

## Hệ quả

- Giọng tạo mới đều nhịp và đều độ to hơn. Tốc độ của giọng cũ chỉ sửa được bằng cách tạo lại (tốn phí).
- Mỗi lần cân bằng hoặc tạo lại thêm một file vào `media/`. Không có bước dọn file tự động.
- Chưa kiểm chứng ElevenLabs có tính ký tự của `previous_text` / `next_text` hay không. Header `character-cost`
  của phản hồi cho biết số thật; CostGuard vẫn ước tính theo ký tự của lời cảnh.
