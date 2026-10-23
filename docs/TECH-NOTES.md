# Ghi chú kỹ thuật — bẫy đã gặp và thuật toán cốt lõi

Rút ra từ bản prototype đã dựng và render thử thành công (`reference-prototype/`, chỉ để tham khảo, không cần dùng lại).
Đưa file này cho Claude Code đọc ở M1–M3 để tránh mất thời gian dò lỗi.

---

## 1. Bẫy kỹ thuật

| Vấn đề                              | Triệu chứng                                                                                                    | Cách làm đúng                                                                                                                                                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Font tải từ Google Fonts lúc render | Render treo/lỗi khi mạng chặn hoặc proxy; dấu tiếng Việt có thể rơi về font khác                               | Đóng gói file font (Be Vietnam Pro, giấy phép SIL OFL) trong `packages/video/public/`, nạp bằng `@remotion/fonts` `loadFont({ url: staticFile(...) })`. Khi bundle truyền `publicDir`. Ở web, copy font vào `apps/web/public/` |
| `staticFile()` trỏ sai chỗ          | Font/ảnh 404 khi render                                                                                        | `bundle({ entryPoint, publicDir })` phải trỏ đúng thư mục `public` của package video                                                                                                                                           |
| Renderer không đọc được file local  | Video đen / lỗi tải                                                                                            | Renderer cần URL HTTP. Dựng server HTTP nhỏ trong worker phục vụ thư mục dự án, cổng ngẫu nhiên `127.0.0.1:0`, đóng lại sau render                                                                                             |
| Tua video trong preview không được  | Thanh chọn đoạn nhảy về 0                                                                                      | Route phục vụ file phải hỗ trợ header `Range` (trả 206 + `Content-Range`)                                                                                                                                                      |
| Path traversal                      | Đọc được file ngoài thư mục dự án qua `../`                                                                    | `path.resolve` rồi kiểm tra kết quả bắt đầu bằng thư mục gốc + dấu phân cách                                                                                                                                                   |
| Prop cắt video của Remotion         | `startFrom`/`endAt` báo deprecated                                                                             | Remotion 4 dùng `trimBefore` + `durationInFrames` (frame của composition) trên `<OffthreadVideo>`; từ 4.0.5xx `trimAfter` cũng deprecated. `Audio` đổi tên thành `Html5Audio`                                                  |
| Đoạn nguồn ngắn hơn cảnh            | Màn hình đen cuối cảnh                                                                                         | Bọc video trong `<Loop durationInFrames={segmentFrames}>`                                                                                                                                                                      |
| Chuyển cảnh fade làm lệch tiếng     | Hình đi trước/sau giọng đọc                                                                                    | Không dùng `TransitionSeries` (nó rút ngắn tổng thời lượng). Cho cảnh i kéo dài thêm `transitionFrames` và cảnh i+1 fade-in đè lên. Tổng thời lượng = tổng thời lượng cảnh                                                     |
| Video quay dọc trên điện thoại      | Width/height bị đảo                                                                                            | Đọc `tags.rotate` hoặc `side_data_list[].rotation` từ ffprobe; nếu 90/270 thì đổi width/height                                                                                                                                 |
| Video HEVC (iPhone)                 | Preview trên trình duyệt không phát (tuỳ trình duyệt/OS)                                                       | Khi import, nếu codec là hevc thì tạo thêm bản proxy H.264 để preview; render vẫn có thể dùng file gốc                                                                                                                         |
| Ảnh bị ffprobe nhận là video        | Ảnh có duration                                                                                                | Coi là ảnh khi codec là mjpeg/png/webp và duration ≈ 0 hoặc format là `image2`/`*_pipe`                                                                                                                                        |
| Ghi `project.json` khi đang ghi dở  | File JSON hỏng sau khi tắt máy đột ngột                                                                        | Ghi file tạm rồi `rename` (atomic). Hai upload song song: đọc lại project ngay trước khi ghi                                                                                                                                   |
| Worker chết giữa chừng              | Job kẹt PROCESSING mãi                                                                                         | Khi worker khởi động, đánh dấu các job PROCESSING cũ là FAILED                                                                                                                                                                 |
| Ghi tiến độ job quá dày             | Ổ đĩa ghi liên tục                                                                                             | Chỉ ghi tiến độ tối đa 1 lần/giây                                                                                                                                                                                              |
| Remotion tải Chrome lần đầu         | Render đầu tiên chậm hoặc lỗi trong môi trường không có mạng                                                   | Cho phép cấu hình `browserExecutable` qua env (`STUDIO_BROWSER_EXECUTABLE`). Chrome/Edge cài sẵn (bản 154) chạy được. Mạng chặn storage.googleapis.com thì bắt buộc dùng cách này                                              |
| File render bị gắn `yuvj420p`       | ffprobe báo `yuvj420p` (full range) dù đã đặt `pixelFormat: yuv420p`; vài trình phát hiển thị nhạt màu         | Khung hình Remotion chụp là JPEG full range. Đặt `colorSpace: "bt709"` trong `renderMedia` → `yuv420p`, `color_range=tv`                                                                                                       |
| Thumbnail JPEG lỗi với ffmpeg mới   | `Non full-range YUV is non-standard` khi tạo thumbnail                                                         | Thêm `scale=W:-2:out_range=full,format=yuvj420p` trước khi mã hoá JPEG                                                                                                                                                         |
| Import `@studio/video` trong Node   | `loadFont` cần `document`, worker crash                                                                        | Worker chỉ import `@studio/video/meta` (hằng số); composition chỉ được nạp qua bundle                                                                                                                                          |
| Bundle mỗi lần render               | Mỗi render mất thêm 20–40s                                                                                     | Bundle một lần mỗi tiến trình worker, cache promise                                                                                                                                                                            |
| Âm thanh clip gốc                   | Tiếng ồn clip đè giọng đọc                                                                                     | `volume` mặc định 0 (tắt tiếng), người dùng tự bật                                                                                                                                                                             |
| Giấy phép Remotion                  |                                                                                                                | Miễn phí cho cá nhân và công ty ≤ 3 người; kiểm tra remotion.dev/license nếu lớn hơn                                                                                                                                           |
| Cache Turbopack của `next dev` cũ   | Route API mới trả trang 404 HTML ở `pnpm dev` (build vẫn đúng); preview báo `Format error`/`cannot be decoded` | Tắt `pnpm dev`, xoá `apps/web/.next`, chạy lại. Kiểm tra nhanh: `curl` route mới phải trả JSON, không phải HTML                                                                                                                |

