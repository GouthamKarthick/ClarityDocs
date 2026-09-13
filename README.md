# ClarityDocs

Tiered document intelligence pipeline — invoices/receipts → structured data with observability.

## Stack
- Backend: Node 20 + Express (ESM `type:module`, `NodeNext`) + `mysql2` (no ORM) + `pdf-parse` (Phase1)
- Frontend: React 18 + Vite + TypeScript (SPA)
- DB: MySQL 8
- Phase2: S3 + SQS + Lambda (same extraction logic, `EXTRACTION_MODE=queue`)

See `TECHNICAL_SPEC.md` for API contract, DDL, and phased checklist. PRD at `ClarityDocs-PRD.md`.

## Quick start (Phase1 sync)

```bash
cp backend/.env.example backend/.env  # edit DB_* if needed
docker compose up -d mysql   # or run MySQL locally
cd backend && npm install && npm run dev   # http://localhost:4000
cd frontend && npm install && npm run dev  # http://localhost:5173 (proxies /api to :4000)
```

Test:
```bash
curl -F file=@invoice.pdf http://localhost:4000/api/documents/upload
curl http://localhost:4000/api/documents
curl http://localhost:4000/api/documents/<id>  # poll until done|failed
```

## Why sync → async (interview note)

Phase1 extracts inline so the API contract (`POST /upload` → 201 pending, `GET :id` polling) is proven end-to-end with minimal moving parts. Phase2 swaps the inline call for SQS + Lambda behind the same interface (`storage`/`queue` adapters, `EXTRACTION_MODE` flag) — frontend does not change, demonstrating a distributed evolution without reshaping the data model (`documents` table `path` abstracts local vs S3).
