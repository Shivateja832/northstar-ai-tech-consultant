# AI Tech Consultant — local capstone build

This repository contains three connected services and a single-page workspace:

1. **Knowledge Brain (Python/FastAPI)** — SQLite full-text retrieval, source citations, text/Markdown ingestion, human-expert follow-up, resumable sitemap indexing and daily refresh scheduling.
2. **Inbox Agent (TypeScript/Node)** — 55 test emails, source-backed drafts, editable replies, human-send feedback, consecutive quality tracking, and guarded SMTP auto-send.
3. **Meeting to Scope (Python/FastAPI)** — transcript chunking, requirement extraction, product-knowledge checks, estimate ranges, proposal drafts, revision comparisons and internal approval records.
4. **Frontend** — responsive workspace for the three workflows, service status, crawler status, feedback and approval.

## Run locally on Windows

Prerequisites: Python 3.11+, Node.js LTS, and npm.

From PowerShell:

```powershell
cd "C:\Users\Shiva Teja\Downloads\Capstone Application"
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm --prefix .\services\inbox_agent install
Copy-Item .env.example .env
.\.venv\Scripts\python.exe .\scripts\run_all.py
```

Keep that terminal open. The launcher verifies health checks and displays child-service logs. Open:

- Workspace: http://localhost:8080
- Knowledge Brain API docs: http://localhost:8001/docs
- Meeting API docs: http://localhost:8002/docs
- Inbox health: http://localhost:3001/health

Use **Ctrl+C** in the launcher terminal to stop all child services.

## Verify functionality from another PowerShell window

```powershell
Invoke-RestMethod http://localhost:8001/health
Invoke-RestMethod http://localhost:8002/health
Invoke-RestMethod http://localhost:3001/health
Invoke-WebRequest -UseBasicParsing http://localhost:8080

Invoke-RestMethod -Method Post -Uri http://localhost:8001/chat `
  -ContentType "application/json" `
  -Body '{"question":"How do cancellations and renewals work?"}'

Invoke-RestMethod -Method Post -Uri http://localhost:3001/draft-reply `
  -ContentType "application/json" `
  -Body '{"emailText":"Can you update our homepage layout and explain whether this needs custom development?"}'

Invoke-RestMethod -Method Post -Uri http://localhost:8002/analyze `
  -ContentType "application/json" `
  -Body '{"transcript":"Client wants category search filters and a simpler homepage hero. Ask for acceptance criteria and verify existing product settings before custom work."}'
```

Expected: all four checks return successfully; Q&A includes source metadata, Inbox returns a clearly labeled draft, and Meeting returns an unapproved scope/proposal with task and estimate ranges. The app deliberately marks rule/retrieval mode when no model is configured.

## Local model, audio transcription and optional screenshot analysis

The Python and TypeScript agents use the Knowledge Brain's `/generate` endpoint as an OpenAI-compatible model gateway. On the development machine used for the verified local run, Ollama and `llama3.2:3b` are installed. The ignored local `.env` uses Ollama at `http://127.0.0.1:11434/v1`, so text generation does not require sending content or a key to a hosted model provider. Keep Ollama running and check `ollama list` before starting the app. The OpenAI-compatible placeholder `OPENAI_API_KEY=ollama` is local-only and is not an account credential. The 3B model is recommended for structured JSON output; smaller models may produce incomplete drafts. Local inference can be slow on machines with limited free memory; increase `AI_REQUEST_TIMEOUT_SECONDS` only if needed. `LOCAL_AI_FAST_MODE=true` uses the model for transcript requirement extraction and deterministic estimates/proposal drafting to avoid several slow serial model calls; hosted model deployments can set it to `false` for model-assisted estimates and proposals.

Inbox drafts retrieve knowledge without running a separate model call for the answer, then make one model call to draft the reply. The retrieval and generated reply remain distinctly labeled, and the draft still requires human review.

To use a hosted text model instead, set `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL` in the ignored local `.env`, restart, and check `ai_model_configured` in service health. Never paste keys into source files or chat.

Scope Studio accepts consented recordings as MP3, MP4, M4A, WAV, or WEBM (maximum 25 MB). It transcribes them through the OpenAI audio transcription API before generating scope. Configure `TRANSCRIPTION_API_KEY` or reuse `OPENAI_API_KEY` in the Knowledge Brain environment (the separate transcription key takes precedence; `TRANSCRIPTION_BASE_URL` / `TRANSCRIPTION_MODEL` are optional). The installed local Ollama text models do not provide audio transcription. The audio file is sent to the configured transcription provider, so obtain participant consent and review the provider's data terms. Without a provider key, paste a transcript instead.

