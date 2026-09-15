# ClarityDocs — Technical Specification

> Derived from `ClarityDocs-PRD.md`. Covers API contract (Phase1 vs Phase2), DDL, folder structure, AWS resources, and phased checklist. Stack: `Node 20 + Express + TypeScript (ESM)` + `React + TypeScript + Vite SPA` + `MySQL (mysql2, no ORM)` + `pdf-parse` (Phase1, swappable) per PRD §8. Deploy deferred.
> **Update 2026-09-14 — Freelancing Finish:** `S3/SQS/Lambda` dropped (code in `backend/src/lambda/` `backend/infra/` deleted per user trade-off), MySQL cloud (`Clever Cloud`/`Railway` free) used for online deploy, `Render` ephemeral `UPLOAD_DIR=/tmp/uploads` accepted. See §10 Reasoning.

---

## 1. Overview & Conventions

**Philosophy:** Upload → Extract → View pipeline where Phase1 is synchronous (inline) and Phase2 is asynchronous (SQS/Lambda) with **identical frontend contract**. Tiered extraction (§6 PRD: regex → layout → llm) is deferred to Phase3 but interfaces are made pluggable now.

**Module system:** Backend is ESM (`package.json "type":"module"`, `tsconfig "NodeNext"`).

**No ORM:** Plain `mysql2/promise` pool. Reason: PRD §8 explicitly says `plain mysql2` unless justified; keeps SQL visible for interviewers and avoids migration magic.

**Env:** `dotenv` + `.env.example`. Frontend `VITE_API_URL` points to `http://localhost:4000`.

---

## 2. API Contract

Base URL: `http://localhost:4000` (Phase1/2). All routes under `/api`. JSON responses. CORS open in dev (`cors()`), locked down later.

### 2.1 Common Types

```ts
type DocumentStatus = "pending" | "processing" | "done" | "failed";

interface Document {
  id: string; // UUID v4, server-generated via crypto.randomUUID() (~5.3e36 values, PK prevents dup)
  name: string; // as uploaded, e.g. "invoice-2024-01.pdf"
  path: string;   // Phase1: ./uploads/<uuid>-<name> | Phase2: s3://<bucket>/<key> (not exposed to client in prod; returned as key)
  status: DocumentStatus;
  data: ExtractedInvoiceData | null;
  error: string | null;
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}

interface ExtractedInvoiceData {
  vendor?: string;
  invoiceNumber?: string;
  invoiceDate?: string; // ISO date string
  totalAmount?: number;
  currency?: string;    // e.g. "INR", "USD"
  // Phase4: add documentType discriminator
}

interface ApiError {
  error: string;
  details?: unknown;
}
```

### 2.2 Endpoints

#### `GET /health`
- **Purpose:** Liveness probe.
- **Request:** none
- **Response 200:**
```json
{ "status": "ok" }
```

#### `POST /api/documents/upload`
- **Purpose:** PRD §7 MVP: store file + create `pending` record + trigger extraction.
- **Request:** `multipart/form-data`, field `file` (single).
  - Allowed mimes: `application/pdf`, `image/png`, `image/jpeg`
  - Max size: `10 MB` (configurable via `MAX_FILE_SIZE`)
  - Validation: `zod` + `multer` fileFilter
