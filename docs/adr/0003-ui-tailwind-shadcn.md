# ADR 0003 — Giao diện web dùng Tailwind CSS 4 + shadcn/ui

**Trạng thái:** Chấp nhận

## Bối cảnh

Từ M4 trở đi web có nhiều màn hình: danh sách dự án, form, scene editor, panel media, preview. Cần một bộ UI
đủ đẹp, truy cập tốt (bàn phím, screen reader) mà không khoá vào một thư viện component nặng.

## Quyết định

- **Tailwind CSS 4** (cấu hình bằng CSS trong `src/app/globals.css`, không có `tailwind.config`).
- **shadcn/ui** style new-york, màu neutral. Component được **copy vào repo** tại `apps/web/src/shared/ui/`
  (cấu hình alias trong `apps/web/components.json`), dựa trên Radix (`radix-ui`) và icon `lucide-react`.
- Component trong `shared/ui` chỉ hiển thị. State và logic nằm trong `features/*/hooks` và `features/*/model.ts`.
- Giao diện tiếng Việt, font hệ thống. Be Vietnam Pro chỉ dùng cho phụ đề video.

## Hệ quả

- Component là code của mình: sửa tự do, không phụ thuộc phiên bản thư viện UI.
- Thêm component bằng `pnpm dlx shadcn@<phiên bản> add <tên>` trong `apps/web`. **Lưu ý:** CLI 4.21 từng ghi sai
  import `cn` thành package npm `cn` và tự cài package đó. Sau mỗi lần `add`, kiểm tra import phải là
  `@/shared/lib/utils` và gỡ package `cn` nếu nó xuất hiện.
- Alias `@/*` được khai báo trong `apps/web/tsconfig.json` và trong `tsconfig.json` gốc (để dependency-cruiser resolve).
