# ADR 0007 — AI qua Claude: gợi ý chạy ở worker, ước tính chi phí và giới hạn mỗi ngày

**Trạng thái:** Chấp nhận · Mục "Giới hạn mỗi ngày" được thay bằng CostGuard (ADR 0009); Full AI tự áp kết quả (ADR 0010)

## Bối cảnh

M9 thêm AI viết script, chia cảnh và gợi ý từ khoá hình. PLAN cho chọn OpenAI hoặc Claude. Người dùng muốn chi phí
có giới hạn rõ ràng và được thấy trước khi chạy. CostGuard đầy đủ để đến M11.

## Quyết định

- **Nhà cung cấp:** Claude, qua SDK chính thức `@anthropic-ai/sdk` (adapter `ai-claude`), model mặc định `claude-sonnet-5-5`,
  đổi được bằng `AI_MODEL`. Đầu ra dùng **structured outputs** (`output_config.format` với JSON schema sinh từ zod),
  sau đó parse và validate lại bằng zod. Không parse Markdown. Riêng Haiku không nhận tham số `effort`;
  các model khác dùng `effort: "low"`.
- **Retry:** tắt retry của SDK (`maxRetries: 0`, vì SDK còn retry cả 408/409 và lỗi mạng). Adapter tự retry tối đa 2 lần,
  chỉ khi gặp 429/5xx, có tôn trọng `retry-after` (quy tắc 7).
- **Chạy ở worker:** mỗi lượt gọi là một job `kind: "ai"`. `RenderJob.ai = { task, maxUsd, costUsd? }` lưu trong cột jsonb
  `render_jobs.ai` (migration `0002_ai_jobs`). Kết quả là file `ai/<jobId>.json` trong thư mục dự án.
- **Gợi ý, không tự áp:** worker không sửa project. UI tải gợi ý về, cho xem trước, rồi áp bằng hàm thuần trong domain
  (`applyScenePlan`, `applyVisualPlans`). Thao tác áp hoàn tác được.
- **Ước tính trước khi chạy:** số token đầu vào lấy từ endpoint `count_tokens` (miễn phí); nếu gọi lỗi thì ước theo
  độ dài chữ. Đầu ra ước theo loại tác vụ. Mức trần là `max_tokens` của request, nên chi phí thật không thể vượt `maxUsd`.
- **Giới hạn mỗi ngày:** `AI_MAX_USD_PER_DAY` (mặc định 0,5 USD), tính trên cửa sổ trượt 24 giờ. Job đã xong tính chi phí thật,
  kể cả lượt bị từ chối hay bị cắt ngắn vì vẫn bị tính tiền. Job đang chờ hoặc đang chạy tính mức trần `maxUsd`.
  Một khoá chung cho mọi dự án, để hai request đồng thời không cùng lọt qua bước kiểm tra.
- Toggle (`scriptGeneration`, `scenePlanning`, `visualKeywords`) được kiểm tra ở server, không chỉ ẩn nút ở UI.
- `searchQueries` viết bằng tiếng Anh để M10 tìm trên Pexels/Pixabay.

## Hệ quả

- Job AI dùng chung hàng đợi với render, nên có thể phải chờ một lượt render đang chạy.
- Giá model nằm trong adapter (`PRICES`). Model lạ được tính theo giá cao nhất (10 / 50 USD cho mỗi 1M token) để giới hạn
  luôn an toàn. Khi Anthropic đổi giá thì phải sửa bảng này.
- Nạp credit trả trước và tắt auto-reload trong Claude Console là lớp chặn ngoài cùng; `AI_MAX_USD_PER_DAY` là lớp trong app.
- M11 sẽ thay giới hạn ngày này bằng CostGuard (ngân sách theo ngày, tháng và dự án, log `api_usage`) mà không đổi `AiPort`.