- **Phase1 behavior:** Server generates `id` via `crypto.randomUUID()` (v4, 122 random bits, collision <1e-25 at 1M docs; `PRIMARY KEY` guards duplicates — `ER_DUP_ENTRY` → retry), save to `UPLOAD_DIR` (`./uploads`), insert `documents` row `pending`, immediately set `processing`, call `extractionService.extract(filePath)` in-process, update `done` + `data` or `failed` + `error`.
- **Phase2 behavior:** Save to S3 (`path = s3Key`), insert `pending`, send `SQS` message `{docId, s3Key, name}` with `MessageGroupId?` (standard queue, no grouping). Return immediately. Worker (Lambda) does the `processing→done/failed` transition.
- **Response 201 (both phases):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "invoice.pdf",
  "status": "pending",
  "created_at": "2026-09-08T10:00:00.000Z"
}
```
- **Errors:**
  - `400` — no file / invalid mime / zod fail `{error:"Invalid file type. Allowed: pdf,png,jpg"}`
  - `413` — file too large
  - `500` — storage/DB/queue failure `{error:"Failed to process upload"}`

#### `GET /api/documents`
- **Purpose:** PRD §7 list view.
- **Query:** `?limit=20&offset=0` (defaults 20/0, max limit 100)
- **Response 200:**
```json
{
  "documents": [ Document ],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```
- **Ordering:** `created_at DESC`
- **Errors:** `400` bad pagination, `500`

#### `GET /api/documents/:id`
- **Purpose:** Polling contract — frontend polls until terminal (`done|failed`) per PRD §10. Unchanged across phases.
- **Params:** `id` UUID
- **Response 200:** `Document`
- **Errors:** `400` invalid UUID, `404` `{error:"Document not found"}`, `500`

#### `PATCH /api/documents/:id/corrections` — **Phase3 only (documented, not MVP)**
- **Request:** `{ corrections: Partial<ExtractedInvoiceData> }`
- **Response 200:** updated `Document`
- **Side effect:** inserts into `extraction_corrections` (future) for learning.

### 2.3 Status Codes Summary

| Route | 2xx | 4xx | 5xx |
|---|---|---|---|
| `POST /upload` | 201 | 400,413 | 500 |
| `GET /documents` | 200 | 400 | 500 |
| `GET /documents/:id` | 200 | 400,404 | 500 |
| `GET /health` | 200 | — | — |

### 2.4 Phase1 vs Phase2 — Exact Delta

| Aspect | Phase1 (sync) | Phase2 (async) |
|---|---|---|
| `POST /upload` latency | Includes extraction (200ms–2s) | Immediate (<100ms) returns `pending` |
| `path` | Local `./uploads/<uuid>-<name>` | S3 key `<uuid>/<name>` (bucket in env `S3_BUCKET`) |
| `status` lifecycle | `pending → processing → done/failed` in same request handler | `pending` in API, worker sets `processing→done/failed` |
| Queue | None | `queueService.send({docId, s3Key})` |
| Worker | None | Lambda `handler` triggered by SQS, reuses `extractionService` |
| Frontend change | — | **None** — polling `GET :id` contract identical (PRD §7.2) |
| Config flag | `EXTRACTION_MODE=inline` | `EXTRACTION_MODE=queue` + `SQS_QUEUE_URL`, `S3_BUCKET`, `AWS_REGION` |
| Failure visibility | Inline try/catch → `failed` | Lambda DLQ + `failed` write; SQS visibility timeout 30s |

No frontend code change required to switch modes. The only observable difference is that Phase1 may return `processing`/`done` faster, while Phase2 will stay `pending` for 1–3s before worker picks up.

---

## 3. Database Schema (DDL)

### 3.1 `documents` — Phase1 (now)

```sql
CREATE TABLE IF NOT EXISTS documents (
  id CHAR(36) PRIMARY KEY COMMENT 'UUID v4 server-generated, PK prevents dup',
  name VARCHAR(255) NOT NULL,
  path VARCHAR(500) NOT NULL,
  status ENUM('pending','processing','done','failed') NOT NULL DEFAULT 'pending',
  data JSON NULL,
  error TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_status_created (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**Notes:**
- Short names: `name` (for `original_name`), `path` (for `stored_path`), `data` (for `extracted_data`), `error` (for `error_message`) per PRD §9.
- `path`: Phase1 local path, Phase2 S3 key. Abstracted via `storageService.resolvePath()`.
- `data` JSON shape = `ExtractedInvoiceData | null`. No generated columns in MVP.
- `DATETIME` uses `CURRENT_TIMESTAMP` (MySQL 8). `updated_at` auto-updates on row change.

Type mapping (`mysql2`):

```ts
interface DocumentRow {
  id: string;
  name: string;
  path: string;
  status: DocumentStatus;
  data: string | null; // JSON string from mysql2, parse on read
  error: string | null;
  created_at: string;
  updated_at: string;
}
```

### 3.2 `extraction_attempts` — Phase3 Migration (documented, not built in MVP)

```sql
-- 002_create_extraction_attempts.sql
CREATE TABLE IF NOT EXISTS extraction_attempts (
  id CHAR(36) PRIMARY KEY,
  doc_id CHAR(36) NOT NULL,
  method VARCHAR(50) NOT NULL COMMENT 'e.g. regex, layout, llm - not indexed',
  confidence FLOAT NOT NULL COMMENT '0-1',
  cost DECIMAL(10,6) NULL,
  latency INT NOT NULL COMMENT 'ms',
  success BOOLEAN NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE,
  INDEX idx_doc_id (doc_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**PRD §9 compliance:** Included so schema decision is made once. Phase3 will also consider `extraction_corrections` (user feedback) but out of MVP scope.

### 3.3 Future Phase4 Column (no DDL now, documented)

```sql
-- 003_add_document_type.sql (future)
ALTER TABLE documents ADD COLUMN document_type VARCHAR(50) NOT NULL DEFAULT 'invoice' COMMENT 'Phase4: invoice|receipt|...';
ALTER TABLE documents ADD INDEX idx_type (document_type);
```

---

## 4. Folder / Module Structure

### 4.1 Repository Layout (separate frontend/backend, deploy deferred)

```
clarityDocs/
├── ClarityDocs-PRD.md
├── TECHNICAL_SPEC.md        # this file
├── docker-compose.yml       # mysql:8 + backend (dev) — mysql local in Phase 2 hybrid, RDS in Phase 3
├── backend/
│   ├── package.json         # type: module, ESM — includes @aws-sdk/client-s3/sqs
│   ├── tsconfig.json        # module NodeNext
│   ├── .env.example
│   ├── src/
│   │   ├── index.ts         # bootstrap: pool → ensureSchema → app.listen
│   │   ├── app.ts           # express app factory (for tests)
│   │   ├── config.ts        # typed env (PORT, DB_*, UPLOAD_DIR, S3_BUCKET, SQS_QUEUE_URL, EXTRACTION_MODE)
│   │   ├── lambda/
│   │   │   └── handler.ts   # Phase2 hybrid SQS event → extraction → MySQL update (reuses extraction.service)
│   │   ├── db/
│   │   │   ├── pool.ts      # mysql2/promise createPool
│   │   │   └── schema.ts    # ensureSchema() runs DDL §3.1
│   │   ├── routes/
│   │   │   └── documents.route.ts  # POST /upload, GET /, GET /:id
│   │   ├── controllers/
│   │   │   └── documents.controller.ts
│   │   ├── services/
│   │   │   ├── extraction.service.ts  # interface + pdf-parse impl (swappable)
│   │   │   ├── storage.service.ts     # local disk (Phase1) → S3 (Phase2) adapter
│   │   │   └── queue.service.ts       # no-op Phase1, SQS send Phase2
│   │   ├── middleware/
│   │   │   ├── upload.ts     # multer({storage, limits, fileFilter})
│   │   │   ├── validate.ts   # zod query/param validators
│   │   │   └── error.ts      # centralized errorHandler
│   │   ├── worker.ts         # Phase2 hybrid local SQS poller → lambda/handler
│   │   └── types/
│   │       └── index.ts      # DocumentRecord, ExtractedInvoiceData, DocumentStatus
│   ├── infra/
│   │   └── localstack-init.sh # Phase2 hybrid S3+SQS emulation (optional, not RDS)
│   └── uploads/              # gitignored, local Phase1
├── frontend/
│   ├── package.json          # vite + react + TS
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx           # router
│       ├── api/
│       │   └── client.ts     # fetch wrapper (VITE_API_URL)
│       ├── hooks/
│       │   └── usePolling.ts # 2s interval until done|failed
│       ├── routes/
│       │   ├── Upload.tsx    # form + drag-drop
│       │   ├── List.tsx      # table of documents
│       │   └── Detail.tsx    # status + extracted_data + polling
│       └── types/
│           └── index.ts
```

### 4.2 Module Responsibilities

- **routes/documents.route.ts:** Defines routes, wires `multer` + controller. No business logic.
- **controllers/documents.controller.ts:** Parses req, validates, calls services, maps DB rows → JSON, handles status codes.
- **services/extraction.service.ts:**
```ts
export interface ExtractionResult {
  data: ExtractedInvoiceData;
  confidence: number; // 0-1, for Phase3 tiering
  method: string;     // 'regex'
}
export async function extract(filePathOrBuffer: string | Buffer): Promise<ExtractionResult>;
```
Impl Phase1: `pdf-parse` → text → regex (`vendor`, `invoiceNumber`, `invoiceDate`, `totalAmount`, `currency`). Confidence heuristic (field coverage). Swappable to `pdfjs-dist` without controller changes.

- **services/storage.service.ts:**
```ts
export interface StorageService {
  save(file: Express.Multer.File): Promise<{path: string; s3Key?: string}>;
  getFile(pathOrKey: string): Promise<Buffer>;
}
```
Local impl now, S3 impl Phase2 behind same interface.

- **services/queue.service.ts:**
```ts
export async function enqueue(job: {docId: string; s3Key: string}): Promise<void>;
```
Phase1: `return;` Phase2: `sqs.sendMessage({QueueUrl, MessageBody: JSON.stringify(job)})`.

---

## 5. AWS Resources — Phase2

All resources stay within **AWS always-free tiers** per PRD §8 for personal/demo traffic:

| Resource | Name (example) | Config | Free Tier Limit (inline) |
|---|---|---|---|
| **S3 Bucket** | `claritydocs-uploads-<env>-<account>` | Region `ap-south-1` (or `us-east-1`), Versioning OFF, Block public access ON, Lifecycle none in MVP, CORS allow `GET/PUT` from frontend origin when needed | **5 GB storage / 20,000 GET / 2,000 PUT per month** |
| **SQS Queue** | `claritydocs-jobs` | Type **Standard** (not FIFO, no ordering needed), Visibility timeout `60s`, Message retention `14 days`, DLQ `claritydocs-jobs-dlq` with maxReceive `3`, Long polling `20s` | **1M requests/month** |
| **Lambda Function** | `claritydocs-worker` | Runtime `nodejs20.x`, Handler `handler.handler`, Memory `512 MB`, Timeout `30s`, Trigger `SQS` batch `1` (to preserve order isolation), Env `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD/S3_BUCKET` (via Secrets Manager or env), VPC same as RDS/MySQL or public with security group | **1M requests / 400,000 GB-seconds per month** |
| **IAM Role** | `claritydocs-worker-role` | Trust `lambda.amazonaws.com` | — |
| **IAM Policies** | `AWSLambdaBasicExecutionRole` + inline: `s3:GetObject/PutObject` on bucket `arn:aws:s3:::claritydocs-uploads-*/*`, `sqs:ReceiveMessage/DeleteMessage/GetQueueAttributes` on queue ARN, `logs:CreateLogGroup/CreateLogStream/PutLogEvents` | — | — |

**Phase2 hybrid (current, Phase 3 RDS deferred):** `docker-compose.yml` still runs `mysql:8` so backend `DB_HOST=localhost` works without AWS — Phase 2 uses real `S3+SQS` (or `backend/infra/localstack-init.sh` emulation) with local `worker.ts` polling `SQS` and calling `backend/src/lambda/handler.ts`; Phase 3 moves to `RDS t3.micro` (free) and deploys Lambda to AWS. Simplest demo per recommendation keeps MySQL local in Phase 2, RDS in Phase 3.

**Cost note:** At demo scale (<100 docs/month, <500 S3 PUT, <200 Lambda invocations), all metrics are <1% of free tier.

---

## 6. Phased Implementation Checklist (each independently shippable & demoable)

### Phase1 — Synchronous MVP (PRD §7.1)

- [ ] Re-init `backend/` ESM (`module NodeNext`, `type:module`, `ts-node-dev` ESM loader or `tsx`)
- [ ] `db/pool.ts` + `schema.ts` run DDL §3.1; `config.ts` typed env; `.env.example` with `DB_*, PORT, UPLOAD_DIR, MAX_FILE_SIZE`
- [ ] `middleware/upload.ts` (`multer` diskStorage `uploads/<uuid>-<name>`, 10MB, pdf/png/jpg filter) + `error.ts` + `validate.ts` (zod)
- [ ] `services/extraction.service.ts` `pdf-parse` impl (export `extract`), regex for `vendor/date/total` + confidence; unit fixture with sample PDF
- [ ] `routes` + `controllers` implement `POST /upload` inline flow `pending→processing→done/failed`, `GET /documents`, `GET /documents/:id`
- [ ] `app.ts`/`index.ts` wire `cors`, `express.json`, `/api`, `/health`, `ensureSchema`
- [ ] `frontend/` Vite scaffold: `Upload` (file input + POST), `List` (GET), `Detail` (polling hook 2s), `client.ts` with `VITE_API_URL`
- [ ] `docker-compose.yml` (`mysql:8`, `backend` depends_on, init `clarity_docs` DB), `README` arch note (why sync first)
- [ ] Verification: `curl -F file=@invoice.pdf http://localhost:4000/api/documents/upload` → `201` → poll `GET :id` → `done` with `extracted_data`; upload 3 real invoices, show list; `npm run build` passes

**Demo exit:** User uploads PDF/PNG, sees `vendor/date/total` within seconds, list persists.

### Phase2 — Async hybrid (PRD §7.2, RDS deferred to Phase 3)

- [x] Abstract `storage.service` (local→S3) + `queue.service` (no-op→SQS) behind interfaces; add `EXTRACTION_MODE` config
- [x] Change `POST /upload` to: S3 put (or local fallback if no `S3_BUCKET`), `pending`, `enqueue`, return `201` (no inline extract)
- [x] Create AWS resources §5 (S3 bucket, SQS queue + DLQ, IAM role); set `SQS_QUEUE_URL`, `S3_BUCKET` env — uses real S3+SQS, DB stays local `mysql:8` (RDS → Phase 3)
- [x] `backend/src/lambda/handler.ts`: SQS event → `pool` query → set `processing` → `storage.getFile(s3Key)` → `extractionService.extract` → update `done/failed`; batch 1, DLQ handling — plus `backend/src/worker.ts` local poller calling `lambda/handler`
- [x] Reuse same `extraction.service` code inside `backend/` (no cross-root `../backend` import) — no drift, `lambda/` `infra/` at root deleted per decision
- [ ] Frontend **unchanged** — confirm polling still works
- [ ] Verification: upload with `EXTRACTION_MODE=queue` → immediate `pending` → 1–3s → `done` via `s3://` path; kill worker, see message retry/DLQ; show both modes via env flag

**Demo exit:** Same UI, backend switched to queue without frontend deploy. **Data saved in cloud (Phase 2 hybrid):** file bytes → `S3` `s3://bucket/<uuid>-name` (persistent vs ephemeral `./uploads`), row → `documents` `data JSON document_type` still local `mysql:8` volume `mysql_data` — cloud-persistent file + local row; Phase 3 moves row to `RDS`.

### Phase2 → Phase3 delta — RDS (deferred)

- [ ] Provision `RDS MySQL 8 t3.micro` `clarity_docs` `SG 3306` `VPC` for `Lambda`/`ECS`; migrate `DB_HOST` from `localhost` to RDS endpoint in `backend/.env` + Lambda env `DB_HOST/.../S3_BUCKET/AI_*`
- [ ] Deploy `backend/dist/lambda/handler.js` as `Lambda claritydocs-worker nodejs20.x 1024MB 30s handler=lambda/handler.handler` + `create-event-source-mapping batch 1`
- [ ] Verify cloud persistence: app on `ECS/EC2` + `RDS` — uploads survive `docker compose down` and container restarts (both `S3` + `RDS`).

**Demo exit:** Full cloud: `S3` + `SQS` + `Lambda` + `RDS`.

### Phase3 — Tiered + Observability (PRD §7.3)

- [ ] Run migration §3.2 `extraction_attempts`
- [ ] Refactor `extractionService` to loop `regex (cost 0) → layout (future) → llm (future)` with per-attempt `confidence/latency/cost/success` rows (`extraction_attempts` §3.2)
- [ ] UI badge: `Method: regex (confidence 0.72)` + attempt history table
- [ ] `PATCH /corrections` store + show corrected field
- [ ] Verification: upload low-confidence doc → see 2 attempts, correct `totalAmount`, see correction persisted

### Phase4 — Generalize (PRD §7.4)

- [ ] Add `document_type` column (migration §3.3), factory `getExtractor(type)` → pluggable per-type strategies
- [ ] Update upload to accept `type` param, route to correct extractor; add receipt extractor as second type
- [ ] Verification: upload `invoice` vs `receipt` → different `extracted_data` shapes

---

## 7. Non-Goals & Deviations from PRD

Flagged per PRD §12 instruction — no scope added without flag:

- **Deviations (intentional):** Short meaningful names `name/path/data/error` + `doc_id/cost/latency/success` adopted (PRD §9 updated), align `DATETIME CURRENT_TIMESTAMP` to MySQL 8, add pagination `?limit&offset` (PRD lists simple list; pagination prevents demo breakage — flagged). Add `MAX_FILE_SIZE 10MB` validation (free-tier safety).
- **Non-goals respected (PRD §5):** No auth/RBAC, no billing, no mobile, no production-grade OCR accuracy — regex stub is acceptable per §7 success criteria; web only.

---

## 8. Open Questions (Resolved for MVP)

- PDF lib: `pdf-parse` now, `pdfjs-dist` later (confirmed 2026-09-08).
- Module: ESM (confirmed 2026-09-08).
- Deploy: deferred; `docker-compose` local is source of truth for Phase1/2 demo.

---

## 9. Success Criteria Mapping (PRD §11)

1. Upload real invoice → `vendor/date/total` appears → covered by Phase1 verification.
2. Same codebase pointed at inline vs SQS/Lambda via `EXTRACTION_MODE` without frontend change → Phase2 checklist.
3. README arch decision (why async) → Phase1 doc task.

---

## 10. Reasoning — Freelancing Finish Decisions (2026-09-14)

**Context per user:** Finish for freelancing applications, cloud makes it tedious, AWS account requires paid tier, want `MySQL cloud alone` for deployed app free, user login session + data `preserved in cloud DB for month` (30-day `hard_delete` + `uploads` unlink), download `summarized graph` as `PDF` tables (no chart image), drop `lambda/` `infra/` + `S3` completely. Choices below locked before build.

| Decision | Choice (locked 2026-09-14) | Why / trade-off |
|----------|----------------------------|-----------------|
| **AWS/S3/SQS/Lambda** | **Remove entirely.** Delete `backend/src/lambda/handler.ts` `backend/src/worker.ts` `backend/src/services/queue.service.ts` `backend/infra/localstack-init.sh` + `@aws-sdk/*` `docker-compose worker/localstack` + `config s3Bucket/sqsQueueUrl/awsRegion/extractionMode queue` branches; `storage.service.ts` → local `fs.readFile` only `saveLocal` | User has no AWS account and free tier now asks paid tier. Keeps `upload → extract (inline tesseract+regex→llm) → view` pipeline fully functional with `mysql2`. For online deploy, `Render` `/tmp/uploads` ephemeral is acceptable because row `data JSON document_type` in cloud MySQL is the source of truth; file bytes after extraction are not re-used. `S3` was the only AWS piece justified for file persistence; dropping it saves `Create bucket, SQS queue+DLQ, IAM role, Lambda zip` steps that block freelancing demo. `backend/src/lambda/` `infra/` at root already consolidated to `backend/` then deleted per “yes delete entire lambda/ and infra/”. |
| **DB for online deploy** | **MySQL cloud `Clever Cloud Free` (primary) or `Railway Free MySQL` (alt)** via `DB_HOST/PORT/USER/PASSWORD/DB_NAME` `config.ts:14` | Both are `MySQL 8` wire-protocol compatible with `mysql2/promise` — zero code change except env. Free tier covers `<100 docs/mo` `data JSON ~2KB` `Clever Cloud ~256MB` / `Railway $5 credit`. `Neon/Supabase/Turso` are `Postgres/libSQL` — would require rewriting `mysql2` queries. `Render` ephemeral disk avoided; `RDS t3.micro` deferred to later `Phase 3` as user moved `RDS → Phase 3` then asked to finish without cloud. |
| **Auth** | **Option A `JWT HttpOnly cookie` + `bcryptjs`** per `plan` (`jsonwebtoken@9` `cookie-parser`) — per-user server isolation `documents.user_id FK→users.id` `WHERE user_id=?` on all `controllers/documents.controller.ts` queries | `PRD.md:46` non-goal `No auth/RBAC` lifted for multi-user freelancing. `JWT HttpOnly` stateless, no `express-session` store, works on `Render` free (no Redis). `bcryptjs` pure JS avoids native build on `node:20-alpine` `Dockerfile:1`. `JWT + cookie-parser` already avoids `localStorage` XSS. |
| **Password hashing** | **`bcryptjs` 10 rounds** | `argon2` stronger but needs native `node-gyp` which fails on `alpine`. `bcryptjs` sufficient for freelancing. |
| **Email verification + reset** | **`Resend` free `100/day 1 domain` via `nodemailer` SMTP `smtp.resend.com 465`** — verification link `uuid 1d expiry` `users.verification_token/expires_at`, reset `password_reset_tokens` `1h` expiry `nodemailer sendMail` | User asked “if email verification can be simpler and free I can have it” → `Resend` is simplest free (verify one domain, `from noreply@resend.dev` for dev). `Gmail SMTP` needs app-password. If not configured, verification auto-marks `email_verified=TRUE` on register (fallback), reset still requires `Resend`. |
| **Per-user isolation** | **Server-side `WHERE user_id=?`** never client-side filter | Prevents cross-user `GET /api/documents/:id` leak; mirrors `listDocuments` `where[]` pattern `validate.ts:1`. |
| **Retention 30-day enforcement** | **Option A `MySQL EVENT` + `node-cron` + `hard_delete` + `uploads` unlink** — `documents.expires_at DATETIME DEFAULT (created_at+INTERVAL 30 DAY) INDEX idx_expires` + `backend/src/jobs/cleanup.ts:1` `SELECT id,path WHERE expires_at<NOW() LIMIT 500 → fs.unlink → DELETE` `setInterval 24h` + `node-cron 0 2 * * *` + optional `CREATE EVENT purge_expired ON SCHEDULE EVERY 1 DAY` if `event_scheduler=ON` | User chose `hard_delete` + `delete file also from uploads` + Option A. `Clever Cloud` allows `EVENT`, `Railway` may block → `node-cron` fallback covers. Hard delete saves free DB quota vs soft `deleted_at`. `S3 Lifecycle` not applicable since `S3` removed. Daily `24h` cadence cheap, `LIMIT 500` avoids long transactions. |
| **Graph** | **Option A `recharts` on `frontend` `Dashboard.tsx`** (light, no `canvas` peer) | `PRD.md:81` observability deferred; `recharts` fits `Vite SPA` `frontend/package.json:12` without native deps. Metrics `average usage AVG(totalAmount)` `document authenticity AVG(confidence)` + `totalDocs sumTotal byType trend topVendors` for 30-day window `WHERE user_id=? AND status='done' AND created_at>=NOW()-INTERVAL 30 DAY` `JSON_EXTRACT(data,'$.totalAmount')`. |
| **Download** | **PNG via `recharts` `canvas.toBlob` + CSV + **PDF summarized tables only, no chart image** via `pdfkit` `GET /api/documents/summary/export?format=pdf|csv`** | User final `b) Just show graph in UI and download summarized data alone as pdf file(no image in that)` + earlier `png and csv`. Implemented as two buttons `Download Summarized CSV` + `Download Summarized PDF`; PNG via `canvas` kept for graph snapshot convenience but PDF is primary. `pdfkit` light vs `puppeteer/html2canvas` heavy on `Render` free. `Content-Disposition attachment; filename=claritydocs-summary-YYYY-MM-DD.pdf`. |
| **File delete after 30d** | **Yes, `uploads/<uuid>-safe` `fs.unlink` in `cleanup.ts`** `resolveFilename` `middleware/upload.ts:14` | User `c` confirmed. Prevents `Render /tmp` fill. |

**Consequence for deploy:** Freelancing build is `Render` `node:20-alpine` `npm run build && node dist/index.js` `PORT=10000` `UPLOAD_DIR=/tmp/uploads` `JWT_SECRET` `RETENTION_DAYS=30` `AI_API_KEY` + `Clever Cloud MySQL` `DB_HOST` → `Vercel` `VITE_API_URL`. `lambda/infra/S3/SQS` code deleted; `EXTRACTION_MODE` flag removed.
