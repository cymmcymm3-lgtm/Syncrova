const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const User = require('../models/User');
const GameSession = require('../models/GameSession');
const IssueReport = require('../models/IssueReport');
const { GAME_RANKS, buildGameLeaderboard, buildGameStats } = require('../services/gameRanks');
const gameRooms = require('../services/gameRooms');
const multiplayerConfig = require('../services/gameMultiplayerConfig');

const router = express.Router();

const VALID_DECISIONS = ['execute', 'schedule', 'delegate', 'unblock', 'review'];
const VALID_ISSUE_TYPES = ['problem', 'suggestion'];
const VALID_ISSUE_CATEGORIES = ['bug', 'feature', 'ui', 'performance', 'account', 'workspace', 'messages', 'other'];
const VALID_ISSUE_SEVERITIES = ['low', 'medium', 'high', 'critical'];
const VALID_ISSUE_STATUSES = ['new', 'reviewing', 'approved', 'rejected', 'resolved', 'closed'];
const ROUND_SIZE = 8;
const DURATION_SECONDS = 75;
const QUIZ_QUESTION_COUNT = 10;
const QUIZ_SECONDS_PER_QUESTION = 10;
const ARCADE_START_LIVES = 3;

const clampNumber = (value, min, max, fallback = 0) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
};

const decisionGuide = [
  { key: 'execute', label: 'Execute Now', detail: 'Urgent, high-impact work that should move immediately.' },
  { key: 'schedule', label: 'Schedule Sprint', detail: 'Important work that needs a planned slot.' },
  { key: 'delegate', label: 'Delegate', detail: 'Work best assigned to another owner or role.' },
  { key: 'unblock', label: 'Unblock First', detail: 'Blocked work that needs dependency removal before execution.' },
  { key: 'review', label: 'Review Gate', detail: 'Work that needs QA, approval, or decision validation.' }
];

const challengePool = [
  {
    title: 'Client demo build is failing',
    brief: 'The presentation is in 2 hours and the deployment check is red.',
    priority: 'critical',
    dueInHours: 2,
    estimateHours: 1,
    impact: 'high',
    signal: 'Deadline pressure + live delivery risk',
    correctAnswer: 'execute',
    basePoints: 190
  },
  {
    title: 'Payment copy needs final approval',
    brief: 'The wording is ready, but the owner has not approved the checkout text.',
    priority: 'high',
    dueInHours: 12,
    estimateHours: 1,
    impact: 'high',
    signal: 'Approval needed before release',
    correctAnswer: 'review',
    basePoints: 170
  },
  {
    title: 'Designer is waiting for brand assets',
    brief: 'The landing page cannot continue until the logo package is attached.',
    priority: 'high',
    dueInHours: 24,
    estimateHours: 2,
    impact: 'medium',
    signal: 'Blocked by missing dependency',
    correctAnswer: 'unblock',
    basePoints: 165
  },
  {
    title: 'Database cleanup for old test data',
    brief: 'Useful maintenance, but no current customer-facing deadline.',
    priority: 'low',
    dueInHours: 168,
    estimateHours: 3,
    impact: 'low',
    signal: 'Low urgency maintenance',
    correctAnswer: 'schedule',
    basePoints: 110
  },
  {
    title: 'Video upload compression task',
    brief: 'Needs media expertise and will take a full afternoon to tune.',
    priority: 'medium',
    dueInHours: 72,
    estimateHours: 6,
    impact: 'medium',
    signal: 'Specialized work + larger estimate',
    correctAnswer: 'delegate',
    basePoints: 145
  },
  {
    title: 'Security report needs verification',
    brief: 'A teammate flagged an auth issue, but impact must be confirmed first.',
    priority: 'critical',
    dueInHours: 8,
    estimateHours: 2,
    impact: 'high',
    signal: 'Risky change requiring review',
    correctAnswer: 'review',
    basePoints: 185
  },
  {
    title: 'Unread team messages about launch',
    brief: 'Three people are waiting for a decision on today’s release plan.',
    priority: 'high',
    dueInHours: 4,
    estimateHours: 1,
    impact: 'high',
    signal: 'Team blocked by your decision',
    correctAnswer: 'execute',
    basePoints: 175
  },
  {
    title: 'Analytics dashboard polish',
    brief: 'Nice improvement for next week, but current sprint scope is full.',
    priority: 'medium',
    dueInHours: 120,
    estimateHours: 4,
    impact: 'medium',
    signal: 'Valuable but not urgent',
    correctAnswer: 'schedule',
    basePoints: 130
  },
  {
    title: 'QA checklist assignment',
    brief: 'The checklist is clear and the QA lead has the right context.',
    priority: 'medium',
    dueInHours: 36,
    estimateHours: 3,
    impact: 'medium',
    signal: 'Clear owner fit',
    correctAnswer: 'delegate',
    basePoints: 135
  },
  {
    title: 'Missing API key blocks staging',
    brief: 'The staging server cannot run until environment access is fixed.',
    priority: 'critical',
    dueInHours: 6,
    estimateHours: 1,
    impact: 'high',
    signal: 'Environment dependency blocker',
    correctAnswer: 'unblock',
    basePoints: 185
  },
  {
    title: 'Profile avatar bug report',
    brief: 'Users cannot update avatars after the latest deployment.',
    priority: 'high',
    dueInHours: 18,
    estimateHours: 2,
    impact: 'high',
    signal: 'Active user-facing defect',
    correctAnswer: 'execute',
    basePoints: 175
  },
  {
    title: 'Rewrite onboarding labels',
    brief: 'The copy can improve clarity, but the feature still works today.',
    priority: 'low',
    dueInHours: 96,
    estimateHours: 2,
    impact: 'medium',
    signal: 'Non-blocking improvement',
    correctAnswer: 'schedule',
    basePoints: 115
  }
];

const typingPrompts = [
  'Prioritize the blocker, confirm the owner, and ship the safest fix before the sprint review.',
  'Clear communication turns a confusing bug report into an action plan the whole team can trust.',
  'A strong campus hub keeps decisions visible, tasks assigned, and updates easy to verify.',
  'When users report a problem, reproduce it, collect evidence, and explain the next step clearly.',
  'Fast work is useful only when the solution is accurate, stable, and easy for teammates to follow.',
  'The best developer response is calm, specific, and focused on what the member needs next.'
];

const typingSentenceBank = [
  ...typingPrompts,
  'Review the report, confirm the issue, and send a clear update to the member.',
  'A reliable team space keeps deadlines visible and ownership easy to understand.',
  'Before closing a ticket, test the fix and explain the result in simple terms.',
  'Good project flow depends on fast feedback, clean tasks, and responsible decisions.',
  'When the build is ready, check the risky parts before you announce the release.',
  'Invite the right people, assign the next action, and keep the campus hub organized.',
  'Strong developers protect user trust by fixing bugs with calm and careful notes.',
  'The dashboard should guide the team toward urgent work without feeling crowded.',
  'A polished profile helps classmates understand your course, campus, and role.',
  'Smooth collaboration feels quiet, fast, and clear even when the project is busy.'
];

const typingRaceBanks = {
  english: typingSentenceBank,
  filipino: [
    'Mabilis magbasa ang estudyante kapag malinaw ang aralin at maayos ang halimbawa.',
    'Kapag may tanong sa klase, makinig muna, isipin ang sagot, at magsalita nang malinaw.',
    'Ang maingat na pag-aaral ay nakakatulong sa proyekto, pagsusulit, at pang-araw-araw na gawain.',
    'Magandang sistema ang nagbibigay ng malinaw na direksyon sa bawat estudyante.',
    'Kapag nagtutulungan ang grupo, mas mabilis matapos ang mahirap na gawain.',
    'Ang tamang oras, sipag, at malinaw na plano ay mahalaga sa tagumpay ng proyekto.',
    'Basahin ang panuto bago magsimula para maiwasan ang paulit-ulit na pagkakamali.',
    'Ang maayos na komunikasyon ay nagpapadali sa trabaho ng buong klase.'
  ],
  programming: [
    'const total = items.filter(item => item.done).length;',
    'function normalizeName(value) { return String(value).trim().toLowerCase(); }',
    'if (!response.ok) throw new Error("Request failed");',
    'await api.post("/posts", { content, privacy, attachments });',
    'const usersById = new Map(users.map(user => [user.id, user]));',
    'return array.reduce((sum, value) => sum + Number(value || 0), 0);',
    'button.disabled = loading || selectedFiles.length === 0;',
    'router.get("/health", async (req, res) => res.json({ ok: true }));'
  ],
  grammar: [
    'The students are preparing their project before the final presentation.',
    'She has already submitted the report, but the teacher requested one revision.',
    'Clear instructions help every member understand what they need to do next.',
    'A complete sentence needs a subject, a verb, and a clear thought.',
    'The group was reviewing its notes while the developer fixed the issue.',
    'Good grammar makes feedback easier to read and harder to misunderstand.',
    'They were studying in the library when the announcement arrived.',
    'The application works better when each screen uses consistent wording.'
  ]
};

const typingEnglishWordBank = [
  'school', 'campus', 'student', 'teacher', 'lesson', 'project', 'library', 'notebook',
  'science', 'history', 'english', 'course', 'review', 'practice', 'answer', 'question',
  'future', 'leader', 'member', 'friend', 'message', 'profile', 'market', 'credit',
  'reward', 'typing', 'signal', 'reaction', 'window', 'button', 'update', 'upload',
  'storage', 'cloud', 'secure', 'simple', 'quick', 'steady', 'bright', 'honest',
  'better', 'strong', 'clear', 'focus', 'finish', 'result', 'winner', 'rank',
  'daily', 'weekly', 'record', 'badge', 'speed', 'accuracy', 'motion', 'design',
  'server', 'client', 'mobile', 'screen', 'system', 'search', 'create', 'share',
  'delete', 'photo', 'video', 'audio', 'report', 'status', 'online', 'ready',
  'player', 'match', 'room', 'start', 'countdown', 'bubble', 'canvas', 'smooth',
  'correct', 'wrong', 'input', 'space', 'logic', 'class', 'group', 'grade',
  'study', 'learn', 'build', 'solve', 'verify', 'deploy', 'release', 'version'
];

