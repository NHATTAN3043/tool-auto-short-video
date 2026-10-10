# AI Shorts Studio — Detailed Implementation Plan

## 1. Project Overview

### 1.1. Project Goal

Build a scene-based tool to automate the production of vertical short-form videos, especially YouTube Shorts, with three automation modes:

1. **Manual**
2. **Assisted**
3. **Full AI**

The tool should reduce the amount of manual work required in the current workflow:

```text
Idea
→ Script
→ Review script
→ Voice generation
→ Find images/videos
→ Edit in CapCut
→ Subtitle
→ Export
```

The target workflow is:

```text
Create Project
→ Choose Automation Mode
→ Script
→ Scene Planning
→ Voice
→ Media
→ Scene Review
→ Preview
→ Render
→ Final MP4
```

The tool is not intended to replace human review completely.

The target is:

```text
AI / Automation: 70–85%
Human Review:     15–30%
```

---

## 2. Core Product Principles

### 2.1. AI Is Optional

AI must be an optional capability, not a hard dependency.

The application must still work when:

- OpenAI is disabled
- ElevenLabs is disabled
- Media APIs are unavailable
- The user provides their own script
- The user provides their own voice
- The user provides their own videos or images

### 2.2. Scene Is the Core Domain Object

Every video is composed of scenes.

```text
Video Project
├── Scene 01
├── Scene 02
├── Scene 03
└── ...
```

Each scene can independently contain:

- narration
- voice
- media
- subtitle
- timing
- crop settings
- visual plan
- approval status

This allows users to modify only one scene without rebuilding the entire video.

### 2.3. Non-Destructive Editing

Uploaded media files must never be modified directly.

Instead, store metadata such as:

```json
{
  "assetId": "video-001",
  "sourceStartMs": 15000,
  "sourceEndMs": 22000,
  "fit": "cover"
}
```

The original source file remains unchanged.

### 2.4. Cost Must Be Controlled

All paid API calls must go through a centralized cost-control layer.

The system must support:

- daily budget
- monthly budget
- per-project budget
- per-video budget
- per-operation budget
- usage logging
- retry limits

### 2.5. Do Not Build a CapCut Clone

V1 should not include:

- multi-track timeline editing
- advanced animation editor
- keyframe editor
- full audio mixer
- professional transition editor
- collaborative editing

The main UI should be a **Scene Editor**.

---

# 3. Automation Modes

## 3.1. Manual Mode

Goal:

> Produce videos without paid AI APIs.

Typical input:

- user-provided script
- uploaded MP3
- uploaded MP4/images

Pipeline:

```text
Paste Script
→ Create Scenes Manually
→ Upload Voice
→ Upload Media
→ Assign Media to Scenes
→ Trim / Crop / Resize
→ Subtitle
→ Preview
→ Render
```

Expected API cost:

```text
~0 VND
```

Manual Mode must support:

- paste script
- create scene
- delete scene
- reorder scene
- split scene
- merge scene
- upload MP4
- upload image
- upload MP3
- assign media to scene
- choose source start/end
- add subtitles
- preview
- render MP4

---

## 3.2. Assisted Mode

Goal:

> Let the user provide some assets while AI assists with repetitive work.

Possible workflow:

```text
Paste Script
→ AI Split Scenes
→ AI Generate Visual Search Queries
→ Search Media
→ User Selects Media
→ TTS
→ Subtitle
→ Render
```

Each AI feature should be independently configurable.

Example settings:

```json
{
  "scriptGeneration": false,
  "scenePlanning": true,
  "voiceGeneration": true,
  "mediaSearch": true,
  "mediaRanking": false,
  "autoMediaSelection": false
}
```

Typical use case:

- user writes the script
- AI splits it into scenes
- AI generates search keywords
- system searches free media providers
- user selects footage
- system generates voice and renders video

---

## 3.3. Full AI Mode

Goal:

> User provides only the idea/topic and reviews the result.

Pipeline:

```text
Idea
→ AI Generate Script
→ AI Scene Planning
→ AI Visual Planning
→ Media Search
→ AI Media Ranking
→ Auto Select Media
→ TTS
→ Subtitle
→ Auto Composition
→ Preview
→ Human Review
→ Render
```

