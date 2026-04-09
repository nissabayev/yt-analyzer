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

  // All comments sentiment bar
  document.getElementById('allCount').textContent = `(${data.totalCommentsFetched} comments)`;
  document.getElementById('barAllPositive').style.width = overallSentiment.positive + '%';
  document.getElementById('barAllNeutral').style.width = overallSentiment.neutral + '%';
  document.getElementById('barAllNegative').style.width = overallSentiment.negative + '%';
  document.getElementById('pctAllPositive').textContent = overallSentiment.positive + '%';
  document.getElementById('pctAllNeutral').textContent = overallSentiment.neutral + '%';
  document.getElementById('pctAllNegative').textContent = overallSentiment.negative + '%';

  // Relevant comments sentiment bar
  const agg = relevantSentiment.aggregate;
  document.getElementById('relevantCount').textContent =
    `(${data.relevantCount} of ${data.totalCommentsFetched} match keywords)`;
  document.getElementById('barPositive').style.width = agg.positive + '%';
  document.getElementById('barNeutral').style.width = agg.neutral + '%';
  document.getElementById('barNegative').style.width = agg.negative + '%';
  document.getElementById('pctPositive').textContent = agg.positive + '%';
  document.getElementById('pctNeutral').textContent = agg.neutral + '%';
  document.getElementById('pctNegative').textContent = agg.negative + '%';

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
