import { config } from "../config.js";

// Phase1: no-op. Phase2: replace with SQS sendMessage.
export async function enqueue(job: { docId: string; s3Key: string }): Promise<void> {
  if (config.extractionMode !== "queue") return;
  if (!config.sqsQueueUrl) throw new Error("SQS_QUEUE_URL not configured");
  // Lazy import to avoid aws-sdk dep in Phase1
  // @ts-ignore - optional dep only for Phase2
  const mod: any = await import("@aws-sdk/client-sqs").catch(() => null);
  if (!mod) throw new Error("AWS SDK not installed. Run npm i @aws-sdk/client-sqs for queue mode.");
  const { SQSClient, SendMessageCommand } = mod;
  const client = new SQSClient({ region: config.awsRegion });
  await client.send(
    new SendMessageCommand({
      QueueUrl: config.sqsQueueUrl,
      MessageBody: JSON.stringify(job),
    })
  );
}
