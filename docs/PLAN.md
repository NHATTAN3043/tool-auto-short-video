# Kế hoạch chi tiết — Shorts Studio (code từ đầu)

Tool tạo video dọc 1080×1920 dùng chung cho TikTok, YouTube Shorts, Facebook Reels, với 3 mức tự động:
**Manual** (bạn đưa script + voice + media, 0đ API), **Assisted** (AI làm từng phần, có toggle), **Full AI** (ý tưởng → video, bạn duyệt 15–30%).

Đặc tả sản phẩm gốc: `AI_Shorts_Studio_Detailed_Plan.md`. Cách dựng source base: `02-SOURCE-BASE.md`.
Bẫy kỹ thuật và thuật toán cốt lõi: `03-TECH-NOTES.md`.

---

## 1. Nguyên tắc thứ tự

1. **Rủi ro kỹ thuật lớn nhất làm trước.** Rủi ro lớn nhất là render video ra đúng (font tiếng Việt, cắt khung, đồng bộ tiếng).
   Vì vậy render được chứng minh bằng CLI (M3) **trước khi** có giao diện.
2. **Domain trước, UI sau.** Logic cảnh / timeline / phụ đề là hàm thuần, test kỹ, rồi UI chỉ gọi lại.
3. **Manual xong và dùng thật rồi mới làm AI.** Sau M7 dừng lại làm 3 video thật.
4. **Mỗi milestone kết thúc bằng `pnpm check` xanh + một commit/PR.**

So với đặc tả gốc, các milestone được tách nhỏ hơn để mỗi cái vừa 1–3 phiên Claude Code:

| Ở đây | Đặc tả gốc    | Nội dung                                                            |
| ----- | ------------- | ------------------------------------------------------------------- |
| M0    | M0            | Source base                                                         |
| M1    | (một phần M2) | Domain: schema, preset, thao tác cảnh, timeline, phụ đề, RenderPlan |
| M2    | (một phần M3) | Hạ tầng: storage, repository JSON, ffprobe, job queue               |
| M3    | (một phần M4) | Composition Remotion + worker render + CLI                          |
| M4    | M1            | Web: dự án + 3 mode                                                 |
| M5    | M2            | Web: script + Scene Editor                                          |
| M6    | M3            | Web: upload, thư viện, gán media                                    |
| M7    | M4            | Web: preview + render job → **mốc POC**                             |
| M8    | M5            | TTS theo cảnh                                                       |
| M9    | M6            | AI viết script + chia cảnh + từ khoá                                |
| M10   | M7            | Tìm media Pexels / Pixabay / thư viện                               |
| M11a  | M8            | CostGuard: ngân sách, log `api_usage`, trang cài đặt                |
| M11b  | M8            | Full AI: xếp hạng media, tự chọn, màn duyệt                         |

---

## 2. Mô hình dữ liệu cốt lõi (chốt ở M1)

