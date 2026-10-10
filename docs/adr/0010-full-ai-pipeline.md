# ADR 0010 — Full AI: worker tự áp kết quả vào dự án, người dùng duyệt sau

**Trạng thái:** Chấp nhận · Bổ sung cho ADR 0007 (gợi ý từng phần vẫn "gợi ý trước, áp sau")

## Bối cảnh

M11b thêm luồng Full AI: từ ý tưởng ra cảnh có media và giọng, rồi người dùng duyệt 15–30%. ADR 0007 quy định
AI chỉ gợi ý, worker không sửa project. Áp quy tắc đó cho Full AI thì người dùng phải duyệt từng bước giữa chừng,
trái với mục đích của mode này. Ngoài ra M11b cần AI xếp hạng media, theo hai cách để người dùng chọn.

## Quyết định

- **Một job `kind: "full_ai"`** (`RenderJob.fullAi = { request, steps, step?, maxUsd, costUsd? }`, cột jsonb
  `render_jobs.full_ai`, migration `0005_full_ai_jobs`). Worker chạy các bước theo toggle (`fullAiSteps`):
  script → chia cảnh (AI hoặc tách script) → từ khoá → tìm media → xếp hạng → chọn media → tạo giọng.
- **Worker áp kết quả trực tiếp** vào project sau từng bước. Bước script và chia cảnh là bắt buộc. Tìm, xếp hạng,
  chọn media và tạo giọng chỉ là "cố gắng": lỗi thì thành cảnh báo trong `full-ai/<jobId>.json`. Vượt ngân sách
  thì dừng ngay; phần đã làm vẫn giữ. Mọi lệnh gọi trả phí vẫn qua CostGuard (ADR 0009).
- **Thay cảnh cần xác nhận**: dự án đã có cảnh thì request phải có `replaceScenes: true` (người dùng tick trong hộp
  xác nhận). File media cũ vẫn ở trong dự án.
- **Không ghi đè nhau**: trước khi chạy, editor lưu hết; trong lúc chạy, editor bị một lớp phủ khoá lại; xong thì mở
  màn duyệt `/projects/[id]/review`, trang này tải lại project từ server.
- **Màn duyệt**: Giữ cảnh (`status: "approved"`), Đổi media (top 6 AI đã xếp, lưu ở kết quả job, cùng panel tìm M10),
  Viết lại (task `rewrite_scene`, là gợi ý để áp như ADR 0007, theo toggle `scriptGeneration`), Tạo lại giọng (M8).
- **Xếp hạng media, hai chế độ** (`MediaRankingMode`): `text` đọc mô tả (alt/slug của Pexels, tag của Pixabay và
  thư viện), `vision` gửi kèm thumbnail. Ảnh stock gửi bằng link HTTPS, chỉ khi link thuộc host media của nhà
  cung cấp; ảnh thư viện đọc từ storage, gửi base64. Tối đa 6 ứng viên mỗi cảnh, 15 cảnh mỗi lần gọi. Chế độ chọn
  lần cuối được nhớ trong `project.mediaRankingMode` (field optional, không cần migration).
- **Giọng khi dự án chưa chọn**: giọng mặc định trong `.env`; không có thì giọng đầu tiên của tài khoản ElevenLabs
  (`initialVoiceSettings`, dùng chung với web).
- **Ước tính trước khi chạy**: các bước sau chưa có dữ liệu, nên ước theo thời lượng mục tiêu (2,6 từ/giây, 18 từ/cảnh)
  và đếm token miễn phí. Ảnh tính 500 token (dự kiến) / 1600 token (tối đa) mỗi cái.

## Hệ quả

- Worker giờ cũng tìm và tải media (cần `PEXELS_API_KEY`/`PIXABAY_API_KEY` ở worker nếu muốn tìm stock).
- Một dự án chỉ chạy một job Full AI một lúc. Job Full AI dùng chung hàng đợi, nên có thể chờ render đang chạy.
- Dừng giữa chừng để lại dự án dở dang (ví dụ có script mới nhưng chưa có cảnh): hoàn tác trên editor không quay lại
  được vì thay đổi do worker ghi, người dùng chạy lại hoặc sửa tay.
- Chế độ `vision` tốn hơn chế độ `text` nhiều lần (thumbnail video Pexels là ảnh lớn); ước tính hiện rõ trước khi chạy.
