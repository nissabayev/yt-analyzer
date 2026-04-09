require('dotenv').config();
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// --- API Key Rotation ---

function parseKeys(envVar) {
  return (envVar || '').split(',').map(k => k.trim()).filter(Boolean);
}

const youtubeKeys = parseKeys(process.env.YOUTUBE_API_KEYS);
const geminiKeys = parseKeys(process.env.GEMINI_API_KEYS);

let ytKeyIndex = 0;
let geminiKeyIndex = 0;

function getYouTubeKey() {
  if (!youtubeKeys.length) throw new Error('No YouTube API keys configured');
  return youtubeKeys[ytKeyIndex % youtubeKeys.length];
}

function rotateYouTubeKey() {
  ytKeyIndex++;
}

function getGeminiKey() {
  if (!geminiKeys.length) throw new Error('No Gemini API keys configured');
  return geminiKeys[geminiKeyIndex % geminiKeys.length];
}

function rotateGeminiKey() {
  geminiKeyIndex++;
}

// --- YouTube helpers ---

function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

async function ytApiFetch(endpoint, params) {
  const maxRetries = youtubeKeys.length;
  for (let i = 0; i < maxRetries; i++) {
    const key = getYouTubeKey();
    const qs = new URLSearchParams({ ...params, key }).toString();
    const url = `https://www.googleapis.com/youtube/v3/${endpoint}?${qs}`;
    const res = await fetch(url);
    if (res.ok) return res.json();
    const body = await res.json().catch(() => ({}));
    const reason = body?.error?.errors?.[0]?.reason;
    if (reason === 'quotaExceeded' || reason === 'rateLimitExceeded') {
      console.warn(`YouTube key ${i} quota hit, rotating...`);
      rotateYouTubeKey();
      continue;
    }
    throw new Error(body?.error?.message || `YouTube API error ${res.status}`);
  }
  throw new Error('All YouTube API keys exhausted');
}

async function fetchVideoStats(videoId) {
  const data = await ytApiFetch('videos', {
    part: 'snippet,statistics',
    id: videoId,
  });
  if (!data.items?.length) throw new Error('Video not found');
  const item = data.items[0];
  const s = item.snippet;
  const st = item.statistics;
  const views = parseInt(st.viewCount || '0', 10);
  const likes = parseInt(st.likeCount || '0', 10);
  const comments = parseInt(st.commentCount || '0', 10);
  const engagement = views > 0 ? ((likes + comments) / views) * 100 : 0;
  return {
    title: s.title,
    channel: s.channelTitle,
    publishedAt: s.publishedAt,
    thumbnail: s.thumbnails?.maxres?.url || s.thumbnails?.high?.url || s.thumbnails?.medium?.url,
    views,
    likes,
    commentCount: comments,
    engagement: Math.round(engagement * 1000) / 1000,
  };
}

async function fetchAllComments(videoId) {
  const comments = [];
  let pageToken = '';
  const maxPages = 25;
  let pages = 0;

  do {
    const params = {
      part: 'snippet',
      videoId,
      maxResults: '100',
      order: 'relevance',
      textFormat: 'plainText',
    };
    if (pageToken) params.pageToken = pageToken;

    const data = await ytApiFetch('commentThreads', params);
    for (const item of (data.items || [])) {
      const c = item.snippet.topLevelComment.snippet;
      comments.push({
        author: c.authorDisplayName,
        authorAvatar: c.authorProfileImageUrl,
        text: c.textDisplay,
        likeCount: c.likeCount || 0,
        publishedAt: c.publishedAt,
      });
    }
    pageToken = data.nextPageToken || '';
    pages++;
  } while (pageToken && pages < maxPages);

  return comments;
}

// --- Comment filtering ---

const KEYWORDS = ['\\bAI\\b', 'Higgsfield', 'Seedance', 'video gen', 'generative', '\\bprompt\\b'];
const keywordRegex = new RegExp(KEYWORDS.join('|'), 'i');

function filterComments(comments) {
  return comments.filter(c => keywordRegex.test(c.text));
}

// --- Keyword extraction ---

function extractTopKeywords(comments, topN = 10) {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'before', 'after', 'and', 'but', 'or', 'nor', 'not', 'so', 'yet',
    'both', 'either', 'neither', 'each', 'every', 'all', 'any', 'few',
    'more', 'most', 'other', 'some', 'such', 'no', 'only', 'own', 'same',
    'than', 'too', 'very', 'just', 'because', 'if', 'when', 'where', 'how',
    'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'i',
    'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she',
    'her', 'it', 'its', 'they', 'them', 'their', 'about', 'up', 'out',
    'then', 'there', 'here', 'also', 'like', 'really', 'much', 'even',
    'still', 'get', 'got', 'make', 'made', 'one', 'two', 'now', 'well',
    'way', 'use', 'used', 'using', 'going', 'know', 'think', 'thing',
    'things', 'don', 'doesn', 'didn', 'won', 'isn', 'aren', 'wasn',
    'weren', 'hasn', 'haven', 'hadn', 'wouldn', 'couldn', 'shouldn',
    'it\'s', 'i\'m', 'don\'t', 'can\'t', 'that\'s', 'what\'s',
  ]);
  const freq = {};
  for (const c of comments) {
    const words = c.text.toLowerCase().replace(/[^a-z0-9\s'-]/g, '').split(/\s+/);
    for (const w of words) {
      if (w.length > 2 && !stopWords.has(w)) {
        freq[w] = (freq[w] || 0) + 1;
      }
    }
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }));
}