Example:

```text
Input:
"Tại sao người trẻ ngày càng ngại nghe điện thoại?"

Output:
- script
- scene list
- narration
- voice
- media suggestions
- subtitles
- final video preview
```

The system must still allow the user to manually override any AI result.

---

# 4. Technology Stack

## 4.1. V1 Stack

Recommended:

```text
Frontend:
Next.js
React
TypeScript

Backend:
Next.js server / Node.js

Database:
PostgreSQL

Worker:
Node.js + TypeScript

Video Processing:
FFmpeg

Video Composition:
Remotion

Validation:
Zod

Storage:
Local filesystem for development
S3-compatible storage later
```

## 4.2. Why No Python in V1

Python is not required initially because:

- current requirements are mostly orchestration
- FFmpeg can handle media processing
- Remotion works directly with React/TypeScript
- user already knows JavaScript/TypeScript
- one language reduces complexity

Python can be introduced later for:

- computer vision
- object detection
- advanced video understanding
- embeddings
- ML pipelines
- subject tracking

---

# 5. High-Level Architecture

```text
                    NEXT.JS
              Project / Scene Editor
                       │
             ┌─────────┴─────────┐
             │ Application Layer │
             └─────────┬─────────┘
                       │
       ┌───────────────┼────────────────┐
       │               │                │
       ▼               ▼                ▼
  AiProvider      TtsProvider      MediaProvider
       │               │                │
    OpenAI         ElevenLabs      Local Library
                                    Pexels
                                    Pixabay

                       │
                       ▼
                   Scene JSON
                       │
                       ▼
               Remotion Preview
                       │
                       ▼
                   Render Job
                       │
                       ▼
                 Node Worker
                  │       │
               FFmpeg   Remotion
                  │       │
                  └───┬───┘
                      ▼
                  final.mp4

          ┌────────────────────────┐
          │       CostGuard        │
          │ protects paid APIs     │
          └────────────────────────┘
```

---

# 6. Repository Structure

Recommended monorepo:

```text
shorts-studio/

├─ apps/
│
│  ├─ web/
│  │   ├─ src/
│  │   └─ package.json
│  │
│  └─ worker/
│      ├─ src/
│      └─ package.json
│
├─ packages/
│
│  ├─ domain/
│  ├─ schemas/
│  ├─ ai/
│  ├─ media/
│  ├─ storage/
│  ├─ cost-control/
│  └─ shared/
│
├─ storage/
│  └─ projects/
│
├─ docs/
│
├─ AGENTS.md
│
├─ docker-compose.yml
└─ package.json
```

---

# 7. Frontend Architecture

Recommended:

```text
src/

├─ app/
│   └─ thin routing only
│
├─ modules/
│
│  ├─ project/
│  ├─ script/
│  ├─ scene/
│  ├─ media/
│  ├─ voice/
│  ├─ render/
│  └─ settings/
│
└─ shared/
    ├─ api/
    ├─ db/
    ├─ ui/
    └─ config/
```

Each module can contain:

```text
scene/

├─ domain/
├─ application/
├─ infrastructure/
├─ components/
├─ hooks/
└─ schemas/
```

Avoid excessive Clean Architecture complexity.

The goal is simply:

> Business logic must not live inside React components.

---

# 8. Core Domain Models

## 8.1. Project

```ts
type AutomationMode = "manual" | "assisted" | "full_ai";

interface Project {
  id: string;
  name: string;
  mode: AutomationMode;

  width: number;
  height: number;
  fps: number;

  automationSettings: AutomationSettings;

  status: ProjectStatus;

  createdAt: Date;
  updatedAt: Date;
}
```

---

## 8.2. Automation Settings

Mode is only a preset.

The real behavior is controlled by settings:

```ts
interface AutomationSettings {
  scriptGeneration: boolean;
  scenePlanning: boolean;
  voiceGeneration: boolean;
  mediaSearch: boolean;
  mediaRanking: boolean;
  autoMediaSelection: boolean;
}
```

### Manual preset

