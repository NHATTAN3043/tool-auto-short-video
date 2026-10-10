# Dựng source base chất lượng, dễ mở rộng

Mục tiêu của source base: **thêm một tính năng mới (TTS mới, nguồn media mới, AI provider mới, DB mới) chỉ cần
thêm một adapter và một dòng đăng ký, không phải sửa domain hay UI.**

Làm phần này trong Milestone M0 (xem `01-PLAN.md`). Mọi lệnh dưới đây chạy được trên Windows / macOS / Linux.

---

## 1. Công cụ và phiên bản

| Công cụ            | Chọn                                                     | Ghi chú                                                                                 |
| ------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Node               | 22 LTS                                                   | Ghi vào `.nvmrc` và `engines`                                                           |
| Package manager    | **pnpm** workspaces                                      | Chặn import package chưa khai báo (npm thì không), cài nhanh hơn                        |
| TypeScript         | **6.0.x** (ghim cứng)                                    | TS 7 đã ra nhưng typescript-eslint hiện chỉ hỗ trợ `<6.1`. Nâng sau khi các tool hỗ trợ |
| Lint               | ESLint 9/10 flat config + typescript-eslint (type-aware) |                                                                                         |
| Format             | Prettier                                                 | Không tranh cãi style trong code review                                                 |
| Test               | Vitest                                                   | Nhanh, chạy TS trực tiếp                                                                |
| Validate           | Zod 4                                                    | Schema = type = validate runtime                                                        |
| Kiểm tra kiến trúc | dependency-cruiser                                       | Bắt lỗi import sai tầng ngay trong CI                                                   |
| Git hooks          | husky + lint-staged                                      | Lint/format file đã stage trước khi commit                                              |
| Chạy TS ở Node     | tsx                                                      | Cho worker và script                                                                    |
| Log                | pino                                                     | Log JSON, có `projectId`, `jobId`                                                       |
| Video              | FFmpeg + Remotion 4                                      | FFmpeg phải có trong PATH                                                               |

Không dùng Turborepo / Nx ở giai đoạn đầu: `pnpm -r` là đủ. Thêm khi build bắt đầu chậm.

---

## 2. Cấu trúc thư mục

```text
shorts-studio/
├─ apps/
│  ├─ web/                    Next.js: giao diện + API routes (mỏng)
│  │  └─ src/
│  │     ├─ app/              chỉ routing: page.tsx, route.ts gọi xuống services
│  │     ├─ features/         project/, scenes/, media/, preview/, render/, settings/
│  │     │   └─ scenes/       components/, hooks/, api.ts (client fetch), index.ts
│  │     ├─ shared/ui/        Button, Slider, Dropzone…
│  │     └─ server/
│  │        └─ container.ts   composition root: ráp adapter vào services
│  └─ worker/                 tiến trình render job
│     └─ src/
│        ├─ main.ts
│        └─ container.ts
├─ packages/
│  ├─ domain/                 THUẦN: zod schema, entity, quy tắc nghiệp vụ. Không I/O
│  │  └─ src/
│  │     ├─ project/          schema.ts, presets.ts
│  │     ├─ scene/            schema.ts, operations.ts (split/merge/move)
│  │     ├─ media/            schema.ts
│  │     ├─ timeline/         compute-timeline.ts, captions.ts
│  │     ├─ render-plan/      build-render-plan.ts, types.ts
│  │     ├─ errors.ts
│  │     └─ index.ts
│  ├─ services/               USE CASE + PORT (interface). Không biết fs, http, SDK nào
│  │  └─ src/
│  │     ├─ ports/            project-repository.ts, storage.ts, media-probe.ts,
│  │     │                    job-queue.ts, tts.ts, ai.ts, media-search.ts, cost-guard.ts, clock.ts
│  │     ├─ project/          create-project.ts, update-project.ts
│  │     ├─ media/            import-asset.ts, assign-media.ts
│  │     ├─ render/           request-render.ts, run-render-job.ts
│  │     └─ testing/          in-memory fakes của mọi port (dùng cho test)
│  ├─ adapters/               HIỆN THỰC port. Mỗi adapter một thư mục, độc lập
│  │  └─ src/
│  │     ├─ storage-local/
│  │     ├─ repository-json/  project + thư viện SFX dạng file JSON (khi không có DATABASE_URL)
│  │     ├─ postgres/         project + job + thư viện SFX trong PostgreSQL (ADR 0005)
│  │     ├─ ffmpeg/           probe + thumbnail
│  │     ├─ queue-file/
│  │     ├─ renderer-remotion/
│  │     ├─ tts-elevenlabs/   (M8)
│  │     ├─ ai-openai/        (M9)
│  │     ├─ media-pexels/  media-pixabay/  media-library/   (M10)
│  │     └─ cost-guard/       (M11)
│  ├─ video/                  Remotion composition (React). Chỉ nhận RenderPlan
│  │  ├─ public/              font đóng gói sẵn
│  │  └─ src/
│  └─ config/                 tsconfig base, eslint config, env schema dùng chung
├─ docs/
│  ├─ PLAN.md  SOURCE-BASE.md  TECH-NOTES.md
│  └─ adr/                    0001-file-storage-for-poc.md, …
├─ fixtures/                  project mẫu dạng JSON để test render
├─ storage/                   dữ liệu chạy thật (git-ignore)
├─ .claude/commands/          slash command cho Claude Code
├─ .github/workflows/ci.yml
├─ CLAUDE.md
├─ .nvmrc  .editorconfig  .gitignore  .env.example
├─ pnpm-workspace.yaml
└─ package.json
```

