# ADR 0021 — Tốc độ phát video của cảnh

**Trạng thái:** Chấp nhận · Dùng bởi ADR 0020 (Full AI theo video nguồn)

## Bối cảnh

Một cảnh dài theo video gốc phải kết thúc cùng giọng đọc. Giọng TTS hiếm khi dài đúng bằng khúc video: cảnh có thời
lượng cố định thì giọng bị cắt hoặc để lại khoảng trống, cảnh theo giọng thì video bị cắt bớt hoặc lặp lại (`<Loop>`).

## Quyết định

- `SceneMedia.playbackRate` tuỳ chọn, 0,5–2 (`SCENE_PLAYBACK_RATE_MIN/MAX`); vắng = 1, giá trị 1 được lưu thành vắng.
  Chỉ video có tốc độ. Không cần migration.
- RenderPlan giữ `startFrom`/`segmentFrames` theo **khung nguồn** và thêm `playbackRate`, `playedFrames` =
  `segmentFrames / rate` (độ dài trên timeline, dùng cho `<Loop>` và quyết định có lặp không). Composition truyền
  `playbackRate` cho `OffthreadVideo`. Đã đọc mã Remotion 4.0.532: `trimBefore` và `durationInFrames` tính theo khung
  nguồn, thời gian hiển thị là khung nguồn / `playbackRate`.
- Preview và render dùng chung plan và composition (rule 8). Gói CapCut cắt từ MP4 đã render nên có sẵn tốc độ.
- `fitSourceSpeed(spanMs, targetMs)` (domain, thuần) chọn tốc độ trong 0,8–1,25× (`FIT_SPEED_MIN/MAX`), làm tròn 3 chữ
  số, trả `durationMs` = span / rate và `mismatch` khi phải kẹp. `fitSceneToVoice` lấy đích = giọng + khoảng nghỉ
  (ADR 0018), đặt `playbackRate` và `durationMs` thủ công cho cảnh; không có giọng thì tốc độ 1, hết dải.
- Trình sửa cảnh tách "Thời lượng cảnh (giây)" và "Tốc độ media trong cảnh". Thanh kéo và ô nhập tốc độ
  0,5–2×, bước 0,01× chỉ đổi `SceneMedia.playbackRate`; thời lượng cảnh, giọng và mốc cắt nguồn giữ nguyên.
  Một lần kéo là một bước Undo. Media ngắn hơn cảnh được lặp lại; dài hơn thì dừng theo cảnh.
- Nút "Khớp tốc độ với giọng" dùng `fitMediaToVoice`, chỉ khớp tốc độ media; "Về 1×" chỉ đặt lại tốc độ.
  Full AI vẫn dùng `fitSceneToVoice` để khớp cả tốc độ và thời lượng. Không tự khớp lại khi giọng đổi.
  Bộ chọn đoạn phát theo cùng tốc độ, các mốc đầu/cuối vẫn tính theo thời gian nguồn. Không sửa dữ liệu cũ.

## Hệ quả

- Video có người nói chạy lệch ±20% có thể thấy rõ; ngoài khoảng đó Full AI cảnh báo thay vì kéo tốc độ thêm.
- Âm thanh gốc cũng nhanh/chậm theo (Remotion không giữ cao độ khi render).