```ts
type AutomationMode = "manual" | "assisted" | "full_ai";

interface AutomationSettings {
  // mode chỉ là preset của object này
  scriptGeneration: boolean;
  scenePlanning: boolean;
  visualKeywords: boolean;
  voiceGeneration: boolean;
  mediaSearch: boolean;
  mediaRanking: boolean;
  autoMediaSelection: boolean;
}

interface Project {
  schemaVersion: 1;
  id: string;
  name: string;
  mode: AutomationMode;
  automationSettings: AutomationSettings;
  width: 1080;
  height: 1920;
  fps: 30;
  script: string;
  scenes: Scene[];
  assets: MediaAsset[];
  voiceAssetId?: string; // 1 file voice cho cả video (Manual)
  music?: { assetId: string; volume: number };
  style: { captions: CaptionStyle; transition: "none" | "fade"; transitionMs: number; background: string };
  createdAt: string;
  updatedAt: string;
}

interface Scene {
  id: string;
  narration: string;
  durationMs?: number; // để trống = tự tính
  voiceAssetId?: string; // voice riêng của cảnh (TTS), ưu tiên hơn voice dự án
  media?: SceneMedia;
  visualPlan?: { intent: string; preferredMedia: "video" | "image"; searchQueries: string[] };
  status: "draft" | "ready" | "approved";
}

interface SceneMedia {
  // không phá huỷ: chỉ lưu tham chiếu
  assetId: string;
  sourceStartMs: number;
  sourceEndMs?: number; // trống = chạy tới hết cảnh, lặp nếu ngắn
  fit: "cover" | "contain"; // contain = nền mờ phía sau
  focusX: number; // 0..1, vị trí cắt ngang khi 16:9 → 9:16
  volume: number; // âm gốc của clip, mặc định 0
  kenBurns: boolean; // zoom chậm cho ảnh
}

interface MediaAsset {
  id: string;
  kind: "video" | "image" | "audio";
  source: "upload" | "library" | "pexels" | "pixabay" | "tts" | "generated";
  fileName: string;
  path: string;
  thumbnailPath?: string;
  durationMs?: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio?: boolean;
  attribution?: string;
  contentHash?: string;
  createdAt: string;
}

interface CaptionStyle {
  enabled: boolean;
  positionY: number; // 0.62 = tránh UI dưới của TikTok/Reels/Shorts
  fontSize: number;
  maxWordsPerCaption: number;
  uppercase: boolean;
  color: string;
}

interface RenderJob {
  id: string;
  projectId: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";
  progress: number;
  outputPath?: string;
  errorMessage?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}
```

Lưu trữ giai đoạn POC: `storage/projects/<id>/project.json` + `media/`, `thumbnails/`, `render/`;
job ở `storage/jobs/<id>.json` (ADR 0001). Khi đặt `DATABASE_URL`, project, job và thư viện SFX lưu trong PostgreSQL
(adapter `postgres`, ADR 0005); file media và video render vẫn nằm trong `storage/`.

---

## 3. Các milestone

Mỗi milestone có: **Mục tiêu · Phạm vi · Không làm · Tiêu chí xong · Prompt**. Dán prompt vào Claude Code
(hoặc gõ `/milestone M<n>` nếu đã cài slash command trong `templates/`).

---

### M0 — Source base

**Mục tiêu:** repo rỗng nhưng đủ "khung xương": tooling, các package trống, luật kiến trúc được máy kiểm tra, CI.

**Phạm vi:** toàn bộ mục 4 của `02-SOURCE-BASE.md`. Các package `domain`, `services`, `adapters`, `video`, `config`
và app `web`, `worker` đều tồn tại, mỗi cái có `index.ts` + 1 test giả.

**Không làm:** bất kỳ tính năng nào.

**Tiêu chí xong:** `pnpm check` xanh ở máy và CI; thêm `import "node:fs"` vào domain thì `pnpm arch` báo lỗi.

```text
Thực hiện Milestone M0 trong docs/PLAN.md, theo đúng docs/SOURCE-BASE.md mục 2 và 4.
Dựng monorepo pnpm với apps/web (Next.js App Router, TS), apps/worker (tsx),
packages/domain, services, adapters, video, config. TypeScript ghim 6.0.x, ESLint flat config
type-aware, Prettier, Vitest (projects), dependency-cruiser với các luật trong SOURCE-BASE,
husky + lint-staged, GitHub Actions CI, .env.example, .editorconfig, .vscode.
Mỗi package export qua src/index.ts và có 1 test giả. Script `pnpm check` chạy hết.
Không viết tính năng. Đề xuất danh sách file trước, chờ tôi đồng ý rồi mới tạo.
```

---

### M1 — Domain (thuần, không UI, không I/O)

**Mục tiêu:** toàn bộ logic dựng video nằm trong hàm thuần, test kỹ.

**Phạm vi** (`packages/domain`):

- Zod schema cho mọi type ở mục 2, `schemaVersion`, hàm `migrateProject()` (bản đầu chỉ nhận v1).
- `MODE_PRESETS` + `createProject({ name, mode, overrides })`.
- `scriptToScenes(script, { strategy: "auto" | "paragraph" | "sentence", maxWordsPerScene })` không dùng AI:
  tách theo dòng trống, `---`, `[Cảnh n]`; nếu không có đoạn thì gom câu ≤ N từ.
