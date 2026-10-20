# ADR 0012 — Skill cho Full AI và nút Viết lại: gửi SKILL.md kèm prompt, chặn lời đọc không phải tiếng Việt

**Trạng thái:** Chấp nhận · Bổ sung cho ADR 0007, 0010

## Bối cảnh

Người dùng cài skill viết nội dung video ngắn (`.claude/skills/viral-*`, định dạng Claude Code) và muốn chọn một skill
khi chạy Full AI để Claude viết script, chọn hình tốt hơn. Skill viết bằng tiếng Anh, trong khi kênh là tiếng Việt:
lời đọc tiếng Anh lọt vào video là lỗi không chấp nhận được. Mỗi skill có `SKILL.md` khoảng 8–12 KB, kèm
`references/` và `assets/` tổng cộng hàng trăm KB.

## Quyết định

- **Gửi nội dung `SKILL.md` trong system prompt**, không dùng Agent Skills API của Anthropic (phải upload skill và
  bật code execution: đắt và phức tạp hơn nhiều so với lợi ích). Chỉ đọc `SKILL.md` (bỏ frontmatter); không gửi
  `references/`, `assets/`. Skill dài hơn `SKILL_MAX_CHARS` (40 000 ký tự) không được liệt kê.
- **Port `SkillCatalogPort`**, adapter `skills-local` đọc `STUDIO_SKILLS_DIR` (mặc định `./.claude/skills`, tính từ gốc
  repo) mỗi lần gọi, nên cài thêm skill không cần khởi động lại. Id là tên thư mục (`SkillIdSchema`), nhờ đó request
  không trỏ ra ngoài thư mục được.
- **Request chỉ mang `skillId`** (`FullAiRequest`, `ScriptRequest`, `ScenePlanRequest`, `VisualPlanRequest`,
  `SceneRewriteRequest`; field optional trong jsonb, không cần migration). Server đọc skill để ước tính và từ chối skill
  không tồn tại (`INVALID_INPUT`); worker đọc lại lúc chạy và truyền nội dung vào `AiPort` (tham số `guidance`).
  Full AI: skill bị gỡ giữa chừng thành cảnh báo, chạy tiếp không dùng skill. Job AI lẻ (Viết lại): báo lỗi.
- **Bước dùng skill:** Viết script, Chia cảnh bằng AI (chỉ cho ý đồ hình và từ khoá, lời giữ nguyên), Gợi ý hình
  ảnh, và Viết lại cảnh ở màn duyệt. Không dùng cho xếp hạng media.
- **Một skill**, chọn bằng dropdown ở form Full AI và ở màn duyệt ("Skill khi viết lại cảnh"). Lựa chọn được nhớ trong
  `project.aiSkillId` (optional, dùng chung cho hai chỗ).
- **Giữ tiếng Việt, ba lớp:**
  1. Prompt: skill được bọc là "tài liệu tham khảo"; `SKILL_RULES` đặt _sau_ skill (luôn viết tiếng Việt, không chép câu
     mẫu tiếng Anh, bỏ qua chỉ dẫn về định dạng, hashtag, hỏi lại); cuối tin nhắn người dùng nhắc lại quy tắc.
  2. Kiểm tra ở domain: `looksVietnamese` (tỉ lệ âm tiết có chữ riêng của tiếng Việt ≥ 30%, bỏ qua câu dưới 6 từ).
     Script và lời viết lại không đạt thì bị bỏ (`AI_INVALID_OUTPUT`), dự án không đổi. Áp dụng cả khi không chọn skill.
  3. Bản dịch: thư mục có `SKILL.vi.md` thì dùng file đó thay `SKILL.md`; dropdown ghi "(tiếng Việt)".

## Hệ quả

- Mỗi lệnh gọi có skill tốn thêm khoảng 2,5–3,5k token đầu vào; ước tính đếm cả phần này và CostGuard vẫn kiểm tra
  từng lệnh. Chưa dùng prompt caching vì một lượt Full AI chỉ có 2 lệnh gọi mang skill.
- Nội dung skill là văn bản bên thứ ba đưa thẳng vào prompt: chỉ cài skill tin cậy. Skill không đọc được file khác,
  không chạy code.
- Web và worker phải cùng thấy `STUDIO_SKILLS_DIR`.
- Kiểm tra tiếng Việt có thể chặn nhầm lời đọc toàn tên riêng/thuật ngữ tiếng Anh; người dùng chạy lại hoặc sửa tay.
