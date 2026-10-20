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

Scope Studio accepts consented recordings as MP3, MP4, M4A, WAV, or WEBM (maximum 25 MB). It transcribes them through the OpenAI audio transcription API before generating scope. Configure a valid `TRANSCRIPTION_API_KEY` (and optionally `TRANSCRIPTION_BASE_URL` / `TRANSCRIPTION_MODEL`) in `.env`; the installed local Ollama text models do not provide audio transcription. The audio file is sent to the configured transcription provider, so obtain participant consent and review the provider's data terms. Without that key, paste a transcript instead.

The crawler always preserves screenshot URLs and alt text. Screenshot interpretation needs a vision-capable model and provider support; the locally installed Llama 3.2 text model does not support images. Set the appropriate hosted model settings and `VISION_ANALYSIS_ENABLED=true` only after reviewing privacy/data terms. Visual analysis is not claimed unless enabled and successfully completed.

`SERVICE_API_TOKEN` is optional for local development. If set, use the same value for Knowledge Brain, Inbox Agent, and Meeting Agent; all non-health API routes then require a bearer token, the workspace prompts for it, and API documentation is disabled. The Render Blueprint generates and shares this token automatically.

The crawler starts shortly after Knowledge Brain startup and checks the specified public sitemap daily. It crawls sequentially with a configurable delay, saves per-page progress, can resume an interrupted crawl, only updates changed article content, and deactivates indexed pages removed from a successfully fetched sitemap. A manual refresh is available in the UI or `POST /crawl`. Watch `GET /crawl/status`; a crawl that is failed/interrupted is not a completed initial index. Do not use `CRAWL_MAX_PAGES` for the final full index (default `0` means all).

## Inbox connection, learning and auto-send policy

The app ships with 55 sample emails so the workflows are testable without private customer data. To read a real mailbox, configure `IMAP_HOST`, `IMAP_USER`, and `IMAP_PASSWORD` (plus port/security/mailbox as needed), then use **Load live mailbox** in the UI. Use a dedicated test mailbox and provider-approved app password; never commit credentials. Configure SMTP to use the explicit **Send reviewed reply** button. Both connections are optional and remain disabled without their credentials.

Feedback is recorded only when a human supplies both the original draft and final sent reply. Edits reset the unchanged streak. Auto-send eligibility requires at least 20 consecutive unchanged, positively rated sends of the same type, recent quality ratings, and a non-sensitive intent. Billing/refund/member-account requests are never eligible. Actual SMTP delivery is off by default and requires all SMTP settings plus `AUTO_SEND_ENABLED=true`; no message is sent by the demo UI's “Record human send” action. Test SMTP with a non-customer mailbox before enabling outbound sending.

## Meeting workflow and sample conversations

The three bundled meeting scenarios are **simulated text fixtures, not recordings or real role-play interviews**. Use authentic recorded/transcribed sessions only with participant consent and provide the transcript to the scope workflow. Estimates are planning ranges and proposals remain internal until a reviewer records approval. The service does not send a proposal to a client.

## Current deployment and completion boundaries

This is a **local application**, not a public internet deployment. Running at `localhost` is visible only on the machine running it. No recruiter-accessible public URL, cloud account, domain, TLS, persistent hosted database, or email credentials are provided in this project. A public production launch also needs hosting-specific configuration, HTTPS, authentication/authorization and rate limits for administrative/model-cost endpoints, secrets management, backups, monitoring, and a real end-to-end test on the target provider. Do not expose the current development servers directly to the public internet.

The source seed file (`services/knowledge_brain/data/knowledge.json`) is demo content and is not a verified snapshot of every Brilliant Directories support article. The live sitemap crawl must finish successfully before claiming the full source has been ingested. Recruiter demos should disclose whether the model is configured, whether the crawl finished, and that the bundled meetings are fixtures.

## Free hosted demo on Render

`render.yaml` defines a four-service Render Blueprint: Knowledge Brain, Meeting Agent, Inbox Agent, and the static workspace. The web services use Render's free compute plan; the static site is free. The Blueprint configures HTTPS service URLs, health checks, CORS, and a generated shared `SERVICE_API_TOKEN`. All non-health API routes require that token; the browser asks for it when the workspace is first used. API documentation is disabled when the token is set. The health routes remain public for platform health checks.

This is a **free-tier demo, not a production deployment**. Render free web services spin down after 15 minutes without inbound traffic and can take about a minute to wake. Their filesystems are ephemeral: SQLite data, learned feedback, and indexed crawl data can be lost on restart, redeploy, or spin-down. The free blueprint disables automatic crawling so an idle service does not attempt a long full crawl; the Knowledge Brain starts with the seven bundled sample articles. Free web services cannot send outbound SMTP traffic on ports 25, 465, or 587. Real mailbox access, email delivery, transcription, and hosted model generation are not configured by this free blueprint. Use a paid hosting plan with persistent storage and provider credentials for those capabilities.

To deploy:

1. Push this project to a GitHub repository you control. Do not include `.env`, API keys, or mailbox credentials.
2. In Render, create a **Blueprint** from that repository and review the plan for every service before applying. This Blueprint selects free compute and has no persistent disks.
3. Wait for all three web-service health checks to pass and confirm the static site is published, then visit `https://northstar-ai-tech-consultant.onrender.com`. Retrieve `SERVICE_API_TOKEN` from the shared environment group and enter it in the workspace prompt. Share that token with a recruiter only through a private channel; rotate it after the demo.
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

The blueprint is a deployment configuration, not evidence that the app is already online. Render's generated service URLs in `render.yaml` must remain aligned with the service names unless the URLs and the Knowledge Brain CORS origin are updated together.

Live mailbox access and message delivery remain optional integrations. Configure IMAP and SMTP secrets only on a hosting plan that permits those connections, and test with a dedicated mailbox; keep `AUTO_SEND_ENABLED=false` unless the separate safety gates have been reviewed. To complete the real-interview requirement, obtain consented recordings/transcripts and process those actual transcripts through Scope Studio; the bundled scenarios are only fixtures. Never place credentials or private customer transcripts in this repository.

This free setup can be used as a **protected recruiter demo with the limitations above**, not production multi-user customer service. Before production use, move to hosting with persistent storage, add identity-based authentication, per-user authorization, rate limits, provider-specific privacy review, monitoring, backups, and operational alerting.
