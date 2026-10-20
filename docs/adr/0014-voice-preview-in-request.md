# ADR 0014 — Nghe thử giọng đọc ngay trong request web

**Trạng thái:** Chấp nhận · Bổ sung cho ADR 0006, 0009

## Bối cảnh

Panel "Giọng đọc AI" cho chỉnh giọng, model, ngôn ngữ, độ ổn định và tốc độ, nhưng người dùng chỉ nghe được kết quả
sau khi đã tạo giọng cho mọi cảnh, tức là đã trả tiền. Cần một cách nghe thử nhanh trước khi tạo.

## Quyết định

- **Mẫu gốc (miễn phí).** `TtsPort.voiceSample(voiceId)` trả về file mẫu có sẵn của provider. Route
  `GET /api/voices/[voiceId]/sample` tải file đó qua server, nên trình duyệt không gọi ElevenLabs trực tiếp (rule 6).
  `GuardedTts` chỉ chuyển tiếp lời gọi, không ghi log, giống `listVoices`.
- **Đọc thử theo thiết lập (có phí).** Route `POST /api/projects/[id]/voices/preview` nhận `{ text, voice, language }`.
  `voice` lấy đúng giá trị đang hiển thị trên UI, vì autosave có thể chưa kịp lưu. Server gọi `synthesize` qua
  `GuardedTts`, nên budget được kiểm tra và lời gọi được ghi log (rule 7).
- **Ngoại lệ của rule 9.** Lời gọi này chạy thẳng trong HTTP request, không đưa vào hàng đợi worker. Lý do:
  - Mỗi lần chỉ có một lời gọi, câu đọc tối đa 200 ký tự (`VOICE_PREVIEW_MAX_CHARACTERS`), mất khoảng 1–3 giây.
  - Phải phát ngay mới gọi là nghe thử được.
  - Tạo giọng hàng loạt cho các cảnh vẫn chạy trong worker như cũ.
- **Cache theo nội dung.** File lưu ở `projects/<id>/voice-previews/<hash>.mp3`, với hash là `voiceContentHash(text,
voice, language)`. Cùng nội dung thì không gọi provider lần nữa. Thư mục này được phục vụ qua route `/files`.
- **Không nằm trong model Project.** File preview không phải asset, không có trong Thư viện media, không vào render,
  không vào gói CapCut, nên không cần đổi schema hay viết migration. Xoá dự án thì thư mục preview bị xoá theo.

## Hệ quả

- Web app giờ có đúng một lời gọi trả phí. Nó vẫn đi qua CostGuard và được log với `operation: "speech"`, không có
  `jobId`.
- File preview cũ không tự bị dọn. Mỗi file chỉ vài chục KB. Nếu cần, có thể xoá thư mục `voice-previews` bất cứ lúc
  nào mà không mất dữ liệu.
