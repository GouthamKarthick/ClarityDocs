# ClarityDocs — Product Requirements Document

## 1. Problem statement

People and small businesses regularly receive documents (invoices, receipts,
and eventually other document types) that contain structured information —
vendor name, amount, date, line items — which today has to be read and typed
in by hand. Existing commercial extraction tools (AWS Textract, Google
Document AI, Nanonets, Rossum) solve the extraction itself but are opaque
black boxes: they give you a result with no visibility into *how* it was
produced, no control over the cost-vs-accuracy tradeoff per document, and no
way to learn from corrections over time.

ClarityDocs is a small, self-built document intelligence pipeline that solves
the same core problem — turn an uploaded document into structured data — but
does so transparently: every extraction attempt, its method, its confidence,
and its cost are observable, and the system escalates through cheaper
methods before reaching for expensive ones.

## 2. Vision

Start narrow (invoices/receipts), prove the pipeline works end-to-end, then
generalize into a document analyzer that can handle other document types by
adding new extraction strategies without changing the core architecture.

## 3. Target user (for this project's purpose)

This is a portfolio/learning project. The two audiences it needs to satisfy:
- **Technical interviewers** evaluating distributed/async systems knowledge
  (SDE-1 job search).
- **The builder himself** — the project must be genuinely understandable and
  extensible without external scaffolding, since it's being built from
  scratch as a learning exercise.

## 4. Goals

- Build a working, demoable upload → extract → view pipeline.
- Demonstrate the sync-to-async architectural evolution explicitly (Phase 1
  vs Phase 2), since that evolution *is* the thing being taught.
- Keep the whole system inside AWS's always-free tiers (S3, SQS, Lambda).
- Design the data model so it doesn't need to be reshaped when the project
  expands from invoices to general documents.

## 5. Non-goals (for the MVP)

- No multi-user auth/RBAC (single-user/demo use only for now).
- No production-grade OCR accuracy — a rule-based extractor is acceptable
  for Phase 1/2; ML-based extraction is a later phase.
- No billing, payments, or multi-tenant concerns.
- No mobile app — web only.

## 6. Key differentiator

A **tiered, confidence-scored extraction strategy** instead of one opaque
call:
1. Try cheap rule-based extraction (regex over OCR/PDF text).
2. If confidence is low, escalate to a layout-aware method.
3. If still low, escalate to an LLM-based extraction call.

Every attempt is logged: method used, confidence score, latency, and cost.
This is the part existing IDP tools don't expose, and it directly answers
the "AI observability" gap identified during planning.

## 7. Functional requirements

### MVP (Phase 1 — synchronous)
- User can upload a document (PDF, PNG, JPG) via a web form.
- System stores the file and creates a document record with status
  `pending`.
- System runs extraction synchronously and updates the record to
  `processing` → `done` (or `failed` with an error message).
- User can view the extracted data once processing completes.
- User can see a list of previously uploaded documents and their status.

### Phase 2 — asynchronous
- Upload triggers a message onto a queue instead of extracting inline.
- A separate worker process consumes the queue and performs extraction.
- Frontend polling behavior is unchanged — only the backend implementation
  changes.

### Phase 3 — tiered extraction + observability
- Each extraction attempt (not just the final result) is recorded.
- A simple UI shows which method was used and its confidence.
- User can correct a field; the correction is stored for future reference.

### Phase 4 — generalize beyond invoices
- Document "type" becomes a first-class concept.
- Extraction strategies are pluggable per document type.

## 8. Non-functional requirements

- **Cost**: must run entirely within AWS's always-free monthly tiers (SQS:
  1M requests, Lambda: 1M requests / 400,000 GB-seconds, S3: 5GB storage /
  20,000 GET / 2,000 PUT) for expected personal-project traffic volumes.
- **Language/stack**: React + TypeScript (frontend), Express + TypeScript
  (backend API), MySQL (persistence), Python or Node (Lambda worker),
  Docker (local dev parity).
