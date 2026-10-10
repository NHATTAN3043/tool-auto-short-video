# Bộ kế hoạch Shorts Studio

Đọc theo thứ tự:

1. **01-PLAN.md** — kế hoạch chi tiết 12 milestone (M0–M11), mỗi cái có phạm vi, tiêu chí xong và prompt dán vào Claude Code.
2. **02-SOURCE-BASE.md** — cách dựng source base chất lượng, dễ mở rộng: công cụ, cấu trúc thư mục, luật phụ thuộc,
   mẫu thiết kế, lệnh khởi tạo từng bước, quy ước code, cách làm việc với Claude Code.
3. **03-TECH-NOTES.md** — bẫy kỹ thuật đã gặp khi dựng prototype và thuật toán cốt lõi (timeline, phụ đề, render).

Thư mục `templates/` chứa file copy thẳng vào repo mới:

| File                                                   | Đặt vào repo tại                                            |
| ------------------------------------------------------ | ----------------------------------------------------------- |
| `templates/CLAUDE.md`                                  | `CLAUDE.md` (gốc repo)                                      |
| `templates/.claude/commands/milestone.md`, `finish.md` | `.claude/commands/` → dùng `/milestone M3`, `/finish`       |
| `templates/.env.example`                               | `.env.example`                                              |
| `templates/adr-0001-file-storage-for-poc.md`           | `docs/adr/0001-file-storage-for-poc.md`                     |
| `01-PLAN.md`, `02-SOURCE-BASE.md`, `03-TECH-NOTES.md`  | `docs/PLAN.md`, `docs/SOURCE-BASE.md`, `docs/TECH-NOTES.md` |
| `../AI_Shorts_Studio_Detailed_Plan.md`                 | `docs/SPEC.md` (đặc tả gốc)                                 |

Cách bắt đầu: tạo thư mục repo, copy các file trên vào đúng chỗ, mở bằng VS Code, chạy Claude Code và gõ `/milestone M0`.
