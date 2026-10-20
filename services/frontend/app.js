const API = window.APP_CONFIG?.api || {
  knowledge: 'http://localhost:8001',
  inbox: 'http://localhost:3001',
  meeting: 'http://localhost:8002',
};

const state = { emails: [], mailboxMessages: [], draft: null, previousScope: null, projectId: null };
const byId = (id) => document.getElementById(id);
let accessTokenPrompt;

if (window.APP_CONFIG?.hosted) {
  byId('workspace-label').textContent = 'Protected demo workspace';
  byId('workspace-description').textContent = 'Enter the access token supplied by the project owner. Model and mailbox integrations depend on their configured credentials.';
  byId('deployment-note').textContent = 'Protected hosted demo · Verify model and mailbox configuration before production use';
}

async function requestJson(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  let token = sessionStorage.getItem('northstar_access_token') || '';
  if (token) headers.Authorization = `Bearer ${token}`;
  let response = await fetch(url, { ...options, headers });
  if (response.status === 401 && !token) {
    token = await requestAccessToken();
    headers.Authorization = `Bearer ${token}`;
    response = await fetch(url, { ...options, headers });
  }
  if (response.status === 401 && token) {
    sessionStorage.removeItem('northstar_access_token');
    throw new Error('Access token rejected. Reload the page and enter the current workspace token.');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail || body.error || `Request failed (${response.status})`);
  return body;
}

function requestAccessToken() {
  if (!accessTokenPrompt) {
    accessTokenPrompt = new Promise((resolve, reject) => {
      const dialog = byId('access-dialog');
      const form = byId('access-form');
      const input = byId('access-token');
      const status = byId('access-status');
      const cancel = byId('access-cancel');
      if (!(dialog instanceof HTMLDialogElement) || !form || !input || !status || !cancel) {
        reject(new Error('The workspace access form is unavailable. Reload the page and try again.'));
        return;
      }

      status.textContent = '';
      input.value = '';
      const cleanup = () => {
        form.removeEventListener('submit', submit);
        cancel.removeEventListener('click', dismiss);
        dialog.removeEventListener('cancel', dismiss);
      };
      const dismiss = (event) => {
        event.preventDefault();
        cleanup();
        dialog.close();
        reject(new Error('A workspace access token is required.'));
      };
      const submit = (event) => {
        event.preventDefault();
        const token = input.value.trim();
        if (!token) {
          status.textContent = 'Enter the access token supplied by the project owner.';
          return;
        }
        sessionStorage.setItem('northstar_access_token', token);
        cleanup();
        dialog.close();
        resolve(token);
      };
      form.addEventListener('submit', submit);
      cancel.addEventListener('click', dismiss);
      dialog.addEventListener('cancel', dismiss);
      dialog.showModal();
      input.focus();
    });
    accessTokenPrompt = accessTokenPrompt.finally(() => {
      accessTokenPrompt = undefined;
    });
  }
  return accessTokenPrompt;
}

function showError(element, error) {
  element.textContent = error instanceof Error ? error.message : String(error);
  element.classList.add('error');
}

function showInfo(element, message) {
  element.textContent = message;
  element.classList.remove('error');
}

function renderJson(element, value) {
  element.textContent = JSON.stringify(value, null, 2);
  element.classList.remove('error');
}

