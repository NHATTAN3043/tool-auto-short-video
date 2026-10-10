# ADR 0005 — Lưu project, job và thư viện SFX bằng PostgreSQL

**Trạng thái:** Chấp nhận · Thay thế ADR 0001 (JSON vẫn dùng khi không đặt `DATABASE_URL`)

## Bối cảnh

ADR 0001 lưu mỗi project, mỗi job thành một file JSON. Web và worker là hai tiến trình cùng ghi vào `storage/`,
nhưng `KeyedLock` chỉ khoá trong một tiến trình → hai bên sửa cùng lúc có thể ghi đè nhau (lost update).
Ngoài ra không có transaction, `list()` phải đọc mọi file, và các tính năng sắp tới (thống kê chi phí M11,
thư viện media M10) cần truy vấn chéo dự án.

## Quyết định

- Thêm adapter `packages/adapters/src/postgres/` (Drizzle ORM + `pg`) cho 3 port: `ProjectRepository`,
  `JobQueuePort`, `SfxLibraryRepository`. Domain, services và UI không đổi.
- Có `DATABASE_URL` → dùng Postgres; không có → dùng adapter JSON như cũ (Manual mode vẫn chạy không cần cài gì).
- Bảng `projects`: project lưu **nguyên khối dạng JSONB** (`data`) vì luôn được đọc/ghi cả khối; các cột
  `name`, `mode`, `scene_count`, `schema_version`, `updated_at` được chép ra mỗi lần ghi để liệt kê nhanh.
  Đọc ra vẫn chạy `migrateProject` → quy tắc `schemaVersion` của domain giữ nguyên.
- `update()` chạy trong transaction với `SELECT … FOR UPDATE` → web và worker ghi cùng lúc không mất dữ liệu.
- Bảng `render_jobs` (cột thường, FK tới `projects`, `ON DELETE CASCADE`); `claimNext` dùng `FOR UPDATE SKIP LOCKED`.
- Bảng `sfx_library`: metadata hiệu ứng âm thanh.
- File media, thumbnail, video render **vẫn nằm trên đĩa** (`storage-local`); DB chỉ lưu metadata.
- Thay đổi bảng: sửa `schema.ts` → `pnpm db:generate` → commit file SQL trong `migrations/` → `pnpm db:migrate`.

## Hệ quả

- Cần Postgres ≥ 13 (test dùng `DROP DATABASE … WITH (FORCE)`). Lần đầu: `pnpm db:migrate`, rồi `pnpm db:import`
  để chép dữ liệu JSON cũ sang (chạy lại được nhiều lần, không xoá file JSON).
- Sao lưu: `pg_dump -Fc shorts_studio > backup.dump` **và** copy thư mục `storage/` (chứa file media).
- Vẫn chỉ chạy **một worker**: `failStaleJobs` lúc khởi động đánh FAILED mọi job `PROCESSING`, kể cả job của worker khác.
  Muốn nhiều worker cần thêm heartbeat/owner cho job.
- `save()` vẫn ghi đè cả project: hai tab cùng sửa thì bản lưu sau thắng (như trước). Chặn việc này cần cột version
  (optimistic locking) — để sau.
- Test adapter Postgres cần `TEST_DATABASE_URL` (mỗi file test tạo một database tạm); không có thì bị skip. CI chạy chúng với service `postgres:17`.
