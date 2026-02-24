import type { TokenManager } from './token-manager.js';

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailMessagePart {
  mimeType: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailMessagePart[];
}

interface GmailRawMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  payload: GmailMessagePart & { headers: GmailHeader[] };
  internalDate: string;
}

export interface Email {
  id: string;
  threadId: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  snippet: string;
  body: string;
  labels: string[];
}

export interface SendOptions {
  cc?: string;
  bcc?: string;
  replyToMessageId?: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
}

function getHeader(headers: GmailHeader[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function decodeBase64Url(data: string): string {
  // Gmail uses URL-safe base64 (replace - with +, _ with /)
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

function extractBody(payload: GmailMessagePart): string {
  // Simple message (no parts)
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (!payload.parts) return '';

  // Prefer text/plain
  const plainPart = findPart(payload.parts, 'text/plain');
  if (plainPart?.body?.data) {
    return decodeBase64Url(plainPart.body.data);
  }

  // Fallback to text/html, strip tags
  const htmlPart = findPart(payload.parts, 'text/html');
  if (htmlPart?.body?.data) {
    const html = decodeBase64Url(htmlPart.body.data);
    return stripHtml(html);
  }

  return '';
}

function findPart(parts: GmailMessagePart[], mimeType: string): GmailMessagePart | undefined {
  for (const part of parts) {
    if (part.mimeType === mimeType) return part;
    if (part.parts) {
      const found = findPart(part.parts, mimeType);
      if (found) return found;
    }
  }
  return undefined;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseMessage(raw: GmailRawMessage): Email {
  const headers = raw.payload.headers;
  return {
    id: raw.id,
    threadId: raw.threadId,
    from: getHeader(headers, 'From'),
    to: getHeader(headers, 'To'),
    cc: getHeader(headers, 'Cc'),
    subject: getHeader(headers, 'Subject'),
    date: getHeader(headers, 'Date'),
    snippet: raw.snippet,
    body: extractBody(raw.payload),
    labels: raw.labelIds || [],
  };
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function buildRawMessage(
  to: string,
  subject: string,
  body: string,
  from: string,
  options?: SendOptions,
): string {
  const lines: string[] = [];
  lines.push(`From: ${from}`);
  lines.push(`To: ${to}`);
  if (options?.cc) lines.push(`Cc: ${options.cc}`);
  if (options?.bcc) lines.push(`Bcc: ${options.bcc}`);
  lines.push(`Subject: ${subject}`);
  if (options?.inReplyTo) lines.push(`In-Reply-To: ${options.inReplyTo}`);
  if (options?.references) lines.push(`References: ${options.references}`);
  lines.push('Content-Type: text/plain; charset=utf-8');
  lines.push('');
  lines.push(body);
  return lines.join('\r\n');
}

export class GmailApi {
  constructor(private tokenManager: TokenManager) {}

  private async headers(): Promise<Record<string, string>> {
    const token = await this.tokenManager.getAccessToken();
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  async getProfile(): Promise<{ emailAddress: string }> {
    const resp = await fetch(`${GMAIL_BASE}/profile`, {
      headers: await this.headers(),
    });
    if (!resp.ok) throw new Error(`getProfile failed: ${resp.status} ${await resp.text()}`);
    return resp.json();
  }

  async getMessage(messageId: string): Promise<Email> {
    const resp = await fetch(`${GMAIL_BASE}/messages/${messageId}?format=full`, {
      headers: await this.headers(),
    });
    if (!resp.ok) throw new Error(`getMessage failed: ${resp.status} ${await resp.text()}`);
    const raw: GmailRawMessage = await resp.json();
    return parseMessage(raw);
  }

  async searchMessages(query: string, maxResults = 10): Promise<Email[]> {
    const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
    const resp = await fetch(`${GMAIL_BASE}/messages?${params}`, {
      headers: await this.headers(),
    });
    if (!resp.ok) throw new Error(`searchMessages failed: ${resp.status} ${await resp.text()}`);
    const data = await resp.json();
    const messageIds: Array<{ id: string }> = data.messages || [];

    // Fetch each message in parallel
    const emails = await Promise.all(
      messageIds.map((m) => this.getMessage(m.id)),
    );
    return emails;
  }

  async getThread(threadId: string): Promise<Email[]> {
    const resp = await fetch(`${GMAIL_BASE}/threads/${threadId}?format=full`, {
      headers: await this.headers(),
    });
    if (!resp.ok) throw new Error(`getThread failed: ${resp.status} ${await resp.text()}`);
    const data = await resp.json();
    return (data.messages || []).map((m: GmailRawMessage) => parseMessage(m));
  }

  async sendMessage(to: string, subject: string, body: string, options?: SendOptions): Promise<Email> {
    const profile = await this.getProfile();
    const raw = buildRawMessage(to, subject, body, profile.emailAddress, options);
    const payload: Record<string, unknown> = { raw: base64UrlEncode(raw) };
    if (options?.threadId) payload.threadId = options.threadId;

    const resp = await fetch(`${GMAIL_BASE}/messages/send`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify(payload),
    });
    if (!resp.ok) throw new Error(`sendMessage failed: ${resp.status} ${await resp.text()}`);
    const sent = await resp.json();
    return this.getMessage(sent.id);
  }

  async createDraft(to: string, subject: string, body: string, options?: SendOptions): Promise<{ draftId: string; message: Email }> {
    const profile = await this.getProfile();
    const raw = buildRawMessage(to, subject, body, profile.emailAddress, options);
    const payload: Record<string, unknown> = {
      message: { raw: base64UrlEncode(raw) },
    };
    if (options?.threadId) {
      (payload.message as Record<string, unknown>).threadId = options.threadId;
    }

    const resp = await fetch(`${GMAIL_BASE}/drafts`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify(payload),
    });
    if (!resp.ok) throw new Error(`createDraft failed: ${resp.status} ${await resp.text()}`);
    const draft = await resp.json();
    const message = await this.getMessage(draft.message.id);
    return { draftId: draft.id, message };
  }
}