function addText(parent, tagName, text, className = '') {
  const element = document.createElement(tagName);
  element.textContent = String(text ?? '');
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function renderScope(scope) {
  const output = byId('meeting-output');
  output.replaceChildren();
  output.classList.remove('empty-state', 'error');
  output.classList.add('scope-details');
  addText(output, 'h4', 'Scope summary', 'scope-heading');
  addText(output, 'p', scope.summary || 'Requirements and product checks are ready for review.');
  const range = scope.estimate?.total_hours || {};
  const estimateGrid = document.createElement('div');
  estimateGrid.className = 'estimate-grid';
  [
    ['Low', range.low],
    ['Likely', range.likely],
    ['High', range.high],
  ].forEach(([label, value]) => {
    const card = document.createElement('div');
    card.className = 'estimate-cell';
    addText(card, 'small', `${label} estimate`);
    addText(card, 'strong', `${value ?? '—'} hours`);
    estimateGrid.append(card);
  });
  output.append(estimateGrid);

  addText(output, 'h4', 'Requirements and product fit', 'scope-heading');
  (scope.requirements || []).forEach((requirement) => {
    const card = document.createElement('article');
    card.className = 'requirement-card';
    addText(card, 'strong', requirement.title);
    const hours = requirement.estimate_hours || {};
    addText(card, 'small', `${hours.low ?? '—'}–${hours.high ?? '—'} h · ${requirement.status || 'needs review'}`, 'requirement-meta');
    addText(card, 'p', requirement.description);
    const fit = requirement.product_solution_check;
    if (fit) {
      addText(card, 'p', `Knowledge Brain (${fit.confidence} confidence): ${fit.answer || 'No verified answer.'}`, 'fit-note');
      (fit.sources || []).forEach((source) => {
        if (source.url) {
          const link = document.createElement('a');
          link.href = source.url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = `Source: ${source.title}`;
          card.append(link);
        } else {
          addText(card, 'small', `Source: ${source.title}`);
        }
      });
    }
    output.append(card);
  });

  if (scope.questions_for_client?.length) {
    addText(output, 'h4', 'Questions before commitment', 'scope-heading');
    const list = document.createElement('ul');
    scope.questions_for_client.forEach((question) => addText(list, 'li', question));
    output.append(list);
  }
  if (scope.change_report) {
    addText(output, 'h4', 'Revision change report', 'scope-heading');
    addText(output, 'p', scope.change_report.summary);
    (scope.change_report.new_items_to_quote || []).forEach((item) => {
      addText(output, 'p', `New / quote separately: ${item.title}`, 'out-of-scope');
    });
  }
  const proposal = scope.proposal;
  if (proposal) {
    addText(output, 'h4', 'Proposal draft — internal review required', 'scope-heading');
    addText(output, 'p', proposal.summary);
    const prices = proposal.price_range || {};
    addText(output, 'p', `Planning range: ${prices.low ?? '—'}–${prices.high ?? '—'} (likely ${prices.likely ?? '—'}).`);
    addText(output, 'small', `Assumptions: ${(proposal.assumptions || []).join(' · ')}`);
  }
}

document.querySelectorAll('.nav-item').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item === button));
    document.querySelectorAll('.panel').forEach((panel) => panel.classList.toggle('active', panel.id === `${button.dataset.tab}-panel`));
    byId('page-title').textContent = { knowledge: 'Knowledge brain', inbox: 'Inbox copilot', meeting: 'Scope studio' }[button.dataset.tab];
  });
});

async function checkHealth() {
  const appStatus = byId('app-status');
  const modelStatus = byId('model-status');
  try {
    const checks = await Promise.all([
      requestJson(`${API.knowledge}/health`),
      requestJson(`${API.inbox}/health`),
      requestJson(`${API.meeting}/health`),
    ]);
    appStatus.innerHTML = '<i></i> All services online';
    appStatus.classList.remove('offline');
    const modelConfigured = checks.some((service) => service.ai_model_configured === true || service.aiModelConfigured === true);
    modelStatus.innerHTML = modelConfigured ? '<i></i> AI model configured' : '<i></i> Retrieval / rules mode';
    modelStatus.classList.toggle('muted', !modelConfigured);
  } catch (error) {
    appStatus.innerHTML = '<i></i> Service unavailable';
    appStatus.classList.add('offline');
    modelStatus.textContent = error instanceof Error ? error.message : 'Could not check services';
  }
}

