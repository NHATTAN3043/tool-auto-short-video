# Kế hoạch triển khai — Phân tích clip tự tải và báo cảnh thiếu

**Trạng thái:** đang làm (P1–P5 xong) · ADR dự kiến: 0019 · Bổ sung cho ADR 0008 (thư viện chung), 0010 (Full AI), 0016 (file upload)

## Mục tiêu

1. Video người dùng tự tải về (1–5 phút, nhiều phân đoạn, tên file vô nghĩa) được AI hiểu theo **từng đoạn** và
   Full AI tự gán **đúng đoạn** vào cảnh (`sourceStartMs`), không phải cắt tay.
2. Cảnh không tìm được hình phù hợp được **liệt kê rõ** kèm mô tả và từ khoá, để người dùng biết cần tải gì.

## Đã chốt với người dùng

| Vấn đề            | Quyết định                                                                          |
| ----------------- | ----------------------------------------------------------------------------------- |
| Nơi lưu clip      | Kho chung (thư viện media), nguồn mới `upload`, chống trùng bằng `contentHash`      |
| Nơi upload        | Trong dự án như hiện tại; video tự vào kho, có ô "Lưu vào kho chung" (mặc định bật) |
| Khi nào phân tích | Chỉ khi bấm nút, có hộp xác nhận chi phí; Full AI không tự phân tích                |
| Cảnh trống        | Chỉ báo để người dùng tải; không tạo ảnh/video AI                                   |
| Độ dài clip       | 1–5 phút → tối đa 48 đoạn, mỗi đoạn một ảnh ≤ 480px                                 |

## Không làm trong đợt này

Tạo ảnh/video bằng AI, tải video từ link TikTok/YouTube, xoá watermark, trang "Kho clip" riêng, luồng
"footage trước rồi mới viết script" (giai đoạn sau), nhận dạng giọng nói trong clip.

## Thiết kế tóm tắt

```
upload (dự án) ──copy──► kho chung: LibraryMedia { source: "upload", sourceRef: "upload:<sha256>", analysis? }
                                    │  bấm "Phân tích" → job `clip` (worker)
                                    ▼
             ffmpeg scdet → điểm cắt → shotsFromCuts() → khung giữa mỗi đoạn (ảnh ≤ 480px)
                                    ▼
             Claude vision (qua CostGuard) → mô tả + tag en/vi + có chữ/watermark, theo số thứ tự đoạn
                                    ▼
             analysis.shots[] { startMs, endMs, description, tags, textOverlay, thumbnailPath }
                                    ▼
Full AI: mỗi đoạn là một ứng viên (key `library:video:lib_1#3`) → xếp hạng → gán { sourceStartMs: shot.startMs }
         cảnh không có ứng viên / bị loại hết → missingScenes[]
```

- File gốc không bao giờ bị sửa (luật 4); ảnh của từng đoạn là file phụ trong thư mục kho.
- Gán đoạn chỉ đặt `sourceStartMs`, để `sourceEndMs` trống: nếu giọng dài hơn đoạn, video chạy tiếp tự nhiên sang
  đoạn sau thay vì lặp lại. Mỗi đoạn chỉ dùng cho một cảnh trong cùng dự án.
- Dự án có asset cùng `contentHash` với item trong kho thì dùng lại asset đó, không copy lần nữa.

## Cách kiểm thử chung

Mỗi phần kết thúc bằng **3 lớp kiểm tra** và **người dùng xác nhận trước khi sang phần sau**:

1. **Test tự động** (vitest): domain thuần, use case với fake, adapter với ffmpeg thật hoặc HTTP giả lập.
2. **`pnpm check`** xanh (format, lint, typecheck, arch, test).
3. **Kiểm tra tay** trên **bộ clip mẫu** (P0) theo checklist của phần đó, ghi kết quả vào mục "Nhật ký kiểm thử" cuối
   file này.

Mỗi phần là một commit riêng (Conventional Commit), để lỗi ở phần sau không kéo theo phần trước.

---

## P0 — Bộ clip mẫu và số đo gốc (không code)

**Mục đích:** có dữ liệu thật để đo trước/sau, tránh "cảm giác là tốt hơn".

- Người dùng chọn **5 clip thật** đã từng tải (1–5 phút, có clip nhiều đoạn, có clip quay liền một cảnh, có clip dính
  chữ/watermark) và **2 script** đã từng làm bằng Full AI.
- Clip để ngoài repo (không commit), ghi đường dẫn vào nhật ký.
- Đo gốc: chạy Full AI hiện tại với 2 script, đếm **số cảnh phải sửa media bằng tay** và thời gian sửa.

**Xong khi:** có bảng số đo gốc trong nhật ký.

## P1 — Hợp đồng domain (thuần, chưa đổi hành vi)

**File:**

- `packages/domain/src/media/clip-analysis.ts` (mới): `ClipShotSchema`, `ClipAnalysisSchema`, hằng số
  (`MIN_SHOT_MS = 1200`, `MAX_SHOT_MS = 8000`, `MAX_SHOTS = 48`), `shotsFromCuts(cutsMs, durationMs)`.
- `media-library.ts`: `source` thêm `upload`; field tuỳ chọn `analysis`; `uploadSourceRef(contentHash)`.
- `search.ts`: `MediaCandidate.segment` (tuỳ chọn `{ index, startMs, endMs }`), `candidateKey` có `#index`;
  hàm `shotCandidates(item)` và chấm điểm theo tag + mô tả của đoạn; đoạn `textOverlay` bị trừ điểm.
