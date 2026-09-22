const views = {
  landing: document.getElementById('view-landing'),
  form: document.getElementById('view-form'),
  loading: document.getElementById('view-loading'),
  error: document.getElementById('view-error'),
  results: document.getElementById('view-results'),
};

function showView(name) {
  Object.values(views).forEach((el) => { el.hidden = true; });
  views[name].hidden = false;
  window.scrollTo({ top: 0, behavior: 'instant' });
}

document.getElementById('btn-start').addEventListener('click', () => { clearFieldErrors(); showView('form'); });
document.getElementById('btn-back-from-form').addEventListener('click', () => showView('landing'));
document.getElementById('btn-back-from-results').addEventListener('click', () => showView('landing'));
document.getElementById('btn-error-back').addEventListener('click', () => { clearFieldErrors(); showView('form'); });
document.getElementById('btn-error-retry').addEventListener('click', () => {
  document.getElementById('profile-form').requestSubmit();
});

document.getElementById('btn-demo').addEventListener('click', async () => {
  showView('loading');
  document.getElementById('loading-headline').textContent = 'Loading the example run…';
  document.getElementById('loading-sub').textContent = 'This is real output from an actual run, not invented.';
  try {
    const res = await fetch('demo-data.json');
    const data = await res.json();
    renderResults(data.results, data.digest, true);
  } catch (err) {
    showError('Could not load the example data. ' + err.message);
  }
});

// Field-level validation, matching the Figma 01B validation-error screen:
// an inline message under each invalid required field, plus a banner at
// the top of the form. Required fields only — optional fields never block.
const REQUIRED_FIELDS = ['educationLevel', 'fieldOfStudy', 'country'];

function clearFieldErrors() {
  document.getElementById('form-error-banner').hidden = true;
  for (const id of REQUIRED_FIELDS) {
    document.getElementById(id).closest('.field').classList.remove('has-error');
    document.getElementById(`error-${id}`).hidden = true;
  }
}

function validateForm() {
  let hasError = false;
  for (const id of REQUIRED_FIELDS) {
    const field = document.getElementById(id);
    if (!field.value.trim()) {
      field.closest('.field').classList.add('has-error');
      document.getElementById(`error-${id}`).hidden = false;
      hasError = true;
    }
  }
  document.getElementById('form-error-banner').hidden = !hasError;
  return !hasError;
}

document.getElementById('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  clearFieldErrors();
  if (!validateForm()) return;

  const profile = {
    educationLevel: document.getElementById('educationLevel').value,
    fieldOfStudy: document.getElementById('fieldOfStudy').value,
    country: document.getElementById('country').value,
    fundingNeeded: document.getElementById('fundingNeeded').checked,
    gpaOrGrade: document.getElementById('gpaOrGrade').value || undefined,
    cvText: document.getElementById('cvText').value || undefined,
  };

  showView('loading');
  runLoadingMessages();

  try {
    const startRes = await fetch('/api/start-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
    });
    const startData = await startRes.json();

    if (!startRes.ok) {
      showError(startData.error || "We couldn't complete your search. Something interrupted the opportunity analysis. Please try again.");
      return;
    }

    await pollRunUntilDone(startData.runId);
  } catch (err) {
    showError("We couldn't complete your search. Something interrupted the opportunity analysis. Please try again.");
  }
});

document.getElementById('btn-no-results-edit').addEventListener('click', () => showView('form'));
document.getElementById('btn-no-results-retry').addEventListener('click', () => {
  document.getElementById('profile-form').requestSubmit();
});