The crawler always preserves screenshot URLs and alt text. Screenshot interpretation needs a vision-capable model and provider support; the locally installed Llama 3.2 text model does not support images. On Render, configure `OPENAI_API_KEY`, select a vision-capable `OPENAI_MODEL` (the Blueprint default is `gpt-4o-mini`), and set `VISION_ANALYSIS_ENABLED=true` only after reviewing privacy/data terms. Then start a new crawl to analyze images. Visual analysis is not claimed unless enabled and successfully completed.

`SERVICE_API_TOKEN` is optional for local development. If set, use the same value for Knowledge Brain, Inbox Agent, and Meeting Agent; all non-health API routes then require a bearer token, the workspace prompts for it, and API documentation is disabled. The Render Blueprint generates and shares this token automatically.

The crawler starts shortly after Knowledge Brain startup when `AUTO_REFRESH=true`; it checks the specified public sitemap daily. The free Render Blueprint leaves automatic crawling disabled to avoid repeated provider charges during free-service restarts; start a crawl manually in the UI or with `POST /crawl`. It crawls sequentially with a configurable delay, saves per-page progress, can resume an interrupted crawl, only updates changed article content, and deactivates indexed pages removed from a successfully fetched sitemap. Watch `GET /crawl/status`: `completed` means text and enabled image analysis finished; `completed_with_warnings` means articles were indexed but one or more image-analysis requests failed, with affected images marked `analysis_status: unavailable`; `failed` or `interrupted` is not a completed crawl. A vision-provider quota error no longer aborts the text crawl, but it cannot produce image descriptions until provider quota is restored. Do not use `CRAWL_MAX_PAGES` for the final full index (default `0` means all).

## Inbox connection, learning and auto-send policy