async function refreshCrawlStatus() {
  const container = byId('crawl-status');
  try {
    const [crawl, health] = await Promise.all([
      requestJson(`${API.knowledge}/crawl/status`),
      requestJson(`${API.knowledge}/health`),
    ]);
    const sitemapInput = byId('sitemap-url');
    if (!sitemapInput.dataset.initialized) {
      sitemapInput.value = health.default_sitemap_url;
      sitemapInput.dataset.initialized = 'true';
    }
    container.textContent = `${health.article_count} indexed articles · Crawl ${crawl.status}${crawl.total ? ` · ${crawl.processed}/${crawl.total} pages` : ''}${crawl.error ? ` · ${crawl.error}` : ''}`;
    container.classList.toggle('error', crawl.status === 'failed' || crawl.status === 'interrupted');
  } catch (error) {
    showError(container, error);
  }
}

byId('knowledge-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const output = byId('kb-output');
  showInfo(output, 'Searching indexed source material…');
  try {
    const result = await requestJson(`${API.knowledge}/chat`, {
      method: 'POST',
      body: JSON.stringify({ question: byId('kb-question').value, top_k: 5 }),
    });
    renderJson(output, result);
  } catch (error) {
    showError(output, error);
  }
});

byId('crawl-button').addEventListener('click', async () => {
  const button = byId('crawl-button');
  button.disabled = true;
  try {
    const sitemapUrl = byId('sitemap-url').value.trim();
    const query = new URLSearchParams({ sitemap_url: sitemapUrl, delay_seconds: '0.75' });
    const result = await requestJson(`${API.knowledge}/crawl?${query}`, { method: 'POST' });
    showInfo(byId('crawl-status'), `Sitemap refresh ${result.status}. Progress is saved as pages complete.`);
    window.setTimeout(refreshCrawlStatus, 1000);
  } catch (error) {
    showError(byId('crawl-status'), error);
  } finally {
    button.disabled = false;
  }
});

async function refreshExpertTasks() {
  const list = byId('expert-tasks');
  try {
    const result = await requestJson(`${API.knowledge}/expert/tasks?status=open`);
    if (!result.tasks.length) {
      list.textContent = 'No open expert tasks. Questions the brain cannot verify will appear here.';
      return;
    }
    list.replaceChildren();
    result.tasks.forEach((task) => {
      const row = document.createElement('div');
      row.className = 'task-row';
      const question = document.createElement('p');
      question.textContent = task.question;
      const answer = document.createElement('textarea');
      answer.rows = 2;
      answer.placeholder = 'Enter the reviewed, approved answer…';
      const save = document.createElement('button');
      save.className = 'button secondary';
      save.textContent = 'Add reviewed answer to knowledge';
      save.addEventListener('click', async () => {
        save.disabled = true;
        try {
          await requestJson(`${API.knowledge}/expert/answer`, {
            method: 'POST',
            body: JSON.stringify({ task_id: task.id, answer: answer.value, expert_name: 'Workspace reviewer' }),
          });
          await refreshExpertTasks();
          await refreshCrawlStatus();
        } catch (error) {
          showError(list, error);
          save.disabled = false;
        }
      });
      row.append(question, answer, save);
      list.append(row);
    });
  } catch (error) {
    showError(list, error);
  }
}

byId('refresh-tasks').addEventListener('click', refreshExpertTasks);

byId('document-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = byId('document-file').files[0];
  const status = byId('document-status');
  if (!file) return;
  try {
    const text = await file.text();
    const result = await requestJson(`${API.knowledge}/documents`, {
      method: 'POST',
      body: JSON.stringify({ filename: file.name, text }),
    });
    showInfo(status, `Indexed “${result.article.title}” from the uploaded document.`);
    await refreshCrawlStatus();
  } catch (error) {
    showError(status, error);
  }
});