- `full-ai/schema.ts`: `MissingSceneSchema { sceneId, reason: "no_candidates" | "all_rejected", intent, queries }`,
  hàm thuần `missingScenes(...)`.
- Không tăng `schemaVersion` (mọi field mới tuỳ chọn); thư viện Postgres lưu jsonb nên không cần migration.

**Test tự động:**

- `shotsFromCuts`: không có điểm cắt → chia đều ≤ 8s; điểm cắt sát nhau → gộp đoạn < 1,2s; đoạn cuối ngắn gộp vào
  trước; điểm cắt ngoài khoảng/trùng/không sắp xếp; trần 48 đoạn; tổng các đoạn phủ kín `[0, durationMs]`.
- Schema: file thư viện cũ (không `analysis`, source `pexels`) vẫn parse; item `upload` thiếu `contentHash` bị từ chối.
- Chấm điểm: đoạn khớp tag thắng đoạn chỉ khớp mô tả; đoạn có chữ xếp sau đoạn sạch cùng điểm; ngưỡng
  `MIN_MATCH_SCORE` vẫn áp dụng.
- `candidateKey` phân biệt hai đoạn của cùng một clip; ứng viên không có đoạn giữ nguyên key cũ.
- `missingScenes`: phân loại đúng hai lý do, bỏ qua cảnh đã có media.

**Kiểm tra tay:** không có (chưa đổi hành vi). **Xong khi:** test + `pnpm check` xanh, app chạy như cũ.

## P2 — Tách đoạn bằng ffmpeg (miễn phí)

**File:**

- `packages/services/src/ports/clip-frames.ts` (mới): `ClipFramesPort { detectCuts(path, { threshold }),
grabFrames(path, atMs[], outDir, { maxSide }) }`.
- `packages/adapters/src/ffmpeg/ffmpeg-clip-frames.ts` (mới): `scdet` trên bản thu nhỏ 320px + đọc
  `lavfi.scd.time` từ stderr; khung bằng `-ss` trước `-i`, cạnh dài ≤ 480px.
- Script `pnpm clip:shots <file...> [--threshold=5]`: in danh sách đoạn và ghi trang HTML các khung ra thư mục tạm
  để xem bằng mắt.
- **Đổi so với bản đầu:** bỏ tấm lưới. `drawtext` của ffmpeg crash khi thiếu fontconfig và cần đường dẫn font khác
  nhau giữa Windows/Linux. Thay vào đó P4 gửi **mỗi đoạn một ảnh**, đứng sau dòng chữ "Shot N" (API cho tối đa 100
  ảnh mỗi lần gọi): Claude không thể đánh số lệch, chi phí token tương đương.

**Test tự động** (`test-media.ts`, video sinh bằng `lavfi`):