```json
{
  "scriptGeneration": false,
  "scenePlanning": false,
  "voiceGeneration": false,
  "mediaSearch": false,
  "mediaRanking": false,
  "autoMediaSelection": false
}
```

### Assisted preset

```json
{
  "scriptGeneration": false,
  "scenePlanning": true,
  "voiceGeneration": true,
  "mediaSearch": true,
  "mediaRanking": false,
  "autoMediaSelection": false
}
```

### Full AI preset

```json
{
  "scriptGeneration": true,
  "scenePlanning": true,
  "voiceGeneration": true,
  "mediaSearch": true,
  "mediaRanking": true,
  "autoMediaSelection": true
}
```

---

## 8.3. Scene

```ts
interface Scene {
  id: string;

  projectId: string;

  order: number;

  narration: string;

  durationMs: number;

  voice?: VoiceAsset;

  media?: SceneMedia;

  subtitle?: SubtitleTrack;

  visualPlan?: VisualPlan;

  status: "draft" | "ready" | "approved";
}
```

---

## 8.4. Scene Media

```ts
interface SceneMedia {
  assetId: string;

  source: "upload" | "library" | "pexels" | "pixabay" | "generated";

  sourceStartMs: number;

  sourceEndMs: number;

  fit: "cover" | "contain";

  crop?: CropConfig;
}
```

---

## 8.5. Voice Asset

```ts
interface VoiceAsset {
  id: string;

  source: "upload" | "elevenlabs" | "local";

  path: string;

  durationMs: number;

  providerMetadata?: Record<string, unknown>;
}
```

---

## 8.6. Visual Plan

```ts
interface VisualPlan {
  intent: string;

  preferredMedia: "video" | "image";

  searchQueries: string[];

  mood?: string;

  shotTypes?: string[];
}
```

---

# 9. Database Design

Suggested V1 tables:

```text
projects
scripts
scenes
media_assets
voice_assets
render_jobs
api_usage
app_settings
```

---

## 9.1. projects

```text
id
name
mode
automation_settings_json

width
height
fps

status

created_at
updated_at
```

---

## 9.2. scripts

```text
id
project_id

title
content

source
version

created_at
updated_at
```

---

## 9.3. scenes

```text
id

project_id

order_index

narration

duration_ms

voice_asset_id

media_asset_id

source_start_ms
source_end_ms

status

visual_plan_json

created_at
updated_at
```

---

## 9.4. media_assets

```text
id

provider

provider_asset_id

type

original_url

local_path

thumbnail_path

duration_ms

width
height
fps

metadata_json

created_at
```

---

## 9.5. voice_assets

```text
id

provider

local_path

duration_ms

metadata_json

created_at
```

---

## 9.6. render_jobs

```text
id

project_id

status

progress

output_path

error_message

created_at
started_at
completed_at
```

Status:

```text
QUEUED
PROCESSING
COMPLETED
FAILED
CANCELLED
```

---

## 9.7. api_usage

```text
id

provider
operation

project_id
scene_id

estimated_cost
actual_cost

input_units
output_units

created_at
```

---

# 10. Storage Design

## 10.1. Storage Interface

```ts
interface StorageProvider {
  save(input: NodeJS.ReadableStream, destination: string): Promise<StoredFile>;

  delete(path: string): Promise<void>;

  exists(path: string): Promise<boolean>;
}
```

---

## 10.2. Development

Use:

```text
LocalStorageProvider
```

Example:

```text
storage/

projects/

  project-001/

    media/
      video-001.mp4

    audio/
      scene-001.mp3

    thumbnails/
      video-001.jpg

    render/
      final.mp4
```

---

## 10.3. Production

Later add:

```text
S3StorageProvider
```

The application layer must not care whether the file is local or remote.

---

# 11. Media Provider Design

```ts
interface MediaProvider {
  searchVideo(query: string, options?: MediaSearchOptions): Promise<MediaCandidate[]>;
}
```

Providers:

```text
LocalLibraryProvider
PexelsProvider
PixabayProvider
UploadProvider
```

Future:

```text
ShutterstockProvider
StoryblocksProvider
GeneratedVideoProvider
```

---

# 12. Media Search Priority