async function loadEmails() {
  const select = byId('sample-email');
  try {
    const result = await requestJson(`${API.inbox}/sample-emails`);
    state.emails = result.emails;
    byId('email-count').textContent = `${result.count} examples`;
    select.innerHTML = '<option value="">Choose an example…</option>';
    state.emails.forEach((email) => {
      const option = document.createElement('option');
      option.value = email.id;
      option.textContent = `${email.emailType} · ${email.emailText.slice(0, 86)}${email.emailText.length > 86 ? '…' : ''}`;
      select.append(option);
    });
  } catch (error) {
    showError(byId('inbox-status'), error);
  }
}

byId('sample-email').addEventListener('change', () => {
  const selected = byId('sample-email').value;
  const liveMessage = state.mailboxMessages.find((email) => email.id === selected);
  const sample = state.emails.find((email) => email.id === selected);
  if (liveMessage) {
    byId('email-input').value = liveMessage.emailText;
    byId('recipient-email').value = liveMessage.from.split(',')[0] || '';
  } else if (sample) {
    byId('email-input').value = sample.emailText;
    byId('recipient-email').value = '';
  }
});

byId('refresh-mailbox').addEventListener('click', async () => {
  const button = byId('refresh-mailbox');
  button.disabled = true;
  try {
    const result = await requestJson(`${API.inbox}/mailbox/messages`);
    state.mailboxMessages = result.messages;
    const select = byId('sample-email');
    const existing = select.querySelector('optgroup[data-kind="mailbox"]');
    if (existing) existing.remove();
    const group = document.createElement('optgroup');
    group.label = 'Live mailbox';
    group.dataset.kind = 'mailbox';
    state.mailboxMessages.forEach((email) => {
      const option = document.createElement('option');
      option.value = email.id;
      option.textContent = `${email.from || 'Unknown sender'} · ${email.subject}`;
      group.append(option);
    });
    select.append(group);
    byId('email-count').textContent = `${state.emails.length} samples · ${result.count} live`;
    showInfo(byId('inbox-status'), `Loaded ${result.count} message(s) from the configured IMAP inbox.`);
  } catch (error) {
    showError(byId('inbox-status'), error);
  } finally {
    button.disabled = false;
  }
});

byId('draft-button').addEventListener('click', async () => {
  const button = byId('draft-button');
  const status = byId('inbox-status');
  const emailText = byId('email-input').value.trim();
  if (!emailText) {
    showError(status, 'Paste or select a customer email first.');
    return;
  }
  button.disabled = true;
  showInfo(status, 'Retrieving evidence and preparing a reviewable draft…');
  try {
    state.draft = await requestJson(`${API.inbox}/draft-reply`, {
      method: 'POST',
      body: JSON.stringify({ emailText }),
    });
    byId('draft-subject').value = state.draft.subject;
    byId('draft-reply').value = state.draft.draftReply;
    byId('draft-mode').textContent = state.draft.generationMode;
    byId('copy-reply').disabled = false;
    byId('mark-sent').disabled = false;
    byId('send-reviewed').disabled = false;
    const autoEligible = state.draft.autoSend?.eligible === true
      && state.draft.generationMode === 'configured-model'
      && state.draft.source?.confidence === 'high'
      && (state.draft.source?.sources || []).length > 0;
    byId('auto-send-reply').disabled = !autoEligible;
    const sources = state.draft.source?.sources || [];
    byId('draft-sources').textContent = sources.length
      ? `Evidence: ${sources.map((source) => source.title).join(' · ')}`
      : 'No supporting source found; treat this draft as an escalation and verify before sending.';
    showInfo(status, `Draft created for ${state.draft.emailType}. Check evidence and review every sentence before sending.`);
    await refreshLearning();
  } catch (error) {
    showError(status, error);
  } finally {
    button.disabled = false;
  }
});

byId('copy-reply').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(`${byId('draft-subject').value}\n\n${byId('draft-reply').value}`);
    showInfo(byId('learning-status'), 'Copied. Send from your authorized email client, then choose Record human send.');
  } catch (error) {
    showError(byId('learning-status'), `Could not access clipboard: ${error.message}`);
  }
});