- Video 3 màu liền nhau (0–2s, 2–5s, 5–9s) → điểm cắt ≈ 2000, 5000 ms (±1 khung).
- Video một cảnh tĩnh 20s → không có điểm cắt.
- `grabFrames` tạo đúng số file, đúng chiều rộng; video xoay (điện thoại) cho khung đúng chiều.
- File hỏng / không phải video → lỗi rõ ràng, không treo.

**Kiểm tra tay:** chạy `pnpm clip:shots` trên 5 clip mẫu, mở trang HTML:

- [ ] Không đoạn nào < 1,2s hoặc > 8s; ≤ 48 đoạn mỗi clip.
- [ ] Đa số chỗ chuyển cảnh thật được bắt; ghi lại chỗ bỏ sót/chia vụn → chỉnh `threshold` (đã chốt 5, so khung cách 250ms).
- [ ] Thời gian xử lý một clip 5 phút: ghi lại (mục tiêu < 60s).

**Xong khi:** người dùng thấy cách chia đoạn chấp nhận được trên 5 clip.

## P3 — Clip upload vào kho chung

**File:**

- `packages/services/src/media-library/add-upload-to-library.ts` (mới): copy file + thumbnail sang kho, chống trùng
  theo `contentHash`, tag ban đầu từ tên file (như ADR 0016).
- `import-asset.ts`: tuỳ chọn `addToLibrary` (mặc định bật cho video); lỗi khi vào kho không làm hỏng upload.
- Adapter thư viện JSON và Postgres: chấp nhận `source: "upload"`, tìm theo `contentHash`.
- Tìm media: ứng viên `project` và `library` cùng `contentHash` chỉ hiện một lần; chọn item kho mà dự án đã có file
  giống hệt → dùng lại asset của dự án.
- Web: ô "Lưu vào kho chung" ở khung upload; nhãn "Tự tải" cho item kho nguồn `upload`.

**Test tự động:**

- Upload video → có item kho `upload:<sha256>`; upload lại cùng file (dự án khác) → không tạo item thứ hai.
- Bỏ chọn ô → không vào kho; ảnh không vào kho.
- Copy vào kho lỗi → asset dự án vẫn tạo, có cảnh báo, không để file rác.
- Tìm kiếm không trả trùng; chọn item kho trùng hash → không copy file.
- Adapter JSON/Postgres: lưu/đọc item `upload`, tìm theo hash.

**Kiểm tra tay:**

- [ ] Upload 5 clip mẫu vào dự án A → mở dự án B, tìm "Thư viện" thấy cả 5 (theo tên file).
- [ ] Upload lại 1 clip ở dự án B → kho vẫn 5 item.
- [ ] Dự án A render như trước.

**Xong khi:** người dùng xác nhận kho nhận clip đúng, không trùng.

## P4 — Phân tích đoạn bằng Claude (trả phí) + màn xem đoạn

**File:**

- Domain: `RenderJobKindSchema` thêm `clip`; `ClipJobOptionsSchema { libraryIds, reanalyze? }`.
- Postgres: migration `0007_clip_jobs` (cột `render_jobs.clip` jsonb, cho phép null).
- `AiPort.describeShots({ sheets, shotCount, language })` + `estimate`; adapter `ai-claude`: prompt, structured
  output `{ shots: [{ index, description, tags_en, tags_vi, textOverlay }] }`, validate zod.
- Use case `requestClipAnalysis` (ước tính chi phí, giữ chỗ CostGuard, không tạo job trùng) và `analyzeClip`
  (worker): cắt → `shotsFromCuts` → ảnh từng đoạn → Claude (mỗi ảnh sau chữ "Shot N") → lưu `analysis`; mỗi clip lỗi riêng,
  không kéo clip khác; dọn file tạm.
- Worker: xử lý job `clip`. `container.ts` web + worker đăng ký port mới.
- Web: trong danh sách media, clip có trạng thái "Chưa phân tích / Đang phân tích / N đoạn"; nút "Phân tích" (chọn
  nhiều) mở hộp chi phí; xem danh sách đoạn (ảnh, thời điểm, mô tả, tag, cờ "có chữ"), bấm để xem thử đoạn đó.

**Test tự động:**