const quizBank = [
  { title: 'JavaScript scope', brief: 'Which keyword declares a block-scoped variable?', options: ['var', 'let', 'global', 'static'], correctAnswer: 'let', basePoints: 150 },
  { title: 'HTML document', brief: 'Which tag contains page metadata?', options: ['body', 'main', 'head', 'section'], correctAnswer: 'head', basePoints: 130 },
  { title: 'CSS layout', brief: 'Which CSS module is best for one-dimensional layout?', options: ['Grid', 'Flexbox', 'Canvas', 'SVG'], correctAnswer: 'Flexbox', basePoints: 140 },
  { title: 'HTTP success', brief: 'Which status code usually means the request succeeded?', options: ['200', '301', '404', '500'], correctAnswer: '200', basePoints: 120 },
  { title: 'Database key', brief: 'What uniquely identifies a row in a relational table?', options: ['Primary key', 'Foreign key', 'Index only', 'Trigger'], correctAnswer: 'Primary key', basePoints: 145 },
  { title: 'React state', brief: 'Which hook stores component state?', options: ['useMemo', 'useEffect', 'useState', 'useRef'], correctAnswer: 'useState', basePoints: 145 },
  { title: 'API format', brief: 'Which data format is most common for REST API responses?', options: ['JSON', 'MP3', 'PNG', 'CSS'], correctAnswer: 'JSON', basePoints: 120 },
  { title: 'Authentication', brief: 'What should never be stored in plain text?', options: ['Password', 'Display name', 'Theme color', 'Avatar URL'], correctAnswer: 'Password', basePoints: 160 },
  { title: 'Git workflow', brief: 'Which command records staged changes into history?', options: ['git add', 'git commit', 'git clone', 'git status'], correctAnswer: 'git commit', basePoints: 135 },
  { title: 'Algorithm', brief: 'Binary search requires data to be what?', options: ['Encrypted', 'Random', 'Sorted', 'Duplicated'], correctAnswer: 'Sorted', basePoints: 150 },
  { title: 'OOP', brief: 'What is bundling data with methods called?', options: ['Encapsulation', 'Compilation', 'Recursion', 'Normalization'], correctAnswer: 'Encapsulation', basePoints: 150 },
  { title: 'Security', brief: 'Which attack tries to inject database commands?', options: ['SQL injection', 'Phishing', 'DDoS', 'Brute force'], correctAnswer: 'SQL injection', basePoints: 165 },
  { title: 'Networking', brief: 'Which protocol secures HTTP traffic?', options: ['FTP', 'SSH', 'TLS', 'SMTP'], correctAnswer: 'TLS', basePoints: 150 },
  { title: 'Programming logic', brief: 'Which structure repeats code while a condition is true?', options: ['Loop', 'Array', 'Object', 'Module'], correctAnswer: 'Loop', basePoints: 115 },
  { title: 'Node.js', brief: 'Which file usually lists npm dependencies?', options: ['package.json', 'index.html', 'README.md', 'style.css'], correctAnswer: 'package.json', basePoints: 135 },
  { title: 'MongoDB', brief: 'MongoDB stores records as what?', options: ['Documents', 'Sheets', 'Slides', 'Frames'], correctAnswer: 'Documents', basePoints: 135 },
  { title: 'UI testing', brief: 'What is a likely sign of poor mobile responsiveness?', options: ['Readable text', 'Clipped buttons', 'Fast loading', 'Clear spacing'], correctAnswer: 'Clipped buttons', basePoints: 145 },
  { title: 'Performance', brief: 'What helps reduce initial JavaScript load?', options: ['Code splitting', 'More loops', 'Inline videos', 'Bigger images'], correctAnswer: 'Code splitting', basePoints: 155 },
  { title: 'Accessibility', brief: 'What helps screen readers understand an image?', options: ['alt text', 'box-shadow', 'z-index', 'padding'], correctAnswer: 'alt text', basePoints: 140 },
  { title: 'Cloud storage', brief: 'A CDN primarily helps deliver assets with lower what?', options: ['Latency', 'Contrast', 'Syntax', 'Schema'], correctAnswer: 'Latency', basePoints: 150 }
];

const quizFactBank = [
  ['JavaScript', 'Which keyword declares a block-scoped variable?', 'let', ['var', 'global', 'static'], 150],
  ['HTML', 'Which tag contains metadata for the document?', 'head', ['body', 'main', 'section'], 130],
  ['CSS', 'Which layout tool is best for one-dimensional rows or columns?', 'Flexbox', ['Grid', 'Canvas', 'SVG'], 140],
  ['HTTP', 'Which status code usually means a request succeeded?', '200', ['301', '404', '500'], 120],
  ['Database', 'What uniquely identifies a row in a relational table?', 'Primary key', ['Foreign key', 'Index only', 'Trigger'], 145],
  ['React', 'Which hook stores component state?', 'useState', ['useMemo', 'useEffect', 'useRef'], 145],
  ['REST API', 'Which response format is most common for REST APIs?', 'JSON', ['MP3', 'PNG', 'CSS'], 120],
  ['Security', 'What should never be stored in plain text?', 'Password', ['Display name', 'Theme color', 'Avatar URL'], 160],
  ['Git', 'Which command records staged changes into history?', 'git commit', ['git add', 'git clone', 'git status'], 135],
  ['Algorithm', 'Binary search requires data to be what?', 'Sorted', ['Encrypted', 'Random', 'Duplicated'], 150],
  ['OOP', 'What is bundling data with methods called?', 'Encapsulation', ['Compilation', 'Recursion', 'Normalization'], 150],
  ['Security', 'Which attack tries to inject database commands?', 'SQL injection', ['Phishing', 'DDoS', 'Brute force'], 165],
  ['Networking', 'Which protocol secures HTTP traffic?', 'TLS', ['FTP', 'SSH', 'SMTP'], 150],
  ['Logic', 'Which structure repeats code while a condition is true?', 'Loop', ['Array', 'Object', 'Module'], 115],
  ['Node.js', 'Which file usually lists npm dependencies?', 'package.json', ['index.html', 'README.md', 'style.css'], 135],
  ['MongoDB', 'MongoDB stores records as what?', 'Documents', ['Sheets', 'Slides', 'Frames'], 135],
  ['Responsive UI', 'What is a likely sign of poor mobile responsiveness?', 'Clipped buttons', ['Readable text', 'Fast loading', 'Clear spacing'], 145],
  ['Performance', 'What helps reduce initial JavaScript load?', 'Code splitting', ['More loops', 'Inline videos', 'Bigger images'], 155],
  ['Accessibility', 'What helps screen readers understand an image?', 'alt text', ['box-shadow', 'z-index', 'padding'], 140],
  ['Cloud', 'A CDN primarily helps deliver assets with lower what?', 'Latency', ['Contrast', 'Syntax', 'Schema'], 150],
  ['JavaScript', 'Which method creates a new array by transforming each item?', 'map', ['filter', 'reduce', 'push'], 145],
  ['JavaScript', 'Which method keeps only items that pass a test?', 'filter', ['map', 'splice', 'join'], 145],
  ['JavaScript', 'Which operator checks strict equality?', '===', ['=', '==', '!='], 140],
  ['Data Type', 'Which type represents true or false?', 'Boolean', ['String', 'Number', 'Array'], 115],
  ['Error Handling', 'Which block catches thrown errors in JavaScript?', 'catch', ['finally only', 'select', 'render'], 140],
  ['Async', 'What does a Promise represent?', 'Future result', ['CSS rule', 'Image file', 'Database table'], 150],
  ['Async', 'Which keyword pauses inside an async function until a Promise settles?', 'await', ['yield', 'return', 'break'], 150],
  ['API', 'Which HTTP method is commonly used to read data?', 'GET', ['POST', 'PUT', 'DELETE'], 125],
  ['API', 'Which HTTP method is commonly used to create data?', 'POST', ['GET', 'HEAD', 'OPTIONS'], 125],
  ['API', 'Which HTTP method is commonly used to replace or update data?', 'PUT', ['GET', 'TRACE', 'CONNECT'], 125],
  ['API', 'Which HTTP method is commonly used to remove data?', 'DELETE', ['PATCH', 'POST', 'HEAD'], 125],
  ['CSS', 'Which feature changes layout rules at different screen widths?', 'Media query', ['Box shadow', 'Opacity', 'Font weight'], 145],
  ['CSS', 'Which property controls stacking order?', 'z-index', ['display', 'margin', 'outline'], 135],
  ['CSS', 'Which layout tool is best for two-dimensional rows and columns?', 'CSS Grid', ['Float', 'Text align', 'Border radius'], 145],
  ['HTML', 'Which element is best for primary page content?', 'main', ['span', 'br', 'meta'], 130],
  ['HTML', 'Which attribute improves form label connection?', 'for', ['src', 'href', 'rel'], 130],
  ['Accessibility', 'Which ARIA attribute names a control when visible text is missing?', 'aria-label', ['aria-grid', 'aria-color', 'aria-size'], 150],
  ['Authentication', 'Which token format is often used for signed API sessions?', 'JWT', ['CSV', 'PNG', 'ZIP'], 150],
  ['Security', 'Which library family is used for password hashing?', 'bcrypt', ['lodash', 'moment', 'vite'], 155],
  ['Database', 'What links one relational table to another?', 'Foreign key', ['Primary color', 'CSS class', 'HTTP verb'], 145],
  ['Database', 'Which structure speeds up database lookups?', 'Index', ['Comment', 'Canvas', 'Gradient'], 145],
  ['MongoDB', 'Which field commonly stores MongoDB document identifiers?', '_id', ['class', 'href', 'alt'], 135],
  ['NPM', 'Which command installs dependencies from package.json?', 'npm install', ['npm delete', 'npm paint', 'npm browse'], 130],
  ['Vite', 'What is Vite mainly used for?', 'Frontend tooling', ['Database backup', 'Password hashing', 'Image compression only'], 135],
  ['React', 'What passes data from a parent component to a child?', 'props', ['indexes', 'headers', 'cookies'], 140],
  ['React', 'Which hook runs side effects after render?', 'useEffect', ['useState', 'useId', 'useMemo only'], 145],
  ['React', 'What should you avoid mutating directly in state?', 'Existing state object', ['A new object copy', 'A callback argument', 'A local constant'], 150],
  ['Algorithm', 'What technique solves a problem by calling itself?', 'Recursion', ['Minification', 'Hashing', 'Indexing'], 145],
  ['Data Structure', 'Which structure follows last-in, first-out?', 'Stack', ['Queue', 'Tree', 'Graph'], 145],
  ['Data Structure', 'Which structure follows first-in, first-out?', 'Queue', ['Stack', 'Heap', 'Set'], 145],
  ['Version Control', 'Which command shows changed files in a Git repository?', 'git status', ['git init only', 'git paint', 'git serve'], 125]
].map(([title, brief, correctAnswer, distractors, basePoints]) => ({
  title,
  brief,
  options: [correctAnswer, ...distractors],
  correctAnswer,
  basePoints
}));

const quizPromptVariants = [
  (fact) => fact.brief,
  (fact) => `In ${fact.title}, ${fact.brief.charAt(0).toLowerCase()}${fact.brief.slice(1)}`,
  (fact) => `Choose the correct answer: ${fact.brief}`,
  (fact) => `Computer fundamentals check: ${fact.brief}`,
  (fact) => `Programming language quiz: ${fact.brief}`,
  (fact) => `Web development quiz: ${fact.brief}`,
  (fact) => `Software engineering quiz: ${fact.brief}`,
  (fact) => `Quick review: ${fact.brief}`,
  (fact) => `Which option best answers this: ${fact.brief}`,
  (fact) => `For a beginner developer, ${fact.brief.charAt(0).toLowerCase()}${fact.brief.slice(1)}`,
  (fact) => `During a code review, ${fact.brief.charAt(0).toLowerCase()}${fact.brief.slice(1)}`,
  (fact) => `In a real project, ${fact.brief.charAt(0).toLowerCase()}${fact.brief.slice(1)}`,
  (fact) => `Pick the most accurate option: ${fact.brief}`,
  (fact) => `Identify the correct concept: ${fact.brief}`,
  (fact) => `What should a developer choose? ${fact.brief}`,
  (fact) => `Classroom coding question: ${fact.brief}`,
  (fact) => `Practical computing question: ${fact.brief}`,
  (fact) => `Technical interview warmup: ${fact.brief}`,
  (fact) => `Code basics challenge: ${fact.brief}`,
  (fact) => `Developer knowledge check: ${fact.brief}`
];

const generatedQuizBank = quizFactBank.flatMap((fact, factIndex) => (
  quizPromptVariants.map((buildBrief, variantIndex) => ({
    title: `${fact.title} ${variantIndex + 1}`,
    brief: buildBrief(fact),
    options: fact.options,
    correctAnswer: fact.correctAnswer,
    basePoints: fact.basePoints + ((factIndex + variantIndex) % 4) * 5
  }))
));

const normalizeTypingMode = (mode = '') => {
  const value = String(mode || '').trim().toLowerCase();
  return ['english', 'filipino', 'programming', 'grammar'].includes(value) ? value : 'english';
};