byId('mark-sent').addEventListener('click', async () => {
  if (!state.draft) return;
  const button = byId('mark-sent');
  button.disabled = true;
  try {
    const feedback = await requestJson(`${API.inbox}/feedback`, {
      method: 'POST',
      body: JSON.stringify({
        emailType: state.draft.emailType,
        draftedReply: state.draft.draftReply,
        sentReply: byId('draft-reply').value,
        rating: Number(byId('quality-rating').value),
        sent: true,
      }),
    });
    showInfo(byId('learning-status'), `Human-send feedback recorded. Draft unchanged: ${feedback.unchanged}. Consecutive qualifying sends: ${feedback.qualification.unchangedCount}/20.`);
    await refreshLearning();
  } catch (error) {
    showError(byId('learning-status'), error);
    button.disabled = false;
  }
});

byId('send-reviewed').addEventListener('click', async () => {
  const recipient = byId('recipient-email').value.trim();
  if (!recipient) {
    showError(byId('learning-status'), 'Enter or select a customer email address before sending.');
    return;
  }
  const button = byId('send-reviewed');
  button.disabled = true;
  try {
    await requestJson(`${API.inbox}/send`, {
      method: 'POST',
      body: JSON.stringify({
        to: recipient,
        subject: byId('draft-subject').value,
        reply: byId('draft-reply').value,
      }),
    });
    const feedback = await requestJson(`${API.inbox}/feedback`, {
      method: 'POST',
      body: JSON.stringify({
        emailType: state.draft.emailType,
        draftedReply: state.draft.draftReply,
        sentReply: byId('draft-reply').value,
        rating: Number(byId('quality-rating').value),
        sent: true,
      }),
    });
    showInfo(byId('learning-status'), `Email sent and feedback recorded. Draft unchanged: ${feedback.unchanged}.`);
    await refreshLearning();
  } catch (error) {
    showError(byId('learning-status'), error);
  } finally {
    button.disabled = false;
  }
});

byId('auto-send-reply').addEventListener('click', async () => {
  if (!state.draft) return;
  byId('auto-send-reply').disabled = true;
  try {
    const result = await requestJson(`${API.inbox}/auto-send`, {
      method: 'POST',
      body: JSON.stringify({
        email: byId('recipient-email').value.trim(),
        emailType: state.draft.emailType,
        subject: byId('draft-subject').value,
        reply: byId('draft-reply').value,
        draft: state.draft.draftReply,
        generationMode: state.draft.generationMode,
        sourceConfidence: state.draft.source?.confidence,
        sources: state.draft.source?.sources || [],
      }),
    });
    showInfo(byId('learning-status'), `Auto-send completed. Message ID: ${result.messageId || '(accepted by SMTP)'}`);
    await refreshLearning();
  } catch (error) {
    showError(byId('learning-status'), error);
  } finally {
    byId('auto-send-reply').disabled = false;
  }
});

async function refreshLearning() {
  const container = byId('learning-summary');
  try {
    const result = await requestJson(`${API.inbox}/learning-summary`);
    const rows = Object.entries(result.qualification || {});
    container.textContent = rows.length
      ? rows.map(([name, value]) => `${name}: ${value.unchangedCount}/20 consecutive unchanged sends · ${value.reason}`).join('\n')
      : 'No human feedback recorded yet. Automatic sending is not eligible.';
    container.classList.remove('error');
  } catch (error) {
    showError(container, error);
  }
}

byId('refresh-learning').addEventListener('click', refreshLearning);

async function loadMeetingSamples() {
  const select = byId('sample-meeting');
  try {
    const result = await requestJson(`${API.meeting}/sample-meetings`);
    state.meetingSamples = result.sample_transcripts;
    result.sample_transcripts.forEach((sample, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = sample.title;
      select.append(option);
    });
  } catch (error) {
    showError(byId('meeting-status'), error);
  }
}

byId('sample-meeting').addEventListener('change', () => {
  const sample = state.meetingSamples?.[Number(byId('sample-meeting').value)];
  if (sample) byId('meeting-transcript').value = sample.transcript;
});