---

## 2. Thuật toán cốt lõi (domain)

### 2.1. Tách script thành cảnh (không AI)

1. Chia theo dòng trống, dòng `---`, hoặc dòng `[Cảnh …]` / `[Scene …]`.
2. Nếu chỉ ra 1 khối: tách câu theo `. ! ? …` (giữ dấu câu và ngoặc đóng), gom các câu liên tiếp sao cho mỗi cảnh ≤ `maxWordsPerScene` (mặc định 18 từ).

### 2.2. Tách đôi một cảnh

Tìm mọi ranh giới sau `. ! ? … , ; :` + khoảng trắng; chọn ranh giới gần giữa chuỗi nhất. Không có thì dùng khoảng trắng gần giữa.
Media ở lại nửa đầu; thời lượng thủ công (nếu có) chia theo tỉ lệ độ dài chữ.

### 2.3. "Trọng số lời đọc"

```text
weight(text) = số_từ + 1.5 × số_cụm_dấu_kết_câu + 0.7 × số_dấu_phẩy/chấm_phẩy/hai_chấm   (tối thiểu 1)
ước_lượng_ms = max(1200, weight / 2.6 × 1000)        // ~2.6 từ/giây
```

Tiếng Việt mỗi âm tiết là một "từ" cách nhau bởi khoảng trắng nên đếm từ là xấp xỉ tốt cho thời gian đọc.

### 2.4. Timeline (1 file voice cho cả video)

Chỉ một track voice được tính và được phát (ADR 0006): `activeVoiceTrack(project)` là `"project"` hoặc `"scenes"`.
Track `"project"` bỏ qua voice cảnh, track `"scenes"` bỏ qua voice dự án.