const createTypingSentences = (count = 18, mode = 'english') => {
  const pool = [...(typingRaceBanks[normalizeTypingMode(mode)] || typingSentenceBank)];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }
  const target = Math.min(count, pool.length);
  return pool.slice(0, target);
};

const createTypingWords = (count = 44) => {
  const pool = [...typingEnglishWordBank];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }
  if (count <= pool.length) return pool.slice(0, count);
  const words = [];
  while (words.length < count) {
    words.push(...pool.slice(0, count - words.length));
  }
  return words;
};

const sanitizeText = (value, maxLength) => String(value || '').trim().slice(0, maxLength);

const getDeveloperStatus = async (userId) => {
  const user = await User.findById(userId).select('name email avatar isDeveloper');
  return {
    user,
    isDeveloper: Boolean(user?.isDeveloper)
  };
};

const requireDeveloper = async (req, res) => {
  const { user, isDeveloper } = await getDeveloperStatus(req.user);
  if (!user) {
    res.status(404).json({ msg: 'User not found' });
    return null;
  }
  if (!isDeveloper) {
    res.status(403).json({ msg: 'Developer access required' });
    return null;
  }
  return user;
};

const populateIssue = (query) => query
  .populate('userId', 'name email avatar isDeveloper course')
  .populate('messages.senderId', 'name email avatar isDeveloper');

const canAccessIssue = (issue, userId, isDeveloper) => {
  if (isDeveloper) return true;
  return String(issue.userId?._id || issue.userId) === String(userId);
};

const levenshtein = (a = '', b = '') => {
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
};

const scoreTyping = (expected, typed, elapsedMs) => {
  const normalizedExpected = expected.replace(/\s+/g, ' ').trim();
  const normalizedTyped = typed.replace(/\s+/g, ' ').trim();
  const maxLength = Math.max(normalizedExpected.length, normalizedTyped.length, 1);
  const distance = levenshtein(normalizedExpected.toLowerCase(), normalizedTyped.toLowerCase());
  const accuracy = Math.max(0, Math.round((1 - (distance / maxLength)) * 100));
  const minutes = Math.max(elapsedMs / 60000, 0.02);
  const words = normalizedExpected.split(/\s+/).filter(Boolean).length;
  const wpm = Math.max(0, Math.round((words * (accuracy / 100)) / minutes));
  const elapsedSeconds = elapsedMs / 1000;
  const accuracyScore = accuracy * 20;
  const speedScore = Math.min(wpm, 140) * 16;
  const timeBonus = accuracy >= 90 ? Math.max(0, Math.round((60 - elapsedSeconds) * 9)) : 0;
  const perfectBonus = accuracy === 100 ? 500 : 0;
  const score = Math.max(0, Math.round(accuracyScore + speedScore + timeBonus + perfectBonus));

  return { accuracy, wpm, score };
};