byId('transcribe-meeting').addEventListener('click', async () => {
  const file = byId('meeting-audio').files?.[0];
  if (!file) {
    showError(byId('meeting-status'), 'Select a consented audio recording first.');
    return;
  }
  if (file.size > 25 * 1024 * 1024) {
    showError(byId('meeting-status'), 'Recording exceeds the 25 MB upload limit.');
    return;
  }
  const button = byId('transcribe-meeting');
  button.disabled = true;
  showInfo(byId('meeting-status'), 'Transcribing the recording with the configured transcription provider…');
  try {
    const headers = {};
    let token = sessionStorage.getItem('northstar_access_token') || '';
    if (token) headers.Authorization = `Bearer ${token}`;
    const makeRequest = () => {
      const body = new FormData();
      body.append('audio', file);
      return fetch(`${API.knowledge}/transcribe`, { method: 'POST', headers, body });
    };
    let response = await makeRequest();
    if (response.status === 401 && !token) {
      token = await requestAccessToken();
      headers.Authorization = `Bearer ${token}`;
      response = await makeRequest();
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.detail || result.error || `Transcription failed (${response.status})`);
    byId('meeting-transcript').value = result.transcript;
    showInfo(byId('meeting-status'), `Transcript created from ${result.filename}. Review and correct it before generating scope.`);
  } catch (error) {
    showError(byId('meeting-status'), error);
  } finally {
    button.disabled = false;
  }
});

byId('analyze-meeting').addEventListener('click', async () => {
  const button = byId('analyze-meeting');
  const transcript = byId('meeting-transcript').value.trim();
  if (!transcript) {
    showError(byId('meeting-status'), 'Paste a transcript or select a sample scenario.');
    return;
  }
  button.disabled = true;
  showInfo(byId('meeting-status'), 'Running requirement extraction, product checks, and estimate stages…');
  try {
    const revise = byId('revise-scope').checked && state.previousScope;
    const result = await requestJson(`${API.meeting}/analyze`, {
      method: 'POST',
      body: JSON.stringify({
        transcript,
        project_id: revise ? state.projectId : undefined,
        previous_scope: revise ? state.previousScope : undefined,
      }),
    });
    state.projectId = result.project_id;
    state.previousScope = result.scope;
    renderScope(result.scope);
    byId('scope-version').textContent = `Project ${result.project_id.slice(0, 8)} · Revision ${result.revision}`;
    byId('approve-scope').disabled = false;
    byId('reject-scope').disabled = false;
    showInfo(byId('meeting-status'), `Scope saved. Analysis mode: ${result.scope.analysis_mode}. The proposal remains internal until a reviewer approves it.`);
  } catch (error) {
    showError(byId('meeting-status'), error);
  } finally {
    button.disabled = false;
  }
});

async function recordApproval(approved) {
  if (!state.projectId) return;
  const reviewer = byId('reviewer-name').value.trim();
  if (!reviewer) {
    showError(byId('meeting-status'), 'Enter the reviewer name to record the decision.');
    return;
  }
  try {
    const result = await requestJson(`${API.meeting}/engagements/${encodeURIComponent(state.projectId)}/approve`, {
      method: 'POST',
      body: JSON.stringify({ reviewer, approved, notes: byId('approval-notes').value }),
    });
    showInfo(byId('meeting-status'), `Internal review recorded: ${result.approval_status}. This does not send the proposal.`);
  } catch (error) {
    showError(byId('meeting-status'), error);
  }
}

byId('approve-scope').addEventListener('click', () => recordApproval(true));
byId('reject-scope').addEventListener('click', () => recordApproval(false));

Promise.all([checkHealth(), refreshCrawlStatus(), refreshExpertTasks(), loadEmails(), refreshLearning(), loadMeetingSamples()]);
window.setInterval(checkHealth, 30000);
window.setInterval(refreshCrawlStatus, 5000);