```text
cho mỗi cảnh:
  nếu có durationMs thủ công → cố định ("manual")
  ngược lại nếu cảnh có voice riêng và biết duration → cố định ("scene-voice")
còn_lại = duration(voice dự án) − tổng các cảnh cố định
nếu có voice dự án và còn_lại > 0:
  cảnh tự động i nhận còn_lại × weight(i) / tổng weight các cảnh tự động   ("project-voice")
ngược lại:
  cảnh tự động dùng ước_lượng_ms                                           ("estimate")
start của cảnh = tổng duration các cảnh trước
```

Hiển thị nguồn thời lượng trên UI để người dùng biết cảnh nào đang "đoán". Nếu lệch, họ nhập thời lượng tay cho cảnh đó,
phần còn lại tự chia lại.

### 2.5. Phụ đề

- Cắt lời thành cụm ≤ `maxWordsPerCaption` (mặc định 6). Kết thúc cụm khi: đủ số từ; hoặc gặp dấu câu kết câu;
  hoặc gặp dấu phẩy và cụm đã ≥ 60% số từ tối đa.
- Nếu còn sót 1 từ cuối, gộp vào cụm trước (tránh một từ đứng lẻ trên màn hình).
- Thời gian mỗi cụm trong cảnh chia theo `weight`; cụm cuối kết thúc đúng ở cuối cảnh.
- Xuất SRT (`HH:MM:SS,mmm --> …`) để tải lên YouTube/Facebook riêng nếu cần.

### 2.6. RenderPlan

- Đổi mọi mốc ms → frame bằng `Math.round(ms / 1000 × fps)`. Duration của cảnh = `frame(end) − frame(start)`
  (không làm tròn từng duration riêng lẻ, nếu không sai số cộng dồn làm lệch tiếng).
- Video: `startFrom = frame(sourceStartMs)`, `segmentFrames = frame(sourceEndMs ?? duration) − startFrom`.
- Đường dẫn file được truyền vào qua hàm `resolveUrl(asset)`: web dùng `/api/projects/:id/files/...`, worker dùng URL server nội bộ.
  Nhờ vậy domain không biết gì về HTTP.
- Hiệu ứng âm thanh (SFX) của cảnh: `from = frame(đầu cảnh) + frame(offsetMs)`, dài bằng file SFX nhưng bị cắt ở cuối video;
  được phép kêu tràn sang cảnh sau. `Scene.sfx` là field optional nên file project v1 cũ vẫn đọc được, không cần migration.
- `filterRenderPlan(plan, layers)` tắt từng lớp (hình, phụ đề, voice, nhạc, SFX) mà giữ nguyên timing. Gói CapCut dùng nó để
  render từng track riêng bằng chính `ProjectVideo`: không bao giờ viết composition thứ hai.

---

## 3. Composition (packages/video)

- Lớp dưới: mỗi cảnh một `<Sequence from durationInFrames={dur + (cảnh cuối ? 0 : transitionFrames)}>`, cảnh sau render sau
  (nằm trên), opacity 0→1 trong `transitionFrames` đầu.
- Cover: `objectFit: cover` + `objectPosition: ${focusX*100}% 50%` (đây chính là crop ngang 16:9 → 9:16).
- Contain: bản cover làm mờ (`blur(40px) brightness(0.6) scale(1.15)`) phía sau + bản contain phía trước. Kiểu phổ biến của Shorts khi dùng video ngang.
- Ảnh: Ken Burns `scale 1 → 1.08` theo suốt cảnh.
- Cảnh chưa có media: nền gradient tối theo màu thay đổi theo thứ tự cảnh (để preview vẫn xem được).
- Âm thanh: voice dự án ở frame 0 **hoặc** voice cảnh trong `Sequence` riêng đúng thời lượng cảnh (không bao giờ cả hai); nhạc nền `loop` với volume thấp (~0.12).
- Phụ đề: lớp trên cùng, độc lập với cảnh; chữ trắng đậm 800, viền đen bằng vòng `text-shadow` 16 hướng (ổn định trên mọi renderer),
  hiệu ứng "pop" nhẹ bằng `spring` scale 0.86 → 1. Vị trí mặc định 62% chiều cao để tránh nút và caption của TikTok/Reels/Shorts.
