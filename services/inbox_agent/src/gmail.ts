import { simpleParser } from 'mailparser';

interface GmailEmail {
  id: string;
  from: string;
  subject: string;
  emailText: string;
  date: string | null;
}

interface GmailMessageSummary {
  id?: string;
}

interface GmailMessageList {
  messages?: GmailMessageSummary[];
}

interface GmailRawMessage {
  id?: string;
  raw?: string;
}

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
}

let cachedAccessToken = '';
let cachedAccessTokenExpiresAt = 0;
let cachedRefreshToken = '';

export function gmailConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN);
}

async function accessToken(): Promise<string> {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Gmail API is not configured. Add GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN in Render.');
  }

  if (
    cachedAccessToken
    && cachedRefreshToken === refreshToken
    && cachedAccessTokenExpiresAt > Date.now() + 60_000
  ) {
    return cachedAccessToken;
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!response.ok) {
    throw new Error(`Google OAuth token refresh failed (${response.status}); verify the Gmail OAuth credentials in Render.`);
  }

  const result = await response.json() as GoogleTokenResponse;
  if (!result.access_token || !Number.isFinite(result.expires_in) || !result.expires_in) {
    throw new Error('Google OAuth returned an invalid access-token response.');
  }
  cachedAccessToken = result.access_token;
  cachedRefreshToken = refreshToken;
  cachedAccessTokenExpiresAt = Date.now() + result.expires_in * 1000;
  return cachedAccessToken;
}

async function gmailRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken();
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Gmail API request failed (${response.status}); verify OAuth scopes and mailbox access.`);
  }
  return await response.json() as T;
}

export async function fetchGmailMessages(): Promise<GmailEmail[]> {
  if (!gmailConfigured()) {
    throw new Error('Gmail API is not configured. Add GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN in Render.');
  }
  const list = await gmailRequest<GmailMessageList>('messages?maxResults=50&q=in%3Ainbox&fields=messages%2Fid');
  const summaries = (list.messages || []).filter((message): message is GmailMessageSummary & { id: string } => Boolean(message.id));
  const messages = await Promise.all(summaries.map(async ({ id }): Promise<GmailEmail | null> => {
    const message = await gmailRequest<GmailRawMessage>(`messages/${encodeURIComponent(id)}?format=raw&fields=id%2Craw`);
    if (!message.raw) {
      throw new Error('Gmail returned a message without its raw content.');
    }
    const parsed = await simpleParser(Buffer.from(message.raw, 'base64url'));
    const from = parsed.from?.value?.map((address) => address.address).filter(Boolean).join(', ') || '';
    return {
      id: `gmail-${message.id || id}`,
      from,
      subject: parsed.subject || '(no subject)',
      emailText: parsed.text?.trim() || '',
      date: parsed.date?.toISOString() || null,
    };
  }));
  return messages.filter((message): message is GmailEmail => message !== null).reverse();
}

function encodeSubject(subject: string): string {
  if (/^[\x20-\x7e]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
}

export async function sendGmailMessage(to: string, subject: string, text: string): Promise<string> {
  if (!gmailConfigured()) {
    throw new Error('Gmail API is not configured. Add GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN in Render.');
  }
  const raw = [
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
  ].join('\r\n');
  const result = await gmailRequest<{ id?: string }>('messages/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: Buffer.from(raw, 'utf8').toString('base64url') }),
  });
  if (!result.id) {
    throw new Error('Gmail accepted no message ID in its send response.');
  }
  return result.id;
}
