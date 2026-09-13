import { useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { usePolling } from "../hooks/usePolling";
import { useToastContext } from "../components/ToastProvider";
import { Heading } from "../components/ui/Heading";
import { Text } from "../components/ui/Text";
import { Badge } from "../components/ui/Badge";
import { FormattedDate } from "../components/FormattedDate";
import styles from "./Detail.module.scss";

function statusVariant(status: string) {
  if (status === "done") return "success" as const;
  if (status === "failed") return "error" as const;
  if (status === "processing") return "warning" as const;
  return "neutral" as const;
}

export default function Detail() {
  const { id } = useParams<{ id: string }>();
  const { doc, error } = usePolling(id ?? null, 2000);
  const { show } = useToastContext();

  useEffect(() => {
    if (error) {
      const isNotFound = error.toLowerCase().includes("not found") || error.includes("404");
      const kind = isNotFound ? "warning" : "error";
      show(kind, error);
    }
  }, [error, show]);

  if (error) return <div className="page"><Text variant="muted" as="p">{error}</Text></div>;
  if (!doc) return <div className="page"><Text variant="muted">Loading…</Text></div>;

  return (
    <div className="page">
      <div className={styles['detail-header']}>
        <Link to="/documents" className={styles['detail-back']}>← Back to list</Link>
        <Heading level={1}>{doc.name}</Heading>
        <div className={styles['detail-meta']}>
          <Badge variant={statusVariant(doc.status)}>{doc.status}</Badge>
          <Badge variant="type">{doc.document_type}</Badge>
          <span className={styles['detail-date']}>
            <FormattedDate iso={doc.updated_at} inline />
          </span>
        </div>
      </div>

      <div className={styles['detail-card']}>
        {(doc.status === "pending" || doc.status === "processing") && (
          <Text variant="muted">Processing… polling every 2s</Text>
        )}
        {doc.error && <Text as="p" variant="small" className={styles['detail-error']}>Error: {doc.error}</Text>}
        {doc.data && (
          <pre className={styles['detail-pre']}>{JSON.stringify(doc.data, null, 2)}</pre>
        )}
        {!doc.data && doc.status === "done" && <Text variant="muted">No data extracted (low confidence).</Text>}
      </div>
    </div>
  );
}
