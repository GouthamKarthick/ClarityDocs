import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { pool } from "../db/pool.js";
import { config } from "../config.js";
import { logger } from "../config/logger.js";
import { extract } from "../services/extraction.service.js";
import { findDuplicateByContent } from "../services/dedup.service.js";
import { enqueue } from "../services/queue.service.js";
import { uuidSchema } from "../middleware/validate.js";

function parseDataField(row: { data: string | null }) {
  if (!row.data) return null;
  try {
    return typeof row.data === "string" ? JSON.parse(row.data) : row.data;
  } catch {
    return null;
  }
}

export async function uploadDocument(req: Request, res: Response, next: NextFunction) {
  try {
    const file = (req as unknown as { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ error: "No file uploaded. Field name must be 'file'." });
      return;
    }

    // filename is <uuid>-<safeName> from multer storage
    const basename = file.filename; // e.g. uuid-original.pdf
    const idFromFile = basename.split("-")[0] ?? "";
    // validate it's a uuid; fallback to new uuid if parsing fails
    const id = (() => {
      try {
        uuidSchema.parse(idFromFile);
        return idFromFile;
      } catch {
        return randomUUID();
      }
    })();

    const filePath = file.path; // e.g. ./uploads/<uuid>-name

    // Insert pending (document_type defaults to 'unknown', set properly after extraction)
    try {
      await pool.query(
        "INSERT INTO documents (id, name, path, status, document_type) VALUES (?, ?, ?, 'pending', 'unknown')",
        [id, file.originalname, filePath]
      );
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === "ER_DUP_ENTRY") {
        const newId = randomUUID();
        await pool.query("INSERT INTO documents (id, name, path, status, document_type) VALUES (?, ?, ?, 'pending', 'unknown')", [
          newId,
          file.originalname,
          filePath,
        ]);
        // use newId for remainder
        if (config.extractionMode === "queue") {
          // Phase2 path: would use s3Key, not filePath
          await enqueue({ docId: newId, s3Key: filePath });
          res.status(201).json({ id: newId, name: file.originalname, status: "pending", created_at: new Date().toISOString() });
          return;
        }
        await pool.query("UPDATE documents SET status='processing' WHERE id=?", [newId]);
        try {
          const result = await extract(filePath);
          const dup2 = await findDuplicateByContent(result.data);
          if (dup2.duplicate) {
            await pool.query("UPDATE documents SET status='done', document_type=?, data=?, error=NULL WHERE id=?", [
              result.documentType,
              JSON.stringify(result.data),
              newId,
            ]);
            res.status(409).json({
              error: "Duplicate invoice content",
              code: "DUPLICATE_CONTENT",
              duplicateOf: dup2.duplicateOf,
              document_type: result.documentType,
              data: result.data,
            });
            return;
          }
          await pool.query("UPDATE documents SET status='done', document_type=?, data=?, error=NULL WHERE id=?", [
            result.documentType,
            JSON.stringify(result.data),
            newId,
          ]);
        } catch (err) {
          await pool.query("UPDATE documents SET status='failed', error=? WHERE id=?", [
            (err as Error).message,
            newId,
          ]);
        }
        const [rows] = await pool.query("SELECT created_at FROM documents WHERE id=?", [newId]);
        const created_at = (rows as Array<{ created_at: string }>)[0]?.created_at ?? new Date().toISOString();
        res.status(201).json({ id: newId, name: file.originalname, status: "pending", created_at });
        return;
      }
      throw e;
    }

    const [createdRows] = await pool.query("SELECT created_at FROM documents WHERE id=?", [id]);
    const created_at = (createdRows as Array<{ created_at: string }>)[0]?.created_at ?? new Date().toISOString();
    logger.info("Document uploaded", { docId: id, name: file.originalname, path: filePath });

    if (config.extractionMode === "queue") {
      // Phase2 async
      await pool.query("UPDATE documents SET status='pending' WHERE id=?", [id]);
      // In Phase2 real impl, path would be S3 key; here we enqueue filePath as placeholder
      await enqueue({ docId: id, s3Key: filePath });
      res.status(201).json({ id, name: file.originalname, status: "pending", created_at });
      return;
    }

    // Phase1 inline extraction
    await pool.query("UPDATE documents SET status='processing' WHERE id=?", [id]);
    logger.info("Extraction started", { docId: id, mode: config.extractionMode });
    try {
      const result = await extract(filePath);
      // Content duplicate check: 4 fields similar (invoice_number, vendor, totalAmount, currency) all non-null
      const dup = await findDuplicateByContent(result.data);
      if (dup.duplicate) {
        await pool.query("UPDATE documents SET status='done', document_type=?, data=?, error=NULL WHERE id=?", [
          result.documentType,
          JSON.stringify(result.data),
          id,
        ]);
        logger.warn("Duplicate content detected", { docId: id, duplicateOf: dup.duplicateOf, data: result.data });
        res.status(409).json({
          error: "Duplicate invoice content",
          code: "DUPLICATE_CONTENT",
          duplicateOf: dup.duplicateOf,
          document_type: result.documentType,
          data: result.data,
        });
        return;
      }
      await pool.query("UPDATE documents SET status='done', document_type=?, data=?, error=NULL WHERE id=?", [
        result.documentType,
        JSON.stringify(result.data),
        id,
      ]);
      logger.info("Extraction done", {
        docId: id,
        method: result.method,
        confidence: result.confidence,
        documentType: result.documentType,
        documentTypeConfidence: result.documentTypeConfidence,
        data: result.data,
      });
    } catch (err) {
      await pool.query("UPDATE documents SET status='failed', error=? WHERE id=?", [
        (err as Error).message,
        id,
      ]);
      logger.error("Extraction failed", { docId: id, error: (err as Error).message, stack: (err as Error).stack });
    }

    res.status(201).json({ id, name: file.originalname, status: "pending", created_at });
  } catch (err) {
    logger.error("Upload failed", { error: (err as Error).message, stack: (err as Error).stack });
    next(err);
  }
}