- Thao tác cảnh: `insertSceneAfter`, `deleteScene`, `moveScene`, `updateScene`, `splitScene` (cắt ở ranh giới câu gần giữa nhất),
  `mergeWithNext`, `assignMedia`, `clearMedia`.
- `computeTimeline(project)`: ưu tiên thời lượng thủ công → voice của cảnh → chia voice dự án theo độ dài lời → ước lượng theo số từ.
- `chunkNarration` + `buildCaptions` + `captionsToSrt`.
- `buildRenderPlan(project, resolveUrl)` (đổi ms → frame, tính đoạn cắt video, lặp clip ngắn).
- `DomainError` có mã.

**Không làm:** đọc/ghi file, gọi ffprobe, React.

**Tiêu chí xong:** test bao phủ các ca trong `03-TECH-NOTES.md` mục 2; coverage domain ≥ 90%.

```text
Thực hiện Milestone M1 (Domain) trong docs/PLAN.md. Đọc docs/TECH-NOTES.md mục 2 để biết thuật toán
timeline, phụ đề và RenderPlan. Viết trong packages/domain, chỉ dùng zod, không I/O.
Contract-first: schema zod → type suy ra từ schema → hàm thuần → test vitest cho từng hàm,
gồm ca biên (script rỗng, 1 cảnh, voice ngắn hơn tổng thời lượng thủ công, cảnh không media,
video nguồn ngắn hơn cảnh). Tách file theo cấu trúc trong SOURCE-BASE mục 2.
Lập kế hoạch trước, chờ tôi duyệt.
```

---

### M2 — Hạ tầng: storage, repository, ffprobe, job queue

**Mục tiêu:** lưu/đọc dự án và media thật trên đĩa qua port.

**Phạm vi:**

- `packages/services/src/ports`: `ProjectRepository`, `StoragePort`, `MediaProbePort`, `JobQueuePort`, `Clock`.
- `packages/services/src/testing`: fake in-memory cho từng port.
- Use case: `createProject`, `getProject`, `listProjects`, `saveProject`, `importAsset` (lưu nguyên file → probe → thumbnail → thêm vào project),
  `requestRender`.
- Adapter: `storage-local` (chặn path thoát khỏi thư mục gốc), `repository-json` (ghi atomic: file tạm + rename; đọc lại ngay trước khi ghi
  khi thêm asset), `ffmpeg` (probe: duration/width/height/fps/hasAudio, xử lý cờ xoay của video điện thoại; thumbnail), `queue-file`.
- Env: `STUDIO_STORAGE_DIR`.

**Không làm:** UI, render.

**Tiêu chí xong:** test tích hợp sinh video/ảnh/mp3 bằng FFmpeg lavfi rồi import, kiểm tra metadata đúng và file gốc không đổi (so hash).

```text
Thực hiện Milestone M2 trong docs/PLAN.md. Định nghĩa port trong packages/services/src/ports,
fake in-memory trong services/src/testing, use case trong services, và adapter storage-local,
repository-json, ffmpeg, queue-file trong packages/adapters (mỗi adapter một thư mục).
Test use case bằng fake; test adapter bằng file sinh từ ffmpeg -f lavfi trong thư mục tạm.
Xem docs/TECH-NOTES.md mục 1 về video xoay và ghi file atomic. Lập kế hoạch trước.
```

---

### M3 — Composition Remotion + worker render + CLI

**Mục tiêu:** từ một `project.json` mẫu ra được MP4 1080×1920 đúng chuẩn. **Chưa có UI.**

**Phạm vi:**

- `packages/video`: component `ProjectVideo({ plan })` + `Root` đăng ký composition với `calculateMetadata` từ plan + `entry.ts`.
  Cover với `objectPosition` theo `focusX`; contain có nền mờ; Ken Burns cho ảnh; lặp clip ngắn; fade không làm lệch thời gian;
  phụ đề viền đen, font Be Vietnam Pro đóng gói trong `public/`.
- `adapters/renderer-remotion`: bundle 1 lần/tiến trình, server HTTP nhỏ có Range phục vụ thư mục dự án, `renderMedia` H.264/AAC/yuv420p,
  báo tiến độ, ghi thêm file `.srt`.
