# ADR 0001 — Lưu dự án bằng file JSON trong giai đoạn POC

**Trạng thái:** Thay thế bởi ADR 0005 (JSON vẫn được dùng khi không đặt `DATABASE_URL`)

## Bối cảnh

Tool dùng một người, chạy trên máy cá nhân. Đặc tả gốc đề xuất PostgreSQL, nhưng cài Postgres/Docker làm chậm
giai đoạn chứng minh ý tưởng, trong khi dữ liệu mỗi dự án nhỏ và luôn được đọc/ghi nguyên khối.

## Quyết định

Lưu mỗi dự án thành `storage/projects/<id>/project.json` (có `schemaVersion`), job render thành `storage/jobs/<id>.json`.
Truy cập chỉ qua `ProjectRepository` và `JobQueuePort`; adapter là `repository-json` và `queue-file`.

## Hệ quả

- Không cần cài DB; sao lưu = copy thư mục.
- Không truy vấn chéo dự án hiệu quả (thống kê chi phí, thư viện media dùng chung) → khi cần (M10–M11) thêm
  adapter `repository-postgres` (ví dụ Drizzle) mà không đổi domain/services/UI.