- Use case với fake: chạy đúng thứ tự, lưu đủ đoạn; AI trả thiếu/thừa/sai `index` → clip đó lỗi, không lưu nửa vời;
  ngân sách bị chặn → job thất bại với thông báo rõ, không gọi AI; clip đã phân tích bị bỏ qua (trừ `reanalyze`);
  người dùng xoá item trong lúc chạy → bỏ qua, không lỗi.
- Retry: chỉ 429/5xx, tối đa 2 lần (theo luật 7), có log `api_usage`.
- Adapter Claude (HTTP giả lập): gửi đủ ảnh, đúng schema; parse đúng; output sai schema → lỗi có `usage`.
- Ước tính: 48 đoạn ≤ trần chi phí mỗi lần gọi.
- Migration chạy được trên DB trống và DB có dữ liệu.

**Kiểm tra tay:**

- [ ] Phân tích 5 clip mẫu; ghi **chi phí thật / clip** so với ước tính (dự kiến ~0,02–0,08 USD).
- [ ] Soát ngẫu nhiên 20 đoạn: mô tả đúng ≥ 80%; cờ "có chữ" đúng với clip dính watermark.
- [ ] Không có key Claude → nút ẩn, phần còn lại chạy bình thường (luật 5).
- [ ] Bấm "Phân tích" hai lần liên tiếp → chỉ một job.

**Xong khi:** chi phí và độ chính xác mô tả được người dùng chấp nhận.

## P5 — Full AI chọn theo đoạn

**File:**

- `search-media.ts`: item kho đã phân tích → một ứng viên mỗi đoạn (thumbnail là ảnh của đoạn, mô tả là mô tả đoạn);
  chưa phân tích → như cũ (một ứng viên cả clip).
- `run-full-ai.ts`: xếp hạng text dùng mô tả đoạn, vision dùng ảnh đoạn; gán `sourceStartMs = shot.startMs`; không
  dùng một đoạn cho hai cảnh; giới hạn `AI_RANK_MAX_OWN` tính theo đoạn.
- Ô "Đổi media" thủ công cũng hiện từng đoạn và gán đúng thời điểm.

**Test tự động:**

- Cảnh khớp đoạn 3 của clip → asset gán có `sourceStartMs` = đầu đoạn 3, `sourceEndMs` trống.
- Hai cảnh cùng khớp một đoạn → cảnh sau lấy đoạn khác hoặc ứng viên khác.
- Clip chưa phân tích vẫn được đề xuất như trước (không hồi quy ADR 0016).
- Item kho chưa có trong dự án → copy một lần dù nhiều cảnh dùng nhiều đoạn của nó.
- Render plan: video bắt đầu đúng khung `sourceStartMs`.

**Kiểm tra tay** (so với P0):

- [ ] Chạy lại Full AI với 2 script + 5 clip đã phân tích: **số cảnh phải sửa media giảm ≥ 50%** so với số đo gốc.
- [ ] Preview các cảnh dùng clip tự tải: hình khớp lời, bắt đầu đúng chỗ, không bị lặp đoạn.

**Xong khi:** đạt mục tiêu giảm sửa tay, hoặc người dùng chấp nhận kết quả.

## P6 — Báo cảnh thiếu

**File:**

- `run-full-ai.ts`: trả `missingScenes` trong kết quả job (dùng hàm thuần ở P1).
- Web: khung "Cảnh thiếu" ở màn kết quả Full AI: số cảnh, ý định hình ảnh, từ khoá en/vi/zh có nút copy, bấm để
  nhảy tới cảnh; nhắc "Còn N clip chưa phân tích" ở màn chạy Full AI (kèm nút mở phần phân tích).

**Test tự động:**

- Cảnh không ứng viên / bị loại hết → có trong danh sách đúng lý do; cảnh đã gán → không có.
- Job cũ không có `missingScenes` vẫn đọc được.
- Hàm đếm clip chưa phân tích.

**Kiểm tra tay:**

- [ ] Script có cảnh cố tình "khó" (không clip nào khớp) → cảnh đó hiện trong khung, từ khoá dùng được để tự tìm.
- [ ] Gán media tay cho cảnh thiếu → cảnh rời khỏi danh sách sau khi tải lại.

## P7 — Hoàn tất

- ADR 0019, mục "Bổ sung" trong `docs/PLAN.md`, bẫy kỹ thuật (`scdet`, ngưỡng, `drawtext` cần fontconfig) vào `docs/TECH-NOTES.md`.
- `pnpm check`; tổng kết file đổi, rủi ro, chi phí đo được, số đo trước/sau.

