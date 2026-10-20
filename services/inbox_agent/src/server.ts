import { createServer, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { LearningStore, normalizedReply, qualification } from './learning.js';

const PORT = Number(process.env.PORT || 3001);
const KNOWLEDGE_BASE_URL = (process.env.KNOWLEDGE_BRAIN_URL || 'http://127.0.0.1:8001').replace(/\/$/, '');
const KNOWLEDGE_URL = `${KNOWLEDGE_BASE_URL}/chat`;
const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
const LEARNING_PATH = join(DATA_DIR, 'learning.json');
const MAX_BODY_BYTES = 1024 * 1024;
const SERVICE_API_TOKEN = process.env.SERVICE_API_TOKEN || '';

interface MailboxEmail {
  id: string;
  from: string;
  subject: string;
  emailText: string;
  date: string | null;
}

const SAMPLE_EMAILS = [
  'Hi team, our website search is returning irrelevant listings for the word "design" and it feels unhelpful. Can you help us improve the search or filter defaults?',
  'We need a refund for a canceled subscription because the site was down for a day and we did not use the service. Please help us with the billing issue.',
  'Could you update the homepage hero section and add a pricing section to match our new branding? We are looking for a quicker redesign without custom code.',
  'Our members cannot log in to their accounts after resetting their passwords. Could you clarify the steps or fix the issue?',
  'We need a quote for a CRM integration to sync new lead submissions with our external sales system. Should this be a custom project or a built-in integration?',
  'The current site is confusing for first-time visitors. Can you suggest the simplest way to improve layout and navigation using the built-in tools?',
  'We received an invoice for an extra seat after a team member left. Please review whether this was a mistake and advise if it is eligible for correction.',
  'Our clients want better sorting options on the directory, especially by city and category, without needing any custom coding.',
  'We need to cancel our package because our business has slowed down, but we want to understand the final invoice and any prorated charges.',
  'The site search is ignoring location filters, so people cannot narrow results by state. Can this be fixed with settings?',
  'Can we add a new homepage banner and remove outdated sections while keeping the brand colors consistent?',
  'Our team is looking for a way to route leads into a spreadsheet automatically after someone fills out the contact form.',
  'We had a very slow response time when contacting support. Could you help us understand if there is a refund policy for downtime?',
  'The login page shows an error when a member tries to use a password that was just reset; can we avoid this issue with a configuration change?',
  'We are planning a new design refresh for the directory and want to know which customizations are supported out of the box.',
  'Please tell us the difference between a settings-based tweak and a custom project estimate for search ranking improvements.',
  'We have a customer account that keeps showing the wrong plan status. Please help us check whether this is a product setting or a billing issue.',
  'Our company wants a simple proposal for a home page redesign and a better member experience, but we are unsure which parts are custom work.',
  'Can the product support an event booking form with a custom workflow for approvals? We need to know if a connector or custom build is needed.',
  'Our support team is overwhelmed with repetitive pricing questions. Could you help draft an answer based on the latest help center guidance?',
  'We want to add a membership form and improve the pricing cards on the homepage without creating a custom site build.',
  'We need to understand what is included when a client requests a quote. Can you help us produce a professional proposal response?',
  'Our existing page layout is cluttered. Can we solve this with page sections, module ordering, and a cleaner design without custom code?',
  'New customers are unsure how to update the contact settings after signing up. What is the recommended workflow for account changes?',
  'We have been asked to add a team directory but want to know whether the product already supports this with existing settings.',
  'A client is complaining that the directory is showing duplicate results. We need to know whether the bug can be solved from search settings or whether it requires a custom tune-up.',
  'We are reviewing our renewal terms and need to know whether auto-renewal can be disabled or whether an account manager must be involved.',
  'Our sales team wants to send a new lead automatically into CRM when a form is submitted. We need a recommendation on the best path.',
  'We are collecting feature requests from members. Can you draft a reply explaining the difference between a quick settings change and a custom development task?',
  'Can we create a better homepage navigation menu using the built-in builder so that new customers find pricing pages quickly?',
  'We need to understand how a cancellation is processed and what happens with billing for the current month before we send a reply to the client.',
  'The search bar is missing a category filter. Can we enable that without needing a custom site build?',
  'A prospect wants a proposal for a redesign and an improved search experience. We need a clear estimate and a scope of work.',
  'Our client wants to know whether they can change branding, fonts, and hero layout on their own. Can you draft a response with the product guidance?',
  'We are seeing duplicate member sign-up records and need advice on whether account settings, login rules, or custom code are responsible.',
  'A customer asks for a refund because they never used the service. Can we suggest next steps based on the current policy?',
  'We want to connect the site to an external email platform but think the product may already support it via a built-in integration.',
  'Could you help us compose a reply acknowledging the request and explaining that many changes can be handled using settings and templates?',
  'This request is about custom design changes and a proposal. We need to know the best path to avoid unnecessary development work.',
  'Our team needs a reliable answer on how to update filters, sort order, and homepage sections without custom coding.',
  'We want to know whether the platform supports a member account dashboard with custom links and access roles using standard settings.',
  'The client is asking for a search ranking overhaul. Can we explain which part is a setting and which part is a custom project?',
  'We are reviewing a cancellation request and need a helpful response that clarifies the remaining charge and the refund review process.',
  'A member cannot access their account after a password reset. What would a proper support response say for troubleshooting?',
  'Can the product support connected services for CRM and payment reminders? We need guidance on integration scope.',
  'We need a short reply that tells the client that the product offers built-in design adjustments and standard integrations, while large custom requests require a quote.',
  'The website needs a search improvement but not a complete redesign. How should we respond and what should we recommend?',
  'We need help creating a support response for a billing question about plan cancellation and pending charges.',
  'Can you draft a first reply for a customer asking about new website sections, improved search, and whether the request should be scoped as a custom project?',
  'The client wants to know if custom login rules or new member workflows can be built into the product without a custom track.',
  'We need a clear answer on whether pricing and billing questions should be escalated to support or handled with an automated email response.',
  'A customer asks to change the layout and search filters on their site. Please suggest a response that mentions built-in features and optional custom work.',
  'We need to send a polite reply saying we can review the issue, check account details, and escalate only when the request is not covered by the current knowledge base.',
  'The client wants a quote for a homepage makeover, improved directory search, and a custom integration. Can you help us draft a response that separates built-in from custom work?',
  'A new lead wants to know if their request fits existing product settings or whether they need a custom budget. Please draft a response to help them understand.',
  'We are expecting recurring questions about billing, custom design, and support escalation; can your agent help us keep the tone clear and response-ready?'
];

function ensureLearningStore(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!existsSync(LEARNING_PATH)) {
    const initialData: LearningStore = { history: [] };
    writeFileSync(LEARNING_PATH, JSON.stringify(initialData, null, 2));
  }
}