- Kết quả render: H.264, AAC, `yuv420p` (bắt buộc để các nền tảng và điện thoại phát được), CRF ~20.

Trong môi trường thử, video 14 giây mất khoảng 2 phút để render, kể cả bước bundle lần đầu.

## 4. Gói CapCut (ADR 0004)

- Job `kind: "capcut"` chạy `exportCapcut`: render video không phụ đề (chỉ lớp hình + tiếng gốc clip), mỗi lớp âm thanh có tiếng
  thành một WAV dài bằng video (`codec: "wav"` của Remotion), cắt clip từng cảnh bằng FFmpeg theo đúng ranh giới frame của
  RenderPlan, thêm SRT + `HUONG_DAN.txt`, rồi zip (yazl, media không nén).
- Clip cắt bằng `-ss` đặt sau `-i` và encode lại (CRF 18): cắt đúng frame, không phụ thuộc keyframe.
- File trung gian nằm ở `render/<job>-capcut/` và luôn bị xoá (`StoragePort.removeFolder`), kể cả khi lỗi.
- Đo trên máy dev: demo 17 giây (3 cảnh, voice + 1 SFX) xuất gói mất ~70 giây, không tính bundle.

## 5. TTS theo cảnh (M8, ADR 0006)

- Adapter `tts-elevenlabs`: `POST /v1/text-to-speech/{voiceId}?output_format=mp3_44100_128`, header `xi-api-key`,
  body `{ text, model_id, language_code, voice_settings: { stability, similarity_boost, speed } }`. Retry tối đa 2 lần,
  chỉ khi gặp 429/5xx, có tôn trọng `Retry-After`.
- `language_code` là ngôn ngữ dự án (ADR 0013), chỉ gửi cho model nhận nó (Flash/Turbo v2.5, v3). Thiếu tham số này,
  model đoán ngôn ngữ từ một câu ngắn và có lúc đọc tiếng Việt theo kiểu tiếng Anh.
- Model tiếng Việt: `eleven_flash_v2_5` (0,5 credit/ký tự, mặc định) và `eleven_v3` (1 credit/ký tự). `eleven_multilingual_v2`
  **không** hỗ trợ tiếng Việt. Chi phí ước tính = ký tự × credit/ký tự × `ELEVENLABS_USD_PER_CREDIT`.
- Văn bản gửi đi là lời đã chuẩn hoá khoảng trắng (`narrationForSpeech`). Hash cũng tính trên văn bản đã chuẩn hoá,
  nên sửa khoảng trắng không làm phải tạo lại giọng.
- Worker đọc lại project trước mỗi cảnh. Cảnh đã bị xoá trong lúc đang tạo giọng thì file vừa ghi bị xoá theo.
- Nghe thử (ADR 0014):
  - **Mẫu gốc:** `GET /v1/voices/{id}` lấy `preview_url`, rồi server tải file mẫu về. Request tới host chứa file mẫu
    không gửi kèm API key. Phần này miễn phí nên không đi qua CostGuard.
  - **Đọc thử theo thiết lập:** gọi `synthesize` qua `GuardedTts` ngay trong request web, câu đọc tối đa 200 ký tự.
    File lưu tại `projects/<id>/voice-previews/<voiceContentHash>.mp3`. Cùng câu, thiết lập và ngôn ngữ thì dùng lại
    file đã lưu, không trả thêm phí.
  - File preview không phải asset của dự án, nên không ảnh hưởng tới hash hay trạng thái giọng của cảnh.

## 6. AI gợi ý (M9, ADR 0007)

- Adapter `ai-claude` gọi `client.messages.create` với `output_config: { format: { type: "json_schema", schema }, effort: "low" }`.
  Schema lấy từ `zodOutputFormat(zodSchema).schema`. Không dùng prefill: các model 4.6 trở lên trả 400 nếu có.
