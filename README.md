# Shorts Studio

Công cụ dựng video dọc 1080×1920 cho TikTok, YouTube Shorts và Facebook Reels: bạn đưa script, giọng đọc và
media, chỉnh từng cảnh rồi render thành MP4. Có ba chế độ:

- **Manual:** tự làm mọi thứ, không cần API key nào.
- **Assisted:** AI giúp từng phần (viết script, chia cảnh, gợi ý hình, tạo giọng).
- **Full AI:** từ một ý tưởng, AI hỏi lại vài câu, viết khung kịch bản cho bạn duyệt, rồi tự tìm media và tạo giọng.

Hướng dẫn dưới đây giúp bạn tải source từ GitHub về và chạy trên máy của mình.

---

## 1. Chuẩn bị

| Phần mềm                                   | Phiên bản                                  | Ghi chú                                                                                        |
| ------------------------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| [Git](https://git-scm.com/downloads)       | bất kỳ                                     | Để tải source                                                                                  |
| [Node.js](https://nodejs.org/)             | **22 trở lên**                             | Kiểm tra: `node -v`                                                                            |
| pnpm                                       | theo `packageManager` trong `package.json` | Cài bằng Corepack (có sẵn trong Node), xem bước 2                                              |
| [FFmpeg](https://ffmpeg.org/download.html) | bản mới                                    | **Bắt buộc**, `ffmpeg` và `ffprobe` phải chạy được trong terminal                              |
| PostgreSQL                                 | 14 trở lên                                 | **Tuỳ chọn.** Không có thì dữ liệu lưu bằng file JSON                                          |
| Chrome hoặc Edge                           | bản mới                                    | **Tuỳ chọn.** Remotion tự tải Chrome để render; máy không tải được thì dùng trình duyệt có sẵn |

### Cài FFmpeg

- **Windows:** `winget install Gyan.FFmpeg`, rồi mở lại terminal.
- **macOS:** `brew install ffmpeg`
- **Ubuntu/Debian:** `sudo apt-get update && sudo apt-get install -y ffmpeg`

Kiểm tra bằng `ffmpeg -version` và `ffprobe -version`. Nếu không muốn thêm FFmpeg vào PATH, bạn có thể khai báo
đường dẫn trong file `.env` (biến `STUDIO_FFMPEG_PATH`, `STUDIO_FFPROBE_PATH`).

---

## 2. Tải source và cài thư viện

```bash
git clone https://github.com/NHATTAN3043/tool-auto-short-video.git
cd tool-auto-short-video

corepack enable      # bật pnpm đúng phiên bản dự án dùng
pnpm install
```

> Trên Windows, nếu `corepack enable` báo thiếu quyền, hãy mở terminal bằng quyền Administrator rồi chạy lại.

---

## 3. Tạo file cấu hình `.env`

Sao chép file mẫu thành `.env` ở thư mục gốc dự án:

```bash
# macOS / Linux / Git Bash
cp .env.example .env

# Windows PowerShell
Copy-Item .env.example .env
```

**Để nguyên file vừa sao chép là đã chạy được chế độ Manual.** Mỗi API key bạn điền vào sẽ mở thêm một tính năng;
để trống thì tính năng đó tự ẩn khỏi giao diện.

| Biến                 | Dùng để                                        | Lấy ở đâu                                                                                                  |
| -------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`  | AI viết script, chia cảnh, gợi ý hình, Full AI | [Claude Console](https://platform.claude.com) → API Keys (tính phí riêng, không dùng chung gói Claude Pro) |
| `OPENAI_API_KEY`     | Nhà cung cấp AI thay thế, chọn theo từng dự án | [OpenAI Platform](https://platform.openai.com/api-keys) → API Keys                                         |
| `ELEVENLABS_API_KEY` | Tạo giọng đọc cho từng cảnh                    | [ElevenLabs](https://elevenlabs.io) → API Keys; cần quyền "Text to Speech" và "Voices: read"               |
| `PEXELS_API_KEY`     | Tìm video/ảnh miễn phí trên Pexels             | [pexels.com/api](https://www.pexels.com/api/)                                                              |
| `PIXABAY_API_KEY`    | Tìm video/ảnh miễn phí trên Pixabay            | [pixabay.com/api/docs](https://pixabay.com/api/docs/) (đăng nhập để xem key)                               |
| `DATABASE_URL`       | Lưu dữ liệu bằng PostgreSQL thay cho file JSON | Xem mục 4                                                                                                  |

Ý nghĩa từng biến còn lại (ngân sách chi tiêu, model AI, thư mục lưu trữ…) được ghi chú ngay trong `.env.example`.

Khi có ít nhất một API key AI, mở **Cài đặt dự án** để chọn Claude hoặc OpenAI và model. Danh sách model được
lấy từ tài khoản provider rồi lọc bằng `ANTHROPIC_AI_MODEL_PATTERNS` hoặc `OPENAI_AI_MODEL_PATTERNS`; API key
luôn chỉ ở phía server.

> **Giữ bí mật file `.env`.** File này đã nằm trong `.gitignore`, đừng commit hay gửi cho người khác vì nó chứa
> API key.

---

## 4. (Tuỳ chọn) Dùng PostgreSQL

Bỏ qua mục này nếu bạn để trống `DATABASE_URL`: dự án, job và thư viện sẽ lưu thành file JSON trong `storage/`.

1. Tạo một database trống, ví dụ `shorts_studio`.
2. Điền vào `.env`:

   ```env
   DATABASE_URL=postgres://postgres:mat_khau@localhost:5432/shorts_studio
   ```

   Ký tự đặc biệt trong mật khẩu phải được mã hoá: `@` → `%40`, `#` → `%23`, `/` → `%2F`, `:` → `%3A`.

3. Tạo bảng:

   ```bash
   pnpm db:migrate
   ```

4. Nếu trước đó bạn đã có dữ liệu JSON trong `storage/` và muốn chuyển sang Postgres:

   ```bash
   pnpm db:import
   ```

---

## 5. Chạy ứng dụng

```bash
pnpm dev
```

Lệnh này chạy cùng lúc hai phần:

- **web** (Next.js): giao diện tại **http://localhost:3000**
- **worker**: chạy các việc lâu như render video, tạo giọng, gọi AI

Hãy để cả hai cùng chạy: nếu chỉ chạy web thì job render và AI sẽ nằm chờ mãi. Dừng bằng `Ctrl + C`.

Video render xong, file media tải lên và dữ liệu dự án đều nằm trong thư mục `storage/` (đổi được bằng
`STUDIO_STORAGE_DIR`). Thư mục này không có trong git, nên máy mới clone về sẽ bắt đầu với danh sách dự án trống.

### Kiểm tra nhanh, không cần API key

```bash
pnpm demo
```

Lệnh này dùng FFmpeg sinh media mẫu, tạo một dự án demo 3 cảnh rồi render ra MP4. Chạy được tức là Node, FFmpeg và
Remotion đều đã sẵn sàng. Lần render đầu có thể chậm vì Remotion phải tải Chrome.

---

## 6. Các lệnh hay dùng

| Lệnh                      | Việc                                                                |
| ------------------------- | ------------------------------------------------------------------- |
| `pnpm dev`                | Chạy web + worker                                                   |
| `pnpm demo`               | Tạo và render dự án demo                                            |
| `pnpm render <projectId>` | Render một dự án từ dòng lệnh                                       |
| `pnpm test`               | Chạy test                                                           |
| `pnpm check`              | Chạy mọi bước CI kiểm tra: format, lint, typecheck, kiến trúc, test |
| `pnpm db:migrate`         | Tạo/cập nhật bảng PostgreSQL                                        |
| `pnpm db:import`          | Chép dữ liệu JSON có sẵn vào PostgreSQL                             |

---

## 7. (Tuỳ chọn) Skill cho Full AI

Full AI có thể gửi kèm một "skill" (tài liệu kinh nghiệm viết video ngắn) cho Claude. Skill nằm trong
`.claude/skills/` (đổi được bằng `STUDIO_SKILLS_DIR`), mỗi skill là một thư mục chứa `SKILL.md`. Danh sách skill dự án
đang dùng được ghi trong `skills-lock.json` (nguồn `vyralcontent/content-skills` trên GitHub). Nếu thư mục
`.claude/skills/` chưa có sau khi clone, cài lại bằng `npx skills add vyralcontent/content-skills`. Không có skill nào thì Full AI vẫn
chạy bình thường, ô chọn skill chỉ tự ẩn đi.

---

## 8. Cấu trúc thư mục

```
apps/
  web/        Giao diện Next.js (trang, API route)
  worker/     Vòng lặp chạy job: render, tạo giọng, AI
packages/
  domain/     Quy tắc nghiệp vụ thuần: schema, cảnh, timeline, phụ đề
  services/   Use case và các cổng (port) ra bên ngoài
  adapters/   Kết nối thật: lưu trữ, Postgres, FFmpeg, Remotion, Claude, ElevenLabs, Pexels…
  video/      Composition Remotion dùng chung cho xem trước và render
  config/     Đọc và kiểm tra biến môi trường
docs/         Kế hoạch, kiến trúc, ghi chú kỹ thuật, ADR
```

Muốn sửa code thì đọc trước `CLAUDE.md` và `docs/SOURCE-BASE.md`: hai file này ghi quy ước và kiến trúc của dự án.

---

## 9. Xử lý sự cố

| Hiện tượng                                        | Cách xử lý                                                                                                                                                                         |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ffmpeg` / `ffprobe` not found                    | Cài FFmpeg (mục 1) rồi mở lại terminal, hoặc khai báo `STUDIO_FFMPEG_PATH`, `STUDIO_FFPROBE_PATH` trong `.env`                                                                     |
| Render lần đầu bị lỗi khi tải Chrome              | Mạng chặn bản tải về của Remotion. Trỏ `STUDIO_BROWSER_EXECUTABLE` tới Chrome/Edge có sẵn, ví dụ `C:\Program Files\Google\Chrome\Application\chrome.exe`                           |
| Job render hoặc AI cứ nằm "Đang chờ worker…"      | Worker chưa chạy. Dùng `pnpm dev` (chạy cả hai), đừng chỉ chạy web                                                                                                                 |
| Không thấy nút AI, tạo giọng hay tìm Pexels       | Chưa điền key tương ứng trong `.env`. Điền xong thì khởi động lại `pnpm dev`                                                                                                       |
| Vừa sửa code ở `packages/` mà web vẫn chạy như cũ | Web giữ một container dịch vụ qua các lần hot reload. Dừng rồi chạy lại `pnpm dev`                                                                                                 |
| Cổng 3000 đang bị chiếm                           | Tắt chương trình đang dùng cổng 3000, hoặc chạy web ở cổng khác: `pnpm --filter @studio/web exec next dev -p 3001` (worker vẫn chạy riêng bằng `pnpm --filter @studio/worker dev`) |
| Lỗi kết nối PostgreSQL                            | Kiểm tra database đã được tạo, mật khẩu trong `DATABASE_URL` đã mã hoá ký tự đặc biệt, rồi chạy `pnpm db:migrate`                                                                  |
| Thao tác AI bị chặn "Vượt ngân sách"              | Đổi giới hạn trong trang **Ngân sách** (`/settings`) hoặc các biến `BUDGET_*` trong `.env`                                                                                         |