function readLearningStore(): LearningStore {
  ensureLearningStore();
  const raw = readFileSync(LEARNING_PATH, 'utf-8');
  return JSON.parse(raw) as LearningStore;
}

function writeLearningStore(data: LearningStore): void {
  const temporaryPath = `${LEARNING_PATH}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(data, null, 2));
  renameSync(temporaryPath, LEARNING_PATH);
}

function classifyEmail(emailText: string): string {
  const lower = emailText.toLowerCase();
  if (/(legal|lawsuit|attorney|gdpr|privacy breach)/.test(lower)) return 'legal';
  if (/(security|hacked|breach|compromis|suspicious login)/.test(lower)) return 'security';
  if (/(complaint|unhappy|upset|poor service|very disappointed)/.test(lower)) return 'complaint';
  if (/(refund|cancel|billing|invoice|charge|renew)/.test(lower)) return 'billing';
  if (/(design|layout|homepage|branding|hero|logo|theme)/.test(lower)) return 'design';
  if (/(search|filter|directory|ranking|listing)/.test(lower)) return 'search';
  if (/(login|member|account|password|access)/.test(lower)) return 'member';
  if (/(integrat|crm|email|automation|lead|sync)/.test(lower)) return 'integration';
  if (/(proposal|quote|scope|estimate|custom)/.test(lower)) return 'proposal';
  return 'support';
}

async function getKnowledgeInsight(emailText: string): Promise<Record<string, any>> {
  const response = await fetch(KNOWLEDGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(SERVICE_API_TOKEN ? { Authorization: `Bearer ${SERVICE_API_TOKEN}` } : {}),
    },
    body: JSON.stringify({ question: emailText, top_k: 3, generate_answer: false }),
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Knowledge Brain request failed (${response.status}): ${details}`);
  }
  return await response.json();
}

