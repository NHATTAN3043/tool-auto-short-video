# ADR 0020 — Full AI bám theo một video nguồn

**Trạng thái:** Chấp nhận · Bổ sung cho ADR 0010 (Full AI), 0015 (hỏi lại + khung kịch bản), 0019 (phân tích clip) ·
Dùng ADR 0021 (tốc độ phát của cảnh)

## Bối cảnh

Nhiều short được làm từ **một video gốc**: người dùng muốn AI kể/thuyết minh liền mạch theo đúng những gì video chiếu,
thường kèm thoại/sub gốc hoặc lời đọc đã viết sẵn, và thêm một đoạn **hook mở đầu** và một đoạn **kết kêu gọi theo
dõi**. Luồng Full AI cũ luôn viết script → chia cảnh ngắn (~18 từ) → tìm media cho từng cảnh, nên video gốc bị cắt vụn
và trộn với stock không liên quan.

Bản đầu của quyết định này cắt phần chính thành nhiều cảnh 4–15 giây có thời lượng cố định: giọng bị ngắt nhịp ở mỗi
cảnh, giọng ngắn thì hụt, dài thì bị cắt, và thời lượng bị chặn ≤ video gốc. Các mục dưới đây thay bản đó.

## Quyết định

- **Một lựa chọn của request, không phải mode mới.** `FullAiRequest.sourceVideo = { assetId, volume, script?, hook?,
outro? }`; khi có, `fullAiSteps` trả `[analyze?] → cut → [voice]` thay cho script/scenes/visual/media/rank/select.
  Toggle tìm/xếp hạng/chọn media bị bỏ qua; `voiceGeneration` vẫn áp dụng. Không dùng chung với khung kịch bản
  (ADR 0015): bản cắt là kết quả.
- **Bắt buộc có phân tích shot (ADR 0019).** Video upload được copy vào kho chung nếu chưa có, rồi phân tích trong cùng
  job khi chưa có shot (`analyzeLibraryClip`, dùng chung với job `clip`; đi qua CostGuard với `describe_shots`). Đã phân
  tích thì không trả phí lại. Ước tính giữ chỗ ngân sách theo `maxShotCount` như job `clip`.
- **Hook → phần chính → kết.** Phần chính là **một cảnh dài** chạy liền một dải shot của video gốc với một lời kể liên
  tục; AI chỉ tách thêm (2–3 cảnh) khi nội dung đổi hẳn, được bỏ khúc thừa nhưng không chia nhỏ để đổi hình. Hook và kết
  là cảnh riêng, người dùng chọn mỗi lần (`SourcePart`): không có, cắt từ video gốc (hook: khúc gay cấn làm teaser, được
  trùng phần chính; kết: khúc cuối), hoặc một video/ảnh khác của dự án (clip chạy trọn, ảnh có Ken Burns).
- **Cảnh dài theo giọng, video chỉnh tốc độ (ADR 0021).** Sau bước giọng, `fitSourceScenes` cho mỗi cảnh video chạy
  nhanh/chậm 0,8–1,25× để kết thúc cùng giọng (cộng khoảng nghỉ ADR 0018). Lệch hơn khoảng đó thì kẹp lại và cảnh báo.
  Không tạo giọng thì video chạy tốc độ thường hết dải.
- **Một lệnh AI `source_cut`** nhận danh sách shot (thời gian, mô tả, cờ chữ in sẵn), yêu cầu, thời lượng mục tiêu, giọng
  văn, kịch bản và loại hook/kết (cắt từ nguồn, hoặc clip dài bao nhiêu); trả hook, các dải `main` và kết. Hook/kết ở
  đầu ra là trường phẳng luôn có mặt (rỗng/0 khi không yêu cầu) để structured output của mọi nhà cung cấp nhận được.
- **Kịch bản có hai vai:** `reference` (thoại/sub gốc, AI chỉ dùng để hiểu và viết lời mới) và `narration` (lời đọc giữ
  nguyên — `normalizeSourceCut` từ chối nếu lời phần chính không phải dãy con các từ của kịch bản, so không phân biệt hoa
  thường và dấu câu; tức chỉ được bỏ bớt, không sửa). Lời hook/kết do AI viết nếu kịch bản không có sẵn.
- **`normalizeSourceCut` từ chối cả câu trả lời** khi dải chính sai thứ tự, chồng nhau hoặc ngoài phạm vi, hoặc thiếu
  lời/dải hợp lệ cho hook/kết đã yêu cầu (như `buildClipAnalysis`). Hook/kết không yêu cầu thì bỏ. Lời ước tính lệch
  mục tiêu > 25% hay không thể khớp dải video kể cả với tốc độ giới hạn chỉ là cảnh báo.
- **Thời lượng mục tiêu là cả video** (hook + chính + kết), số giây nguyên 1–999, không giới hạn theo video gốc.
- `source_cut` cũng là một `AiTask` (toggle `scenePlanning`) để dùng chung ước tính, CostGuard và kết quả lưu trữ.
- Mọi field mới đều tuỳ chọn; job, bản nháp và kết quả cũ vẫn đọc được; `schemaVersion` giữ nguyên.

## Hệ quả

- Chất lượng phụ thuộc mô tả shot: AI chỉ thấy một ảnh giữa mỗi shot và không nghe tiếng; thoại gốc nên được dán làm
  kịch bản `reference`. Chưa dùng timestamp của file `.srt`.
- Trong một cảnh dài, lời và hình chỉ khớp theo trình tự (AI viết theo thứ tự shot), không khớp từng giây.
- Sửa lời/tạo lại giọng sau khi chạy không tự khớp lại tốc độ: người dùng bấm "Khớp tốc độ với giọng" ở trình sửa cảnh.
- Để sau: xem/sửa bản cắt trước khi chạy; nhiều video nguồn trong một short; đọc `.srt` có mốc thời gian; hook/kết
  lấy media AI tìm từ kho/stock.