// A real run takes several minutes, so poll for status instead of holding
// one request open the whole time — Vercel's serverless functions don't
// allow requests anywhere near that long.
async function pollRunUntilDone(runId) {
  const POLL_INTERVAL_MS = 5000;
  const MAX_POLL_MS = 20 * 60 * 1000; // generous ceiling, a real run has taken ~10 minutes
  const startedAt = Date.now();

  while (Date.now() - startedAt < MAX_POLL_MS) {
    if (views.loading.hidden) return; // user navigated away, stop polling

    const res = await fetch(`/api/check-run?runId=${encodeURIComponent(runId)}`);
    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Could not check run status.');
      return;
    }

    if (data.status === 'SUCCEEDED') {
      const results = data.results || [];
      const digest = buildLocalDigest(results);
      renderResults(results, digest, false);
      return;
    }

    if (data.status === 'FAILED' || data.status === 'ABORTED' || data.status === 'TIMED-OUT') {
      showError(data.error || `The run ended unexpectedly (${data.status}).`);
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  showError('This run is taking longer than expected. Check back in a few minutes, or try again.');
}

// The live run takes several minutes; cycle through honest stage messages
// instead of a static spinner with no context.
function runLoadingMessages() {
  const headline = document.getElementById('loading-headline');
  const stages = [
    'Scanning listings…',
    'Checking eligibility against your profile…',
    'Gathering trust evidence…',
    'Still working — this step paces itself deliberately…',
  ];
  let i = 0;
  headline.textContent = stages[0];
  const interval = setInterval(() => {
    i = (i + 1) % stages.length;
    if (!views.loading.hidden) {
      headline.textContent = stages[i];
    } else {
      clearInterval(interval);
    }
  }, 12000);
}

function showError(message) {
  document.getElementById('error-message').textContent = message;
  showView('error');
}

function buildLocalDigest(results) {
  const counts = { total: results.length, eligible: 0, partial: 0, notEligible: 0, highRisk: 0, someConcerns: 0 };
  for (const r of results) {
    if (r.eligibilityMatch === 'Eligible') counts.eligible++;
    else if (r.eligibilityMatch === 'Partial') counts.partial++;
    else if (r.eligibilityMatch === 'Not Eligible') counts.notEligible++;
    if (r.trustRisk === 'High Risk') counts.highRisk++;
    else if (r.trustRisk === 'Some Concerns') counts.someConcerns++;
  }
  const summary = `Found ${counts.total} opportunities. ${counts.eligible} you're eligible for. ${counts.partial} need a closer look. ${counts.notEligible} you don't qualify for right now.`;
  return { summary, counts };
}

function badgeClassForMatch(match) {
  if (match === 'Eligible') return 'badge-eligible';
  if (match === 'Partial') return 'badge-partial';
  return 'badge-noteligible';
}

function badgeClassForRisk(risk) {
  if (risk === 'Low Risk') return 'badge-lowrisk';
  if (risk === 'Some Concerns') return 'badge-someconcerns';
  return 'badge-highrisk';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function renderResults(results, digest, isDemo) {
  document.getElementById('demo-banner').hidden = !isDemo;

  const list = document.getElementById('results-list');
  const noResults = document.getElementById('no-results');
  list.innerHTML = '';

  if (results.length === 0) {
    document.getElementById('digest-summary').textContent = '0 opportunities found';
    list.hidden = true;
    noResults.hidden = false;
    showView('results');
    return;
  }

  list.hidden = false;
  noResults.hidden = true;
  document.getElementById('digest-summary').textContent = digest?.summary || `Found ${results.length} opportunities.`;

  for (const r of results) {
    const card = document.createElement('div');
    card.className = 'listing-card';

    const titleHtml = r.link
      ? `<a href="${escapeHtml(r.link)}" target="_blank" rel="noopener">${escapeHtml(r.title)}</a>`
      : escapeHtml(r.title);

    let html = `
      <div class="listing-top">
        <div>
          <div class="listing-title">${titleHtml}</div>
          <div class="listing-meta">Deadline: ${escapeHtml(r.deadline || 'Not specified')} &middot; ${escapeHtml(r.urgency || 'Unknown')}</div>
        </div>
        <div class="badges">
          <span class="badge ${badgeClassForMatch(r.eligibilityMatch)}">${escapeHtml(r.eligibilityMatch || 'Unknown')}</span>
          <span class="badge ${badgeClassForRisk(r.trustRisk)}">${escapeHtml(r.trustRisk || 'Unknown')}</span>
          <span class="badge badge-confidence">${escapeHtml(r.trustConfidence || '?')} confidence</span>
        </div>
      </div>
      <div class="listing-body">
    `;

    if (r.description) {
      html += `<p class="listing-desc">${escapeHtml(r.description)}</p>`;
    }

    if (r.llmInterpretation) {
      html += `<div class="listing-note"><b>Eligibility:</b> ${escapeHtml(r.llmInterpretation)}</div>`;
    }

    if (r.missingRequirements?.length) {
      html += `<div class="listing-note"><b>Missing:</b> ${r.missingRequirements.map(escapeHtml).join(', ')}</div>`;
    }

    if (r.actionSteps?.length) {
      html += `<ul class="action-steps">${r.actionSteps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>`;
    }

    if (r.trustEvidence?.length) {
      html += `<div class="listing-note trust"><b>Trust evidence:</b> ${r.trustEvidence.map(escapeHtml).join('; ')}</div>`;
    }

    if (r.usedCvEvidence) {
      html += `<div class="listing-note">Checked against your CV</div>`;
    }

    html += '</div>';
    card.innerHTML = html;
    list.appendChild(card);
  }

  showView('results');
}