### Luật phụ thuộc (quan trọng nhất)

```text
domain   ←   services   ←   adapters
   ↑            ↑              ↑
   └──── video  └──── apps (container.ts ráp mọi thứ) ──┘
```

- `domain` không import gì ngoài `zod`. Chạy được trong browser, Node, test.
- `services` chỉ import `domain`. Gọi thế giới bên ngoài **qua port**.
- `adapters` import `domain` + `services` (để implement port). Adapter không import adapter khác.
- `video` chỉ import `domain` (kiểu `RenderPlan`).
- `apps` là nơi duy nhất `new` adapter và truyền vào service (composition root).
- Component React không gọi `fetch` thẳng tới API bên ngoài, không chứa logic nghiệp vụ: gọi hàm domain hoặc API route của chính app.

Luật này được **máy kiểm tra** bằng dependency-cruiser (mục 5), không chỉ ghi trong tài liệu.

---

## 3. Các mẫu thiết kế giúp dễ mở rộng

### 3.1. Port + Adapter cho mọi thứ bên ngoài

```ts
// packages/services/src/ports/tts.ts
export interface TtsPort {
  readonly id: string; // "elevenlabs", "openai", "local"
  estimateCostUsd(text: string): number;
  synthesize(text: string, voice: VoiceSettings): Promise<{ audio: Uint8Array; mimeType: string }>;
}
```

Thêm nhà cung cấp mới = tạo `adapters/src/tts-xxx/` implement `TtsPort` + đăng ký trong `container.ts`.

### 3.2. Registry theo cấu hình

```ts
// apps/web/src/server/container.ts
const tts = env.ELEVENLABS_API_KEY ? new ElevenLabsTts(env.ELEVENLABS_API_KEY) : null;
export const services = {
  generateVoice: tts ? makeGenerateVoice({ tts, repo, storage, costGuard }) : null,
  // …
};
```

Không có key → service là `null` → UI ẩn nút. Manual mode luôn chạy được.

### 3.3. Mode chỉ là preset, toggle mới là thật

Mọi chỗ kiểm tra tính năng AI dùng `project.automationSettings.voiceGeneration`, **không bao giờ** `if (mode === "assisted")`.
Thêm toggle mới không đụng tới logic mode.

### 3.4. Use case là hàm nhận dependency

```ts
export function makeAssignMedia(deps: { repo: ProjectRepository; clock: Clock }) {
  return async (input: AssignMediaInput): Promise<Project> => {
    const project = await deps.repo.get(input.projectId);
    const next = assignMedia(project, input.sceneId, input.media); // hàm thuần trong domain
    return deps.repo.save(next);
  };
}
```

Test bằng fake in-memory, không cần ổ đĩa hay mạng.

### 3.5. Một "RenderPlan" cho cả preview và render

`buildRenderPlan(project, resolveUrl)` (domain, thuần) → object chỉ gồm số frame và URL.
Remotion Player (trình duyệt) và renderer (worker) cùng nhận object này → hình preview và video cuối không bao giờ lệch.
Muốn đổi engine render sau này (ví dụ FFmpeg thuần) chỉ cần viết adapter mới đọc RenderPlan.

### 3.6. Dữ liệu có phiên bản