Default strategy:

```text
Scene
 ↓
Local Library
 ↓
Found?
 ├─ Yes → Use
 └─ No
      ↓
Free Provider
(Pexels / Pixabay)
      ↓
Found?
 ├─ Yes → Use
 └─ No
      ↓
Paid Provider / AI Generated / Manual
```

Priority:

```text
1. My Library
2. Free providers
3. Paid providers
4. AI-generated media
5. Manual
```

---

# 13. Media Upload Flow

User uploads:

```text
video.mp4
```

Worker runs:

```text
ffprobe
```

Extract:

```json
{
  "duration": 54.3,
  "width": 1920,
  "height": 1080,
  "fps": 30
}
```

Store metadata in `media_assets`.

Generate:

- thumbnail
- preview metadata

Do not modify original source file.

---

# 14. MP4 Scene Editing

Example:

Source video:

```text
Duration: 35 seconds
```

Scene needs:

```text
6.8 seconds
```

User selects:

```text
12.5s → 19.3s
```

Store:

```json
{
  "sourceStartMs": 12500,
  "sourceEndMs": 19300
}
```

Actual trimming happens only during render or preprocessing.

---

# 15. Video Crop

V1 strategy:

```text
center crop
```

Example:

```text
1920 × 1080
      ↓
scale
      ↓
crop
      ↓
1080 × 1920
```

Future:

```text
AI smart crop
subject tracking
face tracking
```

Do not implement smart crop in V1.

---

# 16. Script Module

Supported sources:

```text
AI generated
Paste manually
Import
```

Suggested UI:

```text
--------------------------------

TITLE

[........................]

SCRIPT

[........................]
[........................]

Word count: 312
Estimated duration: 2m24s

--------------------------------

[AI Rewrite]

[Split Into Scenes]

[Approve]
```

---

# 17. Scene Planning

AI input:

```text
script
desired duration
content style
video style
```

Expected Structured Output:

```json
{
  "scenes": [
    {
      "narration": "...",
      "visualIntent": "...",
      "searchQueries": ["...", "..."]
    }
  ]
}
```

Do not rely on Markdown parsing.

Use schema validation.

---

# 18. AI Provider Abstraction

```ts
interface AiProvider {
  generateScript(input: GenerateScriptInput): Promise<Script>;

  planScenes(input: PlanScenesInput): Promise<ScenePlan[]>;

  generateVisualPlan(input: GenerateVisualPlanInput): Promise<VisualPlan>;

  rankMedia(input: RankMediaInput): Promise<MediaRanking[]>;
}
```

V1:

```text
OpenAiProvider
```

Future:

```text
GeminiProvider
ClaudeProvider
LocalProvider
```

Never call OpenAI directly from UI code.

---

# 19. TTS Provider Abstraction

```ts
interface TtsProvider {
  synthesize(text: string, settings: VoiceSettings): Promise<VoiceResult>;
}
```

V1:

```text
ElevenLabsProvider
UploadedVoiceProvider
```

Future:

```text
LocalTtsProvider
OpenAITtsProvider
```

---

# 20. Voice Strategy

Generate voice per scene.

Do not generate one large file first.

Use:

```text
scene-001.mp3
scene-002.mp3
scene-003.mp3
```

Benefits:

- regenerate only modified scene
- lower API cost
- easier timing
- easier editing

Example:

```text
Scene 07 narration changed

→ regenerate scene-007.mp3 only
→ update Scene 07 duration
→ recalculate timeline after Scene 07
```

---

# 21. Subtitle Model

```ts
interface Caption {
  text: string;

  startMs: number;

  endMs: number;
}
```

V1:

```text
sentence/chunk-based subtitles
```

Future:

```text
word-level timestamps
karaoke highlighting
animated captions
```

---

# 22. Scene Editor

This is the most important screen.

Example UI:

```text
--------------------------------------------------

Scene 05                     00:28 → 00:35

Narration

┌───────────────────────────────┐
│ Ngày càng nhiều người trẻ... │
└───────────────────────────────┘


MEDIA

┌───────────────────────┐
│                       │
│     video preview     │
│                       │
└───────────────────────┘


[Replace]
[Search]
[Upload]
[Use Library]


SOURCE

15.2s [==========] 21.5s


VOICE

▶ ━━━━━━━━━━━


[Regenerate Voice]


✓ Approved

--------------------------------------------------
```