- `apps/worker`: vòng lặp lấy job QUEUED; job PROCESSING bị treo khi worker khởi động lại thì đánh FAILED.
- CLI: `pnpm render <projectId>` và `pnpm demo` (sinh media mẫu bằng FFmpeg, tạo dự án 3 cảnh, render).
- `fixtures/demo-project.json`.

**Không làm:** UI, TTS, AI.

**Tiêu chí xong:** `pnpm demo` ra video 1080×1920, 30fps, có tiếng, phụ đề tiếng Việt đủ dấu, cảnh 1 dùng đoạn 3.2–9.5s của video 1,
cảnh 2 là ảnh, cảnh 3 dùng đoạn 14–21s của video 2. Render được khi tắt mạng.

```text
Thực hiện Milestone M3 trong docs/PLAN.md. Đọc kỹ docs/TECH-NOTES.md mục 1 và 3 (bẫy Remotion:
font offline, trimBefore/trimAfter, publicDir khi bundle, file server có Range, chuyển cảnh chồng lấn).
Viết packages/video, adapters/renderer-remotion, vòng lặp job trong apps/worker, lệnh pnpm render và pnpm demo.
Kiểm tra kết quả bằng ffprobe và trích vài khung hình để tôi xem. Lập kế hoạch trước.
```

---

### M4 — Web: dự án + 3 mode

**Phạm vi:** trang danh sách dự án; form tạo dự án (tên, chọn mode, các toggle khởi tạo từ preset và sửa được);
API `GET/POST /api/projects`, `GET/PUT /api/projects/[id]`; `server/container.ts` ráp adapter; giao diện tiếng Việt.
Chọn thư viện UI một lần ở đây (gợi ý: Tailwind + shadcn/ui) và ghi ADR.

**Tiêu chí xong:** tạo dự án, đổi toggle, reload vẫn giữ.

```text
Thực hiện Milestone M4 trong docs/PLAN.md. Next.js App Router: app/ chỉ routing, logic trong
features/project và services. Route handler: parse zod → gọi service → JSON; lỗi DomainError map sang HTTP.
Dùng Tailwind + shadcn/ui, ghi ADR. Giao diện tiếng Việt. Không làm scene editor. Lập kế hoạch trước.
```

---

### M5 — Web: Script + Scene Editor

**Phạm vi:** ô dán script (đếm từ, ước lượng thời lượng); nút "Tách cảnh" (chọn chiến lược, cảnh báo nếu ghi đè);
danh sách cảnh: sửa lời, thêm, xoá, lên/xuống, tách, gộp, nhập thời lượng thủ công; hiện start → end và nguồn thời lượng;
tự lưu (debounce) + trạng thái "Đã lưu"; hoàn tác (undo) một bước là điểm cộng.

**Tiêu chí xong:** dán script → tách → sửa/gộp/đổi thứ tự → reload vẫn đúng.

```text
Thực hiện Milestone M5 trong docs/PLAN.md. Mọi thao tác cảnh dùng hàm domain (M1); state trong hook
features/scenes/hooks/use-project-editor.ts, component chỉ hiển thị. Tự lưu debounce 800ms qua PUT.
Không gọi AI. Lập kế hoạch trước.
```

---

### M6 — Web: upload, thư viện, gán media

**Phạm vi:**

- `POST /api/projects/[id]/assets` (multipart, stream xuống đĩa, giới hạn dung lượng, chỉ nhận mp4/mov/webm, jpg/png/webp, mp3/wav/m4a).
- `GET /api/projects/[id]/files/[...path]` có hỗ trợ **Range** (để tua video), chặn path traversal.
- Panel media: kéo thả nhiều file, lưới thumbnail, thời lượng, độ phân giải.
- Chọn audio làm voice dự án; nhạc nền + âm lượng.
- Mỗi cảnh: chọn media; video có thanh chọn đoạn start/end với `<video>` xem trước; cover/contain; thanh focus ngang; âm lượng gốc.

**Tiêu chí xong (theo đặc tả):** upload MP4 → thấy trong thư viện → gán cho Cảnh 3 → chọn 15s–22s → lưu → reload vẫn đúng.

