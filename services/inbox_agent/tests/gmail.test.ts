import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchGmailMessages, gmailConfigured, sendGmailMessage } from '../src/gmail.js';

const gmailEnvironment = {
  GMAIL_CLIENT_ID: 'client-id-test',
  GMAIL_CLIENT_SECRET: 'client-secret-test',
  GMAIL_REFRESH_TOKEN: 'refresh-token-test',
};

function gmailRawMessage(): string {
  const raw = [
    'From: Customer <customer@example.com>',
    'Subject: Help with my account',
    'Date: Tue, 20 Oct 2026 08:00:00 +0000',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    'Please help me update my account settings.',
  ].join('\r\n');
  return Buffer.from(raw, 'utf8').toString('base64url');
}

test('Gmail API configuration requires the OAuth client and refresh token', () => {
  assert.equal(gmailConfigured(gmailEnvironment), true);
  assert.equal(gmailConfigured({ ...gmailEnvironment, GMAIL_REFRESH_TOKEN: '' }), false);
});

test('fetchGmailMessages refreshes OAuth and parses the newest inbox message', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvironment = {
    GMAIL_CLIENT_ID: process.env.GMAIL_CLIENT_ID,
    GMAIL_CLIENT_SECRET: process.env.GMAIL_CLIENT_SECRET,
    GMAIL_REFRESH_TOKEN: process.env.GMAIL_REFRESH_TOKEN,
  };
  Object.assign(process.env, gmailEnvironment);
  const requests: Array<{ url: string; authorization?: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const authorization = new Headers(init?.headers).get('Authorization') || undefined;
    requests.push({ url, authorization });
    if (url === 'https://oauth2.googleapis.com/token') {
      assert.equal(new URLSearchParams(String(init?.body)).get('grant_type'), 'refresh_token');
      return Response.json({ access_token: 'access-token-test', expires_in: 3600 });
    }
    if (url.includes('/messages?')) {
      return Response.json({ messages: [{ id: 'message-1' }] });
    }
    if (url.includes('/messages/message-1?')) {
      return Response.json({ id: 'message-1', raw: gmailRawMessage() });
    }
    throw new Error(`Unexpected test request: ${url}`);
  };

  try {
    const messages = await fetchGmailMessages();
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0], {
      id: 'gmail-message-1',
      from: 'customer@example.com',
      subject: 'Help with my account',
      emailText: 'Please help me update my account settings.',
      date: '2026-10-20T08:00:00.000Z',
    });
    assert.equal(requests[1].authorization, 'Bearer access-token-test');
    assert.equal(requests[2].authorization, 'Bearer access-token-test');
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('sendGmailMessage posts a base64url MIME message via Gmail API', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvironment = {
    GMAIL_CLIENT_ID: process.env.GMAIL_CLIENT_ID,
    GMAIL_CLIENT_SECRET: process.env.GMAIL_CLIENT_SECRET,
    GMAIL_REFRESH_TOKEN: process.env.GMAIL_REFRESH_TOKEN,
  };
  Object.assign(process.env, gmailEnvironment);
  let sentRaw = '';
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === 'https://oauth2.googleapis.com/token') {
      return Response.json({ access_token: 'send-token-test', expires_in: 3600 });
    }
    assert.equal(url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    const body = JSON.parse(String(init?.body)) as { raw: string };
    sentRaw = Buffer.from(body.raw, 'base64url').toString('utf8');
    return Response.json({ id: 'sent-message-1' });
  };

  try {
    const messageId = await sendGmailMessage(
      'customer@example.com',
      'Re: Account support',
      'Thanks for reaching out.',
    );
    assert.equal(messageId, 'sent-message-1');
    assert.match(sentRaw, /To: customer@example\.com/);
    assert.match(sentRaw, /Subject: Re: Account support/);
    assert.match(sentRaw, /Thanks for reaching out\./);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