---

# 23. Scene Actions

Each scene should support:

```text
Edit Narration

Replace Media

Search Media

Upload Media

Use Library

Change Source Start

Change Source End

Regenerate Voice

Split Scene

Merge Scene

Move Up

Move Down

Approve

Delete
```

Important:

Changing media must not automatically regenerate voice.

Changing voice must not automatically replace media.

Each part is independently editable.

---

# 24. Media Replacement UI

Example:

```text
Search
--------------------------------

[lonely person smartphone]

SOURCE

○ My Library
○ Pexels
○ Pixabay
● All

--------------------------------

[video] [video] [video]

[video] [video] [video]
```

User selects a candidate.

Only the current scene changes.

---

# 25. Preview Architecture

Use one canonical project JSON.

Example:

```ts
<ProjectVideo
  scenes={scenes}
  settings={renderSettings}
/>
```

Use it for:

```text
Remotion Player
```

and also:

```text
Remotion Render
```

Benefits:

- preview and final output stay consistent
- no duplicated composition logic

---

# 26. Rendering Pipeline

Output defaults:

```text
1080 × 1920
30 fps
H.264
AAC
MP4
```

Recommended responsibility split:

## FFmpeg

```text
trim
crop
scale
convert
audio normalization
thumbnail generation
media preprocessing
```

## Remotion

```text
composition
layout
captions
animations
transitions
final render
```

---

# 27. Render Job Architecture

Never keep a browser request open for a long render.

Use:

```text
POST /render

      ↓

RenderJob
QUEUED

      ↓

Worker

      ↓

PROCESSING

      ↓

COMPLETED

      ↓

output.mp4
```

---

# 28. Cost Guard

Cost control is mandatory.

```ts
interface CostPolicy {
  dailyBudgetUsd: number;

  monthlyBudgetUsd: number;

  projectBudgetUsd: number;

  maxPerOperationUsd: number;
}
```

Example:

```text
Daily       $1

Monthly     $20

Video       $0.50

Single call $0.10
```

Before every paid request:

```text
Estimate cost
      ↓
CostGuard
      ↓
Allowed?
 ┌────┴────┐
 No        Yes
 │          │
Stop     Call API
            ↓
        Record usage
```

---

# 29. API Usage Dashboard

Example:

```text
API COST

Today

$0.23 / $1.00

████░░░░░░


This month

$4.12 / $20


Per Video Maximum

$0.50
```

Project cost:

```text
Current Project

OpenAI       $0.023

TTS          $0.148

Media        $0

----------------

TOTAL        $0.171
```

---

# 30. Estimated Cost Before Operation

Before a paid operation:

```text
Generate Video

Estimated API Cost

$0.16 – $0.24

Uses:

✓ AI scene planning

✓ TTS

✓ Media search

✕ AI media ranking

[Generate]
```

Paid APIs must never run automatically without an explicit triggering operation.

---

# 31. API Keys

Environment:

```text
OPENAI_API_KEY

ELEVENLABS_API_KEY

PEXELS_API_KEY

PIXABAY_API_KEY
```

Never expose keys to the browser.

Correct:

```text
Browser
↓
Backend
↓
Provider API
```

Incorrect:

```text
Browser
↓
Provider API directly
```

---

# 32. Retry Rules

Never use unlimited retries.

Recommended:

```text
maxRetries = 2
```

Retry only appropriate transient errors such as:

```text
429
500
502
503
```

Do not retry:

```text
400
401
403
```

Operations should support idempotent behavior where possible.

---

# 33. Media Library

Media Library is a core feature.

Example:

```text
Library

├─ Phone
├─ People
├─ City
├─ Technology
├─ Office
└─ Society
```

Each asset stores:

```text
file
thumbnail
tags
duration
resolution
usage count
source
```

Later AI can search this library first.

Advantages:

- less dependency on external media APIs
- lower cost
- consistent visual style
- reuse existing footage

