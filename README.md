# ClarityDocs

Tiered document intelligence pipeline — invoices/receipts → structured data with observability.

## Stack
- Backend: Node 20 + Express (ESM `type:module`, `NodeNext`) + `mysql2` (no ORM) + `pdf-parse` (Phase1) — `backend/src/lambda/handler.ts` + `backend/src/worker.ts` + `backend/infra/localstack-init.sh` (consolidated from root `lambda/` `infra/`, root deleted)
- Frontend: React 18 + Vite + TypeScript (SPA)
- DB: MySQL 8 (Phase 2 hybrid keeps local `mysql:8`; RDS `t3.micro` → Phase 3)
- Phase2 hybrid: S3 + SQS real (DB local) — `EXTRACTION_MODE=queue` `S3_BUCKET` `SQS_QUEUE_URL` — file → `s3://bucket/key` persistent, row → `documents` local `mysql_data` (Phase 3 moves row to RDS)

See `TECHNICAL_SPEC.md` for API contract, DDL, and phased checklist. PRD at `ClarityDocs-PRD.md`. Data saved in cloud (Phase 2 hybrid): bytes → `S3` `s3://bucket/<uuid>-name` (vs ephemeral `./uploads`), meta → `documents` `data JSON document_type` in `mysql:8` (`RDS` in Phase 3) — app on `ECS/EC2` must set `S3_BUCKET/SQS_QUEUE_URL/RDS DB_HOST`.

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

Phase1 extracts inline so the API contract (`POST /upload` → 201 pending, `GET :id` polling) is proven end-to-end with minimal moving parts. Phase2 hybrid swaps the inline call for SQS + S3 behind the same interface (`storage`/`queue` adapters, `backend/src/lambda/handler.ts` reused, `EXTRACTION_MODE` flag) — frontend does not change, demonstrating a distributed evolution without reshaping the data model (`documents` table `path` abstracts local `s3://` vs `RDS` in Phase 3).

**Phase 2 hybrid vs Phase 3 with RDS:** Phase 2 uses real `S3+SQS` but `DB_HOST=localhost` (`docker-compose mysql:8`) — files persistent, rows local. Phase 3 provisions `RDS MySQL t3.micro` + deploys `backend/dist/lambda/handler.js` as `claritydocs-worker` `nodejs20.x` to AWS, making both layers cloud-persistent.
