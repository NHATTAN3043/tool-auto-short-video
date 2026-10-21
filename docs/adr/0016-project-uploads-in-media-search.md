# ADR 0016 — Tìm cả file upload của dự án, tag theo tên file, giữ chỗ cho stock

**Trạng thái:** Chấp nhận · Bổ sung cho ADR 0008 (tìm media), 0010 (luồng Full AI)

## Bối cảnh

Full AI chỉ tìm trong thư viện chung và Pexels/Pixabay. File người dùng upload vào dự án (khung "Thư viện media")
không bao giờ được đề xuất, nên người dùng chuẩn bị sẵn clip mà Full AI vẫn lấy stock. Ngoài ra, cách chấm điểm thư
viện quá dễ dãi: chỉ cần trùng một từ như "the" là đã khớp. Kết quả thư viện luôn đứng đầu, sau đó danh sách bị cắt,
nên vài clip khớp yếu có thể chiếm hết chỗ trong vòng xếp hạng và stock không bao giờ được so sánh.

## Quyết định

- **Nguồn mới `project`:** tìm trong asset `source = "upload"` (video, ảnh) của chính dự án. Thứ tự là file dự án,
  rồi thư viện chung, rồi stock. Ô tìm media thủ công có thêm lựa chọn "File của dự án". Chọn một file dự án sẽ gán
  thẳng asset đó, không tải hay copy.
- **Tag lấy từ tên file, tính lúc tìm:** `__` ngăn cách các tag; `-`, `_`, `.` ngăn cách các từ. Ví dụ
  `cat-sleeping__orange-cat__sofa.mp4` cho ra `cat sleeping`, `orange cat`, `sofa`. Không thêm field nào, nên không cần
  migration. Muốn đổi tag thì đổi tên file rồi upload lại. Tag sửa được trong UI để sau.
- **Chấm điểm chặt hơn** (dùng chung cho thư viện và file dự án): bỏ stop-word tiếng Anh và tiếng Việt, điểm dưới
  `MIN_MATCH_SCORE = 20` coi như không khớp. Trùng đúng một từ không đủ; trùng hai từ, tag nằm trong từ khoá (hoặc
  ngược lại), hay trùng nguyên tag thì đủ.
- **Giữ chỗ cho stock trong vòng xếp hạng Full AI:** tối đa `AI_RANK_MAX_OWN = 5` trên `AI_RANK_MAX_CANDIDATES = 10`
  ứng viên là file của mình (dự án và thư viện). Chỗ nào stock không lấp được thì trả về cho file của mình.
- **AI được loại ứng viên:** kết quả xếp hạng có thêm `rejected` (optional). Full AI không bao giờ tự gán ứng viên bị
  loại. Nếu mọi ứng viên của một cảnh đều bị loại, cảnh để trống kèm cảnh báo. Ứng viên bị loại vẫn nằm cuối danh
  sách "Đổi media" để người dùng tự chọn.
- **Từ khoá thứ hai:** Full AI chỉ dừng khi đã gom đủ 10 ứng viên. Nếu chưa đủ, nó tìm thêm bằng từ khoá kế tiếp
  (vẫn tối đa 2 từ khoá) rồi gộp kết quả, bỏ trùng.
- Ở chế độ vision, thumbnail của file dự án được server đọc từ storage, tìm theo id dự án và id asset. Server không
  bao giờ dùng `path` gửi lên trong request.

## Hệ quả

- File đặt tên không theo quy ước (`IMG_1234.mp4`) gần như không bao giờ được tìm thấy. Gợi ý đặt tên hiển thị ngay
  dưới khung upload.
- Ngưỡng điểm cũng áp dụng cho ô tìm thủ công: tìm thư viện chung bằng một từ trùng lẻ sẽ không còn ra kết quả.
- Full AI gọi Pexels/Pixabay nhiều hơn một chút, vì cảnh có ít kết quả sẽ tìm thêm bằng từ khoá thứ hai. Kết quả tìm
  vẫn được cache như cũ.