The app ships with 56 sample emails so the workflows are testable without private customer data. For Gmail or Google Workspace on Render, use the Gmail API over HTTPS rather than IMAP/SMTP. Enable the Gmail API in a Google Cloud project, configure its OAuth consent screen and OAuth client, and obtain an offline refresh token with the `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/gmail.send` scopes. Add `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, and `GMAIL_REFRESH_TOKEN` as private environment variables on the Inbox Agent in Render, then use **Load connected mailbox**. The agent reads at most the 50 newest inbox messages and sends only after the reviewer clicks **Send reviewed reply**. Begin with a dedicated test mailbox and revoke the OAuth grant when no longer needed; never commit credentials or share them in chat. Google's OAuth consent mode/testing rules may expire refresh tokens or require app verification for continued use.

For other mail providers, configure `IMAP_HOST`, `IMAP_USER`, and `IMAP_PASSWORD` to read and SMTP values to send only on a host that permits those connections. Render free web services restrict outbound SMTP ports, so the Gmail API path is the supported route for the free demo. Mailbox access and email delivery remain off until valid provider credentials are configured.

Feedback is recorded only when a human supplies both the original draft and final sent reply. Edits reset the unchanged streak. Auto-send eligibility requires at least 20 consecutive unchanged, positively rated sends of the same type, recent quality ratings, and a non-sensitive intent. Billing/refund/member-account requests are never eligible. Actual SMTP delivery is off by default and requires all SMTP settings plus `AUTO_SEND_ENABLED=true`; no message is sent by the demo UI's “Record human send” action. Test SMTP with a non-customer mailbox before enabling outbound sending.

## Meeting workflow and sample conversations

The three bundled meeting scenarios are **simulated text fixtures, not recordings or real role-play interviews**. Use authentic recorded/transcribed sessions only with participant consent and provide the transcript to the scope workflow. Estimates are planning ranges and proposals remain internal until a reviewer records approval. The service does not send a proposal to a client.

## Current deployment and completion boundaries

The application is deployed as a **protected free-tier demo** at [https://northstar-ai-tech-consultant.onrender.com](https://northstar-ai-tech-consultant.onrender.com). The four hosted services have public HTTPS endpoints and health checks. The interactive workspace requires the `SERVICE_API_TOKEN` from the Render `northstar-shared` environment group; share it only with intended reviewers through a private channel. The hosted Knowledge Brain currently starts with seven bundled sample articles and reports whether an external model is configured; do not claim a full crawl or model-backed output unless those statuses confirm it.

This is not a production customer-service deployment. Free hosting has ephemeral storage and can spin down, so SQLite indexes, crawl progress, meeting revisions, and Inbox feedback can be lost on restart. The owner chose to retain this free-tier behavior instead of adding paid storage. The hosted Blueprint does not itself configure Gmail OAuth, external model keys, transcription credentials, or image-analysis consent. Public production use additionally needs persistent storage, identity-based authentication/authorization, rate limits for administrative/model-cost endpoints, backups, monitoring, and provider-specific privacy review.

The source seed file (`services/knowledge_brain/data/knowledge.json`) is demo content and is not a verified snapshot of every Brilliant Directories support article. The live sitemap crawl must finish successfully before claiming the full source has been ingested. Recruiter demos should disclose whether the model is configured, whether the crawl finished, and that the bundled meetings are fixtures.

## Free hosted demo on Render

`render.yaml` defines a four-service Render Blueprint: Knowledge Brain, Meeting Agent, Inbox Agent, and the static workspace. The web services use Render's free compute plan; the static site is free. The Blueprint configures HTTPS service URLs, health checks, CORS, and a generated shared `SERVICE_API_TOKEN`. All non-health API routes require that token; the browser asks for it when the workspace is first used. API documentation is disabled when the token is set. The health routes remain public for platform health checks.

This is a **free-tier demo, not a production deployment**. Render free web services spin down after 15 minutes without inbound traffic and can take about a minute to wake. Their filesystems are ephemeral: SQLite data, learned feedback, and indexed crawl data can be lost on restart, redeploy, or spin-down. The free blueprint disables automatic crawling so an idle service does not attempt a long full crawl; the Knowledge Brain starts with the seven bundled sample articles, and an owner can start a manual crawl for a demo. Free web services cannot send outbound SMTP traffic on ports 25, 465, or 587; Gmail API HTTPS requests are the supported option when OAuth is configured. Transcription, hosted model generation, and image analysis also require provider credentials, and the latter requires explicit enablement.

To deploy:

1. Push this project to a GitHub repository you control. Do not include `.env`, API keys, or mailbox credentials.
2. In Render, create a **Blueprint** from that repository and review the plan for every service before applying. This Blueprint selects free compute and has no persistent disks.
3. Wait for all three web-service health checks to pass and confirm the static site is published, then visit `https://northstar-ai-tech-consultant.onrender.com`. Retrieve `SERVICE_API_TOKEN` from the shared environment group and enter it in the workspace access dialog. Share that token with a recruiter only through a private channel; rotate it after the demo.
4. Test each workflow against the hosted URL. Expect free services to wake slowly and stored data to reset. Do not represent simulated meetings as recorded interviews or the seven sample articles as a complete help-center crawl.
5. Optional model generation requires a provider endpoint and key configured in the Knowledge Brain environment; the local Ollama instance on your computer is not reachable by the hosted service. Real transcription requires a transcription provider key. Configure secrets only in Render, never in GitHub.

For hosted end-to-end verification, set the service URLs and token in the PowerShell session (do not put the token in a source file), then run:

```powershell
$env:KNOWLEDGE_BRAIN_URL = "https://northstar-knowledge-brain.onrender.com"
$env:MEETING_AGENT_URL = "https://northstar-meeting-agent.onrender.com"
$env:INBOX_AGENT_URL = "https://northstar-inbox-agent.onrender.com"
$env:FRONTEND_URL = "https://northstar-ai-tech-consultant.onrender.com"
$env:SERVICE_API_TOKEN = Read-Host "Paste the Render SERVICE_API_TOKEN"
.\.venv\Scripts\python.exe .\scripts\verify_application.py
```

The Render Blueprint is configured for the deployed demo. Render's generated service URLs in `render.yaml` must remain aligned with the service names unless the URLs and the Knowledge Brain CORS origin are updated together.

Live mailbox access and message delivery remain optional integrations. Configure IMAP and SMTP secrets only on a hosting plan that permits those connections, and test with a dedicated mailbox; keep `AUTO_SEND_ENABLED=false` unless the separate safety gates have been reviewed. To complete the real-interview requirement, obtain consented recordings/transcripts and process those actual transcripts through Scope Studio; the bundled scenarios are only fixtures. Never place credentials or private customer transcripts in this repository.

This free setup can be used as a **protected recruiter demo with the limitations above**, not production multi-user customer service. Before production use, move to hosting with persistent storage, add identity-based authentication, per-user authorization, rate limits, provider-specific privacy review, monitoring, backups, and operational alerting.