export async function listDocuments(req: Request, res: Response, next: NextFunction) {
  try {
    const pagination = (req as unknown as Record<string, unknown>)._pagination as
      | { limit: number; offset: number; q?: string; document_type?: string }
      | undefined;
    const limit = pagination?.limit ?? Number(req.query.limit ?? 20);
    const offset = pagination?.offset ?? Number(req.query.offset ?? 0);
    const q = pagination?.q?.trim() || undefined;
    const docType = pagination?.document_type || undefined;

    const where: string[] = [];
    const params: unknown[] = [];
    if (q) {
      where.push("name LIKE ?");
      // escape % and _ for LIKE, wrap with % for contains search
      const escaped = q.replace(/[%_\\]/g, "\\$&");
      params.push(`%${escaped}%`);
    }
    if (docType) {
      where.push("document_type = ?");
      params.push(docType);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [totalRows] = await pool.query(`SELECT COUNT(*) as cnt FROM documents ${whereSql}`, params);
    const total = (totalRows as Array<{ cnt: number }>)[0]?.cnt ?? 0;
    const [rows] = await pool.query(
      `SELECT id, name, path, status, document_type, data, error, created_at, updated_at FROM documents ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const documents = (rows as Array<Record<string, unknown>>).map((r) => ({
      ...r,
      data: parseDataField(r as { data: string | null }),
    }));
    res.json({ documents, total, limit, offset });
  } catch (err) {
    next(err);
  }
}

export async function getDocument(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id;
    const parsed = uuidSchema.safeParse(id);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid document id" });
      return;
    }
    const [rows] = await pool.query(
      "SELECT id, name, path, status, document_type, data, error, created_at, updated_at FROM documents WHERE id=?",
      [id]
    );
    const row = (rows as Array<Record<string, unknown>>)[0];
    if (!row) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    res.json({ ...row, data: parseDataField(row as { data: string | null }) });
  } catch (err) {
    next(err);
  }
}
