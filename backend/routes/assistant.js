const express = require('express');
const auth = require('../middleware/auth');
const User = require('../models/User');

const router = express.Router();

const buildFallbackAnswer = (input = '', user = {}) => {
  const text = String(input || '').toLowerCase();
  const firstName = String(user.name || '').split(' ')[0] || 'there';

  if (!text.trim()) return `Hi ${firstName}. Ask me about Syncrova settings, marketplace access, messages, ranks, updates, or games.`;
  if (/market|sell|buy|verify|verification|id|cor/.test(text)) {
    if (user.isDeveloper) return 'Your developer account can use Marketplace without student verification. Regular student accounts still need approved ID or COR before buy and sell actions.';
    return 'Marketplace buy and sell needs approved student verification. Open Marketplace, upload a clear ID or COR, then wait for developer review.';
  }
  if (/rank|season|highest|current/.test(text)) {
    return 'Games rank is monthly. Current Rank can reset down at a new season, while Highest Rank is your lifetime best and only changes when you beat it.';
  }
  if (/dark|theme|blue|color|white/.test(text)) {
    return 'Theme controls are in Settings > App. Dark mode uses neutral dark surfaces, while light mode stays white with readable contrast.';
  }
  if (/update|apk|download|version/.test(text)) {
    return 'Syncrova checks Android updates after opening the mobile app. When a newer build is available, the in-app update card shows download status and opens the installer after download.';
  }
  if (/knife|duel|game|fullscreen|full screen|aim/.test(text)) {
    return 'For games, use the Full Screen button for a wider view. Knife Duel keeps the camera wider while aiming and applies HP changes at impact timing.';
  }
  if (/message|chat|developer|dev/.test(text)) {
    return 'Developer badges are shown from the actual message sender, so both sides of a chat can see when a sender is a developer.';
  }
  if (/profile|avatar|border|glow/.test(text)) {
    return 'Developer profile photos use a stronger blue supernova frame with animated sparks. Profile rank shows Current Rank and Highest Rank.';
  }

  return 'I can help with Syncrova app flows and account status. For private account changes, open Settings or the relevant page so the app can use your current signed-in state.';
};

const sanitizeHistory = (history = []) => (
  Array.isArray(history)
    ? history
        .slice(-8)
        .map(item => ({
          role: item?.role === 'assistant' ? 'assistant' : 'user',
          content: String(item?.text || item?.content || '').trim().slice(0, 900)
        }))
        .filter(item => item.content)
    : []
);

const getOpenAiStatus = () => ({
  configured: Boolean(process.env.OPENAI_API_KEY),
  model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
});

const buildAccountContext = (user = {}) => ({
  now: new Date().toISOString(),
  app: {
    name: 'Syncrova',
    currentVersion: process.env.APP_VERSION_NAME || '4.4.33',
    androidVersionCode: Number(process.env.APP_VERSION_CODE || 80)
  },
  account: {
    name: user.name || '',
    email: user.email || '',
    isDeveloper: Boolean(user.isDeveloper),
    marketplaceStatus: user.isDeveloper ? 'developer_access' : user.studentVerificationStatus || 'not_submitted',
    course: user.course || '',
    campus: user.campus || ''
  }
});

const getOpenAiAnswer = async ({ message, user, history }) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || typeof fetch !== 'function') return { answer: '', error: 'not_configured' };

  const controller = new AbortController();
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 12000);
  const timeout = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 12000);
  const cleanHistory = sanitizeHistory(history)
    .filter(item => item.content !== message)
    .slice(-6);
  const apiBaseUrl = String(process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');

  try {
    const response = await fetch(`${apiBaseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.2,
        max_tokens: 260,
        messages: [
          {
            role: 'system',
            content: [
              'You are Syncrova Assistant inside a campus social app.',
              'Give concise, accurate, friendly guidance based on the supplied live app/account context.',
              'Do not pretend to access private data that is not supplied.',
              'If something requires deployment, API keys, Render, or an APK build, say the concrete requirement.',
              'When the user asks how the app works, prefer current Syncrova behavior from context over generic advice.'
            ].join(' ')
          },
          {
            role: 'system',
            content: `Live Syncrova context: ${JSON.stringify(buildAccountContext(user))}`
          },
          ...cleanHistory,
          {
            role: 'user',
            content: message
          }
        ]
      })
    });

    if (!response.ok) {
      return { answer: '', error: `openai_${response.status}` };
    }
    const payload = await response.json();
    return {
      answer: String(payload?.choices?.[0]?.message?.content || '').trim().slice(0, 1200),
      error: ''
    };
  } catch (err) {
    return { answer: '', error: err?.name === 'AbortError' ? 'openai_timeout' : 'openai_error' };
  } finally {
    clearTimeout(timeout);
  }
};

router.get('/status', auth, (req, res) => {
  const status = getOpenAiStatus();
  res.json({
    configured: status.configured,
    model: status.model,
    source: status.configured ? 'openai' : 'syncrova'
  });
});

router.post('/message', auth, async (req, res) => {
  const message = String(req.body?.message || '').trim().slice(0, 1200);
  if (!message) return res.status(400).json({ msg: 'Message is required' });

  const user = await User.findById(req.user)
    .select('name email course campus isDeveloper studentVerificationStatus')
    .lean()
    .catch(() => null);
  const profile = user || {};
  const aiAnswer = await getOpenAiAnswer({ message, user: profile, history: req.body?.history });
  const fallbackAnswer = buildFallbackAnswer(message, profile);

  res.json({
    answer: aiAnswer.answer || fallbackAnswer,
    source: aiAnswer.answer ? 'openai' : 'syncrova',
    aiConfigured: getOpenAiStatus().configured,
    fallbackReason: aiAnswer.answer ? '' : aiAnswer.error
  });
});

module.exports = router;
