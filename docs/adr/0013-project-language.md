# ADR 0013 — Ngôn ngữ dự án (Tiếng Việt / Tiếng Anh) cho lời đọc AI và giọng đọc

**Trạng thái:** Chấp nhận · Bổ sung cho ADR 0006, 0007, 0012

## Bối cảnh

Giọng ElevenLabs đôi khi đọc sai tiếng Việt. Request TTS không báo ngôn ngữ, nên model phải tự đoán từ từng cảnh. Mỗi
cảnh chỉ có một hai câu, thường chen tên riêng hay từ tiếng Anh, nên model dễ đoán nhầm. Người dùng cũng muốn làm video
tiếng Anh, trong khi prompt Claude, bước kiểm tra lời đọc (`looksVietnamese`) và việc chọn skill đều đang cứng tiếng
Việt.

## Quyết định

- **Một giá trị cho cả dự án:** `project.language` (`"vi" | "en"`, optional, thiếu thì là `vi`). Field optional nên file
  v1 và jsonb cũ vẫn hợp lệ, không cần migration. Ô chọn ở panel Full AI và ở "Giọng đọc AI" cùng sửa giá trị này
  (`setProjectLanguage`) để kịch bản và giọng không bao giờ lệch nhau.
- **TTS:** `TtsPort.synthesize(text, voice, language, context?)`. ElevenLabs gửi `language_code` cho các model nhận
  tham số này (Flash/Turbo v2.5, v3). Theo tài liệu, multilingual_v2 không hỗ trợ nên không gửi.
- **Hash giọng:** `voiceContentHash(narration, settings, language)` chỉ thêm ngôn ngữ vào payload khi khác `vi`. Nhờ vậy
  mọi giọng tạo trước ADR này vẫn "current", không bị ép tạo lại tốn tiền, dù lần tạo sau mới có `language_code`. Đổi
  dự án sang `en` thì mọi giọng thành "outdated", đổi lại `vi` thì chúng current trở lại.
- **AI:** `ScriptRequest`, `ScenePlanRequest`, `SceneRewriteRequest` có `language` optional. Server điền ngôn ngữ của
  dự án (`withProjectLanguage`) lúc ước tính và lúc xếp job, bất kể trình duyệt gửi gì. Full AI lưu `request.language`
  vào dự án trước bước đầu tiên. Chỉ dẫn trong prompt vẫn viết tiếng Việt; chỉ ngôn ngữ của lời đọc và tiêu đề đổi theo
  dự án. Ý đồ hình ảnh luôn viết tiếng Việt, từ khoá vẫn đủ ba thứ tiếng. Với `en`, lời nhắc ngôn ngữ cuối tin nhắn luôn
  được gửi, kể cả không dùng skill.
- **Kiểm tra lời đọc:** `matchesLanguage(text, lang)`. `en` nghĩa là "không rõ ràng là tiếng Việt" (dùng cùng ngưỡng
  `VIETNAMESE_MIN_MARKED_RATIO`). Lời đọc sai ngôn ngữ bị bỏ với `NOT_ENGLISH_MESSAGE` / `NOT_VIETNAMESE_MESSAGE`.
- **Skill:** `SkillCatalogPort.get(id, language)`. Dự án `en` đọc `SKILL.md` trước, dự án `vi` đọc `SKILL.vi.md` trước.

## Hệ quả

- Thêm ngôn ngữ thứ ba cần: một giá trị enum, nhãn, câu trong `LANGUAGE_TEXT` của prompt, và một cách kiểm tra lời đọc
  tốt hơn so sánh với tiếng Việt.
- Phụ đề, chia cảnh theo từ và ước tính thời lượng vẫn dùng chung quy tắc tách theo khoảng trắng, đủ dùng cho tiếng Anh.
