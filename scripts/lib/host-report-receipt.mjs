import { createHash } from 'node:crypto';

export function visibleReportText(report) {
  return `Что сделал: ${report.did}\nЗачем: ${report.why}\nРезультат: ${report.result}`;
}

export function normalizedVisibleText(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').trim();
}

export function visibleTextSha256(text) {
  return createHash('sha256').update(normalizedVisibleText(text), 'utf8').digest('hex');
}

export function hostAckForReport(report, env = process.env) {
  if (env.COS_ASSISTANT_RECEIPT_VERSION !== '1') return undefined;
  if (!report || typeof report !== 'object') return undefined;
  const messageId = typeof env.COS_ASSISTANT_MESSAGE_ID === 'string' ? env.COS_ASSISTANT_MESSAGE_ID.trim() : '';
  const sha256 = typeof env.COS_ASSISTANT_MESSAGE_SHA256 === 'string' ? env.COS_ASSISTANT_MESSAGE_SHA256.trim().toLowerCase() : '';
  const deliveredAt = typeof env.COS_ASSISTANT_DELIVERED_AT === 'string' ? env.COS_ASSISTANT_DELIVERED_AT.trim() : '';
  const turnId = typeof env.COS_ASSISTANT_TURN_ID === 'string' ? env.COS_ASSISTANT_TURN_ID.trim() : '';
  if (!messageId || !/^[0-9a-f]{64}$/i.test(sha256) || !Number.isFinite(Date.parse(deliveredAt))) return undefined;
  if (visibleTextSha256(visibleReportText(report)) !== sha256) return undefined;
  return {
    source: 'chat_on_steroids',
    message_id: messageId,
    delivered_at: new Date(deliveredAt).toISOString(),
    text_sha256: sha256,
    ...(turnId ? { turn_id: turnId } : {}),
  };
}