const scoreSentenceStream = (expected, typedSentences, elapsedMs) => {
  const expectedSentences = expected.split(/\n+/).map(item => item.trim()).filter(Boolean);
  const cleanTypedSentences = (Array.isArray(typedSentences) ? typedSentences : [])
    .map(sentence => sanitizeText(sentence, 240))
    .filter(Boolean)
    .slice(0, expectedSentences.length);
  let correctCount = 0;
  let currentStreak = 0;
  let maxStreak = 0;

  cleanTypedSentences.forEach((sentence, index) => {
    const cleanSentence = sentence.replace(/\s+/g, ' ').trim().toLowerCase();
    const expectedSentence = expectedSentences[index]?.replace(/\s+/g, ' ').trim().toLowerCase();
    const correct = cleanSentence === expectedSentence;
    if (correct) {
      correctCount += 1;
      currentStreak += 1;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  });

  const totalCount = Math.max(expectedSentences.length, 1);
  const accuracy = Math.round((correctCount / totalCount) * 100);
  const minutes = Math.max(elapsedMs / 60000, 0.02);
  const correctWords = cleanTypedSentences.reduce((sum, sentence, index) => {
    const cleanSentence = sentence.replace(/\s+/g, ' ').trim().toLowerCase();
    const expectedSentence = expectedSentences[index]?.replace(/\s+/g, ' ').trim().toLowerCase();
    return cleanSentence === expectedSentence ? sum + sentence.split(/\s+/).filter(Boolean).length : sum;
  }, 0);
  const wpm = Math.max(0, Math.round(correctWords / minutes));
  const score = Math.max(0, Math.round(
    (correctCount * 420)
    + (Math.min(wpm, 140) * 12)
    + (accuracy * 12)
    + (maxStreak * 95)
  ));

  return {
    accuracy,
    wpm,
    score,
    correctCount,
    totalCount,
    maxStreak,
    typedText: cleanTypedSentences.join('\n')
  };
};

const shuffle = (items) => {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = crypto.randomInt(index + 1);
    [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
  }
  return copy;
};

const publicChallenge = (challenge) => ({
  challengeId: challenge.challengeId,
  title: challenge.title,
  brief: challenge.brief,
  priority: challenge.priority,
  dueInHours: challenge.dueInHours,
  estimateHours: challenge.estimateHours,
  impact: challenge.impact,
  signal: challenge.signal,
  options: challenge.options || [],
  basePoints: challenge.basePoints
});

const createChallenges = () => shuffle(challengePool)
  .slice(0, ROUND_SIZE)
  .map(challenge => ({
    ...challenge,
    challengeId: crypto.randomUUID()
  }));

const createQuizQuestions = () => shuffle([...quizBank, ...generatedQuizBank])
  .slice(0, QUIZ_QUESTION_COUNT)
  .map(question => ({
    challengeId: crypto.randomUUID(),
    title: question.title,
    brief: question.brief,
    priority: 'medium',
    dueInHours: 1,
    estimateHours: 1,
    impact: 'medium',
    signal: 'Computer and programming knowledge check',
    options: shuffle(question.options),
    correctAnswer: question.correctAnswer,
    basePoints: question.basePoints
  }));

const scoreQuizSession = (session, submittedAnswers, now) => {
  const answerMap = new Map(
    (Array.isArray(submittedAnswers) ? submittedAnswers : [])
      .map(item => [String(item.challengeId), String(item.answer || '').trim()])
  );

  let score = 0;
  let correctCount = 0;
  let currentStreak = 0;
  let maxStreak = 0;

  const answers = session.challenges.map(challenge => {
    const answer = answerMap.get(challenge.challengeId) || 'timeout';
    const correct = answer === challenge.correctAnswer;
    let points = 0;
    if (correct) {
      currentStreak += 1;
      maxStreak = Math.max(maxStreak, currentStreak);
      correctCount += 1;
      points = challenge.basePoints + currentStreak * 25;
      score += points;
    } else {
      currentStreak = 0;
    }

    return { challengeId: challenge.challengeId, answer, correct, points };
  });

  const elapsedMs = Math.max(0, now.getTime() - session.startedAt.getTime());
  const elapsedSeconds = elapsedMs / 1000;
  const speedBonus = correctCount === session.challenges.length
    ? Math.max(0, Math.round((session.durationSeconds - elapsedSeconds) * 9))
    : Math.max(0, Math.round((session.durationSeconds - elapsedSeconds) * 2));

  return {
    answers,
    score: Math.max(0, Math.round(score + speedBonus)),
    correctCount,
    totalCount: session.challenges.length,
    maxStreak,
    elapsedMs,
    accuracy: Math.round((correctCount / Math.max(1, session.challenges.length)) * 100)
  };
};

const scoreSession = (session, submittedAnswers, now) => {
  const answerMap = new Map(
    (Array.isArray(submittedAnswers) ? submittedAnswers : [])
      .map(item => [String(item.challengeId), VALID_DECISIONS.includes(item.answer) ? item.answer : ''])
  );

  let score = 0;
  let correctCount = 0;
  let currentStreak = 0;
  let maxStreak = 0;

  const answers = session.challenges.map(challenge => {
    const answer = answerMap.get(challenge.challengeId) || 'timeout';
    const correct = answer === challenge.correctAnswer;
    let points = 0;

    if (correct) {
      currentStreak += 1;
      maxStreak = Math.max(maxStreak, currentStreak);
      correctCount += 1;
      points = challenge.basePoints + (currentStreak * 18);
      score += points;
    } else {
      currentStreak = 0;
    }

    return {
      challengeId: challenge.challengeId,
      answer,
      correct,
      points
    };
  });

  const elapsedMs = Math.max(0, now.getTime() - session.startedAt.getTime());
  const elapsedSeconds = elapsedMs / 1000;
  const speedBonus = Math.max(0, Math.round((session.durationSeconds - elapsedSeconds) * 4));

  return {
    answers,
    score: Math.max(0, Math.round(score + speedBonus)),
    correctCount,
    totalCount: session.challenges.length,
    maxStreak,
    elapsedMs
  };
};

const createCompletedGameSession = async ({
  userId,
  gameKey,
  title,
  brief,
  signal,
  score,
  accuracy = 0,
  correctCount = 0,
  totalCount = 1,
  maxStreak = 0,
  elapsedMs = 1000
}) => {
  const now = new Date();
  const challengeId = crypto.randomUUID();
  const safeElapsedMs = clampNumber(elapsedMs, 1000, 60 * 60 * 1000, 1000);

  const session = new GameSession({
    userId,
    gameKey,
    durationSeconds: Math.max(1, Math.ceil(safeElapsedMs / 1000)),
    challenges: [{
      challengeId,
      title,
      brief,
      priority: 'medium',
      dueInHours: 1,
      estimateHours: 1,
      impact: 'medium',
      signal,
      correctAnswer: 'score',
      basePoints: score
    }],
    answers: [{
      challengeId,
      answer: `score:${score}`,
      correct: true,
      points: score
    }],
    score,
    accuracy,
    correctCount,
    totalCount,
    maxStreak,
    elapsedMs: safeElapsedMs,
    startedAt: new Date(now.getTime() - safeElapsedMs),
    expiresAt: now,
    completedAt: now
  });

  await session.save();
  return session;
};

const developerContributionScore = {
  reviewing: 180,
  approved: 520,
  rejected: 360,
  resolved: 650,
  closed: 260,
  reply: 140
};

const recordDeveloperContribution = async ({ userId, issue, action, detail }) => {
  const score = developerContributionScore[action] || 160;
  await createCompletedGameSession({
    userId,
    gameKey: 'developer-review',
    title: action === 'reply' ? 'Developer Response' : 'Developer Review',
    brief: action === 'reply'
      ? 'Responded to a member report with a developer follow-up.'
      : 'Reviewed a member report and updated the developer decision.',
    signal: detail || `Report: ${issue?.title || 'Member report'}. Status: ${issue?.status || action}.`,
    score,
    accuracy: 100,
    correctCount: 1,
    totalCount: 1,
    maxStreak: 1,
    elapsedMs: 2200
  });
};

const getMultiplayerGameKey = (gameType = '') => (
  gameType === 'reaction-tap' ? 'reaction-tap' : 'typing-sprint'
);

const buildMultiplayerContent = (gameType, body = {}) => {
  if (gameType !== 'typing-race') return {};

  const mode = 'english';
  const durationSeconds = clampNumber(
    body.durationSeconds,
    multiplayerConfig.typing.minDurationSeconds,
    multiplayerConfig.typing.maxDurationSeconds,
    multiplayerConfig.typing.defaultDurationSeconds
  );
  const sentences = createTypingWords(multiplayerConfig.typing.sentenceCount);

  return {
    typingMode: mode,
    durationSeconds,
    sentences,
    prompt: sentences.join('\n')
  };
};

const getCurrentUser = async (req) => {
  const user = await User.findById(req.user).select('name email avatar');
  if (!user) {
    const error = new Error('Session expired. Please log in again.');
    error.status = 401;
    throw error;
  }
  return user;
};

const getOpponentList = (room, player) => room.players
  .filter(candidate => candidate.userId !== player.userId)
  .map(candidate => ({
    userId: mongoose.Types.ObjectId.isValid(candidate.userId) ? candidate.userId : undefined,
    name: candidate.name
  }))
  .filter(candidate => candidate.userId);

const buildRewardSummary = ({ result, previousSessions }) => {
  if (
    !result
    || result.disqualified
    || (result.falseStarts || 0) > 0
    || (result.flags || []).includes('false-start')
    || (result.flags || []).includes('disconnected')
    || (result.flags || []).includes('impossible-wpm')
    || (result.flags || []).includes('instant-finish')
  ) {
    return {
      xp: 0,
      credits: 0,
      rankBonusXp: 0,
      rankBonusCredits: 0,
      streakBonusXp: 0,
      streakBonusCredits: 0,
      eligible: false
    };
  }

  const isWinner = result.rank === 1;
  const isSecond = result.rank === 2;
  const rankBonusXp = isWinner
    ? multiplayerConfig.rewards.winnerXp - multiplayerConfig.rewards.participantXp
    : isSecond ? multiplayerConfig.rewards.secondPlaceXp : 0;
  const rankBonusCredits = isWinner
    ? multiplayerConfig.rewards.winnerCredits - multiplayerConfig.rewards.participantCredits
    : isSecond ? multiplayerConfig.rewards.secondPlaceCredits : 0;
  const hasWinStreak = isWinner && previousSessions[0]?.placement === 1;
  const streakBonusXp = hasWinStreak ? multiplayerConfig.rewards.streakXp : 0;
  const streakBonusCredits = hasWinStreak ? multiplayerConfig.rewards.streakCredits : 0;

  return {
    xp: multiplayerConfig.rewards.participantXp + rankBonusXp + streakBonusXp,
    credits: multiplayerConfig.rewards.participantCredits + rankBonusCredits + streakBonusCredits,
    rankBonusXp,
    rankBonusCredits,
    streakBonusXp,
    streakBonusCredits,
    eligible: true
  };
};

const buildAchievements = (gameType, result, previousSessions) => {
  const achievements = [];

  if (gameType === 'typing-race') {
    if ((result.wpm || 0) >= 50) achievements.push('Speedster');
    if ((result.accuracy || 0) >= 95) achievements.push('Accuracy Master');
    if ((result.totalCount || 0) > 0 && result.correctCount === result.totalCount) achievements.push('No Mistake Run');
    return achievements;
  }

  if ((result.bestReactionMs || 0) > 0 && result.bestReactionMs < 200) achievements.push('Lightning Reflex');
  const recentNoFalseStarts = previousSessions
    .slice(0, 4)
    .every(session => (session.falseStarts || 0) === 0 && !(session.flags || []).includes('false-start'));
  if ((result.falseStarts || 0) === 0 && previousSessions.length >= 4 && recentNoFalseStarts) {
    achievements.push('Perfect Start');
  }
  const previousWins = previousSessions.filter(session => session.placement === 1).length;
  if (result.rank === 1 && previousWins >= 4) achievements.push('Tap Champion');
  return achievements;
};

const persistFinishedRoom = async (room) => {
  if (!room || room.status !== 'finished' || room.persistedAt) return room;
  if (room.persistingAt) return room;
  room.persistingAt = Date.now();

  try {
    const completedAt = new Date(room.finishedAt || Date.now());
    const startedAt = new Date(room.startedAt || room.createdAt || Date.now());
    const gameKey = getMultiplayerGameKey(room.gameType);

    for (const player of room.players) {
      const result = player.result;
      if (!result || !mongoose.Types.ObjectId.isValid(player.userId)) continue;

      const existing = await GameSession.findOne({
        userId: player.userId,
        roomId: room.id,
        gameKey
      }).select('_id rewardSummary achievements xpEarned creditsEarned');
      if (existing) {
        result.sessionId = existing._id;
        result.rewardSummary = existing.rewardSummary || null;
        result.achievements = existing.achievements || [];
        continue;
      }

      const previousSessions = await GameSession.find({
        userId: player.userId,
        gameKey,
        mode: 'multiplayer',
        completedAt: { $ne: null }
      }).sort({ completedAt: -1 }).limit(10).lean();
      const rewards = buildRewardSummary({ result, previousSessions });
      const achievements = buildAchievements(room.gameType, result, previousSessions);
      const challengeId = crypto.randomUUID();
      const session = new GameSession({
        userId: player.userId,
        gameKey,
        mode: 'multiplayer',
        roomId: room.id,
        roomCode: room.code,
        opponents: getOpponentList(room, player),
        placement: result.rank || null,
        xpEarned: rewards.xp,
        creditsEarned: rewards.credits,
        rewardSummary: rewards,
        achievements,
        flags: result.flags || [],
        bestReactionMs: result.bestReactionMs || 0,
        averageReactionMs: result.averageReactionMs || 0,
        falseStarts: result.falseStarts || 0,
        disqualified: Boolean(result.disqualified),
        durationSeconds: Math.max(1, Math.ceil((result.elapsedMs || 1000) / 1000)),
        challenges: [{
          challengeId,
          title: room.gameType === 'typing-race' ? 'Typing Race Multiplayer' : 'Reaction Tap Multiplayer',
          brief: room.gameType === 'typing-race'
            ? room.prompt
            : `First to ${multiplayerConfig.reaction.targetPoints} points with server-controlled signal timing.`,
          priority: 'medium',
          dueInHours: 1,
          estimateHours: 1,
          impact: 'medium',
          signal: room.gameType === 'typing-race'
            ? `${result.wpm || 0} WPM, ${result.accuracy || 0}% accuracy.`
            : `Best ${result.bestReactionMs || 0}ms. Average ${result.averageReactionMs || 0}ms. False starts ${result.falseStarts || 0}.`,
          correctAnswer: 'score',
          basePoints: result.score || 0
        }],
        answers: [{
          challengeId,
          answer: `rank:${result.rank || 'dq'} score:${result.score || 0}`,
          correct: !result.disqualified,
          points: result.score || 0
        }],
        score: result.score || 0,
        accuracy: result.accuracy || 0,
        wpm: result.wpm || 0,
        correctCount: result.correctCount || result.playerPoints || 0,
        totalCount: result.totalCount || multiplayerConfig.reaction.targetPoints,
        maxStreak: result.maxStreak || result.playerPoints || 0,
        elapsedMs: result.elapsedMs || 1000,
        startedAt,
        expiresAt: completedAt,
        completedAt
      });

      await session.save();
      result.sessionId = session._id;
      result.rewardSummary = rewards;
      result.achievements = achievements;

      if (rewards.eligible && (rewards.xp > 0 || rewards.credits > 0)) {
        await User.updateOne(
          { _id: player.userId },
          { $inc: { gameRewardXp: rewards.xp, gameCredits: rewards.credits } }
        );
      }
    }

    room.persistedAt = Date.now();
  } catch (err) {
    room.persistingAt = null;
    throw err;
  }

  room.persistingAt = null;
  return room;
};

const sendSerializedRoom = async (req, res, room, status = 200) => {
  await persistFinishedRoom(room);
  const serialized = gameRooms.serializeRoom(room, req.user);
  if (!serialized) return res.status(404).json({ msg: 'Match no longer exists' });
  return res.status(status).json({ room: serialized });
};

const handleRoomError = (res, err, fallback = 'Failed to join match') => (
  res.status(err.status || 500).json({ msg: err.message || fallback })
);

const roomHasPlayer = (room, userId) => Boolean(
  room?.players?.some(player => player.userId === String(userId))
);

router.post('/typing-sprint/practice', auth, async (req, res) => {
  try {
    const mode = 'english';
    const durationSeconds = clampNumber(req.body?.durationSeconds, 30, 90, 45);
    const sentences = createTypingWords(52);
    res.status(201).json({
      mode: 'practice',
      prompt: sentences.join('\n'),
      sentences,
      raceMode: mode,
      durationSeconds,
      ranked: false
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/multiplayer/rooms/quick', auth, async (req, res) => {
  try {
    const gameType = String(req.body?.gameType || '').trim();
    const user = await getCurrentUser(req);
    const room = gameRooms.quickMatch({
      gameType,
      user,
      content: buildMultiplayerContent(gameType, req.body)
    });
    return sendSerializedRoom(req, res, room, 201);
  } catch (err) {
    return handleRoomError(res, err);
  }
});

router.post('/multiplayer/rooms/private', auth, async (req, res) => {
  try {
    const gameType = String(req.body?.gameType || '').trim();
    const user = await getCurrentUser(req);
    const room = gameRooms.createRoom({
      gameType,
      user,
      privateRoom: true,
      content: buildMultiplayerContent(gameType, req.body)
    });
    return sendSerializedRoom(req, res, room, 201);
  } catch (err) {
    return handleRoomError(res, err);
  }
});

router.post('/multiplayer/rooms/join', auth, async (req, res) => {
  try {
    const user = await getCurrentUser(req);
    const room = gameRooms.joinByCode({ code: req.body?.code, user });
    return sendSerializedRoom(req, res, room, 200);
  } catch (err) {
    return handleRoomError(res, err);
  }
});

router.get('/multiplayer/rooms/:roomId', auth, async (req, res) => {
  try {
    const room = gameRooms.touchRoom(req.params.roomId, req.user);
    if (room && !roomHasPlayer(room, req.user)) {
      return res.status(403).json({ msg: 'This match has already started. Please join another match.' });
    }
    return sendSerializedRoom(req, res, room);
  } catch (err) {
    return handleRoomError(res, err, 'Match no longer exists');
  }
});

router.post('/multiplayer/rooms/:roomId/heartbeat', auth, async (req, res) => {
  try {
    const room = gameRooms.touchRoom(req.params.roomId, req.user);
    if (room && !roomHasPlayer(room, req.user)) {
      return res.status(403).json({ msg: 'This match has already started. Please join another match.' });
    }
    return sendSerializedRoom(req, res, room);
  } catch (err) {
    return handleRoomError(res, err, 'Connection lost');
  }
});

router.post('/multiplayer/rooms/:roomId/ready', auth, async (req, res) => {
  try {
    const room = gameRooms.setReady({
      roomId: req.params.roomId,
      userId: req.user,
      ready: req.body?.ready !== false
    });
    return sendSerializedRoom(req, res, room);
  } catch (err) {
    return handleRoomError(res, err, 'Not enough players');
  }
});

router.post('/multiplayer/rooms/:roomId/start', auth, async (req, res) => {
  try {
    const room = gameRooms.hostStart({ roomId: req.params.roomId, userId: req.user });
    return sendSerializedRoom(req, res, room);
  } catch (err) {
    return handleRoomError(res, err, 'Not enough players');
  }
});

router.post('/multiplayer/rooms/:roomId/leave', auth, async (req, res) => {
  try {
    const room = gameRooms.leaveRoom({ roomId: req.params.roomId, userId: req.user });
    if (!room) return res.json({ ok: true });
    return sendSerializedRoom(req, res, room);
  } catch (err) {
    return handleRoomError(res, err, 'Connection lost');
  }
});

router.post('/multiplayer/rooms/:roomId/typing-progress', auth, async (req, res) => {
  try {
    const room = gameRooms.updateTypingProgress({
      roomId: req.params.roomId,
      userId: req.user,
      progress: req.body?.progress
    });
    return sendSerializedRoom(req, res, room);
  } catch (err) {
    return handleRoomError(res, err, 'Connection lost');
  }
});

router.post('/multiplayer/rooms/:roomId/typing-submit', auth, async (req, res) => {
  try {
    const room = gameRooms.getRoom(req.params.roomId);
    if (!room) return res.status(404).json({ msg: 'Match no longer exists' });
    if (room.gameType !== 'typing-race') return res.status(400).json({ msg: 'Failed to join match' });
    if (room.status === 'finished') return res.status(400).json({ msg: 'Game already finished' });
    if (room.status !== 'playing') return res.status(400).json({ msg: 'Match has not started yet' });

    const elapsedMs = Math.max(1000, Date.now() - (room.startedAt || Date.now()));
    const typedSentences = Array.isArray(req.body?.typedSentences)
      ? req.body.typedSentences.map(sentence => sanitizeText(sentence, 240))
      : [];
    const scored = scoreSentenceStream(room.prompt || '', typedSentences, elapsedMs);
    const flags = [];
    if (scored.wpm > multiplayerConfig.typing.impossibleWpm) flags.push('impossible-wpm');
    if (elapsedMs < multiplayerConfig.typing.minimumFinishMs && scored.correctCount >= (room.sentences?.length || 1)) {
      flags.push('instant-finish');
    }

    const updatedRoom = gameRooms.submitTypingResult({
      roomId: req.params.roomId,
      userId: req.user,
      result: {
        score: scored.score,
        accuracy: scored.accuracy,
        wpm: scored.wpm,
        correctCount: scored.correctCount,
        totalCount: scored.totalCount,
        maxStreak: scored.maxStreak,
        elapsedMs,
        typedText: scored.typedText,
        flags
      }
    });

    return sendSerializedRoom(req, res, updatedRoom);
  } catch (err) {
    return handleRoomError(res, err, 'Failed to save Typing Race');
  }
});

router.post('/multiplayer/rooms/:roomId/reaction-tap', auth, async (req, res) => {
  try {
    const room = gameRooms.tapReaction({ roomId: req.params.roomId, userId: req.user });
    return sendSerializedRoom(req, res, room);
  } catch (err) {
    return handleRoomError(res, err, 'Connection lost');
  }
});

router.post('/multiplayer/rooms/:roomId/rematch', auth, async (req, res) => {
  try {
    const room = gameRooms.getRoom(req.params.roomId);
    if (!room) return res.status(404).json({ msg: 'Match no longer exists' });
    const user = await getCurrentUser(req);
    const updatedRoom = gameRooms.voteRematch({
      roomId: req.params.roomId,
      user,
      content: buildMultiplayerContent(room.gameType, req.body)
    });
    return sendSerializedRoom(req, res, updatedRoom);
  } catch (err) {
    return handleRoomError(res, err, 'Failed to join rematch');
  }
});

const formatRecentMatch = (session) => ({
  id: session._id,
  gameType: session.gameKey === 'reaction-tap' ? 'Reaction Tap' : 'Typing Race',
  opponents: (session.opponents || []).map(opponent => opponent.name).filter(Boolean),
  rank: session.placement,
  score: session.score || 0,
  accuracy: session.accuracy || 0,
  wpm: session.wpm || 0,
  bestReactionMs: session.bestReactionMs || 0,
  averageReactionMs: session.averageReactionMs || 0,
  xpEarned: session.xpEarned || 0,
  creditsEarned: session.creditsEarned || 0,
  rewardSummary: session.rewardSummary || null,
  achievements: session.achievements || [],
  flags: session.flags || [],
  date: session.completedAt
});

router.get('/history/me', auth, async (req, res) => {
  try {
    const limit = clampNumber(req.query.limit, 1, 30, 10);
    const sessions = await GameSession.find({
      userId: req.user,
      mode: 'multiplayer',
      gameKey: { $in: ['typing-sprint', 'reaction-tap'] },
      completedAt: { $ne: null }
    }).sort({ completedAt: -1 }).limit(limit).lean();

    res.json({ matches: sessions.map(formatRecentMatch) });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

const getPeriodStart = (period = 'all') => {
  const now = new Date();
  if (period === 'daily') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  if (period === 'weekly') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - start.getDay());
    return start;
  }
  return null;
};

router.get('/leaderboards', auth, async (req, res) => {
  try {
    const gameType = String(req.query.gameType || 'typing-race');
    const metric = String(req.query.metric || (gameType === 'reaction-tap' ? 'reaction' : 'wpm'));
    const period = ['daily', 'weekly', 'all'].includes(req.query.period) ? req.query.period : 'weekly';
    const gameKey = getMultiplayerGameKey(gameType);
    const completedAt = { $ne: null };
    const periodStart = getPeriodStart(period);
    if (periodStart) completedAt.$gte = periodStart;
    const baseQuery = {
      gameKey,
      mode: 'multiplayer',
      disqualified: { $ne: true },
      completedAt
    };

    const sessions = await GameSession.find(
      metric === 'reaction' ? { ...baseQuery, bestReactionMs: { $gt: 0 } } : baseQuery
    )
      .populate('userId', 'name email course avatar isDeveloper')
      .sort(metric === 'reaction'
        ? { bestReactionMs: 1, score: -1 }
        : metric === 'accuracy'
          ? { accuracy: -1, score: -1 }
          : metric === 'wins'
            ? { completedAt: -1 }
            : { wpm: -1, score: -1 })
      .limit(300)
      .lean();

    let rows = [];
    if (metric === 'wins') {
      const grouped = new Map();
      sessions.forEach(session => {
        const id = String(session.userId?._id || session.userId || '');
        if (!id || session.placement !== 1) return;
        const current = grouped.get(id) || { user: session.userId, value: 0, score: 0 };
        current.value += 1;
        current.score += session.score || 0;
        grouped.set(id, current);
      });
      rows = [...grouped.values()].sort((a, b) => b.value - a.value || b.score - a.score);
    } else {
      const bestByUser = new Map();
      sessions.forEach(session => {
        const id = String(session.userId?._id || session.userId || '');
        if (!id || bestByUser.has(id)) return;
        bestByUser.set(id, {
          user: session.userId,
          value: metric === 'reaction'
            ? session.bestReactionMs || 0
            : metric === 'accuracy'
              ? session.accuracy || 0
              : session.wpm || session.score || 0,
          score: session.score || 0,
          accuracy: session.accuracy || 0,
          wpm: session.wpm || 0,
          bestReactionMs: session.bestReactionMs || 0
        });
      });
      rows = [...bestByUser.values()];
    }

    res.json({
      gameType,
      metric,
      period,
      leaders: rows.slice(0, 25).map((row, index) => ({
        rank: index + 1,
        value: row.value,
        score: row.score || 0,
        accuracy: row.accuracy || 0,
        wpm: row.wpm || 0,
        bestReactionMs: row.bestReactionMs || 0,
        user: row.user ? {
          id: row.user._id,
          name: row.user.name,
          email: row.user.email,
          course: row.user.course,
          avatar: row.user.avatar,
          isDeveloper: row.user.isDeveloper
        } : null
      }))
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

// The Games landing page asks for several derived views of the same sessions.
// Keep the response shape intact, but only read each member's completed
// sessions once and avoid hydrating challenge/answer payloads that never leave
// this endpoint.
const GAME_SUMMARY_SESSION_FIELDS = 'gameKey score accuracy wpm correctCount totalCount maxStreak elapsedMs completedAt startedAt createdAt achievements';
const GAME_LEADERBOARD_SESSION_FIELDS = 'userId score accuracy wpm correctCount totalCount maxStreak elapsedMs completedAt startedAt createdAt';
const GAME_LEADERBOARD_USER_FIELDS = 'name email course avatar isDeveloper';

const getSummaryLeaderboardSessions = (gameKey = '') => GameSession.find({
  ...(gameKey ? { gameKey } : {}),
  completedAt: { $ne: null }
})
  .select(GAME_LEADERBOARD_SESSION_FIELDS)
  .populate('userId', GAME_LEADERBOARD_USER_FIELDS)
  .sort({ score: -1 })
  .limit(300)
  .lean();

router.get('/summary/me', auth, async (req, res) => {
  try {
    const [
      mySessions,
      leaderboardSessions,
      typingLeaderboardSessions,
      blockLeaderboardSessions,
      bugHuntLeaderboardSessions,
      focusFlowLeaderboardSessions,
      jetFighterLeaderboardSessions,
      neonDriftLeaderboardSessions,
      reactionTapLeaderboardSessions,
      bowDuelLeaderboardSessions,
      codeQuizLeaderboardSessions
    ] = await Promise.all([
      GameSession.find({ userId: req.user, completedAt: { $ne: null } })
        .select(GAME_SUMMARY_SESSION_FIELDS)
        .lean(),
      getSummaryLeaderboardSessions(),
      getSummaryLeaderboardSessions('typing-sprint'),
      getSummaryLeaderboardSessions('block-stack'),
      getSummaryLeaderboardSessions('bug-hunt'),
      getSummaryLeaderboardSessions('focus-flow'),
      getSummaryLeaderboardSessions('jet-fighter'),
      getSummaryLeaderboardSessions('neon-drift'),
      getSummaryLeaderboardSessions('reaction-tap'),
      getSummaryLeaderboardSessions('bow-duel'),
      getSummaryLeaderboardSessions('code-quiz')
    ]);

    const mySessionsFor = (gameKey) => mySessions.filter(session => session.gameKey === gameKey);
    const myTypingSessions = mySessionsFor('typing-sprint');
    const myBlockSessions = mySessionsFor('block-stack');
    const myBugHuntSessions = mySessionsFor('bug-hunt');
    const myFocusFlowSessions = mySessionsFor('focus-flow');
    const myJetFighterSessions = mySessionsFor('jet-fighter');
    const myNeonDriftSessions = mySessionsFor('neon-drift');
    const myReactionTapSessions = mySessionsFor('reaction-tap');
    const myBowDuelSessions = mySessionsFor('bow-duel');
    const myCodeQuizSessions = mySessionsFor('code-quiz');

    const leaderboard = buildGameLeaderboard(leaderboardSessions);
    const typingLeaderboard = buildGameLeaderboard(typingLeaderboardSessions);
    const blockLeaderboard = buildGameLeaderboard(blockLeaderboardSessions);
    const bugHuntLeaderboard = buildGameLeaderboard(bugHuntLeaderboardSessions);
    const focusFlowLeaderboard = buildGameLeaderboard(focusFlowLeaderboardSessions);
    const jetFighterLeaderboard = buildGameLeaderboard(jetFighterLeaderboardSessions);
    const neonDriftLeaderboard = buildGameLeaderboard(neonDriftLeaderboardSessions);
    const reactionTapLeaderboard = buildGameLeaderboard(reactionTapLeaderboardSessions);
    const bowDuelLeaderboard = buildGameLeaderboard(bowDuelLeaderboardSessions);
    const codeQuizLeaderboard = buildGameLeaderboard(codeQuizLeaderboardSessions);
    const myRank = leaderboard.find(entry => String(entry.user._id) === String(req.user)) || null;
    const myTypingRank = typingLeaderboard.find(entry => String(entry.user._id) === String(req.user)) || null;
    const myBlockRank = blockLeaderboard.find(entry => String(entry.user._id) === String(req.user)) || null;
    const myBugHuntRank = bugHuntLeaderboard.find(entry => String(entry.user._id) === String(req.user)) || null;
    const myFocusFlowRank = focusFlowLeaderboard.find(entry => String(entry.user._id) === String(req.user)) || null;
    const myJetFighterRank = jetFighterLeaderboard.find(entry => String(entry.user._id) === String(req.user)) || null;
    const myNeonDriftRank = neonDriftLeaderboard.find(entry => String(entry.user._id) === String(req.user)) || null;
    const myReactionTapRank = reactionTapLeaderboard.find(entry => String(entry.user._id) === String(req.user)) || null;
    const myBowDuelRank = bowDuelLeaderboard.find(entry => String(entry.user._id) === String(req.user)) || null;
    const myCodeQuizRank = codeQuizLeaderboard.find(entry => String(entry.user._id) === String(req.user)) || null;

    res.json({
      stats: buildGameStats(mySessions),
      typingStats: buildGameStats(myTypingSessions),
      blockStats: buildGameStats(myBlockSessions),
      bugHuntStats: buildGameStats(myBugHuntSessions),
      focusFlowStats: buildGameStats(myFocusFlowSessions),
      jetFighterStats: buildGameStats(myJetFighterSessions),
      neonDriftStats: buildGameStats(myNeonDriftSessions),
      reactionTapStats: buildGameStats(myReactionTapSessions),
      bowDuelStats: buildGameStats(myBowDuelSessions),
      codeQuizStats: buildGameStats(myCodeQuizSessions),
      gameAchievements: [...new Set(mySessions.flatMap(session => session.achievements || []))],
      leaderboard: leaderboard.slice(0, 15),
      typingLeaderboard: typingLeaderboard.slice(0, 15),
      blockLeaderboard: blockLeaderboard.slice(0, 15),
      bugHuntLeaderboard: bugHuntLeaderboard.slice(0, 15),
      focusFlowLeaderboard: focusFlowLeaderboard.slice(0, 15),
      jetFighterLeaderboard: jetFighterLeaderboard.slice(0, 15),
      neonDriftLeaderboard: neonDriftLeaderboard.slice(0, 15),
      reactionTapLeaderboard: reactionTapLeaderboard.slice(0, 15),
      bowDuelLeaderboard: bowDuelLeaderboard.slice(0, 15),
      codeQuizLeaderboard: codeQuizLeaderboard.slice(0, 15),
      myRank,
      myTypingRank,
      myBlockRank,
      myBugHuntRank,
      myFocusFlowRank,
      myJetFighterRank,
      myNeonDriftRank,
      myReactionTapRank,
      myBowDuelRank,
      myCodeQuizRank,
      ranks: GAME_RANKS,
      decisions: decisionGuide
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.get('/developers/me', auth, async (req, res) => {
  try {
    const { user, isDeveloper } = await getDeveloperStatus(req.user);
    res.json({
      isDeveloper,
      user: user ? {
        _id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        isDeveloper
      } : null
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/developers/access', auth, async (req, res) => {
  res.status(410).json({
    msg: 'Developer access is assigned by admin email allowlist or server-side promotion.'
  });
});

router.get('/fix-arena/issues', auth, async (req, res) => {
  try {
    const { user, isDeveloper } = await getDeveloperStatus(req.user);
    if (!user) return res.status(404).json({ msg: 'User not found' });

    const issues = await populateIssue(
      IssueReport.find(isDeveloper ? {} : { userId: req.user }).sort({ updatedAt: -1 }).limit(100)
    );
    res.json({ issues, isDeveloper, developerOnly: isDeveloper });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/fix-arena/issues', auth, async (req, res) => {
  try {
    const { user, isDeveloper } = await getDeveloperStatus(req.user);
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    if (isDeveloper) {
      return res.status(403).json({ msg: 'Developers cannot submit member reports' });
    }

    const title = sanitizeText(req.body.title, 140);
    const details = sanitizeText(req.body.details, 2500);
    if (!title || !details) return res.status(400).json({ msg: 'Title and details are required' });

    const type = VALID_ISSUE_TYPES.includes(req.body.type) ? req.body.type : 'problem';
    const category = VALID_ISSUE_CATEGORIES.includes(req.body.category) ? req.body.category : 'other';
    const severity = VALID_ISSUE_SEVERITIES.includes(req.body.severity) ? req.body.severity : 'medium';
    const expected = sanitizeText(req.body.expected, 1200);
    const workspaceName = sanitizeText(req.body.workspaceName, 120);

    const issue = await IssueReport.create({
      userId: req.user,
      type,
      category,
      severity,
      title,
      details,
      expected,
      workspaceName,
      messages: [{
        senderId: req.user,
        role: 'member',
        text: 'Submitted this report for developer review.'
      }]
    });

    const populatedIssue = await populateIssue(IssueReport.findById(issue._id));

    res.status(201).json({
      msg: 'Report submitted to developers',
      issueId: issue._id,
      status: issue.status,
      issue: populatedIssue
    });
  } catch (err) {
    console.error('Issue report submit failed:', err);
    res.status(500).json({ msg: err.message });
  }
});

router.put('/fix-arena/issues/:issueId/status', auth, async (req, res) => {
  try {
    const developer = await requireDeveloper(req, res);
    if (!developer) return;
    if (!mongoose.Types.ObjectId.isValid(req.params.issueId)) return res.status(404).json({ msg: 'Report not found' });
    const status = VALID_ISSUE_STATUSES.includes(req.body.status) ? req.body.status : null;
    if (!status) return res.status(400).json({ msg: 'Invalid status' });

    const issue = await IssueReport.findById(req.params.issueId);
    if (!issue) return res.status(404).json({ msg: 'Report not found' });

    issue.status = status;
    issue.messages.push({
      senderId: req.user,
      role: 'developer',
      text: `Status changed to ${status}.`
    });
    await issue.save();
    await recordDeveloperContribution({
      userId: req.user,
      issue,
      action: status,
      detail: `Set "${issue.title}" to ${status}.`
    }).catch(err => console.warn('Developer contribution score failed:', err.message));

    res.json(await populateIssue(IssueReport.findById(issue._id)));
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.delete('/fix-arena/issues/:issueId', auth, async (req, res) => {
  try {
    const { user, isDeveloper } = await getDeveloperStatus(req.user);
    if (!user) return res.status(404).json({ msg: 'User not found' });
    if (!mongoose.Types.ObjectId.isValid(req.params.issueId)) return res.status(404).json({ msg: 'Report not found' });

    const issue = await IssueReport.findById(req.params.issueId);
    if (!issue) return res.status(404).json({ msg: 'Report not found' });
    if (!canAccessIssue(issue, req.user, isDeveloper)) {
      return res.status(403).json({ msg: 'Not authorized to delete this report' });
    }

    await IssueReport.deleteOne({ _id: issue._id });
    res.json({ msg: 'Report deleted', issueId: issue._id });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/fix-arena/issues/:issueId/messages', auth, async (req, res) => {
  try {
    const { user, isDeveloper } = await getDeveloperStatus(req.user);
    if (!user) return res.status(404).json({ msg: 'User not found' });
    if (!mongoose.Types.ObjectId.isValid(req.params.issueId)) return res.status(404).json({ msg: 'Report not found' });
    const text = sanitizeText(req.body.text, 1500);
    if (!text) return res.status(400).json({ msg: 'Message is required' });

    const issue = await IssueReport.findById(req.params.issueId);
    if (!issue) return res.status(404).json({ msg: 'Report not found' });
    if (!canAccessIssue(issue, req.user, isDeveloper)) {
      return res.status(403).json({ msg: 'Not authorized to message this report' });
    }

    issue.messages.push({
      senderId: req.user,
      role: isDeveloper ? 'developer' : 'member',
      text
    });
    if (isDeveloper && issue.status === 'new') issue.status = 'reviewing';
    await issue.save();
    if (isDeveloper) {
      await recordDeveloperContribution({
        userId: req.user,
        issue,
        action: 'reply',
        detail: `Replied to "${issue.title}".`
      }).catch(err => console.warn('Developer reply score failed:', err.message));
    }

    res.json(await populateIssue(IssueReport.findById(issue._id)));
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/typing-sprint/start', auth, async (req, res) => {
  try {
    const startedAt = new Date();
    const mode = 'english';
    const requestedDuration = clampNumber(req.body?.durationSeconds, 30, 90, 60);
    const sentences = createTypingWords(52);
    const prompt = sentences.join('\n');
    const session = new GameSession({
      userId: req.user,
      gameKey: 'typing-sprint',
      durationSeconds: requestedDuration,
      challenges: [{
        challengeId: crypto.randomUUID(),
        title: 'Typing Sprint',
        brief: prompt,
        priority: 'medium',
        dueInHours: 1,
        estimateHours: 1,
        impact: 'medium',
        signal: 'Type each sentence accurately and quickly before the timer ends.',
        correctAnswer: prompt,
        basePoints: 100
      }],
      totalCount: 1,
      startedAt,
      expiresAt: new Date(startedAt.getTime() + ((requestedDuration + 10) * 1000))
    });

    await session.save();
    res.status(201).json({
      sessionId: session._id,
      prompt,
      sentences,
      mode: 'sentence-stream',
      raceMode: mode,
      durationSeconds: requestedDuration,
      startedAt: session.startedAt,
      expiresAt: session.expiresAt
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/typing-sprint/:sessionId/submit', auth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.sessionId)) {
      return res.status(404).json({ msg: 'Typing session not found' });
    }

    const session = await GameSession.findOne({ _id: req.params.sessionId, userId: req.user, gameKey: 'typing-sprint' });
    if (!session) return res.status(404).json({ msg: 'Typing session not found' });
    if (session.completedAt) return res.status(400).json({ msg: 'Typing session already submitted' });

    const now = new Date();
    if (now > session.expiresAt) return res.status(400).json({ msg: 'Typing session expired' });

    const typedText = sanitizeText(req.body.text, 2000);
    const expected = session.challenges[0].correctAnswer;
    const elapsedMs = Math.max(1000, now.getTime() - session.startedAt.getTime());
    const isSentenceStream = req.body.mode === 'sentence-stream' && Array.isArray(req.body.typedSentences);
    const scored = isSentenceStream
      ? scoreSentenceStream(expected, req.body.typedSentences, elapsedMs)
      : scoreTyping(expected, typedText, elapsedMs);
    const answerText = isSentenceStream ? scored.typedText : typedText;

    session.answers = [{
      challengeId: session.challenges[0].challengeId,
      answer: answerText || 'blank',
      correct: isSentenceStream ? scored.correctCount > 0 : scored.accuracy === 100,
      points: scored.score
    }];
    session.score = scored.score;
    session.accuracy = scored.accuracy;
    session.wpm = scored.wpm;
    session.correctCount = isSentenceStream ? scored.correctCount : (scored.accuracy === 100 ? 1 : 0);
    session.totalCount = isSentenceStream ? scored.totalCount : 1;
    session.maxStreak = isSentenceStream ? scored.maxStreak : (scored.accuracy === 100 ? 1 : 0);
    session.elapsedMs = elapsedMs;
    session.completedAt = now;
    await session.save();

    const myTypingSessions = await GameSession.find({ userId: req.user, gameKey: 'typing-sprint', completedAt: { $ne: null } }).lean();

    res.json({
      result: {
        sessionId: session._id,
        score: session.score,
        accuracy: scored.accuracy,
        wpm: scored.wpm,
        elapsedMs,
        expected,
        correctCount: session.correctCount,
        totalCount: session.totalCount,
        maxStreak: session.maxStreak
      },
      stats: buildGameStats(myTypingSessions)
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/block-stack/submit', auth, async (req, res) => {
  try {
    const score = clampNumber(req.body.score, 0, 1000000);
    if (score <= 0) return res.status(400).json({ msg: 'Score must be greater than zero' });

    const moves = clampNumber(req.body.moves, 1, 1000, 1);
    const linesCleared = clampNumber(req.body.linesCleared, 0, 500);
    const maxCombo = clampNumber(req.body.maxCombo, 0, 100);
    const boardFill = clampNumber(req.body.boardFill, 0, 100);
    const elapsedMs = clampNumber(req.body.durationMs, 1000, 60 * 60 * 1000, 1000);
    const now = new Date();
    const challengeId = crypto.randomUUID();

    const session = new GameSession({
      userId: req.user,
      gameKey: 'block-stack',
      durationSeconds: Math.max(1, Math.ceil(elapsedMs / 1000)),
      challenges: [{
        challengeId,
        title: 'WorkGrid Blocks',
        brief: 'Place work cards, clear sprint lanes, and keep the project board open.',
        priority: 'medium',
        dueInHours: 1,
        estimateHours: 1,
        impact: 'medium',
        signal: `Moves: ${moves}. Lines cleared: ${linesCleared}. Board fill: ${boardFill}%.`,
        correctAnswer: 'score',
        basePoints: score
      }],
      answers: [{
        challengeId,
        answer: `score:${score}`,
        correct: true,
        points: score
      }],
      score,
      accuracy: boardFill,
      correctCount: linesCleared,
      totalCount: moves,
      maxStreak: maxCombo,
      elapsedMs,
      startedAt: new Date(now.getTime() - elapsedMs),
      expiresAt: now,
      completedAt: now
    });

    await session.save();

    const [mySessions, myBlockSessions] = await Promise.all([
      GameSession.find({ userId: req.user, completedAt: { $ne: null } }).lean(),
      GameSession.find({ userId: req.user, gameKey: 'block-stack', completedAt: { $ne: null } }).lean()
    ]);

    res.status(201).json({
      result: {
        sessionId: session._id,
        score,
        moves,
        linesCleared,
        maxCombo,
        boardFill,
        elapsedMs
      },
      stats: buildGameStats(mySessions),
      blockStats: buildGameStats(myBlockSessions)
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/bug-hunt/submit', auth, async (req, res) => {
  try {
    const score = clampNumber(req.body.score, 0, 1000000);
    if (score <= 0) return res.status(400).json({ msg: 'Score must be greater than zero' });

    const foundCount = clampNumber(req.body.foundCount, 0, 50);
    const totalCount = clampNumber(req.body.totalCount, 1, 50, 1);
    const mistakes = clampNumber(req.body.mistakes, 0, 200);
    const accuracy = clampNumber(req.body.accuracy, 0, 100);
    const secondsLeft = clampNumber(req.body.secondsLeft, 0, 300);
    const elapsedMs = clampNumber((45 - secondsLeft) * 1000, 1000, 45 * 1000, 1000);

    const session = await createCompletedGameSession({
      userId: req.user,
      gameKey: 'bug-hunt',
      title: 'Bug Hunt',
      brief: 'Find UI and workflow issues in a simulated campus screen.',
      signal: `Found ${foundCount}/${totalCount}. Mistakes: ${mistakes}. Seconds left: ${secondsLeft}.`,
      score,
      accuracy,
      correctCount: foundCount,
      totalCount,
      maxStreak: foundCount,
      elapsedMs
    });

    const [mySessions, myBugHuntSessions] = await Promise.all([
      GameSession.find({ userId: req.user, completedAt: { $ne: null } }).lean(),
      GameSession.find({ userId: req.user, gameKey: 'bug-hunt', completedAt: { $ne: null } }).lean()
    ]);

    res.status(201).json({
      result: {
        sessionId: session._id,
        score,
        foundCount,
        totalCount,
        mistakes,
        accuracy,
        elapsedMs
      },
      stats: buildGameStats(mySessions),
      bugHuntStats: buildGameStats(myBugHuntSessions)
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/focus-flow/submit', auth, async (req, res) => {
  try {
    const score = clampNumber(req.body.score, 0, 1000000);
    if (score <= 0) return res.status(400).json({ msg: 'Score must be greater than zero' });

    const hits = clampNumber(req.body.hits, 0, 1000);
    const total = clampNumber(req.body.total, 1, 1000, 1);
    const perfects = clampNumber(req.body.perfects, 0, 1000);
    const bestStreak = clampNumber(req.body.bestStreak, 0, 1000);
    const accuracy = clampNumber(req.body.accuracy, 0, 100);
    const misses = clampNumber(req.body.misses, 0, 1000);
    const elapsedMs = clampNumber(req.body.elapsedMs || (total * 1800), 1000, 20 * 60 * 1000, 1000);

    const session = await createCompletedGameSession({
      userId: req.user,
      gameKey: 'focus-flow',
      title: 'Focus Flow',
      brief: 'Lock the moving signal inside the focus window with accurate timing.',
      signal: `Hits ${hits}/${total}. Perfect hits: ${perfects}. Best streak: ${bestStreak}.`,
      score,
      accuracy,
      correctCount: hits,
      totalCount: total,
      maxStreak: bestStreak,
      elapsedMs
    });

    const [mySessions, myFocusFlowSessions] = await Promise.all([
      GameSession.find({ userId: req.user, completedAt: { $ne: null } }).lean(),
      GameSession.find({ userId: req.user, gameKey: 'focus-flow', completedAt: { $ne: null } }).lean()
    ]);

    res.status(201).json({
      result: {
        sessionId: session._id,
        score,
        hits,
        total,
        perfects,
        bestStreak,
        misses,
        accuracy,
        elapsedMs
      },
      stats: buildGameStats(mySessions),
      focusFlowStats: buildGameStats(myFocusFlowSessions)
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/flappy-bird/submit', auth, async (req, res) => {
  try {
    const score = clampNumber(req.body.score, 0, 1000000);
    if (score <= 0) return res.status(400).json({ msg: 'Score must be greater than zero' });

    const pipesPassed = clampNumber(req.body.pipesPassed, 0, 1000);
    const elapsedMs = clampNumber(req.body.elapsedMs, 1000, 20 * 60 * 1000, 1000);
    const accuracy = clampNumber(70 + Math.min(30, pipesPassed * 2), 0, 100);

    const session = await createCompletedGameSession({
      userId: req.user,
      gameKey: 'flappy-bird',
      title: 'Flappy Scholar',
      brief: 'Tap through study gates and keep the scholar flying.',
      signal: `Passed ${pipesPassed} gates. Flight time: ${(elapsedMs / 1000).toFixed(1)}s.`,
      score,
      accuracy,
      correctCount: pipesPassed,
      totalCount: Math.max(1, pipesPassed),
      maxStreak: pipesPassed,
      elapsedMs
    });

    const [mySessions, myFlappySessions] = await Promise.all([
      GameSession.find({ userId: req.user, completedAt: { $ne: null } }).lean(),
      GameSession.find({ userId: req.user, gameKey: 'flappy-bird', completedAt: { $ne: null } }).lean()
    ]);

    res.status(201).json({
      result: {
        sessionId: session._id,
        score,
        pipesPassed,
        accuracy,
        elapsedMs
      },
      stats: buildGameStats(mySessions),
      flappyStats: buildGameStats(myFlappySessions)
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/jet-fighter/submit', auth, async (req, res) => {
  try {
    const kills = clampNumber(req.body.kills, 0, 5000);
    const level = clampNumber(req.body.level, 1, 50, 1);
    const lives = clampNumber(req.body.lives, 0, 10, 0);
    const elapsedMs = clampNumber(req.body.elapsedMs, 1000, 30 * 60 * 1000, 1000);
    const scoreCap = kills * 92 + level * 115 + Math.floor(elapsedMs / 1000) * 3 + lives * 55;
    const score = clampNumber(Math.min(Number(req.body.score) || 0, scoreCap), 0, 1000000);
    if (score <= 0) return res.status(400).json({ msg: 'Score must be greater than zero' });
    const accuracy = clampNumber(58 + Math.min(35, kills * 2) + Math.min(7, level), 0, 100);

    const session = await createCompletedGameSession({
      userId: req.user,
      gameKey: 'jet-fighter',
      title: 'Jet Fighter',
      brief: 'Defended the campus launch lane from incoming drones.',
      signal: `Cleared ${kills} drones, reached level ${level}, and survived ${(elapsedMs / 1000).toFixed(1)}s.`,
      score,
      accuracy,
      correctCount: kills,
      totalCount: Math.max(1, kills + Math.max(0, 3 - lives)),
      maxStreak: kills,
      elapsedMs
    });

    const [mySessions, myJetFighterSessions] = await Promise.all([
      GameSession.find({ userId: req.user, completedAt: { $ne: null } }).lean(),
      GameSession.find({ userId: req.user, gameKey: 'jet-fighter', completedAt: { $ne: null } }).lean()
    ]);

    res.status(201).json({
      result: {
        sessionId: session._id,
        score,
        kills,
        level,
        lives,
        accuracy,
        elapsedMs
      },
      stats: buildGameStats(mySessions),
      jetFighterStats: buildGameStats(myJetFighterSessions)
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/neon-drift/submit', auth, async (req, res) => {
  try {
    const distance = clampNumber(req.body.distance, 0, 200000);
    const boosts = clampNumber(req.body.boosts, 0, 5000);
    const dodges = clampNumber(req.body.dodges, 0, 10000);
    const lives = clampNumber(req.body.lives, 0, 10, 0);
    const level = clampNumber(req.body.level, 1, 50, 1);
    const elapsedMs = clampNumber(req.body.elapsedMs, 1000, 30 * 60 * 1000, 1000);
    const scoreCap = distance * 4 + boosts * 260 + dodges * 90 + level * 140 + Math.floor(elapsedMs / 1000) * 18 + lives * 90;
    const score = clampNumber(Math.min(Number(req.body.score) || 0, scoreCap), 0, 1000000);
    if (score <= 0) return res.status(400).json({ msg: 'Score must be greater than zero' });

    const accuracy = clampNumber(62 + Math.min(24, dodges * 2) + Math.min(14, boosts * 3) + lives * 2, 0, 100);
    const session = await createCompletedGameSession({
      userId: req.user,
      gameKey: 'neon-drift',
      title: 'Neon Drift',
      brief: 'Steered a hovercar through a neon city lane while avoiding red barriers.',
      signal: `Distance ${distance}m. Dodges: ${dodges}. Boost cores: ${boosts}. Level ${level}.`,
      score,
      accuracy,
      correctCount: dodges + boosts,
      totalCount: Math.max(1, dodges + boosts + Math.max(0, ARCADE_START_LIVES - lives)),
      maxStreak: dodges,
      elapsedMs
    });

    const [mySessions, myNeonDriftSessions] = await Promise.all([
      GameSession.find({ userId: req.user, completedAt: { $ne: null } }).lean(),
      GameSession.find({ userId: req.user, gameKey: 'neon-drift', completedAt: { $ne: null } }).lean()
    ]);

    res.status(201).json({
      result: {
        sessionId: session._id,
        score,
        distance,
        boosts,
        dodges,
        lives,
        level,
        accuracy,
        elapsedMs
      },
      stats: buildGameStats(mySessions),
      neonDriftStats: buildGameStats(myNeonDriftSessions)
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/space-runner/submit', auth, async (req, res) => {
  try {
    const distance = clampNumber(req.body.distance, 0, 200000);
    const cores = clampNumber(req.body.cores, 0, 5000);
    const nearMisses = clampNumber(req.body.nearMisses, 0, 10000);
    const lives = clampNumber(req.body.lives, 0, 10, 0);
    const level = clampNumber(req.body.level, 1, 50, 1);
    const elapsedMs = clampNumber(req.body.elapsedMs, 1000, 30 * 60 * 1000, 1000);
    const scoreCap = distance * 4 + cores * 290 + nearMisses * 115 + level * 150 + Math.floor(elapsedMs / 1000) * 18 + lives * 90;
    const score = clampNumber(Math.min(Number(req.body.score) || 0, scoreCap), 0, 1000000);
    if (score <= 0) return res.status(400).json({ msg: 'Score must be greater than zero' });

    const accuracy = clampNumber(60 + Math.min(22, nearMisses * 2) + Math.min(16, cores * 3) + lives * 2, 0, 100);
    const session = await createCompletedGameSession({
      userId: req.user,
      gameKey: 'space-runner',
      title: 'Space Runner',
      brief: 'Piloted through a 3D asteroid tunnel and collected energy cores.',
      signal: `Distance ${distance}m. Energy cores: ${cores}. Close skims: ${nearMisses}. Level ${level}.`,
      score,
      accuracy,
      correctCount: cores + nearMisses,
      totalCount: Math.max(1, cores + nearMisses + Math.max(0, ARCADE_START_LIVES - lives)),
      maxStreak: nearMisses,
      elapsedMs
    });

    const [mySessions, mySpaceRunnerSessions] = await Promise.all([
      GameSession.find({ userId: req.user, completedAt: { $ne: null } }).lean(),
      GameSession.find({ userId: req.user, gameKey: 'space-runner', completedAt: { $ne: null } }).lean()
    ]);

    res.status(201).json({
      result: {
        sessionId: session._id,
        score,
        distance,
        cores,
        nearMisses,
        lives,
        level,
        accuracy,
        elapsedMs
      },
      stats: buildGameStats(mySessions),
      spaceRunnerStats: buildGameStats(mySpaceRunnerSessions)
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/reaction-tap/submit', auth, async (req, res) => {
  try {
    const playerPoints = clampNumber(req.body.playerPoints, 0, 50, 0);
    const targetPoints = clampNumber(req.body.targetPoints, 1, 50, 20);
    const taps = clampNumber(req.body.taps, 0, 250, 0);
    const wins = clampNumber(req.body.wins, 0, 50, 0);
    const rounds = clampNumber(req.body.rounds, 1, 250, 1);
    const bestReactionMs = clampNumber(req.body.bestReactionMs, 90, 5000, 5000);
    const averageReactionMs = clampNumber(req.body.averageReactionMs, 90, 5000, 5000);
    const elapsedMs = clampNumber(req.body.elapsedMs, 1000, 10 * 60 * 1000, 1000);
    const wonMatch = Boolean(req.body.wonMatch || playerPoints >= targetPoints);
    const scoreCap = playerPoints * 420
      + wins * 160
      + Math.max(0, 900 - averageReactionMs)
      + Math.max(0, 650 - bestReactionMs)
      + (wonMatch ? 1500 : 0);
    const score = clampNumber(Math.min(Number(req.body.score) || 0, scoreCap), 0, 1000000);
    if (score <= 0) return res.status(400).json({ msg: 'Score must be greater than zero' });

    const accuracy = clampNumber(Math.round((wins / Math.max(1, rounds)) * 100), 0, 100);
    const session = await createCompletedGameSession({
      userId: req.user,
      gameKey: 'reaction-tap',
      title: 'Reaction Tap',
      brief: 'Won fast-tap rounds against campus racers by hitting the target first.',
      signal: `Points ${playerPoints}/${targetPoints}. Best ${bestReactionMs}ms. Average ${averageReactionMs}ms.`,
      score,
      accuracy,
      correctCount: wins,
      totalCount: rounds,
      maxStreak: playerPoints,
      elapsedMs
    });

    const [mySessions, myReactionTapSessions] = await Promise.all([
      GameSession.find({ userId: req.user, completedAt: { $ne: null } }).lean(),
      GameSession.find({ userId: req.user, gameKey: 'reaction-tap', completedAt: { $ne: null } }).lean()
    ]);

    res.status(201).json({
      result: {
        sessionId: session._id,
        score,
        playerPoints,
        targetPoints,
        taps,
        wins,
        rounds,
        bestReactionMs,
        averageReactionMs,
        elapsedMs,
        wonMatch
      },
      stats: buildGameStats(mySessions),
      reactionTapStats: buildGameStats(myReactionTapSessions)
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/bow-duel/submit', auth, async (req, res) => {
  try {
    const wins = clampNumber(req.body.wins, 0, 3);
    const rounds = clampNumber(req.body.rounds, 1, 80, 1);
    const totalDamage = clampNumber(req.body.totalDamage, 0, 2000);
    const bowLevel = clampNumber(req.body.bowLevel, 0, 4);
    const shots = clampNumber(req.body.shots, 0, 80);
    const hits = clampNumber(req.body.hits, 0, 80);
    const hpRemaining = clampNumber(req.body.hpRemaining, 0, 540);
    const elapsedMs = clampNumber(req.body.elapsedMs, 1000, 30 * 60 * 1000, 1000);
    const wonMatch = Boolean(req.body.wonMatch);
    const scoreCap = wins * 1400 + totalDamage * 24 + bowLevel * 430 + hits * 130 + hpRemaining * 3 + (wonMatch ? 1200 : 0);
    const score = clampNumber(Math.min(Number(req.body.score) || 0, scoreCap), 0, 1000000);
    if (score <= 0) return res.status(400).json({ msg: 'Score must be greater than zero' });

    const accuracy = shots ? clampNumber(Math.round((hits / shots) * 100), 0, 100) : clampNumber(wins * 28, 0, 100);
    const session = await createCompletedGameSession({
      userId: req.user,
      gameKey: 'bow-duel',
      title: 'Knife Duel',
      brief: 'Played a ranked HP throwing-knife duel with unlockable blades.',
      signal: `${wonMatch ? 'Won' : 'Finished'} after ${rounds} turns. Damage ${totalDamage}. HP left ${hpRemaining}. Knife level ${bowLevel + 1}.`,
      score,
      accuracy,
      correctCount: wins,
      totalCount: rounds,
      maxStreak: bowLevel,
      elapsedMs
    });

    const [mySessions, myBowDuelSessions] = await Promise.all([
      GameSession.find({ userId: req.user, completedAt: { $ne: null } }).lean(),
      GameSession.find({ userId: req.user, gameKey: 'bow-duel', completedAt: { $ne: null } }).lean()
    ]);

    res.status(201).json({
      result: {
        sessionId: session._id,
        score,
        wins,
        rounds,
        totalDamage,
        bowLevel,
        hits,
        shots,
        hpRemaining,
        accuracy,
        elapsedMs
      },
      stats: buildGameStats(mySessions),
      bowDuelStats: buildGameStats(myBowDuelSessions)
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/code-quiz/start', auth, async (req, res) => {
  try {
    const startedAt = new Date();
    const session = new GameSession({
      userId: req.user,
      gameKey: 'code-quiz',
      durationSeconds: QUIZ_QUESTION_COUNT * QUIZ_SECONDS_PER_QUESTION,
      challenges: createQuizQuestions(),
      totalCount: QUIZ_QUESTION_COUNT,
      startedAt,
      expiresAt: new Date(startedAt.getTime() + ((QUIZ_QUESTION_COUNT * QUIZ_SECONDS_PER_QUESTION) + 20) * 1000)
    });

    await session.save();

    res.status(201).json({
      sessionId: session._id,
      gameKey: session.gameKey,
      durationSeconds: session.durationSeconds,
      secondsPerQuestion: QUIZ_SECONDS_PER_QUESTION,
      startedAt: session.startedAt,
      expiresAt: session.expiresAt,
      questions: session.challenges.map(publicChallenge)
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/code-quiz/:sessionId/submit', auth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.sessionId)) {
      return res.status(404).json({ msg: 'Quiz session not found' });
    }

    const session = await GameSession.findOne({ _id: req.params.sessionId, userId: req.user, gameKey: 'code-quiz' });
    if (!session) return res.status(404).json({ msg: 'Quiz session not found' });
    if (session.completedAt) return res.status(400).json({ msg: 'Quiz session already submitted' });

    const now = new Date();
    const result = now > session.expiresAt
      ? {
          answers: [],
          score: 0,
          correctCount: 0,
          totalCount: session.challenges.length,
          maxStreak: 0,
          elapsedMs: Math.max(0, now.getTime() - session.startedAt.getTime()),
          accuracy: 0
        }
      : scoreQuizSession(session, req.body.answers, now);

    session.answers = result.answers;
    session.score = result.score;
    session.accuracy = result.accuracy;
    session.correctCount = result.correctCount;
    session.totalCount = result.totalCount;
    session.maxStreak = result.maxStreak;
    session.elapsedMs = result.elapsedMs;
    session.completedAt = now;
    await session.save();

    const [mySessions, myQuizSessions] = await Promise.all([
      GameSession.find({ userId: req.user, completedAt: { $ne: null } }).lean(),
      GameSession.find({ userId: req.user, gameKey: 'code-quiz', completedAt: { $ne: null } }).lean()
    ]);

    res.json({
      result: {
        sessionId: session._id,
        score: session.score,
        accuracy: session.accuracy,
        correctCount: session.correctCount,
        totalCount: session.totalCount,
        maxStreak: session.maxStreak,
        elapsedMs: session.elapsedMs,
        answers: session.answers
      },
      stats: buildGameStats(mySessions),
      codeQuizStats: buildGameStats(myQuizSessions)
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/ops-arena/start', auth, async (req, res) => {
  try {
    const startedAt = new Date();
    const session = new GameSession({
      userId: req.user,
      durationSeconds: DURATION_SECONDS,
      challenges: createChallenges(),
      totalCount: ROUND_SIZE,
      startedAt,
      expiresAt: new Date(startedAt.getTime() + (DURATION_SECONDS + 15) * 1000)
    });

    await session.save();

    res.status(201).json({
      sessionId: session._id,
      gameKey: session.gameKey,
      durationSeconds: session.durationSeconds,
      startedAt: session.startedAt,
      expiresAt: session.expiresAt,
      decisions: decisionGuide,
      challenges: session.challenges.map(publicChallenge)
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

router.post('/ops-arena/:sessionId/submit', auth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.sessionId)) {
      return res.status(404).json({ msg: 'Game session not found' });
    }

    const session = await GameSession.findOne({ _id: req.params.sessionId, userId: req.user });
    if (!session) return res.status(404).json({ msg: 'Game session not found' });
    if (session.completedAt) return res.status(400).json({ msg: 'Game session already submitted' });

    const now = new Date();
    if (now > session.expiresAt) {
      session.completedAt = now;
      session.elapsedMs = Math.max(0, now.getTime() - session.startedAt.getTime());
      session.answers = [];
      session.score = 0;
      session.correctCount = 0;
      session.maxStreak = 0;
      await session.save();
      return res.status(400).json({
        msg: 'Game session expired',
        result: {
          sessionId: session._id,
          score: 0,
          correctCount: 0,
          totalCount: session.challenges.length,
          maxStreak: 0,
          elapsedMs: session.elapsedMs,
          answers: []
        }
      });
    }

    const result = scoreSession(session, req.body.answers, now);
    session.answers = result.answers;
    session.score = result.score;
    session.correctCount = result.correctCount;
    session.totalCount = result.totalCount;
    session.maxStreak = result.maxStreak;
    session.elapsedMs = result.elapsedMs;
    session.completedAt = now;
    await session.save();

    const mySessions = await GameSession.find({ userId: req.user, completedAt: { $ne: null } }).lean();

    res.json({
      result: {
        sessionId: session._id,
        score: session.score,
        correctCount: session.correctCount,
        totalCount: session.totalCount,
        maxStreak: session.maxStreak,
        elapsedMs: session.elapsedMs,
        answers: session.answers
      },
      stats: buildGameStats(mySessions)
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

module.exports = router;
