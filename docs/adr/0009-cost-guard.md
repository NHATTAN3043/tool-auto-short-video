# ADR 0009 — CostGuard: chặn chi phí ngay trước mỗi lệnh gọi trả phí, log `api_usage`

**Trạng thái:** Chấp nhận · Thay thế mục "Giới hạn mỗi ngày" của ADR 0007

## Bối cảnh

M11 yêu cầu ngân sách theo ngày, tháng, dự án và mỗi lần gọi, chặn khi vượt và ghi log 100% lệnh gọi trả phí.
Trước đó chỉ AI có giới hạn ngày (`AI_MAX_USD_PER_DAY`), tính từ các job; TTS không có giới hạn nào.
Các lệnh gọi trả phí (Claude generate, ElevenLabs synthesize) chỉ chạy trong worker, mỗi lần một job. Web chỉ gọi
endpoint miễn phí (`count_tokens`, danh sách giọng).

## Quyết định

- **Chặn ở điểm chi tiền:** port `CostGuardPort.guard({ call, run, onResult, onError })` kiểm tra ngân sách, chạy lệnh gọi,
  rồi ghi một dòng `api_usage` (`ok`, `failed`, hoặc `blocked` nếu bị chặn và không gửi đi). Adapter `cost-guard`
  có decorator `GuardedAi` và `GuardedTts`. Worker bọc provider thật **cho từng job** (`PaidPortFactory`), nên mỗi dòng log
  có `projectId` và `jobId`. Use case `runAiTask` và `generateSceneVoices` chỉ nhận port đã bọc.
- **Kiểm tra sớm ở web:** `estimate*` trả kèm `budget: BudgetCheck`, và `request*` từ chối bằng `BUDGET_EXCEEDED` trước khi
  xếp hàng, kèm lý do tiếng Việt. Không còn giữ chỗ chi phí theo job: job đã xếp hàng vẫn có thể bị CostGuard trong worker
  chặn, khi đó job FAILED với cùng thông báo.
- **Ngân sách** (USD, `null` = không giới hạn, `0` = chặn hết): mỗi lần gọi (worst case), 24 giờ trượt, tháng dương lịch
  theo giờ Việt Nam (UTC+7 cố định, không cần thư viện múi giờ), và mỗi dự án (tổng từ trước tới nay, một mức chung cho mọi dự án).
  Thứ tự báo lỗi: call → day → month → project.
- **Cấu hình:** lưu trong bảng `budget_settings` (một dòng) hoặc `settings/budget.json`, và sửa được ở trang `/settings`.
  `BUDGET_MAX_USD_PER_*` trong `.env` chỉ là giá trị mặc định cho tới lần lưu đầu. CostGuard đọc lại cấu hình mỗi lần kiểm tra,
  nên đổi ngân sách không cần khởi động lại.
- **Log:** bảng `api_usage` (migration `0004_api_usage`, không có FK tới `projects`, nên xoá dự án vẫn giữ chi phí)
  hoặc `usage/api-usage.jsonl` (chỉ append; một dòng cuối bị cắt do crash thì bỏ qua). Chi phí thật: AI lấy từ `usage`, kể cả
  lượt bị từ chối hoặc bị cắt; TTS tính theo ký tự, lượt lỗi không bị tính tiền.
- Pexels/Pixabay miễn phí: không đi qua CostGuard và không ghi log.
- CostGuard giữ một khoá chung trong tiến trình suốt bước kiểm tra, gọi và ghi log, nên hai lệnh gọi đồng thời không thể cùng lọt.

## Hệ quả

- `AI_MAX_USD_PER_DAY` bị bỏ; thay bằng `BUDGET_MAX_USD_PER_DAY` (mặc định 2 USD, gồm cả TTS).
- Khoá chỉ có tác dụng trong một tiến trình: vẫn giả định **một worker** (như ADR 0005). Nhiều worker cần khoá trong DB
  (`pg_advisory_xact_lock`) hoặc đặt trước chi phí.
- Mỗi lần gọi AI bọc CostGuard sẽ gọi `count_tokens` thêm một lần (miễn phí) để lấy worst case.
- Worker chết giữa lệnh gọi thì dòng log của lệnh đó mất (đã gửi nhưng chưa ghi). Lớp chặn ngoài cùng vẫn là credit trả trước
  ở Claude Console và ElevenLabs.