async function getKnowledgeHealth(): Promise<{ available: boolean; modelConfigured: boolean; error?: string }> {
  try {
    const response = await fetch(`${KNOWLEDGE_BASE_URL}/health`);
    if (!response.ok) {
      const details = await response.text();
      return { available: false, modelConfigured: false, error: `Knowledge Brain health request failed (${response.status}): ${details}` };
    }
    const health = await response.json() as { ai_model_configured?: boolean };
    return { available: true, modelConfigured: health.ai_model_configured === true };
  } catch (error) {
    return {
      available: false,
      modelConfigured: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function isKnowledgeModelConfigured(): Promise<boolean> {
  const health = await getKnowledgeHealth();
  if (!health.available) throw new Error(health.error || 'Knowledge Brain health check failed.');
  return health.modelConfigured;
}

async function fetchMailboxMessages(): Promise<MailboxEmail[]> {
  const host = process.env.IMAP_HOST;
  const user = process.env.IMAP_USER;
  const password = process.env.IMAP_PASSWORD;
  if (!host || !user || !password) {
    throw new Error('IMAP is not configured. Set IMAP_HOST, IMAP_USER, and IMAP_PASSWORD in .env.');
  }
  const client = new ImapFlow({
    host,
    port: Number(process.env.IMAP_PORT || 993),
    secure: process.env.IMAP_SECURE !== 'false',
    auth: { user, pass: password },
    logger: false,
  });
  await client.connect();
  try {
    const lock = await client.getMailboxLock(process.env.IMAP_MAILBOX || 'INBOX');
    try {
      const uids = await client.search({ all: true }, { uid: true });
      if (!Array.isArray(uids)) throw new Error('Mailbox search did not return a valid UID list.');
      const messages: MailboxEmail[] = [];
      const latestUids = uids.slice(-50);
      for await (const message of client.fetch(latestUids, { uid: true, source: true, envelope: true }, { uid: true })) {
        if (!message.source) continue;
        const parsed = await simpleParser(message.source);
        const from = parsed.from?.value?.map((address) => address.address).filter(Boolean).join(', ') || '';
        messages.push({
          id: `imap-${message.uid}`,
          from,
          subject: parsed.subject || message.envelope?.subject || '(no subject)',
          emailText: parsed.text?.trim() || '',
          date: parsed.date?.toISOString() || message.envelope?.date?.toISOString() || null,
        });
      }
      return messages.reverse();
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

function emailTransport() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    throw new Error('SMTP is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASSWORD in .env.');
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  });
}

function validEmail(value: string): boolean {
  return value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function buildDraftReply(type: string, emailText: string, knowledgeInsight: any): string {
  const answer = knowledgeInsight.answer || 'We reviewed the product guidance and recommend a standard solution first.';
  const subject = {
    billing: 'Billing and refund review',
    design: 'Design update guidance',
    search: 'Search and filter improvements',
    member: 'Member access follow-up',
    integration: 'Integration planning guidance',
    proposal: 'Project scoping and proposal guidance',
    support: 'Support follow-up',
  }[type] || 'Customer follow-up';

  return `Subject: ${subject}\n\nHi there,\n\nThank you for reaching out. Based on the current product guidance, the best first step is to check whether this can be solved using the built-in settings before moving into custom work.\n\nKey guidance: ${answer}\n\nWe recommend confirming the exact requirement, then reviewing whether the request fits an existing setting, a template update, or a custom estimate. If there are account-specific details, we can escalate to a human expert for a final review.\n\nBest,\nAI Tech Consultant Inbox Agent`;
}

async function readBody(req: AsyncIterable<Uint8Array>): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES) throw new Error('Request body exceeds 1 MB');
    chunks.push(buffer);
  }
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Request body must be a JSON object');
  return body as Record<string, unknown>;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(payload));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (SERVICE_API_TOKEN && url.pathname !== '/health') {
    const [scheme, supplied = ''] = (req.headers.authorization || '').split(' ', 2);
    const expected = Buffer.from(SERVICE_API_TOKEN);
    const provided = Buffer.from(supplied);
    if (scheme.toLowerCase() !== 'bearer' || expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      sendJson(res, 401, { error: 'A valid bearer token is required.' });
      return;
    }
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    const knowledge = await getKnowledgeHealth();
    sendJson(res, 200, {
      status: 'ok',
      service: 'inbox-agent',
      sampleEmailCount: SAMPLE_EMAILS.length,
      aiModelConfigured: knowledge.modelConfigured,
      knowledgeBrainAvailable: knowledge.available,
      ...(knowledge.error ? { knowledgeBrainError: knowledge.error } : {}),
      smtpConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD),
      mailboxConfigured: Boolean(process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASSWORD),
      serviceTokenConfigured: Boolean(process.env.SERVICE_API_TOKEN),
    });
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/emails' || url.pathname === '/sample-emails')) {
    sendJson(res, 200, {
      emails: SAMPLE_EMAILS.map((emailText, index) => ({
        id: `sample-${index + 1}`,
        emailText,
        emailType: classifyEmail(emailText),
      })),
      count: SAMPLE_EMAILS.length,
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/mailbox/messages') {
    try {
      const messages = await fetchMailboxMessages();
      sendJson(res, 200, { messages, count: messages.length });
    } catch (error) {
      sendJson(res, 503, { error: error instanceof Error ? error.message : 'Mailbox fetch failed' });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/learning-summary') {
    const store = readLearningStore();
    const categories = [...new Set(store.history.map((event) => event.emailType))];
    sendJson(res, 200, {
      totalFeedback: store.history.length,
      qualification: Object.fromEntries(categories.map((category) => [category, qualification(store, category)])),
      recentFeedback: store.history.slice(-20).reverse(),
      autoSendEnabled: process.env.AUTO_SEND_ENABLED === 'true',
      smtpConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD),
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/draft-reply') {
    try {
      const body = await readBody(req);
      const emailText = String(body.emailText || '').trim();
      if (!emailText) {
        sendJson(res, 400, { error: 'emailText is required' });
        return;
      }
      const type = classifyEmail(emailText);
      const knowledgeInsight = await getKnowledgeInsight(emailText);
      let subject = `Re: ${type.charAt(0).toUpperCase()}${type.slice(1)} support request`;
      let draftReply = buildDraftReply(type, emailText, knowledgeInsight);
      let mode = 'rule-based';
      if (await isKnowledgeModelConfigured()) {
        const generatedResponse = await fetch(`${KNOWLEDGE_BASE_URL}/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(process.env.SERVICE_API_TOKEN ? { Authorization: `Bearer ${process.env.SERVICE_API_TOKEN}` } : {}),
          },
          body: JSON.stringify({
            system_prompt: 'Draft a concise, empathetic, accurate customer-service email. Use only the supplied knowledge evidence; never promise a refund, account change, delivery date, or unverified capability. If evidence is insufficient, ask a clear follow-up question and recommend human review. Return JSON with subject and reply.',
            user_prompt: JSON.stringify({
              customer_email: emailText,
              verified_knowledge_answer: String(knowledgeInsight.answer || '').slice(0, 4500),
              sources: (knowledgeInsight.sources || []).slice(0, 3).map((source: Record<string, unknown>) => ({
                title: source.title,
                category: source.category,
                url: source.url,
              })),
            }),
          }),
        });
        if (!generatedResponse.ok) {
          const details = await generatedResponse.text();
          throw new Error(`AI draft generation failed (${generatedResponse.status}): ${details}`);
        }
        const generatedPayload = await generatedResponse.json() as { result?: { subject?: string; reply?: string } };
        if (!generatedPayload.result?.subject || !generatedPayload.result?.reply) {
          throw new Error('Configured model did not return the required subject and reply fields.');
        }
        subject = generatedPayload.result.subject;
        draftReply = generatedPayload.result.reply;
        mode = 'configured-model';
      }
      sendJson(res, 200, {
        emailType: type,
        subject,
        draftReply,
        source: knowledgeInsight,
        generationMode: mode,
        requiresHumanReview: true,
        autoSend: qualification(readLearningStore(), type),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      sendJson(res, message.includes('exceeds 1 MB') ? 413 : 502, { error: message });
    }
    return;
  }

  if (req.method === 'POST' && (url.pathname === '/feedback' || url.pathname === '/learn')) {
    try {
      const body = await readBody(req);
      const type = String(body.emailType || 'support');
      const draftedReply = String(body.draftedReply || '');
      const sentReply = String(body.sentReply || '');
      if (!draftedReply || !sentReply) {
        sendJson(res, 400, { error: 'draftedReply and sentReply are required for feedback' });
        return;
      }
      const rating = Number(body.rating ?? (normalizedReply(draftedReply) === normalizedReply(sentReply) ? 5 : 3));
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        sendJson(res, 400, { error: 'rating must be an integer from 1 to 5' });
        return;
      }
      const unchanged = normalizedReply(draftedReply) === normalizedReply(sentReply);
      const sent = body.sent === true;
      const store = readLearningStore();
      store.history.push({
        emailType: type,
        unchanged,
        rating,
        sent,
        createdAt: new Date().toISOString(),
      });
      writeLearningStore(store);
      sendJson(res, 200, { status: 'saved', unchanged, qualification: qualification(store, type) });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : 'Invalid feedback' });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/auto-send') {
    try {
      const body = await readBody(req);
      const emailType = String(body.emailType || '');
      const email = String(body.email || '');
      const reply = String(body.reply || '');
      const draft = String(body.draft || '');
      const eligibility = qualification(readLearningStore(), emailType);
      if (!eligibility.eligible) {
        sendJson(res, 403, { error: 'Auto-send qualification requirements are not met.', ...eligibility });
        return;
      }
      if (body.generationMode !== 'configured-model' || body.sourceConfidence !== 'high' || !Array.isArray(body.sources) || body.sources.length === 0) {
        sendJson(res, 403, { error: 'Auto-send requires a model-generated draft grounded in at least one high-confidence Knowledge Brain source.' });
        return;
      }
      if (process.env.AUTO_SEND_ENABLED !== 'true') {
        sendJson(res, 403, { error: 'Auto-send is disabled. Set AUTO_SEND_ENABLED=true only after reviewing the policy.' });
        return;
      }
      if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
        sendJson(res, 503, { error: 'SMTP is not configured; no email was sent.' });
        return;
      }
      const subject = String(body.subject || 'Support follow-up');
      if (!validEmail(email) || !reply || normalizedReply(reply) !== normalizedReply(draft) || /[\r\n]/.test(subject)) {
        sendJson(res, 400, { error: 'A valid recipient, reply, and unchanged approved draft are required.' });
        return;
      }
      const sentMessage = await emailTransport().sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: email,
        subject,
        text: reply,
      });
      const store = readLearningStore();
      store.history.push({
        emailType,
        unchanged: true,
        rating: 0,
        sent: true,
        createdAt: new Date().toISOString(),
      });
      writeLearningStore(store);
      sendJson(res, 200, { status: 'sent', messageId: sentMessage.messageId });
    } catch (error) {
      sendJson(res, 502, { error: error instanceof Error ? error.message : 'Email transport failed' });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/send') {
    try {
      const body = await readBody(req);
      const to = String(body.to || '');
      const subject = String(body.subject || '');
      const reply = String(body.reply || '');
      if (!validEmail(to) || !subject || /[\r\n]/.test(subject) || !reply) {
        sendJson(res, 400, { error: 'A valid recipient, single-line subject, and reply body are required.' });
        return;
      }
      const result = await emailTransport().sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to,
        subject,
        text: reply,
      });
      sendJson(res, 200, { status: 'sent', messageId: result.messageId });
    } catch (error) {
      sendJson(res, 503, { error: error instanceof Error ? error.message : 'Email send failed' });
    }
    return;
  }

  sendJson(res, 404, { error: 'Route not found' });
});

server.listen(PORT, () => {
  console.log(`Inbox agent listening on http://localhost:${PORT}`);
});