`project.json` có `schemaVersion`. Khi đổi schema, thêm hàm `migrate_v1_to_v2` trong `domain/project/migrations.ts`,
repository chạy migration khi đọc. Không bao giờ làm hỏng dự án cũ.

### 3.7. Lỗi có mã

```ts
export class DomainError extends Error {
  constructor(readonly code: "SCENE_NOT_FOUND" | "INVALID_MEDIA" | "BUDGET_EXCEEDED" | …, message: string) { super(message); }
}
```

API route map `code` → HTTP status + thông báo tiếng Việt. Không trả stack trace ra UI.

### 3.8. Env được validate khi khởi động

`packages/config/src/env.ts` dùng zod; thiếu biến bắt buộc thì app dừng ngay với thông báo rõ.
Key API chỉ đọc ở server. Có `.env.example` liệt kê mọi biến.

### 3.9. Job dài không chạy trong request

Web tạo job qua `JobQueuePort`, worker xử lý. Bản đầu dùng file JSON (`queue-file`), sau đổi sang pg-boss/BullMQ
mà không đổi web.

### 3.10. ADR ngắn cho quyết định lớn

Mỗi quyết định khó đảo ngược ghi 10–20 dòng vào `docs/adr/NNNN-ten.md`: bối cảnh, quyết định, hệ quả.
Claude Code đọc được, bạn của 6 tháng sau cũng đọc được.

---

## 4. Từng bước dựng source base (M0)

### 4.1. Khởi tạo

```bash
mkdir shorts-studio && cd shorts-studio
git init
corepack enable              # có sẵn pnpm qua corepack
pnpm init
echo "22" > .nvmrc
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`package.json` gốc:

```json
{
  "name": "shorts-studio",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@<phiên bản bạn đang dùng>",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "pnpm --parallel --filter @studio/web --filter @studio/worker dev",
    "build": "pnpm -r build",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "pnpm -r typecheck",
    "test": "vitest run",
    "test:watch": "vitest",
    "arch": "depcruise apps packages --config .dependency-cruiser.cjs",
    "check": "pnpm format:check && pnpm lint && pnpm typecheck && pnpm arch && pnpm test",
    "prepare": "husky"
  }
}
```

`pnpm check` là lệnh duy nhất bạn (và Claude) chạy trước mỗi commit.

### 4.2. TypeScript dùng chung

```bash
pnpm add -Dw typescript@~6.0.3 @types/node tsx
```

`packages/config/tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": false,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  }
}
```

Mỗi package: `tsconfig.json` extends file này, script `"typecheck": "tsc -p ."`.
Package nội bộ export thẳng source TS (`"main": "src/index.ts"`), Next.js dùng `transpilePackages`, worker dùng tsx.
Không cần bước build cho package nội bộ.

Import giữa package qua tên (`@studio/domain`), **không** dùng đường dẫn `../../packages/...`.
Mỗi package chỉ export qua `src/index.ts` (public API); không import sâu vào file bên trong package khác.

### 4.3. ESLint + Prettier

```bash
pnpm add -Dw eslint @eslint/js typescript-eslint eslint-config-prettier prettier \
  eslint-plugin-react-hooks @next/eslint-plugin-next
```

`eslint.config.js` (rút gọn):

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["**/node_modules", "**/.next", "storage", "**/dist"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  prettier,
);
```

`.prettierrc`: `{ "printWidth": 110, "singleQuote": false, "trailingComma": "all" }`.

### 4.4. Vitest

```bash
pnpm add -Dw vitest
```

`vitest.config.ts` ở gốc với `test.projects: ["packages/*", "apps/*"]`. Test đặt cạnh code: `operations.test.ts`.

### 4.5. Kiểm tra kiến trúc

```bash
pnpm add -Dw dependency-cruiser
```

`.dependency-cruiser.cjs` (phần quan trọng):

```js
module.exports = {
  forbidden: [
    {
      name: "domain-is-pure",
      from: { path: "^packages/domain" },
      to: { pathNot: ["^packages/domain", "node_modules/zod"] },
    },
    {
      name: "services-only-domain",
      from: { path: "^packages/services" },
      to: { path: ["^packages/adapters", "^packages/video", "^apps"] },
    },
    {
      name: "adapters-isolated",
      from: { path: "^packages/adapters/src/([^/]+)/" },
      to: { path: "^packages/adapters/src/", pathNot: "^packages/adapters/src/$1/" },
    },
    {
      name: "video-only-domain",
      from: { path: "^packages/video" },
      to: { path: ["^packages/services", "^packages/adapters", "^apps"] },
    },
    { name: "no-circular", from: {}, to: { circular: true } },
  ],
  options: { tsConfig: { fileName: "packages/config/tsconfig.base.json" }, doNotFollow: "node_modules" },
};
```