---

## Rủi ro và cách giảm

| Rủi ro                                                       | Giảm thiểu                                                              |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `scdet` bỏ sót cảnh quay liền / chia vụn clip nhiều hiệu ứng | Gộp/chia theo `MIN/MAX_SHOT_MS`; chỉnh ngưỡng ở P2 trên clip thật       |
| Khung giữa đoạn không đại diện khi máy quay di chuyển        | Đoạn dài bị chia ≤ 8s; nếu vẫn kém, P4 thử 2 khung mỗi đoạn             |
| Claude trả lệch số đoạn                                      | Mỗi ảnh đi sau chữ "Shot N"; kiểm tra đủ và đúng `index`, sai thì lỗi   |
| Chi phí cao hơn dự kiến                                      | Ước tính trước, CostGuard chặn; đo thật ở P4 trước khi sang P5          |
| Clip dính watermark của kênh khác                            | Cờ `textOverlay`, xếp sau; người dùng tự quyết                          |
| Dung lượng đĩa tăng (file trong kho + trong dự án)           | Dùng lại asset cùng hash; giống cách thư viện stock đang làm (ADR 0008) |

## Nhật ký kiểm thử

| Phần | Ngày       | Kết quả                                                                                                                                                                                                                                                                                                                              | Ghi chú                                                                                                                                                  |
| ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0   |            | chờ người dùng gửi 5 clip + 2 script                                                                                                                                                                                                                                                                                                 |                                                                                                                                                          |
| P1   | 2026-10-23 | Đạt: 860/860 test, lint, typecheck, arch                                                                                                                                                                                                                                                                                             | Mô tả chỉ cộng điểm; đoạn chỉ khớp mô tả (< 20) bị loại                                                                                                  |
| P2   | 2026-10-23 | Đạt trên 5 clip thật (D:\clip, short 4K HEVC ~2 phút, có phụ đề + logo): ngưỡng 10 chỉ bắt 0–9 điểm cắt vì cảnh chuyển bằng fade; đổi sang so khung cách 250ms (`fps=4`) + ngưỡng 5 → bia 23/24, chandi 19/21 điểm cắt đếm tay; 22–33 đoạn/clip                                                                                      | Tách 6–25s/clip nhờ `-hwaccel auto -skip_frame noref`; chụp ảnh ~1s/ảnh trên 4K → ~50s/clip 2 phút                                                       |
| P3   | 2026-10-23 | Đạt: 882 test (thêm 15); chạy thật với 5 clip trong thư mục tạm: 5 item kho, dự án B tìm thấy, dự án A chỉ hiện 1 lần, upload lại không thêm item, tắt ô thì không vào kho, chọn item kho tăng `usageCount`                                                                                                                          | Lỗi hồi quy bắt được nhờ test: quy tắc chống trùng giấu nhầm item kho của clip stock → chỉ xét file nguồn `upload`; copy vào kho thêm ~0,5–1s/clip 240MB |
| P4   | 2026-10-23 | Đạt: 915 test (thêm 33); migration 0007 đã chạy trên DB thật; chạy thật 5 clip qua CostGuard + Claude Sonnet: 5/5 thành công, 138 đoạn, ước tính 0,253 → thật 0,262 USD (~0,05 USD/clip 2 phút), ~90s/clip 4K; soát mô tả ~25 đoạn trên 3 clip: đúng nội dung; cờ "có chữ" đúng 138/138 (clip thành phẩm có phụ đề + logo mọi khung) | Bỏ tấm lưới: mỗi đoạn một ảnh sau nhãn "Shot N"; Claude không lệch số lần nào. Chưa thử nút trên UI thật (cần worker chạy code mới)                      |
| P5   | 2026-10-24 | Code đạt: 923 test (thêm 8); Full AI chọn theo đoạn, đặt `sourceStartMs`, không dùng lại đoạn trong một lần chạy, đoạn có chữ/logo xếp sau + cảnh báo (người dùng chọn)                                                                                                                                                              | Người dùng tự đánh giá mức giảm sửa tay trên dự án thật (không đo P0)                                                                                    |