---

# 34. Screens

Recommended routes:

```text
/dashboard

/projects/new

/projects/:id/script

/projects/:id/scenes

/projects/:id/media

/projects/:id/preview

/projects/:id/render

/library

/settings/providers

/settings/budget
```

---

# 35. Features Explicitly Excluded From V1

Do not implement:

```text
Microservices

Kubernetes

Mobile app

Collaborative editing

Multi-track CapCut-style editor

AI subject tracking

AI-generated full videos

Vector database

Automatic YouTube publishing

Advanced analytics

SaaS billing

Social login requirement
```

These can be considered later.

---

# 36. Development Milestones

---

## M0 — Foundation

### Scope

Implement:

```text
monorepo

Next.js

TypeScript strict

PostgreSQL

ORM

shared schemas

lint

format

env validation

Docker local
```

No AI.

### Acceptance Criteria

- application starts locally
- database connection works
- migrations work
- typecheck passes
- lint passes
- test command works
- environment validation exists

---

## M1 — Project + Three Modes

### Scope

Implement:

```text
Create Project

Manual Mode

Assisted Mode

Full AI Mode

Automation Settings

Project Detail
```

### Acceptance Criteria

- user can create a project
- mode is persisted
- automation settings are persisted
- page reload preserves project state
- mode can initialize its preset
- advanced settings can override preset

---

## M2 — Script + Scene Management

### Scope

Implement:

```text
Paste Script

Manual Scene Creation

Edit Narration

Delete Scene

Split Scene

Merge Scene

Reorder Scene
```

No AI.

### Acceptance Criteria

A user can manually convert a script into a complete scene structure.

Scene ordering must persist.

---

## M3 — Media Library + Upload

### Scope

Implement:

```text
Upload MP4

Upload Images

Local Storage

ffprobe Metadata Extraction

Thumbnail Generation

Media Library

Assign Media to Scene

Source Start/End

Crop Settings
```

### Acceptance Criteria

User can:

1. upload an MP4
2. see the media in the library
3. assign it to Scene 03
4. select 15s–22s
5. save
6. reload project
7. selection remains correct

### Explicitly Excluded

```text
AI video analysis

Pexels

Pixabay

TTS

Timeline editor

S3

Smart cropping
```

---

## M4 — Preview + Render

### Scope

Implement:

```text
Remotion Composition

9:16 Preview

Scene Switching

Media Crop

Subtitle Rendering

Voice Track

Final MP4 Render

Render Job
```

### Acceptance Criteria

Manual Mode must be able to create a complete vertical video without any paid API.

This is the first major POC checkpoint.

---

## M5 — TTS

### Scope

Implement:

```text
TtsProvider

ElevenLabsProvider

UploadedVoiceProvider

Generate Voice Per Scene

Regenerate Scene Voice

Voice Preview
```

### Acceptance Criteria

If Scene 04 narration changes:

```text
only Scene 04 voice is regenerated
```

Other voice files remain unchanged.

---

## M6 — AI Script + Scene Planning

### Scope

Implement:

```text
AiProvider

OpenAiProvider

Generate Script

Rewrite Script

Plan Scenes

Generate Visual Plan

Structured JSON

Schema Validation
```

### Acceptance Criteria

```text
Idea
↓
Script
↓
Scene JSON
```

works without manually editing JSON.

---

## M7 — Media Search

### Scope

Implement:

```text
MediaProvider

LocalLibraryProvider

PexelsProvider

PixabayProvider

Search UI

AI Search Query Generation
```

Search order:

```text
Local Library
↓
Free Providers
```

### Acceptance Criteria

User can open Scene 05 and:

```text
Search Media
→ View Candidates
→ Select Candidate
→ Assign to Scene
```

---

## M8 — CostGuard + Full AI Pipeline

### Scope

Implement:

```text
Cost Estimation

API Usage Logging

Budget Enforcement

AI Media Ranking

Auto Media Selection

Full AI Workflow
```

Final workflow:

```text
Idea
↓
Script
↓
Scenes
↓
Voice
↓
Media
↓
Preview
↓
Render
```

### Acceptance Criteria