- Luôn kiểm tra `stop_reason` trước khi đọc nội dung. `refusal` → `AI_REFUSED`; `max_tokens` → `AI_INVALID_OUTPUT`.
  Cả hai trường hợp vẫn bị tính tiền, nên `AiCallError.usage` mang theo chi phí và job ghi lại vào `ai.costUsd`.
- Thinking (adaptive) được tính tiền như output, nên `max_tokens` chừa sẵn chỗ cho nó. Tiếng Việt ≈ 2,5 ký tự/token,
  con số này chỉ dùng để chọn `max_tokens` và để ước tính.
- Gợi ý từ khoá hình dùng số thứ tự cảnh (`sceneNumber`, bắt đầu từ 1) thay vì id, vì model chép id dài dễ sai. Adapter đổi số
  về `sceneId`; domain bỏ đi những cảnh không có trong yêu cầu.
- Kết quả AI luôn đi qua `normalize*` trong domain: trim, tối đa 5 query không trùng nhau, bỏ cảnh rỗng.

## 7. Tìm media (M10, ADR 0008)

- Pexels: `GET /videos/search` và `/v1/search` với `orientation=portrait` và `locale` (`vi-VN`, `zh-CN`, `en-US`);
  header `Authorization: <key>`. Mỗi video có nhiều `video_files`; bỏ bản HLS (`m3u8`, không có kích thước), chọn MP4.
  Ảnh tải bằng `src.original?auto=compress&cs=tinysrgb&fit=max&w=2400&h=2400`.
- Pixabay: `GET /api/videos/` và `/api/` với `lang=vi|zh|en`, `per_page` tối thiểu 3. Key nằm trong query string, nên
  **không bao giờ** đưa URL request vào thông báo lỗi hay log. Bản `xlarge` có thể là chuỗi rỗng, phải lọc bỏ.
- Proxy (`/api/media-proxy`) kiểm tra: phải là HTTPS, không có user:pass trong URL, host nằm trong danh sách của nhà cung cấp.
  Link ảnh và video stock không chứa key.
- Tải stock: stream thẳng vào storage qua `limited()`, probe để chắc đúng loại (video/ảnh), tạo thumbnail, thêm vào thư viện,
  rồi copy sang dự án. Lỗi ở bất kỳ bước nào thì xoá file đã ghi.

## 8. CostGuard (M11a, ADR 0009)

- Port trả phí chỉ được dùng qua `GuardedAi`/`GuardedTts`, tạo **mỗi job** trong `apps/worker/src/container.ts`. Thêm provider
  trả phí mới = viết adapter + bọc nó bằng decorator tương ứng (hoặc viết decorator mới gọi `costGuard.guard`).
- `guard` ghi log cả khi lệnh gọi throw; `onError` phải trả số tiền thật đã bị tính (`AiCallError.usage`), không phải 0.
- `BUDGET_EXCEEDED` mang thông báo tiếng Việt viết sẵn cho người dùng (`budgetExceededMessage`); `toErrorResponse` trả nguyên
  thông báo đó thay cho câu chung.
- Tháng tính theo UTC+7 cố định (`budgetMonthStart`): 2026-10-31T18:00Z đã là tháng 11 ở Việt Nam.
- `generateSceneVoices` dừng ở cảnh đầu tiên bị chặn: các cảnh còn lại báo cùng lỗi, không gửi tiếp (mỗi lần gửi sẽ thêm một dòng `blocked`).

## 9. Full AI (M11b, ADR 0010)

- Job `full_ai` ghi bước đang chạy (`fullAi.step`) và tiến độ trên **cùng một chuỗi ghi** với bản cập nhật cuối, để
  bản ghi tiến độ đến muộn không đè trạng thái COMPLETED.
- Xếp hạng dùng số thứ tự (cảnh, ứng viên bắt đầu từ 1), adapter đổi về key `provider:kind:ref`;
  `normalizeMediaRanking` bỏ key lạ/trùng rồi nối các ứng viên AI bỏ sót vào cuối, nên luôn ra thứ tự đủ.
- Chế độ vision: mỗi ứng viên là một dòng chữ rồi tới ảnh của nó. Ứng viên không lấy được ảnh vẫn được xếp theo chữ.
  Link ảnh do browser gửi lên chỉ được dùng khi `provider.isProxyUrl` chấp nhận (cùng luật với `/api/media-proxy`).
