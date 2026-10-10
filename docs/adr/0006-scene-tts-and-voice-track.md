# ADR 0006 — Giọng TTS theo cảnh và chỉ phát một track voice

**Trạng thái:** Chấp nhận

## Bối cảnh

M8 thêm giọng đọc AI cho từng cảnh (ElevenLabs). Trước đó một dự án có thể vừa có voice chung (`voiceAssetId`)
vừa có voice cảnh (`Scene.voiceAssetId`). Khi có cả hai, RenderPlan phát cả hai cùng lúc và hai giọng đọc đè lên nhau.
Timeline cũng không nhất quán: voice chung chỉ được chia cho các cảnh không có voice riêng, trong khi file vẫn phát từ frame 0.
Ngoài ra, TTS là lệnh gọi trả phí, nên phải biết chính xác cảnh nào cần tạo lại.

## Quyết định

- **Một track voice duy nhất.** Thêm field optional `Project.voiceTrack: "project" | "scenes"`. Hàm `activeVoiceTrack` chọn track:
  nếu chỉ có một loại voice thì dùng loại đó; nếu có cả hai thì theo lựa chọn của người dùng, mặc định là `"project"`.
  `computeTimeline` và `buildRenderPlan` chỉ dùng track đang phát. Tham chiếu của track kia vẫn được lưu (không phá huỷ),
  nên đổi qua lại không mất gì. UI hiện bộ chọn "Voice được phát" khi dự án có cả hai loại.
- **Hash nội dung.** Mỗi asset `source: "tts"` lưu `contentHash = voiceContentHash(narration, voiceSettings)`. Hàm này là
  FNV-1a 64-bit thuần JS, có tiền tố `tts1:`. Hash chỉ dùng để phát hiện thay đổi, không dùng cho bảo mật. Cảnh có hash
  khác với hash tính lại được coi là "Lời đã đổi". Đổi giọng, model hoặc tham số cũng làm hash đổi.
- **Cài đặt giọng** lưu ở `Project.voice` (optional), dùng chung cho mọi cảnh.
- **Chạy ở worker.** Việc tạo giọng chạy như job `kind: "tts"` có `sceneIds` (rule 9). Postgres có thêm cột `render_jobs.scene_ids`
  (migration `0001_tts_scene_ids`). Mỗi cảnh xong được lưu ngay, nên lỗi ở một cảnh không làm mất các cảnh đã tạo.
- Field mới đều optional, nên file `schemaVersion: 1` cũ vẫn hợp lệ và không cần migration (cùng cách làm với `Scene.sfx`).

## Hệ quả

- Dự án cũ có cả voice chung lẫn voice cảnh giờ chỉ phát voice chung. Trước M8 không có cách nào gán voice cảnh từ UI,
  nên thực tế không có dự án nào bị ảnh hưởng.
- Chọn "Voice từng cảnh" thì cảnh chưa có giọng sẽ im lặng, và thời lượng của cảnh đó là ước tính.
- Client giữ bản project và autosave cả `scenes`. Worker gắn voice lên bản trên server, nên khi job xong, client tải lại
  project và gộp asset cùng `voiceAssetId` của các cảnh vừa tạo (`voicesGenerated`). Nếu có một autosave cũ ghi đè đúng
  lúc job vừa xong, lần gộp ngay sau đó sẽ sửa lại.
- CostGuard (M11) sẽ bọc `TtsPort` trong `container.ts`. M8 chỉ hiện chi phí ước tính và bắt người dùng xác nhận trước khi chạy.
