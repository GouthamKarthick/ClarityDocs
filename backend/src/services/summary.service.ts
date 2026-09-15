import { pool } from "../db/pool.js";

export interface Summary {
  totalDocs: number;
  sumTotal: number;
  avgUsage: number;
  avgConfidence: number;
  byType: Array<{ document_type: string; cnt: number; sum: number }>;
  trend: Array<{ date: string; cnt: number; sum: number }>;
  topVendors: Array<{ vendor: string; cnt: number; sum: number }>;
}

export async function getSummary(userId: string, days = 30): Promise<Summary> {
  const [totalRows] = await pool.query(
    "SELECT COUNT(*) as cnt, COALESCE(SUM(CAST(JSON_EXTRACT(data,'$.totalAmount') AS DECIMAL(12,2))),0) as sum FROM documents WHERE user_id=? AND status='done' AND expires_at > NOW() AND created_at >= NOW() - INTERVAL ? DAY",
    [userId, days]
  );
  const total = (totalRows as Array<{ cnt: number; sum: string }>)[0];
  const [byType] = await pool.query(
    "SELECT document_type, COUNT(*) as cnt, COALESCE(SUM(CAST(JSON_EXTRACT(data,'$.totalAmount') AS DECIMAL(12,2))),0) as sum FROM documents WHERE user_id=? AND status='done' AND expires_at > NOW() AND created_at >= NOW() - INTERVAL ? DAY GROUP BY document_type",
    [userId, days]
  );
  const [trend] = await pool.query(
    "SELECT DATE(created_at) as date, COUNT(*) as cnt, COALESCE(SUM(CAST(JSON_EXTRACT(data,'$.totalAmount') AS DECIMAL(12,2))),0) as sum FROM documents WHERE user_id=? AND status='done' AND expires_at > NOW() AND created_at >= NOW() - INTERVAL ? DAY GROUP BY DATE(created_at) ORDER BY date",
    [userId, days]
  );
  const [vendors] = await pool.query(
    "SELECT JSON_UNQUOTE(JSON_EXTRACT(data,'$.vendor')) as vendor, COUNT(*) as cnt, COALESCE(SUM(CAST(JSON_EXTRACT(data,'$.totalAmount') AS DECIMAL(12,2))),0) as sum FROM documents WHERE user_id=? AND status='done' AND expires_at > NOW() AND created_at >= NOW() - INTERVAL ? DAY AND JSON_EXTRACT(data,'$.vendor') IS NOT NULL GROUP BY vendor ORDER BY cnt DESC LIMIT 5",
    [userId, days]
  );
  const [confRows] = await pool.query(
    "SELECT data FROM documents WHERE user_id=? AND status='done' AND expires_at > NOW() AND created_at >= NOW() - INTERVAL ? DAY",
    [userId, days]
  );
  // authenticity: average confidence not stored, approximate via field coverage
  let avgConfidence = 0;
  const datas = confRows as Array<{ data: string }>;
  if (datas.length) {
    let sum = 0;
    for (const r of datas) {
      try {
        const d = typeof r.data === "string" ? JSON.parse(r.data) : (r.data as unknown as Record<string, unknown>);
        const filled = ["vendor", "invoiceNumber", "invoiceDate", "totalAmount"].filter((k) => (d as Record<string, unknown>)[k] != null).length;
        sum += filled / 4;
      } catch {}
    }
    avgConfidence = sum / datas.length;
  }
  const totalDocs = Number(total?.cnt ?? 0);
  const sumTotal = Number(total?.sum ?? 0);
  return {
    totalDocs,
    sumTotal,
    avgUsage: totalDocs ? sumTotal / totalDocs : 0,
    avgConfidence,
    byType: (byType as Array<{ document_type: string; cnt: number; sum: string }>).map((r) => ({ document_type: r.document_type, cnt: Number(r.cnt), sum: Number(r.sum) })),
    trend: (trend as Array<{ date: string; cnt: number; sum: string }>).map((r) => ({ date: String(r.date).slice(0, 10), cnt: Number(r.cnt), sum: Number(r.sum) })),
    topVendors: (vendors as Array<{ vendor: string; cnt: number; sum: string }>).map((r) => ({ vendor: r.vendor, cnt: Number(r.cnt), sum: Number(r.sum) })),
  };
}
