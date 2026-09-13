import { Router } from "express";
import { upload } from "../middleware/upload.js";
import { validatePagination } from "../middleware/validate.js";
import { uploadDocument, listDocuments, getDocument } from "../controllers/documents.controller.js";

const router = Router();

router.post("/documents/upload", upload.single("file"), uploadDocument);
router.get("/documents", validatePagination, listDocuments);
router.get("/documents/:id", getDocument);

export default router;
