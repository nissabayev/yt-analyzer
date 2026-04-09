const urlInput = document.getElementById('urlInput');
const analyzeBtn = document.getElementById('analyzeBtn');
const loading = document.getElementById('loading');
const results = document.getElementById('results');
const errorEl = document.getElementById('error');

let analysisData = null;
let activeTab = 'all';

analyzeBtn.addEventListener('click', analyze);
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') analyze();
});

document.querySelector('.tabs').addEventListener('click', (e) => {
  if (!e.target.classList.contains('tab')) return;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  e.target.classList.add('active');
  activeTab = e.target.dataset.tab;
  renderComments();
});

async function analyze() {
  const url = urlInput.value.trim();
  if (!url) return;

  errorEl.classList.add('hidden');
  results.classList.add('hidden');
  loading.classList.remove('hidden');
  analyzeBtn.disabled = true;

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Analysis failed');

    analysisData = data;
    renderResults(data);
    results.classList.remove('hidden');
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  } finally {
    loading.classList.add('hidden');
    analyzeBtn.disabled = false;
  }
}

function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function renderResults(data) {
  const { stats, keywords, overallSentiment, relevantSentiment } = data;

  // Video card
  document.getElementById('thumbnail').src = stats.thumbnail;
  document.getElementById('videoTitle').textContent = stats.title;
  document.getElementById('videoChannel').textContent = stats.channel;
  document.getElementById('videoDate').textContent = new Date(stats.publishedAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  // Stats
  document.getElementById('statViews').textContent = fmt(stats.views);
  document.getElementById('statLikes').textContent = fmt(stats.likes);
  document.getElementById('statComments').textContent = fmt(stats.commentCount);
  document.getElementById('statEngagement').textContent = stats.engagement + '%';

  // All comments sentiment
  const allTotal = data.totalCommentsFetched;
  document.getElementById('allCount').textContent = `(${allTotal} comments)`;
  renderSentimentCard('All', overallSentiment, allTotal);

  // Relevant comments sentiment
  const agg = relevantSentiment.aggregate;
  const relTotal = data.relevantCount;
  document.getElementById('relevantCount').textContent = `(${relTotal} of ${allTotal})`;
  renderSentimentCard('Rel', agg, relTotal);

  // Summary
  document.getElementById('summaryText').textContent = data.summary || '';

  // Keywords
  const pillsEl = document.getElementById('keywordPills');
  pillsEl.innerHTML = keywords.map(k =>
    `<span class="pill">${esc(k.word)}<span class="count">${k.count}</span></span>`
  ).join('');

  // Comments
  renderComments();
}

function renderSentimentCard(prefix, agg, total) {
  const circ = 2 * Math.PI * 60; // circumference for r=60
  const pos = agg.positive;
  const neg = agg.negative;
  const neu = agg.neutral;

  // Donut segments: positive, then negative, then neutral
  const posLen = (pos / 100) * circ;
  const negLen = (neg / 100) * circ;
  const neuLen = (neu / 100) * circ;

  const posEl = document.getElementById(`donut${prefix}Positive`);
  const negEl = document.getElementById(`donut${prefix}Negative`);
  const neuEl = document.getElementById(`donut${prefix}Neutral`);

  posEl.style.strokeDasharray = `${posLen} ${circ}`;
  posEl.style.strokeDashoffset = '0';

  negEl.style.strokeDasharray = `${negLen} ${circ}`;
  negEl.style.strokeDashoffset = `${-posLen}`;

  neuEl.style.strokeDasharray = `${neuLen} ${circ}`;
  neuEl.style.strokeDashoffset = `${-(posLen + negLen)}`;

  // Center label — show dominant sentiment
  const dominant = pos >= neg && pos >= neu ? 'positive' : neg >= pos && neg >= neu ? 'negative' : 'neutral';
  const dominantPct = dominant === 'positive' ? pos : dominant === 'negative' ? neg : neu;
  const colors = { positive: 'var(--positive)', negative: 'var(--negative)', neutral: 'var(--neutral)' };
  const icons = { positive: '&#128578;', negative: '&#128543;', neutral: '&#128528;' };
  const iconBgs = { positive: 'rgba(34,197,94,0.15)', negative: 'rgba(239,68,68,0.15)', neutral: 'rgba(100,116,139,0.15)' };

  document.getElementById(`donut${prefix}Pct`).textContent = Math.round(dominantPct) + '%';
  const labelEl = document.getElementById(`donut${prefix}Label`);
  labelEl.textContent = dominant.toUpperCase();
  labelEl.style.color = colors[dominant];

  // Icon
  const iconId = prefix === 'All' ? 'allSentimentIcon' : 'relSentimentIcon';
  const iconEl = document.getElementById(iconId);
  iconEl.innerHTML = icons[dominant];
  iconEl.style.background = iconBgs[dominant];

  // Legend bars and counts
  const posCount = Math.round((pos / 100) * total);
  const negCount = Math.round((neg / 100) * total);
  const neuCount = Math.round((neu / 100) * total);

  const suffix = prefix === 'All' ? 'All' : '';
  document.getElementById(`pct${suffix}Positive`).textContent = pos + '%';
  document.getElementById(`pct${suffix}Neutral`).textContent = neu + '%';
  document.getElementById(`pct${suffix}Negative`).textContent = neg + '%';
  document.getElementById(`bar${suffix}Positive`).style.width = pos + '%';
  document.getElementById(`bar${suffix}Neutral`).style.width = neu + '%';
  document.getElementById(`bar${suffix}Negative`).style.width = neg + '%';
  document.getElementById(`count${suffix}Positive`).textContent = posCount + ' comments';
  document.getElementById(`count${suffix}Neutral`).textContent = neuCount + ' comments';
  document.getElementById(`count${suffix}Negative`).textContent = negCount + ' comments';
}

function renderComments() {
  if (!analysisData) return;
  const list = document.getElementById('commentsList');
  let comments = analysisData.relevantSentiment.comments;

  if (activeTab === 'questions') {
    comments = comments.filter(c => c.isQuestion);
  } else if (activeTab === 'positive' || activeTab === 'negative' || activeTab === 'neutral') {
    comments = comments.filter(c => c.sentiment === activeTab);
  }

  if (!comments.length) {
    list.innerHTML = `<div class="no-comments">${activeTab === 'questions' ? 'No questions found.' : 'No relevant comments found.'}</div>`;
    return;
  }

  list.innerHTML = comments.map(c => `
    <div class="comment-card">
      <img class="avatar" src="${esc(c.authorAvatar)}" alt="" loading="lazy">
      <div class="comment-body">
        <div class="comment-header">
          <span class="comment-author">${esc(c.author)}</span>
          <span class="sentiment-tag ${c.sentiment}">${c.sentiment}</span>
        </div>
        <p class="comment-text">${esc(c.text)}</p>
        <div class="comment-likes">&#x1F44D; ${c.likeCount}</div>
      </div>
    </div>
  `).join('');
}

function esc(str) {
  const el = document.createElement('span');
  el.textContent = str || '';
  return el.innerHTML;
}
