# ClarityDocs — Technical Specification

> Derived from `ClarityDocs-PRD.md`. Covers API contract (Phase1 vs Phase2), DDL, folder structure, AWS resources, and phased checklist. Stack: `Node 20 + Express + TypeScript (ESM)` + `React + TypeScript + Vite SPA` + `MySQL (mysql2, no ORM)` + `pdf-parse` (Phase1, swappable) per PRD §8. Deploy deferred.

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
├── docker-compose.yml       # mysql:8 + backend (dev)
├── backend/
│   ├── package.json         # type: module, ESM
│   ├── tsconfig.json        # module NodeNext
│   ├── .env.example
│   ├── src/
│   │   ├── index.ts         # bootstrap: pool → ensureSchema → app.listen
│   │   ├── app.ts           # express app factory (for tests)
│   │   ├── config.ts        # typed env (PORT, DB_*, UPLOAD_DIR, S3_BUCKET, SQS_QUEUE_URL, EXTRACTION_MODE)
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
│   │   └── types/
│   │       └── index.ts      # DocumentRecord, ExtractedInvoiceData, DocumentStatus
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
└── lambda/                   # Phase2 only
    ├── handler.ts            # SQS event → extraction → MySQL update
    └── package.json
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

**Phase1 local parity:** `docker-compose.yml` runs `mysql:8` so backend `DB_HOST=localhost` works without AWS. Phase2 switches to `RDS t3.micro` (free) or keeps local MySQL via Lambda VPC peering; simplest demo keeps MySQL on EC2/RDS free without VPC change for interview storytelling.

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

### Phase2 — Async (PRD §7.2)

- [ ] Abstract `storage.service` (local→S3) + `queue.service` (no-op→SQS) behind interfaces; add `EXTRACTION_MODE` config
- [ ] Change `POST /upload` to: S3 put (or local fallback if no `S3_BUCKET`), `pending`, `enqueue`, return `201` (no inline extract)
- [ ] Create AWS resources §5 (S3 bucket, SQS queue + DLQ, Lambda role); set `SQS_QUEUE_URL`, `S3_BUCKET` env
- [ ] `lambda/handler.ts`: SQS event → `pool` query → set `processing` → `storage.getFile(s3Key)` → `extractionService.extract` → update `done/failed`; batch 1, DLQ handling
- [ ] Reuse same `extraction.service` code (shared via `npm pack` or copy) — no drift
- [ ] Frontend **unchanged** — confirm polling still works
- [ ] Verification: upload with `EXTRACTION_MODE=queue` → immediate `pending` → 1–3s → `done`; kill worker, see message retry/DLQ; show both modes via env flag

**Demo exit:** Same UI, backend switched to queue without frontend deploy.

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
