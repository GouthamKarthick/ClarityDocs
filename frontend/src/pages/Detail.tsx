import { useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { usePolling } from "../hooks/usePolling";
import { useToastContext } from "../context/ToastContext";
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
      const isNotFound =
        error.toLowerCase().includes("not found") || error.includes("404");
      const kind = isNotFound ? "warning" : "error";
      show(kind, error);
    }
  }, [error, show]);

  if (error)
    return (
      <div className="page">
        <Text variant="muted" as="p">
          {error}
        </Text>
      </div>
    );
  if (!doc)
    return (
      <div className="page">
        <Text variant="muted">Loading…</Text>
      </div>
    );

  return (
    <div className="page">
      <div className={styles["detail-header"]}>
        <Link to="/documents" className={styles["detail-back"]}>
          ← Back to list
        </Link>
        <Heading level={1}>{doc.name}</Heading>
        <div className={styles["detail-meta"]}>
          <Badge variant={statusVariant(doc.status)}>{doc.status}</Badge>
          <Badge variant="type">{doc.document_type}</Badge>
          <span className={styles["detail-date"]}>
            <FormattedDate iso={doc.updated_at} inline />
          </span>
        </div>
      </div>

      <div className={styles["detail-card"]}>
        {(doc.status === "pending" || doc.status === "processing") && (
          <Text variant="muted">Processing… polling every 2s</Text>
        )}
        {doc.error && (
          <Text as="p" variant="small" className={styles["detail-error"]}>
            Error: {doc.error}
          </Text>
        )}
        {doc.data && (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
              marginTop: 8,
            }}
          >
            <thead>
              <tr style={{ background: "#f1f5f9" }}>
                <th
                  style={{
                    textAlign: "left",
                    padding: "8px 10px",
                    borderBottom: "1px solid #e5e7eb",
                    fontSize: 12,
                    textTransform: "uppercase",
                    color: "#6b7280",
                  }}
                >
                  Field
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: "8px 10px",
                    borderBottom: "1px solid #e5e7eb",
                    fontSize: 12,
                    textTransform: "uppercase",
                    color: "#6b7280",
                  }}
                >
                  Value
                </th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(doc.data).map(([k, v]) => (
                <tr key={k}>
                  <td
                    style={{
                      padding: "8px 10px",
                      borderBottom: "1px solid #e5e7eb",
                      fontWeight: 600,
                      textTransform: "capitalize",
                    }}
                  >
                    {k.replace(/([A-Z])/g, " $1")}
                  </td>
                  <td
                    style={{
                      padding: "8px 10px",
                      borderBottom: "1px solid #e5e7eb",
                    }}
                  >
                    {v == null ? "—" : String(v)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!doc.data && doc.status === "done" && (
          <Text variant="muted">No data extracted (low confidence).</Text>
        )}
      </div>
    </div>
  );
}