```text
Thực hiện Milestone M6 trong docs/PLAN.md. Upload đi qua use case importAsset (M2), không xử lý file
trong route handler. Route phục vụ file phải hỗ trợ Range và chặn path traversal (có test).
Component chọn đoạn video tách riêng, nhận/trả sourceStartMs/sourceEndMs. Lập kế hoạch trước.
```

---

### M7 — Web: preview + render → **MỐC POC**

**Phạm vi:** `@remotion/player` với `ProjectVideo` và `buildRenderPlan(project, url API file)`; bấm cảnh → nhảy tới cảnh;
cài đặt phụ đề (bật/tắt, cỡ, vị trí, số từ/dòng, viết hoa) và chuyển cảnh; nút Render tạo job (không render trong request),
poll tiến độ, tải MP4 + SRT; cảnh báo cảnh chưa có media và video quá dài; `pnpm dev` chạy cả web lẫn worker.

**Tiêu chí xong:** tạo trọn một video Manual từ giao diện, 0đ API. Preview và file render trông giống nhau.

```text
Thực hiện Milestone M7 trong docs/PLAN.md. Preview dùng đúng ProjectVideo và buildRenderPlan như worker,
không viết composition thứ hai. Font phải dùng staticFile và có trong apps/web/public.
Render qua JobQueuePort; UI poll trạng thái. Lập kế hoạch trước.
```

**→ DỪNG. Làm 3 video thật** và ghi lại vào `docs/poc-notes.md`: thời gian làm 1 video, chỗ UX vướng, phụ đề có phải sửa tay không,
còn phải mở CapCut không. Sửa các điểm vướng trước khi làm AI. Cải tiến hay cần: import SRT có sẵn, chỉnh tay mốc phụ đề,
preset kiểu phụ đề, logo/watermark, proxy H.264 cho video HEVC.

---

### M8 — TTS theo cảnh

**Phạm vi:** `TtsPort` + adapter (ElevenLabs hoặc nhà cung cấp bạn chọn); sinh voice **từng cảnh** thành asset `source: "tts"`;
lưu `contentHash = hash(narration + voiceSettings)` để chỉ sinh lại cảnh đã đổi lời; nút "Tạo giọng" từng cảnh và "Tạo cho cảnh đã đổi";
chỉ hiện khi toggle `voiceGeneration` bật và có key; hiện chi phí ước tính trước khi chạy.

**Tiêu chí xong:** đổi lời Cảnh 4 → chỉ Cảnh 4 được sinh lại; các file voice khác giữ nguyên.

### M9 — AI script + chia cảnh + từ khoá hình

**Phạm vi:** `AiPort` (`generateScript`, `planScenes`, `generateVisualPlan`); adapter OpenAI hoặc Claude, **structured output** và validate zod;
kết quả là _gợi ý_ để bạn duyệt rồi mới áp vào; retry tối đa 2 lần chỉ cho 429/5xx; không gọi từ browser.

**Tiêu chí xong:** ý tưởng → script → danh sách cảnh có từ khoá, không phải sửa JSON tay.

### M10 — Tìm media

**Phạm vi:** `MediaSearchPort` + adapter `media-library` (thư viện dùng chung giữa dự án, có tag, đếm lượt dùng), `media-pexels`, `media-pixabay`;
thứ tự: thư viện → Pexels/Pixabay; ưu tiên video dọc; panel tìm kiếm trong cảnh điền sẵn `searchQueries`; chọn → tải về thành asset (lưu nguồn + attribution) → gán cảnh.

**Tiêu chí xong:** mở Cảnh 5 → tìm → xem ứng viên → chọn → gán; chỉ Cảnh 5 thay đổi.

**→ Mốc 2: làm 5–10 video bằng Assisted**, đo: thời gian tiết kiệm (mục tiêu ≥ 50%), % cảnh AI chia dùng được (≥ 80%),
% top-3 media dùng được (≥ 75%), chi phí/video (< 10.000đ).

### M11 — CostGuard + Full AI

Tách làm hai phần; M11b dựa trên M11a vì mọi lệnh gọi trả phí của luồng Full AI phải qua CostGuard.