- `<provider>-<ref>.<ext>` là tên file của media stock đã tải; màn duyệt dùng nó để bỏ ứng viên cảnh đang dùng khỏi
  danh sách "Đổi media".
- Màn duyệt và editor là hai trang riêng, mỗi trang một `useProjectEditor`; không import `@/features/scenes` (index)
  từ `full-ai` vì `ProjectWorkspace` đã import `full-ai` (vòng import).

## 10. Xoá dự án

- `deleteProject` xoá theo thứ tự: bản ghi (`repo.remove`) → job (`queue.removeForProject`; Postgres còn có cascade) →
  thư mục `projects/<id>/`. Bản ghi đi trước: nếu xoá file lỗi giữa chừng, dự án đã biến khỏi danh sách, chỉ còn file rác.
- Từ chối (`PROJECT_BUSY`, 409) khi có job `QUEUED`/`PROCESSING`: worker đang chạy sẽ ghi file lại vào thư mục vừa xoá.
- Autosave của editor sau khi xoá không tạo lại dự án: `saveProject` dùng `repo.update`, vốn báo `PROJECT_NOT_FOUND`.
- Log `api_usage` không có khoá ngoại tới `projects` (ADR 0009); trang Ngân sách hiện "Dự án đã xoá".

## 11. Nghỉ giữa các cảnh (ADR 0018)

- ElevenLabs với `previous_text`/`next_text` trả file gần như không có lặng cuối, nên hai cảnh nối thẳng thì đọc dính
  liền. Khoảng nghỉ nằm trên timeline (`TimelineEntry.pauseMs`), file giọng không bị đệm; phụ đề phải chia theo
  `durationMs - pauseMs`, nếu không chữ chạy trước giọng.

## 12. Phân tích clip (ADR 0019)

- **Fade làm `scdet` bỏ sót cảnh.** Short thành phẩm chuyển cảnh bằng mờ dần: hai khung liền nhau ở 30fps chỉ lệch
  điểm < 6, ngưỡng 10 bắt được 0–9 chỗ cắt trên clip 2 phút có ~25 cảnh. Lọc `fps=4` trước `scdet` (so khung cách
  250ms) rồi ngưỡng 5 bắt 23/24. Thời điểm cắt vì vậy chính xác tới ±250ms.
- **4K HEVC giải mã chậm** (~40–55s cho 2 phút). `-hwaccel auto -skip_frame noref` còn ~24s, cùng kết quả;
  `-hwaccel auto` một mình lại chậm hơn. Chụp ảnh từng đoạn bằng `-ss` trước `-i` tốn ~1s/ảnh trên 4K (giải mã từ
  keyframe, mỗi 5s); GPU không giúp. Đo tốc độ chụp phải lấy thời điểm lệch keyframe, nếu không sẽ thấy nhanh giả.
- **`drawtext` crash (segfault) khi máy không có cấu hình fontconfig** (bản ffmpeg build sẵn trên Windows). Đừng in số
  lên ảnh cho AI; gửi chữ "Shot N" thành block text ngay trước ảnh.
- Thứ tự đoạn là hợp đồng giữa ffmpeg, ảnh và câu trả lời của AI: `grabFrames` ghi `frame-000.jpg`… theo đúng thứ tự
  thời điểm, service suy ra key từ tên đó (`StoragePort` không đổi đường dẫn tuyệt đối về key được).
- Mỗi lần phân tích ghi ảnh vào thư mục theo job; chỉ sau khi `setAnalysis` thành công mới xoá thư mục của lần
  trước, để ảnh đang được dùng không bao giờ mất giữa chừng.
- `MediaCandidate` nhiều đoạn cùng clip có chung `provider`/`ref`: React key, chống trùng và danh sách đã dùng phải
  dùng `candidateKey` (có `#n`), không dùng `provider:ref`.
- Xem thử một đoạn bằng media fragment `…/file?file=media#t=<start>,<end>` (giây); trình duyệt tự dừng ở `end`.