- **Observability**: every extraction attempt must be traceable after the
  fact — no silent failures.

## 9. Data model

### Phase 1/2 — `documents` table

| Column | Type | Notes |
|---|---|---|
| `id` | VARCHAR(36) PK | UUID v4, server-generated (`crypto.randomUUID()`), `PRIMARY KEY` prevents duplicates (`ER_DUP_ENTRY` → retry) |
| `name` | VARCHAR(255) | as uploaded (short name for `original_name`) |
| `path` | VARCHAR(500) | local path (Phase 1) or S3 key (Phase 2) — short name for `stored_path` |
| `status` | ENUM(pending, processing, done, failed) | |
| `data` | JSON, nullable | shape varies by document type — short name for `extracted_data` |
| `error` | TEXT, nullable | short name for `error_message` |
| `created_at` / `updated_at` | DATETIME | |

### Phase 3 — additional `extraction_attempts` table (future)

| Column | Type | Notes |
|---|---|---|
| `id` | VARCHAR(36) PK | UUID |
| `doc_id` | VARCHAR(36) FK → documents.id | short name for `document_id` |
| `method` | VARCHAR(50) | e.g. `regex`, `layout`, `llm` — not indexed (query by `doc_id` only) |
| `confidence` | FLOAT | 0–1 |
| `cost` | DECIMAL, nullable | short name for `cost_estimate` |
| `latency` | INT | ms — short name for `latency_ms` |
| `success` | BOOLEAN | short name for `succeeded` |
| `created_at` | DATETIME | |

Not built in the MVP — included here so the schema decision is made once,
not revisited mid-project.

## 10. High-level data flow

**Phase 1 (synchronous):**
`React frontend` → `Express API (save + call inline)` → `Extraction function (runs in-process)` → `MySQL`, with the frontend polling `GET /api/documents/:id` until status is terminal.

**Phase 2 (async):**
Same frontend and API, except the API's upload handler pushes a job onto
SQS instead of calling extraction directly. A Lambda function, triggered by
the SQS queue, performs the extraction (reusing the same logic) and writes
back to MySQL. The frontend's polling contract does not change.

## 11. Success criteria for the MVP

- A user can upload a real invoice/receipt image or PDF and see structured
  fields (vendor, date, total) appear within a reasonable time.
- The same codebase can be pointed at either the inline extraction path or
  the SQS/Lambda path via configuration, without frontend changes.
- The project has a README explaining the architecture decision (why async,
  what problem it solves) clearly enough for an interviewer to follow.

## 12. Open questions / assumptions

- Assuming personal/demo-scale traffic (not production load) for all free
  tier and performance reasoning in this document.
- Assuming the builder will implement Phase 1 and Phase 2 himself, with an
  AI assistant used for guidance/debugging rather than full code generation.
- Extraction accuracy is explicitly not a success metric for Phase 1/2 — the
  pipeline architecture is.

---

## Instructions for generating the technical specification

This PRD is the input. Using it, produce a `TECHNICAL_SPEC.md` that covers:

1. Full API contract (routes, request/response shapes, status codes) for
   both Phase 1 and Phase 2, noting exactly what changes between them.
2. Complete database schema (DDL) for the `documents` table now, and the
   `extraction_attempts` table as a documented future migration.
3. Folder/module structure for the backend and frontend consistent with the
   stack listed in section 8 (no ORM assumed — plain `mysql2` — unless the
   spec explicitly calls out a reason to add one).
4. AWS resource list for Phase 2 (S3 bucket, SQS queue, Lambda function,
   IAM role/policy requirements) with free-tier limits noted inline.
5. A phased implementation checklist matching sections 7.1–7.4 above, each
   phase independently shippable and demoable.

Do not introduce scope beyond what's listed in Goals/Non-goals (section 4/5)
without flagging it as a deviation from this PRD.