Before starting paid automation:

```text
estimated cost is shown
```

If budget would be exceeded:

```text
operation is blocked
```

---

# 37. Recommended POC Execution Order

Do not build Full AI first.

Build:

```text
M0
↓
M1
↓
M2
↓
M3
↓
M4
```

Then stop.

Use Manual Mode to produce at least:

```text
3 real videos
```

Measure:

- rendering quality
- scene editing UX
- media workflow
- subtitle quality
- whether CapCut is still required

If successful:

```text
M5
↓
M6
↓
M7
```

Use Assisted Mode to produce:

```text
5–10 real videos
```

Measure:

- time saved
- AI scene quality
- media search quality
- API cost
- number of manual corrections

Only then implement:

```text
M8
```

---

# 38. POC Metrics

Recommended success criteria:

| Metric                                 |       Target |
| -------------------------------------- | -----------: |
| Production time reduction              |       >= 50% |
| AI scene segmentation usable           |       >= 80% |
| Top-3 media usable                     |       >= 75% |
| Scenes requiring manual footage search |       <= 25% |
| Videos not requiring CapCut            |       >= 70% |
| Economy API cost per video             | < 10,000 VND |
| Render success rate                    |       >= 95% |
| Paid API budget enforcement            |         100% |

---

# 39. Testing Strategy

## 39.1. Unit Tests

Prioritize:

```text
Scene duration calculation

Scene ordering

Split scene

Merge scene

CostGuard

Budget enforcement

Provider selection

Media metadata normalization

Timeline calculation

Automation settings
```

Do not try to unit test every small React component.

---

## 39.2. Integration Tests

Important flows:

```text
Create Project

Create Scene

Upload Media

Assign Media

Save Trim Range

Generate Render Job

Complete Render
```

---

# 40. Contract-First Development

For every new module, coding agents should follow:

```text
1. Define interface

2. Define Zod schema

3. Define domain model

4. Write application service

5. Implement infrastructure provider

6. Write tests

7. Build UI
```

Avoid:

```text
React UI
↓
direct fetch
↓
external API
```

---

# 41. AGENTS.md

Create an `AGENTS.md` at repository root.

Suggested content:

```text
PROJECT: AI Shorts Studio

GOAL:
Create a scene-based video production tool supporting:
- Manual
- Assisted
- Full AI

ARCHITECTURE RULES:

1. TypeScript strict.

2. Next.js app directory is thin routing only.

3. Business logic must live in modules/services.

4. Never call external AI/media/TTS providers directly
   from React components.

5. All external services must implement interfaces:
   - AiProvider
   - TtsProvider
   - MediaProvider
   - StorageProvider

6. Scene is the central video domain object.

7. Editing must be non-destructive.
   Never modify uploaded source files.

8. AI is optional.
   Manual Mode must work without AI APIs.

9. All paid external calls must pass CostGuard.

10. Never expose provider API keys to the browser.

11. Do not implement functionality outside
    the current milestone.

12. Do not introduce microservices.

13. Avoid premature abstraction.

14. Add tests for important business logic.

15. Update documentation after architecture changes.

16. Do not create a CapCut-style timeline editor in V1.

17. Prefer simple implementation over generic frameworks.

18. Before coding, inspect existing repository structure.

19. Before modifying architecture, explain the proposed change.

20. At completion:
    - run tests
    - run typecheck
    - run lint
    - summarize modified files
    - document remaining risks
```

---

# 42. Coding Agent Workflow

Never prompt:

```text
Build me an AI video generator.
```

Instead, give the agent only one milestone.

Recommended format:

```text
Implement Milestone M3: Media Library and Upload.

Read first:
- AGENTS.md
- docs/architecture.md
- docs/domain.md

Scope:
...

Acceptance Criteria:
...

Do Not Implement:
...

Before modifying files:
1. inspect current architecture
2. propose affected files
3. then implement

After implementation:
- run tests
- run typecheck
- run lint
- summarize changes
- identify risks
```

---

# 43. Example Coding Agent Prompt — M3

