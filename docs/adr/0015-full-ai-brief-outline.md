# ADR 0015 — Full AI hỏi lại và cho duyệt khung kịch bản trước khi tạo video

**Trạng thái:** Chấp nhận · Bổ sung cho ADR 0010 (luồng Full AI), 0012 (skill)

## Bối cảnh

Full AI cũ chạy liền một job từ ý tưởng tới giọng đọc: người dùng chỉ thấy lời đọc sau khi đã trả tiền tìm media,
xếp hạng và tạo giọng. Ý tưởng một dòng thường thiếu thông tin (xem cho ai, mở đầu kiểu gì, kết bằng gì), nên kịch
bản hay lệch ý và phải chạy lại cả luồng. Cần một luồng: ý tưởng → AI hỏi lại → khung kịch bản để duyệt → duyệt
xong mới tạo video.

## Quyết định

- **Trang riêng `/projects/[id]/full-ai`** gồm 3 bước: Ý tưởng, Câu hỏi, Khung kịch bản. Từ bước 2 có cột tóm tắt bên
  trái. Tab Trợ lý AI của editor chỉ còn card lối vào ("Bắt đầu" / "Tiếp tục bản nháp"), editor được lưu trước khi
  chuyển trang. Đã cân nhắc đặt các bước ngay trong card của tab AI, hoặc làm dạng hội thoại; chọn trang riêng vì
  khung kịch bản nhiều cảnh cần chỗ để đọc và sửa.
- **Hai AI task mới, chạy ở worker như mọi task** (ADR 0007, 0009; qua CostGuard, ước tính trước khi gọi):
  - `brief_questions`: input giống task script, trả 0–5 câu hỏi (`single` / `multi` / `text`, tối đa 5 lựa chọn).
    Không có câu hỏi nào nghĩa là ý tưởng đã đủ rõ. Câu hỏi luôn viết bằng tiếng Việt vì người đọc là người dùng,
    kể cả khi video tiếng Anh.
  - `script_outline`: thêm các câu đã trả lời, có thể kèm `revision` (lời các cảnh cũ + góp ý) khi bấm "Làm lại". Kết
    quả dùng lại dạng chia cảnh (`ScenePlanSuggestion`: lời đọc + `visualPlan`) cộng tiêu đề. Lời đọc phải đúng ngôn
    ngữ dự án, như bước script.
  - Cả hai cần toggle `scriptGeneration`, vì đó là nửa đầu của việc viết script. "Viết lại một cảnh" dùng lại task
    `rewrite_scene`; kết quả chỉ là gợi ý, người dùng bấm "Dùng bản này" thì mới thay.
- **Nháp lưu thành file riêng** `projects/<id>/full-ai/draft.json` (`FullAiDraftSchema`, `schemaVersion: 1`), không nằm
  trong `Project`. Editor tự lưu bằng cách PUT nguyên project, nên để chung thì hai bên có thể ghi đè nhau. File hỏng
  hoặc sai phiên bản thì bỏ, bắt đầu nháp mới. Run xong thì worker xoá nháp; run lỗi thì giữ để chạy lại. Xoá dự án
  thì nháp mất theo thư mục dự án.
- **`FullAiRequest.outline`** (optional trong jsonb, không cần migration): có outline thì bỏ bước script; bước `scenes`
  áp đúng từng chữ (miễn phí); bước `visual` chỉ chạy cho cảnh chưa có ý đồ hình (cảnh thêm tay, hoặc đã sửa lời sau
  khi AI gợi ý), khi `scenePlanning` hoặc `visualKeywords` bật. Các bước media, xếp hạng, chọn media, giọng giữ như cũ.
- **Không thêm toggle.** Luồng mới là mặc định khi `scriptGeneration` bật. "Chạy luôn, không hỏi" (bước 1) và "Bỏ qua
  câu hỏi" (bước 2) là đường tắt, khỏi đổi schema `AutomationSettings`.
- Run nhớ cách xếp hạng media và skill vào dự án (`mediaRankingMode`, `aiSkillId`), thay cho việc form cũ lưu qua
  editor.

## Hệ quả

- Thêm 2 lần gọi Claude mỗi video (khoảng 0,01–0,02 USD), mỗi lần "Làm lại khung" thêm khoảng 0,01 USD. Chi phí từng
  lần hiện trước khi bấm.
- Mỗi lần hỏi hoặc tạo khung chờ khoảng 5–20 giây (job vào hàng đợi chung với render, có thể phải chờ).
- Câu hỏi được hỏi lại chỉ khi ý tưởng, thời lượng, giọng văn, skill hoặc ngôn ngữ đổi (`briefKey`); quay lại sửa câu
  trả lời rồi bấm "Tạo khung kịch bản" sẽ thay cả khung đang có.
- Tiền tố id `ols` cho cảnh của khung nháp; cảnh thật vẫn sinh id `scn` khi áp vào dự án.