### 4.6. Git hooks + commit convention

```bash
pnpm add -Dw husky lint-staged
pnpm exec husky init
echo "pnpm exec lint-staged" > .husky/pre-commit
```

`package.json`: `"lint-staged": { "*.{ts,tsx}": ["eslint --fix", "prettier --write"], "*.{json,md,yml}": "prettier --write" }`.

Commit theo Conventional Commits: `feat(scenes): split scene at sentence boundary`, `fix(render): …`, `chore: …`.
Mỗi milestone một nhánh `m3-media-upload`, merge bằng PR (tự review diff, kể cả làm một mình).

### 4.7. CI (GitHub Actions)

`.github/workflows/ci.yml`:

```yaml
name: ci
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: pnpm }
      - run: sudo apt-get update && sudo apt-get install -y ffmpeg
      - run: pnpm install --frozen-lockfile
      - run: pnpm check
```

### 4.8. File cấu hình nhỏ khác

- `.editorconfig`: LF, 2 space, UTF-8.
- `.gitignore`: `node_modules`, `.next`, `storage/`, `.env*` (trừ `.env.example`), `*.tsbuildinfo`.
- `.vscode/settings.json`: format on save bằng Prettier, `"typescript.tsdk": "node_modules/typescript/lib"`.
- `.vscode/extensions.json`: ESLint, Prettier.

### 4.9. Tiêu chí M0 xong

- `pnpm install && pnpm check` xanh trên máy và trên CI.
- Mỗi package có một test giả chạy được.
- Cố ý thêm `import "fs"` vào `packages/domain` → `pnpm arch` báo lỗi. Xoá đi.
- `CLAUDE.md` và `docs/` đã có (copy từ `templates/` và các file plan này).

---

## 5. Quy ước code

- **Tên file** kebab-case (`compute-timeline.ts`), component PascalCase (`SceneCard.tsx`).
- **Một hàm export chính mỗi file** ở domain/services; file > ~250 dòng thì tách.
- **Thời gian** lưu ms (số nguyên) trong domain; chỉ đổi sang frame trong `buildRenderPlan`.
- **ID** dùng `crypto.randomUUID()` có tiền tố (`scn_…`, `ast_…`) qua một hàm `newId()` trong domain.
- **Ngày** lưu chuỗi ISO.
- **Không** `any`; dữ liệu từ ngoài (request, file JSON, API) luôn `Schema.parse` trước khi dùng.
- **Không** để logic nghiệp vụ trong component hay route handler: route handler = parse input → gọi service → trả JSON.
- **Comment** giải thích _tại sao_, không giải thích _cái gì_.
- **Test**: domain test kỹ (ca biên: cảnh rỗng, 1 cảnh, voice ngắn hơn tổng); services test với fake; adapter test tích hợp
  với file media sinh bằng FFmpeg (`ffmpeg -f lavfi -i testsrc2…`), không commit file video lớn vào repo.

---

## 6. Làm việc với Claude Code trong VS Code

1. `CLAUDE.md` ở gốc repo (mẫu trong `templates/CLAUDE.md`): Claude đọc tự động mỗi phiên.
2. Slash command trong `.claude/commands/` (mẫu trong `templates/.claude/commands/`):
   - `/milestone M3` → đọc plan, đề xuất file, chờ bạn duyệt rồi mới code.
   - `/finish` → chạy `pnpm check`, tóm tắt thay đổi, rủi ro, gợi ý commit message.
3. Mỗi milestone: bật **plan mode** (Shift+Tab) để Claude lập kế hoạch trước, đọc kỹ rồi mới cho code.
4. `/clear` giữa các milestone để context sạch; kiến thức cần giữ thì ghi vào `docs/` hoặc ADR, không trông vào trí nhớ phiên.
5. Milestone lớn thì chia nhỏ hơn nữa: một phiên cho domain + test, một phiên cho adapter, một phiên cho UI.
6. Luôn tự đọc diff trước khi commit. Nếu Claude sửa file ngoài phạm vi milestone, yêu cầu hoàn lại.