#### M11a — CostGuard (ADR 0009)

**Phạm vi:** `CostGuardPort` + adapter (ngân sách ngày/tháng/dự án/mỗi lần gọi, log `api_usage`, chặn khi vượt); mọi adapter trả phí
được bọc qua CostGuard trong `container.ts`; trang cài đặt ngân sách + chi phí theo dự án; hiện chi phí ước tính và ngân sách còn lại
trước khi bấm chạy. Log `api_usage` là bảng Postgres mới trong adapter `postgres` (ADR 0005), hoặc file JSONL khi không có DB.

**Tiêu chí xong:** vượt ngân sách thì thao tác bị chặn với thông báo rõ; 100% lệnh gọi trả phí có log.

#### M11b — Full AI

**Phạm vi:** AI xếp hạng media + tự chọn; luồng Full AI có màn duyệt (Giữ cảnh / Đổi media / Viết lại / Tạo lại giọng);
hiện chi phí ước tính của cả luồng trước khi bấm chạy. Xếp hạng media có **hai chế độ, người dùng chọn**: theo mô tả chữ
(tag/alt của Pexels/Pixabay, rẻ) hoặc cho AI xem thumbnail (chính xác hơn, đắt hơn).

**Tiêu chí xong:** ý tưởng → video có media và giọng cho từng cảnh, duyệt và sửa từng cảnh trong một màn hình.

### Bổ sung — Xoá dự án

**Phạm vi:** nút Xoá ở danh sách dự án và trong Cài đặt dự án, hỏi "Bạn chắc chắn?" một lần rồi **xoá hẳn** (không thùng
rác): bản ghi dự án, các job của nó và thư mục `projects/<id>/`. Chặn xoá khi dự án có job đang chờ/đang chạy. Giữ thư
viện media/SFX chung và log `api_usage` (chi phí vẫn tính vào ngân sách ngày/tháng). **Không làm:** xoá nhiều dự án một
lúc, khôi phục.

### Bổ sung — Skill cho Full AI (ADR 0012)

**Phạm vi:** dropdown chọn một skill (thư mục `STUDIO_SKILLS_DIR`, mặc định `.claude/skills`) ở form Full AI và ở
nút Viết lại của màn duyệt; nội dung `SKILL.md` (hoặc `SKILL.vi.md`) gửi kèm các bước Viết script, Chia cảnh/Gợi ý
hình ảnh và Viết lại; dự án nhớ skill đã chọn. Lời đọc không phải tiếng Việt bị bỏ, dự án không đổi. **Không làm:**
chọn nhiều skill, gửi `references/`, dùng skill cho xếp hạng media hay trợ lý AI từng phần.

### Bổ sung — Full AI hỏi lại và duyệt khung kịch bản (ADR 0015)

**Phạm vi:** trang `/projects/[id]/full-ai` với 3 bước: ý tưởng → AI hỏi lại tối đa 5 câu (chọn một, chọn nhiều hoặc
tự gõ; bỏ trống thì AI tự chọn) → khung kịch bản theo cảnh (lời đọc + ý đồ hình, ước số giây, cảnh báo cảnh dài).
Ở khung kịch bản: sửa lời, thêm/xoá/đổi thứ tự cảnh, AI viết lại một cảnh, góp ý để AI làm lại cả khung. Duyệt xong
mới chạy job Full AI, dùng đúng lời đã duyệt. Nháp lưu riêng, tải lại trang không mất. Có đường tắt "Chạy luôn, không
hỏi" và "Bỏ qua câu hỏi". **Không làm:** hỏi nhiều vòng, lịch sử các lần làm lại, toggle riêng trong cài đặt.

**Tiêu chí xong:** từ ý tưởng tới video mà không có lệnh gọi trả phí nào ngoài câu hỏi và khung kịch bản trước khi
người dùng bấm duyệt; lời đọc trong dự án đúng từng chữ với khung đã duyệt.

### Bổ sung — Tìm cả file upload của dự án (ADR 0016)