```text
Implement Milestone M3: Media Library and Upload.

First inspect the existing repository and AGENTS.md.

Requirements:

- Support MP4 and image uploads.
- Store media through StorageProvider.
- Use LocalStorageProvider for development.
- Extract MP4 metadata using ffprobe.
- Store duration, width, height and fps.
- Generate a thumbnail.
- Allow an uploaded asset to be assigned to a Scene.
- SceneMedia must support sourceStartMs and sourceEndMs.
- Editing must be non-destructive.
- Do not modify the original uploaded media.
- Add validation for invalid file types.
- Add appropriate domain/service tests.

Do not implement:

- AI video analysis
- Pexels
- Pixabay
- TTS
- timeline editor
- S3
- advanced smart cropping

Before modifying files:
1. inspect the current architecture,
2. propose the files that need changing,
3. then implement.

At the end:
- run tests
- run typecheck
- run lint
- summarize changed files
- identify remaining risks.
```

---

# 44. V1 Definition of Done

V1 is only complete if all three workflows work.

## Manual

```text
Paste Script
+
Upload Voice
+
Upload MP4
↓
Edit Scenes
↓
Preview
↓
Render
```

Target API cost:

```text
0 VND
```

---

## Assisted

```text
Paste Script
↓
AI Scene Planning
↓
TTS
↓
AI Search Queries
↓
User Selects Media
↓
Preview
↓
Render
```

---

## Full AI

```text
Idea
↓
AI Script
↓
AI Scene Planning
↓
TTS
↓
Media Search
↓
AI Ranking
↓
Auto Select
↓
Human Review
↓
Render
```

---

# 45. Important Editing Requirement

Every scene must be independently editable.

Example:

```text
Scene 07 media is wrong
↓
Replace Scene 07 media
```

Do not regenerate:

- script
- other scenes
- other voice files

Example:

```text
Scene 04 narration changed
↓
Regenerate Scene 04 voice
↓
Update Scene 04 duration
↓
Recalculate timeline
```

Do not regenerate all voice files.

---

# 46. Future V2 Possibilities

Only consider after V1/POC proves value.

Potential V2 features:

```text
AI Media Ranking Improvements

Video Semantic Search

AI Video Understanding

Smart Crop

Face / Subject Tracking

Word-Level Animated Captions

Auto B-Roll Selection

YouTube Upload Integration

Cloud Rendering

Multi-User

Team Workspace

Template Marketplace

Analytics

SaaS Billing

Local TTS

Multiple AI Providers

AI-generated Images

AI-generated Short Video Clips
```

---

# 47. Final Technical Direction

Recommended V1 architecture:

```text
Frontend
Next.js + React + TypeScript

Application
Scene-based domain

AI
Provider abstraction

TTS
Provider abstraction

Media
Provider abstraction

Storage
Provider abstraction

Editing
Non-destructive metadata-based editing

Preview
Remotion Player

Processing
FFmpeg

Rendering
Remotion + Worker

Database
PostgreSQL

Cost
Central CostGuard

Development storage
Local filesystem

Production storage
S3-compatible
```

The most important strategic rule is:

> Build Manual Mode and the Scene Editor/Render Engine first.

Do not begin with Full AI.

The project should first prove:

```text
Script
+
Voice
+
Uploaded Media
↓
Scene Editing
↓
Automatic Render
```

works reliably.

Only then add:

```text
AI
TTS
Media Search
AI Ranking
```

as replaceable providers.

This approach reduces:

- technical risk
- API cost
- architecture complexity
- debugging complexity
- vendor dependency

and gives the project a useful product even if AI features are temporarily unavailable.

---

# 48. Recommended First Implementation Sequence

Start development in this exact order:

```text
M0 Foundation

M1 Project + Modes

M2 Script + Scenes

M3 Media Upload + Library

M4 Preview + Render
```

POC checkpoint:

```text
Create 3 real Shorts using Manual Mode.
```

Then:

```text
M5 TTS

M6 AI Script + Scene Planning

M7 Media Search
```

Second checkpoint:

```text
Create 5–10 real Shorts using Assisted Mode.
```

Only if metrics are acceptable:

```text
M8 Full AI + Media Ranking + CostGuard completion
```

This is the recommended investment path for the project.
