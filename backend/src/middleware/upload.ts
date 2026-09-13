import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { config } from "../config.js";

if (!fs.existsSync(config.uploadDir)) {
  fs.mkdirSync(config.uploadDir, { recursive: true });
}

const allowedMimes = new Set(["application/pdf", "image/png", "image/jpeg", "image/jpg"]);

export const upload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, cb) {
      cb(null, config.uploadDir);
    },
    filename(_req, file, cb) {
      const id = randomUUID();
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      // embed id so controller can reuse without reparsing
      cb(null, `${id}-${safe}`);
    },
  }),
  limits: { fileSize: config.maxFileSize },
  fileFilter(_req, file, cb) {
    if (!allowedMimes.has(file.mimetype)) {
      cb(new Error(`Invalid file type. Allowed: pdf, png, jpg`));
      return;
    }
    cb(null, true);
  },
});
