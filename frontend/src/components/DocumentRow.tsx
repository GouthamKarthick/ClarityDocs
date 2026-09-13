import { Link } from "react-router-dom";
import type { Document } from "../types";
import { Badge } from "./ui/Badge";
import { FormattedDate } from "./FormattedDate";
import styles from "./DocumentRow.module.scss";

interface Props {
  doc: Document;
}

function statusVariant(status: Document["status"]) {
  switch (status) {
    case "done": return "success" as const;
    case "failed": return "error" as const;
    case "processing": return "warning" as const;
    default: return "neutral" as const;
  }
}

export function DocumentRow({ doc }: Props) {
  return (
    <Link to={`/documents/${doc.id}`} className={styles['document-row']} aria-label={`Open ${doc.name}`}>
      <div className={styles['document-row-main']}>
        <span className={styles['document-row-name']} title={doc.name}>{doc.name}</span>
        <span className={styles['document-row-meta']}>
          <Badge variant="type">{doc.document_type}</Badge>
          <Badge variant={statusVariant(doc.status)}>{doc.status}</Badge>
        </span>
      </div>
      <div className={styles['document-row-date-col']}>
        <FormattedDate iso={doc.created_at} />
      </div>
      <span className={styles['document-row-chevron']} aria-hidden>›</span>
    </Link>
  );
}