**Phạm vi:** Full AI và ô tìm media tìm cả video/ảnh người dùng upload vào dự án, theo tag đọc từ tên file
(`cat-sleeping__orange-cat__sofa.mp4`). Chấm điểm bỏ stop-word và có ngưỡng tối thiểu. Tối đa 5/10 ứng viên xếp hạng là
file của mình, còn lại cho stock. AI xếp hạng được loại ứng viên không hợp, và Full AI không tự gán ứng viên bị loại.
**Không làm:** ô sửa tag hay mô tả cho file upload, AI tự gắn tag, upload thẳng vào thư viện chung.

**Tiêu chí xong:** dự án có file `orange-cat__sofa.mp4` thì cảnh "orange cat" được đề xuất file đó; thư viện chung có
nhiều clip khớp yếu vẫn chừa chỗ cho stock; cảnh mà AI loại hết ứng viên thì để trống kèm cảnh báo.

### Bổ sung — Logo kênh hình tròn (ADR 0017)

**Phạm vi:** trong tab "Phụ đề & logo", tải ảnh logo lên hoặc chọn một ảnh của dự án. Logo được vẽ thành hình tròn ở
một trong 4 góc (mặc định trên trái), hiện suốt video. Chỉnh được kích thước, khoảng cách tới mép, độ rõ, viền trắng,
bật/tắt và bỏ logo; preview cập nhật ngay, hoàn tác được. Logo có trong video render và trong video của gói CapCut, và
không bị đề xuất làm hình của cảnh. **Không làm:** logo mặc định dùng chung cho mọi dự án, logo chạy giữa các góc,
logo động, nhiều logo, chữ watermark.

**Tiêu chí xong:** dự án có logo ở góc trên trái thì preview và file MP4 render ra có cùng vòng tròn logo ở cùng vị
trí, suốt video; dự án cũ không có logo vẫn mở và render như trước.

### Bổ sung — Nghỉ lấy hơi giữa các cảnh (ADR 0018)

**Phạm vi:** cảnh có giọng riêng được cộng thêm khoảng nghỉ `style.scenePauseMs` theo dấu câu (đủ mức sau `. ! ? …`, 2/3
khi câu còn tiếp); phụ đề chia theo phần có tiếng và giữ câu cuối qua khoảng nghỉ; dự án mới mặc định 300ms, dự án cũ
không đổi; thanh trượt "Nghỉ giữa các cảnh" 0–1s. **Không làm:** đo khoảng lặng có sẵn trong file giọng, nghỉ riêng từng
cảnh (thời lượng tay đã làm được việc đó).

**Tiêu chí xong:** hai cảnh Full AI liền nhau có chỗ lấy hơi mà không phải nhập tay thời lượng.

### Bổ sung — Phân tích clip tự tải và báo cảnh thiếu (ADR 0019)

**Phạm vi:** video upload trong dự án tự vào kho chung (một lần mỗi file); nút "Phân tích" (có phí, xác nhận chi phí)
cắt video thành đoạn bằng ffmpeg và nhờ Claude mô tả từng đoạn; Full AI và ô tìm media tìm theo đoạn, gán đúng
`sourceStartMs`, không dùng một đoạn hai lần, đoạn có chữ/logo xếp sau kèm cảnh báo; màn duyệt có khung "Cảnh thiếu"
kèm từ khoá; màn chạy Full AI nhắc video chưa phân tích. Kế hoạch và nhật ký kiểm thử: `docs/plans/clip-analysis.md`.
**Không làm:** tạo ảnh/video bằng AI, tải video từ link TikTok/YouTube, xoá watermark, trang "Kho clip" riêng, viết
script từ footage.

**Tiêu chí xong:** clip 2 phút tên vô nghĩa, sau khi phân tích, được Full AI dùng đúng đoạn khớp lời cho một cảnh và
bắt đầu đúng chỗ; cảnh không tìm được hình hiện trong "Cảnh thiếu" với từ khoá dùng được.

---

## 4. Sau V1 (chỉ khi POC chứng minh giá trị)

Phụ đề theo từng từ (karaoke) bằng Whisper; căn voice chính xác theo từ; smart crop theo khuôn mặt; template phong cách;
đăng tự động lên nền tảng; render trên cloud. Không làm trong V1.
