# ADR 0008 — Tìm media: thư viện chung trước, Pexels/Pixabay sau, server làm trung gian

**Trạng thái:** Chấp nhận

## Bối cảnh

M10 thêm tính năng tìm media cho từng cảnh. Muốn rẻ và giữ phong cách nhất quán thì nên dùng lại clip đã tải;
muốn có thêm lựa chọn thì tìm trên Pexels và Pixabay (miễn phí, cần key). Quy tắc 6 cấm browser gọi trực tiếp dịch vụ ngoài
và không cho key lọt ra browser. Ngoài ra, người dùng cần từ khoá tiếng Việt và tiếng Trung để tự tìm ở trang khác.

## Quyết định

- **Thư viện media chung** (`library/media/`, file JSON hoặc bảng Postgres `media_library`) chứa stock **đã từng tải về**.
  Mỗi file stock chỉ tải một lần, nhận diện bằng `sourceRef = provider:kind:id` (unique). Tag đầu tiên là từ khoá đã dùng để tìm ra nó.
  Dùng một item trong dự án nghĩa là **copy file vào dự án** (cùng cách với thư viện SFX), rồi tăng `usageCount`.
- **Thứ tự kết quả:** thư viện trước; sau đó Pexels và Pixabay xen kẽ nhau, video dọc đứng trước. Thư viện chấm điểm theo tag:
  không phân biệt dấu và hoa thường, và tag chứa chuỗi tìm cũng được tính (cho tiếng Trung, vốn không có khoảng trắng giữa các từ).
- **Server làm trung gian:** browser chỉ gửi `{ provider, ref }` khi chọn. Server hỏi lại API để lấy link tải, nên không bị SSRF.
  Thumbnail và video xem thử đi qua `/api/media-proxy`, route này chỉ phục vụ HTTPS trên các host media của nhà cung cấp
  (`isProxyUrl`) và chuyển tiếp header Range để tua được.
- **Tải về ngay trong request**, giống upload, có giới hạn `STUDIO_MAX_UPLOAD_MB`. Chọn bản tải về có cạnh ngắn ≥ 1080,
  bỏ qua 4K.
- **Tìm stock** cần toggle `mediaSearch` bật và có key. Thư viện chung thì luôn tìm được, kể cả ở Manual.
- **Cache kết quả tìm:** Pexels 1 giờ (hạn mức 200 request/giờ), Pixabay 24 giờ (theo điều khoản API).
- **Từ khoá 3 thứ tiếng:** thêm field optional `VisualPlan.localizedQueries { vi, zh }`. `searchQueries` vẫn là tiếng Anh.
  File cũ vẫn hợp lệ, không cần migration. AI được yêu cầu sinh ít nhất 3 từ khoá mỗi thứ tiếng. Truy vấn tiếng Việt/Trung
  được gửi sang nhà cung cấp kèm `locale`/`lang`.
- Không lưu và không hiển thị ghi công tác giả (người dùng quyết định); asset vẫn ghi `source` là pexels hoặc pixabay.

## Hệ quả

- Mỗi clip tốn dung lượng hai lần: một bản trong thư viện, một bản trong mỗi dự án dùng nó. Đổi lại, thư mục dự án tự chứa
  đủ file, nên render và xuất CapCut không đọc ra ngoài.
- Xoá item khỏi thư viện không ảnh hưởng dự án đã dùng nó.
- Thêm nguồn mới (trả phí, AI tạo video) chỉ cần thêm một adapter `MediaSearchPort` và một dòng trong `container.ts`.