// --- Gemini helper ---

async function callGemini(prompt) {
  const maxRetries = geminiKeys.length;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const genAI = new GoogleGenerativeAI(getGeminiKey());
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err) {
      console.warn('Gemini error, rotating key:', err.message);
      rotateGeminiKey();
    }
  }
  throw new Error('All Gemini API keys exhausted');
}

// --- Sentiment analysis ---

async function analyzeSentiment(comments) {
  if (!comments.length) {
    return { comments: [], aggregate: { positive: 0, negative: 0, neutral: 0 } };
  }

  const batchSize = 30;
  const results = [];

  for (let i = 0; i < comments.length; i += batchSize) {
    const batch = comments.slice(i, i + batchSize);
    const prompt = `You are a sentiment classifier for YouTube comments. Classify each comment as exactly one of: positive, negative, or neutral.

Guidelines:
- "positive" = praise, excitement, enthusiasm, support, gratitude, compliments, optimism (e.g. "This is amazing!", "Best tool ever!", "Great video!")
- "negative" = criticism, frustration, anger, disappointment, complaints, fear, concern (e.g. "This is terrible", "I hate this", "This will destroy jobs")
- "neutral" = purely factual, informational, balanced without clear emotion, or genuinely mixed
- Comments with exclamation marks expressing enthusiasm are usually positive, not neutral
- If a comment expresses a clear opinion (good or bad), it is NOT neutral

Also determine if the comment contains a question (true/false).

Return ONLY a JSON array, no other text:
[{"index": 0, "sentiment": "positive", "isQuestion": false}]

Comments:
${batch.map((c, idx) => `[${idx}] ${c.text}`).join('\n')}`;

    try {
      const text = await callGemini(prompt);
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON array in response');
      const parsed = JSON.parse(jsonMatch[0]);

      for (const entry of parsed) {
        const comment = batch[entry.index];
        if (comment) {
          results.push({
            ...comment,
            sentiment: entry.sentiment || 'neutral',
            isQuestion: entry.isQuestion || false,
          });
        }
      }
    } catch (err) {
      console.warn('Sentiment batch failed:', err.message);
      for (const c of batch) {
        results.push({ ...c, sentiment: 'neutral', isQuestion: c.text.includes('?') });
      }
    }
  }

  const total = results.length;
  const pos = results.filter(r => r.sentiment === 'positive').length;
  const neg = results.filter(r => r.sentiment === 'negative').length;
  const neu = results.filter(r => r.sentiment === 'neutral').length;

  return {
    comments: results,
    aggregate: {
      positive: total ? Math.round((pos / total) * 1000) / 10 : 0,
      negative: total ? Math.round((neg / total) * 1000) / 10 : 0,
      neutral: total ? Math.round((neu / total) * 1000) / 10 : 0,
    },
  };
}

// --- Summary ---

async function generateSummary(comments, videoTitle) {
  if (!comments.length) return 'No relevant comments to summarize.';

  const sample = comments.slice(0, 50).map(c => c.text).join('\n---\n');
  const prompt = `Below are YouTube comments from the video "${videoTitle}" that mention AI, Higgsfield, Seedance, video generation, or related topics.

Write a concise 3-5 sentence summary of what commenters are saying about:
1. AI in general (overall sentiment, hopes, concerns)
2. Higgsfield specifically (if mentioned — what people think of it)

Be specific and reference actual themes from the comments. Do not use bullet points, just flowing prose.

Comments:
${sample}`;

  try {
    return await callGemini(prompt);
  } catch (err) {
    console.warn('Summary generation failed:', err.message);
    return 'Could not generate summary.';
  }
}

// --- API route ---

app.post('/api/analyze', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const videoId = extractVideoId(url);
    if (!videoId) return res.status(400).json({ error: 'Invalid YouTube URL' });

    const stats = await fetchVideoStats(videoId);
    const allComments = await fetchAllComments(videoId);
    const filtered = filterComments(allComments);

    filtered.sort((a, b) => b.likeCount - a.likeCount);

    const keywords = extractTopKeywords(filtered);
    const [overallSentiment, relevantSentiment, summary] = await Promise.all([
      analyzeSentiment(allComments),
      analyzeSentiment(filtered),
      generateSummary(filtered, stats.title),
    ]);

    res.json({
      stats,
      totalCommentsFetched: allComments.length,
      relevantCount: filtered.length,
      keywords,
      overallSentiment: overallSentiment.aggregate,
      relevantSentiment,
      summary,
    });
  } catch (err) {
    console.error('Analysis error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`yt-analyzer running at http://localhost:${PORT}`);
});
