/* ═══════════════════════════════════════════════════════════════════════════
   SCIENCELAB AI — ADVANCED JAVASCRIPT
   Full ChatGPT-level platform: Chat History · Bengali Support · Image AI
   Drop-in replacement/extension for your existing sciencelab JS
═══════════════════════════════════════════════════════════════════════════ */

'use strict';

/* ══════════════════════════════════════════════════════════════════════════
   1. STORAGE ENGINE  (IndexedDB with localStorage fallback)
══════════════════════════════════════════════════════════════════════════ */
const DB = (() => {
  const DB_NAME = 'ScienceLabAI', DB_VER = 2, STORE = 'conversations';
  let _db = null;

  async function open() {
    if (_db) return _db;
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'id' });
          os.createIndex('updatedAt', 'updatedAt');
          os.createIndex('subject', 'subject');
        }
      };
      req.onsuccess = e => { _db = e.target.result; res(_db); };
      req.onerror   = () => rej(req.error);
    });
  }

  async function tx(mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t  = db.transaction(STORE, mode);
      const os = t.objectStore(STORE);
      const r  = fn(os);
      r.onsuccess = () => res(r.result);
      r.onerror   = () => rej(r.error);
    });
  }

  return {
    save:   conv  => tx('readwrite', os => os.put(conv)),
    get:    id    => tx('readonly',  os => os.get(id)),
    delete: id    => tx('readwrite', os => os.delete(id)),
    all: () => new Promise(async (res, rej) => {
      const db = await open();
      const t  = db.transaction(STORE, 'readonly');
      const os = t.objectStore(STORE);
      const req = os.index('updatedAt').openCursor(null, 'prev');
      const results = [];
      req.onsuccess = e => {
        const cursor = e.target.result;
        if (cursor) { results.push(cursor.value); cursor.continue(); }
        else res(results);
      };
      req.onerror = () => rej(req.error);
    }),
  };
})();


/* ══════════════════════════════════════════════════════════════════════════
   2. CONVERSATION MANAGER
══════════════════════════════════════════════════════════════════════════ */
const ConvMgr = (() => {
  let _current = null;   // active conversation object
  let _all     = [];     // cached list

  function newConv(subject = 'chem') {
    return {
      id:        `conv_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
      title:     'New conversation',
      subject,
      messages:  [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      bookmarks: [],
    };
  }

  function autoTitle(text) {
    const t = text.trim().replace(/[\r\n]+/g,' ');
    return t.length > 55 ? t.slice(0, 52) + '…' : t;
  }

  async function start(subject) {
    _current = newConv(subject);
    await DB.save(_current);
    await refresh();
    return _current;
  }

  async function load(id) {
    _current = await DB.get(id);
    return _current;
  }

  async function addMessage(role, content, meta = {}) {
    if (!_current) _current = newConv();
    const msg = {
      id:       `msg_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
      role,
      content,
      ts:       Date.now(),
      bookmarked: false,
      reactions: { like: false, dislike: false },
      ...meta,
    };
    _current.messages.push(msg);
    _current.updatedAt = Date.now();
    if (_current.messages.filter(m => m.role === 'user').length === 1 && role === 'user') {
      _current.title = autoTitle(content);
    }
    await DB.save(_current);
    await refresh();
    return msg;
  }

  async function editMessage(msgId, newContent) {
    if (!_current) return;
    const msg = _current.messages.find(m => m.id === msgId);
    if (msg) { msg.content = newContent; msg.edited = true; _current.updatedAt = Date.now(); }
    await DB.save(_current);
  }

  async function deleteMessage(msgId) {
    if (!_current) return;
    _current.messages = _current.messages.filter(m => m.id !== msgId);
    _current.updatedAt = Date.now();
    await DB.save(_current);
  }

  async function renameConv(id, title) {
    const conv = id === _current?.id ? _current : await DB.get(id);
    if (conv) { conv.title = title; await DB.save(conv); await refresh(); }
  }

  async function deleteConv(id) {
    await DB.delete(id);
    if (_current?.id === id) _current = null;
    await refresh();
  }

  async function refresh() {
    _all = await DB.all();
  }

  async function searchAll(query) {
    const all = await DB.all();
    const q   = query.toLowerCase();
    return all.filter(conv =>
      conv.title.toLowerCase().includes(q) ||
      conv.messages.some(m => m.content.toLowerCase().includes(q))
    );
  }

  async function exportConv(id) {
    const conv = id === _current?.id ? _current : await DB.get(id);
    if (!conv) return;
    const blob = new Blob([JSON.stringify(conv, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `${conv.title.replace(/\s+/g,'_')}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  async function importConv(file) {
    const text = await file.text();
    const conv = JSON.parse(text);
    conv.id = `conv_${Date.now()}`;
    conv.updatedAt = Date.now();
    await DB.save(conv);
    await refresh();
    return conv;
  }

  return {
    get current() { return _current; },
    get all()     { return _all; },
    start, load, addMessage, editMessage, deleteMessage,
    renameConv, deleteConv, refresh, searchAll, exportConv, importConv,
  };
})();


/* ══════════════════════════════════════════════════════════════════════════
   3. LANGUAGE DETECTOR
══════════════════════════════════════════════════════════════════════════ */
const LangDetector = (() => {
  const BENGALI_RANGE  = /[\u0980-\u09FF]/;
  const ROMANIZED_BN   = /\b(ami|tumi|apni|ki|keno|kothay|boro|choto|bhalo|mone|hoy|kore|deko|paro|koro|jano|ache|holo|gelo|ela|asha|tumi|amra|tomra|apnar|amar|shob|ektu|kintu|tahole|jodi|ba|ebong|naki|theke|diye|hoye|korte|korbe|korbo|kotheke|kothao)\b/i;
  const SCIENCE_BN     = /\b(rashayan|padartha|ganit|bigyan|bijnaan|totobo|onko|jibobigyan|podartho|shakti|beg|toran|oshmo|bikriya|samikaran|tatho|upadan|prokriya)\b/i;

  function detect(text) {
    const hasBengaliScript = BENGALI_RANGE.test(text);
    const hasRomanBengali  = ROMANIZED_BN.test(text) || SCIENCE_BN.test(text);
    const englishRatio     = (text.match(/[a-zA-Z]/g) || []).length / Math.max(text.length, 1);

    if (hasBengaliScript && englishRatio < 0.3) return 'bn';
    if (hasBengaliScript && englishRatio >= 0.3) return 'bn-en';
    if (hasRomanBengali) return 'romanized-bn';
    return 'en';
  }

  function isBengali(text) {
    const l = detect(text);
    return l === 'bn' || l === 'bn-en' || l === 'romanized-bn';
  }

  return { detect, isBengali };
})();


/* ══════════════════════════════════════════════════════════════════════════
   4. BENGALI SCIENCE TERMINOLOGY DATABASE
══════════════════════════════════════════════════════════════════════════ */
const BengaliTerms = {
  // Chemistry
  chemistry:       'রসায়ন',
  atom:            'পরমাণু',
  molecule:        'অণু',
  element:         'মৌল',
  compound:        'যৌগ',
  mixture:         'মিশ্রণ',
  reaction:        'বিক্রিয়া',
  bond:            'বন্ধন',
  electron:        'ইলেকট্রন',
  proton:          'প্রোটন',
  neutron:         'নিউট্রন',
  nucleus:         'নিউক্লিয়াস',
  oxidation:       'জারণ',
  reduction:       'বিজারণ',
  acid:            'অম্ল',
  base:            'ক্ষার',
  salt:            'লবণ',
  catalyst:        'প্রভাবক',
  solution:        'দ্রবণ',
  solvent:         'দ্রাবক',
  solute:          'দ্রাব্য',
  concentration:   'ঘনমাত্রা',
  mole:            'মোল',
  molarity:        'মোলারিটি',
  equilibrium:     'সাম্যাবস্থা',
  enthalpy:        'এনথালপি',
  entropy:         'এনট্রপি',
  polymer:         'পলিমার',
  isomer:          'আইসোমার',
  organic:         'জৈব',
  inorganic:       'অজৈব',
  // Physics
  physics:         'পদার্থবিজ্ঞান',
  force:           'বল',
  mass:            'ভর',
  weight:          'ওজন',
  velocity:        'বেগ',
  acceleration:    'ত্বরণ',
  momentum:        'ভরবেগ',
  energy:          'শক্তি',
  power:           'ক্ষমতা',
  work:            'কাজ',
  pressure:        'চাপ',
  temperature:     'তাপমাত্রা',
  gravity:         'মাধ্যাকর্ষণ',
  friction:        'ঘর্ষণ',
  wave:            'তরঙ্গ',
  frequency:       'কম্পাঙ্ক',
  wavelength:      'তরঙ্গদৈর্ঘ্য',
  amplitude:       'বিস্তার',
  refraction:      'প্রতিসরণ',
  reflection:      'প্রতিফলন',
  electric:        'বৈদ্যুতিক',
  current:         'প্রবাহ',
  voltage:         'ভোল্টেজ',
  resistance:      'রোধ',
  magnetic:        'চুম্বকীয়',
  quantum:         'কোয়ান্টাম',
  relativity:      'আপেক্ষিকতা',
  photon:          'ফোটন',
  // Mathematics
  mathematics:     'গণিত',
  number:          'সংখ্যা',
  integer:         'পূর্ণসংখ্যা',
  fraction:        'ভগ্নাংশ',
  decimal:         'দশমিক',
  equation:        'সমীকরণ',
  variable:        'চলক',
  function:        'ফাংশন',
  derivative:      'অবকলন',
  integral:        'সমাকলন',
  limit:           'সীমা',
  matrix:          'ম্যাট্রিক্স',
  vector:          'ভেক্টর',
  probability:     'সম্ভাবনা',
  statistics:      'পরিসংখ্যান',
  geometry:        'জ্যামিতি',
  triangle:        'ত্রিভুজ',
  circle:          'বৃত্ত',
  angle:           'কোণ',
  theorem:         'উপপাদ্য',
  proof:           'প্রমাণ',
  // Elements (common)
  hydrogen:        'হাইড্রোজেন',
  oxygen:          'অক্সিজেন',
  carbon:          'কার্বন',
  nitrogen:        'নাইট্রোজেন',
  iron:            'লোহা (আয়রন)',
  gold:            'সোনা (গোল্ড)',
  silver:          'রুপা (সিলভার)',
  copper:          'তামা (কপার)',
  sodium:          'সোডিয়াম',
  calcium:         'ক্যালসিয়াম',
  water:           'পানি',
};

function termBn(word) {
  return BengaliTerms[word.toLowerCase()] || word;
}


/* ══════════════════════════════════════════════════════════════════════════
   5. AI SYSTEM PROMPTS  (PhD-level, bilingual, no LaTeX)
══════════════════════════════════════════════════════════════════════════ */
const AI_SYSTEMS = {

  chem: (lang) => `You are a world-class Chemistry Professor with a PhD and decades of research experience. You have deep expertise across all branches: organic, inorganic, physical, analytical, quantum, and biochemistry.

LANGUAGE RULES:
${lang === 'en'
  ? '- Respond entirely in clear, academic English.'
  : lang === 'bn'
  ? '- Respond entirely in professional Bengali (চলিত ভাষা). Use correct Bengali punctuation (।). Use Bengali numerals (১,২,৩) for Bengali-script responses. Provide English technical terms in parentheses where needed.'
  : '- The user is writing in mixed Bengali-English. Respond bilingually: give the main explanation in Bengali (চলিত ভাষা), then provide a concise English summary. Use Bengali punctuation (।).'
}

RESPONSE RULES:
- NEVER use LaTeX commands (\\frac, \\boxed, etc.). Write fractions as a/b, powers as x^2.
- NEVER add promotional text, ads, or "Powered by" footers.
- For DEFINITIONS: Give a clear conceptual explanation + real-world analogy + example.
- For PROBLEMS: Solve completely step-by-step. Number every step. State the final answer in bold.
- For REACTIONS: Show balanced equation, mechanism if relevant, conditions, and applications.
- For STRUCTURES: Draw using ASCII/Unicode (e.g. H-C-H, benzene ring as ASCII).
- Always include: Key Terms, Common Mistakes, Real-world Application where relevant.
- Provide IUPAC names when discussing compounds.
- Include molar masses, stoichiometry calculations, thermodynamic values where relevant.
- Cite key scientists/principles (Hess's Law, Le Chatelier, Arrhenius, etc.).
- Add "Check Your Understanding" questions for complex topics.`,

  phys: (lang) => `You are an elite Physics Professor with a PhD spanning classical mechanics, electromagnetism, thermodynamics, quantum mechanics, relativity, and astrophysics.

LANGUAGE RULES:
${lang === 'en'
  ? '- Respond entirely in clear, academic English.'
  : lang === 'bn'
  ? '- Respond entirely in professional Bengali (চলিত ভাষা). Use correct Bengali punctuation (।). Use Bengali numerals for Bengali-script responses. Provide English technical terms in parentheses.'
  : '- Respond bilingually: main explanation in Bengali (চলিত ভাষা), then English summary. Use Bengali punctuation (।).'
}

RESPONSE RULES:
- NEVER use LaTeX. Write equations as plain text: F = ma, E = mc^2, v^2 = u^2 + 2as.
- NEVER add promotional text or ads.
- For DEFINITIONS: Conceptual explanation + mathematical expression + real-world analogy + example.
- For PROBLEMS: Full step-by-step solution. List knowns/unknowns first. Show every formula used. Include units in every step. State final answer in bold with correct SI units.
- For DIAGRAMS: Draw ASCII vector/force diagrams when helpful.
- Include dimensional analysis for every calculation.
- Show multiple solution methods (energy method vs kinematics, etc.) where applicable.
- Reference landmark experiments (Millikan, Michelson-Morley, double-slit, etc.).
- Connect to modern technology (GPS relativity correction, MRI quantum spin, etc.).
- Include "Common Mistakes" and "Check Your Understanding" for complex topics.`,

  math: (lang) => `You are a distinguished Mathematics Professor with expertise spanning arithmetic, algebra, calculus, linear algebra, differential equations, number theory, topology, and statistics.

LANGUAGE RULES:
${lang === 'en'
  ? '- Respond entirely in clear, academic English.'
  : lang === 'bn'
  ? '- Respond entirely in professional Bengali (চলিত ভাষা). Use correct Bengali punctuation (।). Use Bengali numerals where appropriate. Provide English mathematical terms in parentheses.'
  : '- Respond bilingually: main explanation in Bengali (চলিত ভাষা), then English summary. Use Bengali punctuation (।).'
}

RESPONSE RULES:
- NEVER use LaTeX. Use plain text: x^2 + 5x + 6 = 0, integral as ∫ x^2 dx = x^3/3 + C, sqrt(x).
- NEVER add promotional text or ads.
- For DEFINITIONS: Formal definition + intuitive explanation + concrete numeric example + geometric interpretation.
- For PROBLEMS: Complete step-by-step. Explain the WHY behind each step, not just HOW. Multiple proof techniques where applicable. State final answer in bold.
- Include historical context (Euler, Gauss, Riemann, etc.) for important concepts.
- Show geometric interpretations alongside algebraic ones.
- Provide practice problems with solutions for complex topics.
- Explain common misconceptions clearly.
- Include "Check Your Understanding" follow-up questions.`,

  vision: (lang, subject) => `You are an expert ${subject === 'chem' ? 'Chemistry' : subject === 'phys' ? 'Physics' : 'Mathematics'} Professor analyzing an image provided by the student.

LANGUAGE RULES:
${lang === 'en' ? '- Respond in English.' : lang === 'bn' ? '- Respond in Bengali (চলিত ভাষা) with English terms in parentheses.' : '- Respond bilingually in Bengali then English.'}

IMAGE ANALYSIS RULES:
- Describe what you see in the image first.
- If it contains TEXT or EQUATIONS: Extract and reproduce them accurately, then solve/explain.
- If it contains a DIAGRAM or APPARATUS: Identify all components and explain the concept it illustrates.
- If it contains HANDWRITTEN MATH: Transcribe the equations, then solve step-by-step.
- If it contains a GRAPH or CHART: Identify axes, describe trends, extract key data points.
- If it contains a CHEMICAL STRUCTURE: Name the compound (IUPAC), identify functional groups, describe properties.
- If it contains BENGALI SCRIPT: Read and respond to the content in Bengali.
- NEVER use LaTeX. Write equations as plain text.
- NEVER add promotional text or ads.
- Provide complete, educational responses as you would for a text query.`,
};


/* ══════════════════════════════════════════════════════════════════════════
   6. AI API ENGINE  (multi-model fallback, Anthropic Claude via proxy)
══════════════════════════════════════════════════════════════════════════ */
const AIEngine = (() => {
  const MODELS = ['openai', 'openai-large', 'mistral', 'llama'];

  function stripAds(text) {
    return text
      .replace(/---[\s\S]*?[Ss]upport\s+[Pp]ollinations[\s\S]*?---/g, '')
      .replace(/🌸[\s\S]*?🌸/g, '')
      .replace(/[Pp]owered by\s+Pollinations[^\n]*/g, '')
      .replace(/[Ss]upport our mission[\s\S]{0,300}$/m, '')
      .replace(/[Ss]upport Pollinations[\s\S]{0,300}$/m, '')
      .replace(/free text APIs[\s\S]{0,200}$/m, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  async function callText(systemPrompt, messages) {
    for (const model of MODELS) {
      try {
        const res = await fetch('https://text.pollinations.ai/openai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              ...messages,
            ],
            temperature: 0.2,
            max_tokens: 3000,
          }),
        });
        if (!res.ok) continue;
        const d = await res.json();
        const content = d.choices?.[0]?.message?.content || d.content || '';
        if (content && content.length > 5) return stripAds(content);
      } catch (e) { continue; }
    }
    throw new Error('Unable to reach AI. Please check your connection and try again.');
  }

  async function callVision(systemPrompt, userText, imageDataUrl) {
    for (const model of ['openai', 'openai-large']) {
      try {
        const res = await fetch('https://text.pollinations.ai/openai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              {
                role: 'user',
                content: [
                  { type: 'image_url', image_url: { url: imageDataUrl } },
                  { type: 'text', text: userText || 'Please analyze this image and explain what you see.' },
                ],
              },
            ],
            temperature: 0.2,
            max_tokens: 3000,
          }),
        });
        if (!res.ok) continue;
        const d = await res.json();
        const content = d.choices?.[0]?.message?.content || d.content || '';
        if (content && content.length > 5) return stripAds(content);
      } catch (e) { continue; }
    }
    throw new Error('Vision analysis failed. Please try a different image or describe it in text.');
  }

  return { callText, callVision };
})();


/* ══════════════════════════════════════════════════════════════════════════
   7. MARKDOWN → HTML RENDERER  (safe, no LaTeX)
══════════════════════════════════════════════════════════════════════════ */
function mdToHtml(t) {
  if (!t) return '';
  // Strip stray LaTeX
  t = t.replace(/\\\((.*?)\\\)/gs, '$1')
       .replace(/\\\[(.*?)\\\]/gs, '$1')
       .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1)/($2)')
       .replace(/\\sqrt\{([^}]+)\}/g, 'sqrt($1)')
       .replace(/\\int\b/g, '∫')
       .replace(/\\sum\b/g, '∑')
       .replace(/\\rightarrow|\\to\b/g, '→')
       .replace(/\\left|\\right/g, '')
       .replace(/\\cdot/g, '·')
       .replace(/\\times/g, '×')
       .replace(/\\pm/g, '±')
       .replace(/\\infty/g, '∞')
       .replace(/\\alpha/g, 'α').replace(/\\beta/g, 'β')
       .replace(/\\gamma/g, 'γ').replace(/\\delta/g, 'δ')
       .replace(/\\theta/g, 'θ').replace(/\\lambda/g, 'λ')
       .replace(/\\mu/g, 'μ').replace(/\\pi/g, 'π')
       .replace(/\\sigma/g, 'σ').replace(/\\omega/g, 'ω');

  // Escape HTML (basic)
  t = t.replace(/&(?!(amp|lt|gt|quot|#);)/g, '&amp;');

  // Code blocks
  t = t.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
    `<pre class="code-block" data-lang="${lang}"><code>${code.trim()}</code></pre>`);

  // Inline code
  t = t.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  // Tables
  t = t.replace(/(\|.+\|\n)+/g, match => {
    const rows = match.trim().split('\n').filter(r => !/^[\s|:-]+$/.test(r));
    if (rows.length < 1) return match;
    const isHeader = (i) => i === 0;
    return '<div class="table-wrap"><table class="resp-table"><tbody>' +
      rows.map((r, i) => {
        const cells = r.split('|').slice(1, -1).map(c =>
          `<${isHeader(i) ? 'th' : 'td'}>${c.trim()}</${isHeader(i) ? 'th' : 'td'}>`
        ).join('');
        return `<tr>${cells}</tr>`;
      }).join('') + '</tbody></table></div>';
  });

  // Headers
  t = t.replace(/^### (.+)$/gm, '<h4 class="md-h3">$1</h4>');
  t = t.replace(/^## (.+)$/gm, '<h3 class="md-h2">$1</h3>');
  t = t.replace(/^# (.+)$/gm, '<h2 class="md-h1">$1</h2>');

  // Bold / italic
  t = t.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\*(.+?)\*/g, '<em>$1</em>');
  t = t.replace(/__(.+?)__/g, '<strong>$1</strong>');
  t = t.replace(/_(.+?)_/g, '<em>$1</em>');

  // Blockquote
  t = t.replace(/^> (.+)$/gm, '<blockquote class="md-bq">$1</blockquote>');

  // HR
  t = t.replace(/^---+$/gm, '<hr class="md-hr">');

  // Ordered lists
  t = t.replace(/((?:^\d+\. .+\n?)+)/gm, match => {
    const items = match.trim().split('\n').map(l => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('');
    return `<ol class="md-ol">${items}</ol>`;
  });

  // Unordered lists
  t = t.replace(/((?:^[-•*] .+\n?)+)/gm, match => {
    const items = match.trim().split('\n').map(l => `<li>${l.replace(/^[-•*] /, '')}</li>`).join('');
    return `<ul class="md-ul">${items}</ul>`;
  });

  // Paragraphs
  t = t.split(/\n{2,}/).map(para => {
    para = para.trim();
    if (!para) return '';
    if (/^<(h[1-4]|ul|ol|pre|blockquote|hr|div|table)/.test(para)) return para;
    return `<p>${para.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');

  return t;
}


/* ══════════════════════════════════════════════════════════════════════════
   8. CHAT UI ENGINE
══════════════════════════════════════════════════════════════════════════ */
const ChatUI = (() => {

  /* ── Internal state ── */
  let _subject      = 'chem';
  let _pendingImages = [];   // [{dataUrl, name}]
  let _isStreaming   = false;

  /* ── Selectors ── (call lazily so DOM is ready) */
  const $ = id => document.getElementById(id);

  /* ══ SIDEBAR ══ */
  async function renderSidebar(filterText = '') {
    const list = $('sl-chat-list');
    if (!list) return;

    let convs = filterText
      ? await ConvMgr.searchAll(filterText)
      : ConvMgr.all;

    if (!convs.length) {
      list.innerHTML = '<div class="sl-empty-convs">No conversations yet.<br>Start chatting below!</div>';
      return;
    }

    // Group by date
    const now   = Date.now();
    const ONE_DAY = 86400000;
    const groups = { Today: [], Yesterday: [], 'This Week': [], Older: [] };

    convs.forEach(c => {
      const diff = now - c.updatedAt;
      if (diff < ONE_DAY)          groups['Today'].push(c);
      else if (diff < ONE_DAY*2)   groups['Yesterday'].push(c);
      else if (diff < ONE_DAY*7)   groups['This Week'].push(c);
      else                         groups['Older'].push(c);
    });

    let html = '';
    Object.entries(groups).forEach(([label, items]) => {
      if (!items.length) return;
      html += `<div class="sl-group-label">${label}</div>`;
      items.forEach(c => {
        const active = ConvMgr.current?.id === c.id ? 'active' : '';
        const dot    = c.subject || 'chem';
        const time   = formatRelTime(c.updatedAt);
        const isSearchMatch = filterText && c.messages.some(m =>
          m.content.toLowerCase().includes(filterText.toLowerCase())
        );
        html += `
          <div class="sl-chat-item ${active}" data-id="${c.id}">
            <div class="sl-dot ${dot}"></div>
            <div class="sl-chat-info">
              <div class="sl-chat-title" title="${escHtml(c.title)}">${escHtml(c.title)}</div>
              <div class="sl-chat-time">${time}${isSearchMatch ? ' · match' : ''}</div>
            </div>
            <div class="sl-chat-actions">
              <button class="sl-chat-btn" onclick="ChatUI.renamePrompt('${c.id}')" title="Rename">✏️</button>
              <button class="sl-chat-btn" onclick="ChatUI.exportChat('${c.id}')" title="Export">⬇️</button>
              <button class="sl-chat-btn del" onclick="ChatUI.confirmDelete('${c.id}')" title="Delete">🗑️</button>
            </div>
          </div>`;
      });
    });
    list.innerHTML = html;

    // Click to load
    list.querySelectorAll('.sl-chat-item').forEach(el => {
      el.addEventListener('click', async e => {
        if (e.target.closest('.sl-chat-btn')) return;
        await loadConversation(el.dataset.id);
      });
    });
  }

  async function loadConversation(id) {
    const conv = await ConvMgr.load(id);
    _subject = conv.subject || 'chem';
    renderMessages(conv.messages);
    await renderSidebar($('sl-search-input')?.value || '');
    // Switch subject tab
    if (typeof gotoSubject === 'function') gotoSubject(_subject);
    scrollBottom();
  }

  /* ══ MESSAGES ══ */
  function renderMessages(messages) {
    const container = $('sl-messages');
    if (!container) return;
    if (!messages || !messages.length) {
      container.innerHTML = renderWelcome();
      return;
    }
    container.innerHTML = messages.map(m => renderMessage(m)).join('');
    // Syntax highlight
    container.querySelectorAll('pre code').forEach(el => highlightCode(el));
    scrollBottom();
  }

  function renderMessage(msg) {
    const isUser    = msg.role === 'user';
    const timeStr   = formatTime(msg.ts);
    const editedMark = msg.edited ? '<span class="sl-edited">(edited)</span>' : '';
    const bmClass   = msg.bookmarked ? 'bookmarked' : '';

    // Images inside message
    let imgHtml = '';
    if (msg.images && msg.images.length) {
      imgHtml = `<div class="sl-msg-images">${
        msg.images.map(img => `<img src="${img.dataUrl}" alt="${escHtml(img.name)}" class="sl-msg-img" onclick="ChatUI.viewImage(this)">`).join('')
      }</div>`;
    }

    const contentHtml = isUser
      ? `<div class="sl-msg-text">${escHtml(msg.content).replace(/\n/g,'<br>')}</div>`
      : `<div class="sl-msg-text md-content">${mdToHtml(msg.content)}</div>`;

    return `
      <div class="sl-message ${isUser ? 'user' : 'assistant'} ${bmClass}" data-id="${msg.id}">
        <div class="sl-msg-avatar">${isUser ? '👤' : subjectIcon(_subject)}</div>
        <div class="sl-msg-body">
          ${imgHtml}
          ${contentHtml}
          ${editedMark}
          <div class="sl-msg-meta">
            <span class="sl-msg-time">${timeStr}</span>
            <div class="sl-msg-actions">
              ${!isUser ? `
                <button class="sl-act-btn" onclick="ChatUI.copyMsg('${msg.id}')" title="Copy">📋</button>
                <button class="sl-act-btn" onclick="ChatUI.regenMsg('${msg.id}')" title="Regenerate">🔄</button>
              ` : `
                <button class="sl-act-btn" onclick="ChatUI.editMsg('${msg.id}')" title="Edit">✏️</button>
              `}
              <button class="sl-act-btn ${msg.reactions?.like ? 'active' : ''}" onclick="ChatUI.reactMsg('${msg.id}','like')" title="Like">👍</button>
              <button class="sl-act-btn ${msg.reactions?.dislike ? 'active' : ''}" onclick="ChatUI.reactMsg('${msg.id}','dislike')" title="Dislike">👎</button>
              <button class="sl-act-btn ${msg.bookmarked ? 'active' : ''}" onclick="ChatUI.bookmarkMsg('${msg.id}')" title="Bookmark">🔖</button>
              <button class="sl-act-btn del" onclick="ChatUI.deleteMsg('${msg.id}')" title="Delete">🗑️</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  function renderWelcome() {
    const subjects = {
      chem: { name: 'Chemistry', emoji: '⚗️', color: 'var(--chem)',
        tips: ['Balance a chemical equation', 'Explain Le Chatelier\'s Principle', 'How does NMR spectroscopy work?', 'রসায়নের মূলনীতি কী?'] },
      phys: { name: 'Physics', emoji: '⚡', color: 'var(--phys)',
        tips: ['Derive the equations of motion', 'Explain quantum entanglement', 'How does a transformer work?', 'নিউটনের গতিসূত্র ব্যাখ্যা করো'] },
      math: { name: 'Mathematics', emoji: '∫', color: 'var(--math)',
        tips: ['Solve x^2 - 5x + 6 = 0', 'Explain the Fundamental Theorem of Calculus', 'What is a determinant?', 'সম্ভাবনা কাকে বলে?'] },
    };
    const s = subjects[_subject] || subjects.chem;
    return `
      <div class="sl-welcome">
        <div class="sl-welcome-icon" style="color:${s.color}">${s.emoji}</div>
        <h2 class="sl-welcome-title">${s.name} AI Professor</h2>
        <p class="sl-welcome-sub">PhD-level expertise · Bengali &amp; English · Image analysis</p>
        <div class="sl-suggestions">
          ${s.tips.map(t => `<button class="sl-suggestion" onclick="ChatUI.useSuggestion('${escHtml(t)}')">${t}</button>`).join('')}
        </div>
      </div>`;
  }

  function appendMessage(msg) {
    const container = $('sl-messages');
    if (!container) return;
    const welcome = container.querySelector('.sl-welcome');
    if (welcome) container.innerHTML = '';
    const div = document.createElement('div');
    div.innerHTML = renderMessage(msg);
    container.appendChild(div.firstElementChild);
    container.querySelectorAll('pre code').forEach(el => highlightCode(el));
    scrollBottom();
  }

  function appendThinking() {
    const container = $('sl-messages');
    if (!container) return;
    const div = document.createElement('div');
    div.id = 'sl-thinking-bubble';
    div.className = 'sl-message assistant thinking';
    div.innerHTML = `
      <div class="sl-msg-avatar">${subjectIcon(_subject)}</div>
      <div class="sl-msg-body">
        <div class="sl-thinking-dots">
          <span></span><span></span><span></span>
        </div>
        <div class="sl-thinking-label">Thinking…</div>
      </div>`;
    container.appendChild(div);
    scrollBottom();
  }

  function removeThinking() {
    $('sl-thinking-bubble')?.remove();
  }

  /* ══ SEND MESSAGE ══ */
  async function sendMessage() {
    if (_isStreaming) return;
    const input = $('sl-input');
    if (!input) return;
    const text = input.value.trim();
    const images = [..._pendingImages];
    if (!text && !images.length) return;

    input.value = '';
    input.style.height = 'auto';
    clearImagePreviews();

    // Detect language
    const lang = LangDetector.detect(text);

    // Ensure active conversation
    if (!ConvMgr.current) await ConvMgr.start(_subject);

    // Build message object
    const userMsg = await ConvMgr.addMessage('user', text, { images });
    appendMessage(userMsg);
    appendThinking();
    _isStreaming = true;
    setSendBtnState(true);

    try {
      let reply;
      if (images.length) {
        // Vision mode — use first image (can extend to multiple)
        const sys = AI_SYSTEMS.vision(lang, _subject);
        reply = await AIEngine.callVision(sys, text, images[0].dataUrl);
      } else {
        // Build conversation history for context (last 20 messages)
        const history = (ConvMgr.current?.messages || [])
          .slice(-21, -1)   // exclude the message just added
          .map(m => ({ role: m.role, content: m.content }));
        const sys = AI_SYSTEMS[_subject](lang);
        reply = await AIEngine.callText(sys, [...history, { role: 'user', content: text }]);
      }

      removeThinking();
      const aiMsg = await ConvMgr.addMessage('assistant', reply);
      appendMessage(aiMsg);
      await renderSidebar($('sl-search-input')?.value || '');
      toast('Response ready!', _subject);

    } catch (err) {
      removeThinking();
      appendErrorBubble(err.message);
    } finally {
      _isStreaming = false;
      setSendBtnState(false);
    }
  }

  function appendErrorBubble(msg) {
    const container = $('sl-messages');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'sl-error-bubble';
    div.innerHTML = `<span>⚠️ ${escHtml(msg)}</span> <button onclick="this.parentElement.remove()">✕</button>`;
    container.appendChild(div);
    scrollBottom();
  }

  /* ══ MESSAGE ACTIONS ══ */
  async function copyMsg(msgId) {
    const el = document.querySelector(`[data-id="${msgId}"] .sl-msg-text`);
    if (!el) return;
    try {
      await navigator.clipboard.writeText(el.innerText || el.textContent);
      toast('Copied!', _subject);
    } catch (e) { toast('Copy failed', 'math'); }
  }

  async function regenMsg(msgId) {
    if (!ConvMgr.current) return;
    const msgs   = ConvMgr.current.messages;
    const idx    = msgs.findIndex(m => m.id === msgId);
    if (idx < 1) return;

    // Find the user message before this AI message
    let userMsg = null;
    for (let i = idx - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') { userMsg = msgs[i]; break; }
    }
    if (!userMsg) return;

    // Remove old AI message from DOM + DB
    document.querySelector(`[data-id="${msgId}"]`)?.remove();
    await ConvMgr.deleteMessage(msgId);

    appendThinking();
    _isStreaming = true;
    setSendBtnState(true);
    try {
      const lang    = LangDetector.detect(userMsg.content);
      const history = msgs.slice(0, idx - 1).map(m => ({ role: m.role, content: m.content }));
      const sys     = AI_SYSTEMS[_subject](lang);
      const reply   = await AIEngine.callText(sys, [...history, { role: 'user', content: userMsg.content }]);
      removeThinking();
      const newMsg  = await ConvMgr.addMessage('assistant', reply);
      appendMessage(newMsg);
      toast('Regenerated!', _subject);
    } catch (err) {
      removeThinking();
      appendErrorBubble(err.message);
    } finally {
      _isStreaming = false;
      setSendBtnState(false);
    }
  }

  async function editMsg(msgId) {
    const el = document.querySelector(`[data-id="${msgId}"] .sl-msg-text`);
    if (!el) return;
    const old = el.innerText || el.textContent;
    const newText = prompt('Edit your message:', old);
    if (!newText || newText === old) return;
    await ConvMgr.editMessage(msgId, newText);
    el.innerHTML = escHtml(newText).replace(/\n/g, '<br>');
    el.closest('.sl-message').querySelector('.sl-edited')?.remove();
    const meta = el.closest('.sl-msg-body').querySelector('.sl-msg-meta');
    if (meta) meta.insertAdjacentHTML('beforebegin', '<span class="sl-edited">(edited)</span>');
  }

  async function deleteMsg(msgId) {
    if (!confirm('Delete this message?')) return;
    await ConvMgr.deleteMessage(msgId);
    document.querySelector(`[data-id="${msgId}"]`)?.remove();
  }

  async function bookmarkMsg(msgId) {
    const msgs = ConvMgr.current?.messages;
    if (!msgs) return;
    const msg = msgs.find(m => m.id === msgId);
    if (!msg) return;
    msg.bookmarked = !msg.bookmarked;
    await DB.save(ConvMgr.current);
    const el  = document.querySelector(`[data-id="${msgId}"]`);
    const btn = el?.querySelector('.sl-act-btn[title="Bookmark"]');
    if (el)  el.classList.toggle('bookmarked', msg.bookmarked);
    if (btn) btn.classList.toggle('active', msg.bookmarked);
    toast(msg.bookmarked ? 'Bookmarked!' : 'Bookmark removed', _subject);
  }

  async function reactMsg(msgId, reaction) {
    const msgs = ConvMgr.current?.messages;
    if (!msgs) return;
    const msg = msgs.find(m => m.id === msgId);
    if (!msg) return;
    if (!msg.reactions) msg.reactions = {};
    msg.reactions[reaction] = !msg.reactions[reaction];
    if (reaction === 'like' && msg.reactions.like) msg.reactions.dislike = false;
    if (reaction === 'dislike' && msg.reactions.dislike) msg.reactions.like = false;
    await DB.save(ConvMgr.current);
    const el = document.querySelector(`[data-id="${msgId}"]`);
    el?.querySelector(`.sl-act-btn[title="Like"]`)?.classList.toggle('active', !!msg.reactions.like);
    el?.querySelector(`.sl-act-btn[title="Dislike"]`)?.classList.toggle('active', !!msg.reactions.dislike);
  }

  /* ══ IMAGE HANDLING ══ */
  function initImageHandling() {
    const input = $('sl-img-input');
    const area  = $('sl-drop-zone') || $('sl-chat-form');

    // File input
    input?.addEventListener('change', e => {
      Array.from(e.target.files).forEach(readImage);
      input.value = '';
    });

    // Paste from clipboard
    document.addEventListener('paste', e => {
      if (!isInputFocused()) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          readImage(item.getAsFile());
        }
      }
    });

    // Drag & drop on chat area
    const chatArea = $('sl-chat-area') || document.body;
    chatArea.addEventListener('dragover', e => {
      e.preventDefault();
      chatArea.classList.add('sl-drag-over');
    });
    chatArea.addEventListener('dragleave', () => chatArea.classList.remove('sl-drag-over'));
    chatArea.addEventListener('drop', e => {
      e.preventDefault();
      chatArea.classList.remove('sl-drag-over');
      Array.from(e.dataTransfer.files)
        .filter(f => f.type.startsWith('image/'))
        .forEach(readImage);
    });
  }

  function readImage(file) {
    if (!file) return;
    const ALLOWED = ['image/png','image/jpeg','image/gif','image/webp','image/svg+xml'];
    if (!ALLOWED.includes(file.type)) { toast('Only PNG, JPG, GIF, WebP, SVG allowed', 'math'); return; }
    if (file.size > 10 * 1024 * 1024) { toast('Image too large (max 10MB)', 'math'); return; }
    const reader = new FileReader();
    reader.onload = e => {
      _pendingImages.push({ dataUrl: e.target.result, name: file.name });
      renderImagePreview();
    };
    reader.readAsDataURL(file);
  }

  function renderImagePreview() {
    let wrap = $('sl-img-previews');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'sl-img-previews';
      wrap.className = 'sl-img-previews';
      $('sl-input-row')?.insertAdjacentElement('beforebegin', wrap);
    }
    wrap.innerHTML = _pendingImages.map((img, i) => `
      <div class="sl-img-thumb">
        <img src="${img.dataUrl}" alt="${escHtml(img.name)}">
        <button class="sl-img-remove" onclick="ChatUI.removeImage(${i})">✕</button>
        <span class="sl-img-name">${escHtml(img.name.slice(0,16))}</span>
      </div>`).join('');
  }

  function removeImage(idx) {
    _pendingImages.splice(idx, 1);
    if (_pendingImages.length) renderImagePreview();
    else clearImagePreviews();
  }

  function clearImagePreviews() {
    _pendingImages = [];
    $('sl-img-previews')?.remove();
  }

  function viewImage(imgEl) {
    const modal = document.createElement('div');
    modal.className = 'sl-img-modal';
    modal.innerHTML = `<div class="sl-img-modal-inner"><img src="${imgEl.src}"><button onclick="this.closest('.sl-img-modal').remove()">✕ Close</button></div>`;
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
  }

  /* ══ SIDEBAR ACTIONS ══ */
  async function newChat(subj) {
    _subject = subj || _subject;
    await ConvMgr.start(_subject);
    renderMessages([]);
    await renderSidebar();
    $('sl-input')?.focus();
  }

  async function confirmDelete(id) {
    if (!confirm('Delete this conversation?')) return;
    await ConvMgr.deleteConv(id);
    if (!ConvMgr.current) renderMessages([]);
    await renderSidebar();
    toast('Conversation deleted', 'math');
  }

  async function renamePrompt(id) {
    const conv = ConvMgr.all.find(c => c.id === id);
    if (!conv) return;
    const newTitle = prompt('Rename conversation:', conv.title);
    if (!newTitle || newTitle === conv.title) return;
    await ConvMgr.renameConv(id, newTitle);
    await renderSidebar();
    toast('Renamed!', _subject);
  }

  async function exportChat(id) {
    await ConvMgr.exportConv(id);
    toast('Exported as JSON!', _subject);
  }

  async function importChat(file) {
    try {
      const conv = await ConvMgr.importConv(file);
      toast(`Imported: ${conv.title}`, _subject);
      await renderSidebar();
    } catch (e) {
      toast('Import failed: invalid file', 'math');
    }
  }

  /* ══ SUBJECT SWITCHING ══ */
  function setSubject(s) {
    _subject = s;
    renderMessages(ConvMgr.current?.messages || []);
  }

  /* ══ UTILITY ══ */
  function scrollBottom() {
    const c = $('sl-messages');
    if (c) c.scrollTop = c.scrollHeight;
  }

  function setSendBtnState(loading) {
    const btn = $('sl-send-btn');
    if (!btn) return;
    btn.disabled = loading;
    btn.innerHTML = loading
      ? `<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
  }

  function subjectIcon(s) {
    return { chem: '⚗️', phys: '⚡', math: '∫' }[s] || '🤖';
  }

  function isInputFocused() {
    const el = document.activeElement;
    return el && (el.id === 'sl-input' || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT');
  }

  function useSuggestion(text) {
    const input = $('sl-input');
    if (input) { input.value = text; input.focus(); autoResizeInput(input); }
  }

  function autoResizeInput(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  }

  /* ── simple syntax highlight (CSS class only, no heavy lib) ── */
  function highlightCode(el) {
    const lang = el.parentElement?.dataset?.lang || '';
    if (lang) el.parentElement.setAttribute('data-lang', lang.toUpperCase());
  }

  /* ── escape HTML ── */
  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return {
    init: async function(subj = 'chem') {
      _subject = subj;
      await ConvMgr.refresh();
      await renderSidebar();
      renderMessages(ConvMgr.current?.messages || []);
      initImageHandling();

      // Input auto-resize
      const input = $('sl-input');
      if (input) {
        input.addEventListener('input', () => autoResizeInput(input));
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
          }
        });
      }

      // Send button
      $('sl-send-btn')?.addEventListener('click', sendMessage);

      // New chat button
      $('sl-new-chat')?.addEventListener('click', () => newChat(_subject));

      // Search
      const searchInput = $('sl-search-input');
      if (searchInput) {
        let searchTimer;
        searchInput.addEventListener('input', () => {
          clearTimeout(searchTimer);
          searchTimer = setTimeout(() => renderSidebar(searchInput.value), 300);
        });
      }

      // Import button
      $('sl-import-btn')?.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (file) await importChat(file);
        e.target.value = '';
      });

      // Image attach
      $('sl-img-btn')?.addEventListener('click', () => $('sl-img-input')?.click());

      // Sidebar toggle
      $('sl-sidebar-toggle')?.addEventListener('click', () => {
        $('sl-sidebar')?.classList.toggle('collapsed');
      });

      // Camera (mobile)
      $('sl-camera-btn')?.addEventListener('click', () => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
        inp.onchange = e => { if (e.target.files[0]) readImage(e.target.files[0]); };
        inp.click();
      });
    },

    // Public API
    sendMessage,
    newChat,
    setSubject,
    copyMsg,
    regenMsg,
    editMsg,
    deleteMsg,
    bookmarkMsg,
    reactMsg,
    removeImage,
    viewImage,
    confirmDelete,
    renamePrompt,
    exportChat,
    renderSidebar,
    useSuggestion,
  };
})();


/* ══════════════════════════════════════════════════════════════════════════
   9. VOICE INPUT  (enhanced from original)
══════════════════════════════════════════════════════════════════════════ */
const VoiceInput = (() => {
  let _rec = null, _active = false;

  function supported() {
    return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
  }

  function start(targetInputId, lang = 'auto') {
    if (!supported()) { toast('Voice input requires Chrome or Edge.', 'math'); return; }
    if (_active) { stop(); return; }

    const input = document.getElementById(targetInputId);
    if (!input) return;

    const subj    = targetInputId.split('-')[0];
    const vbtn    = document.getElementById(subj + '-vbtn') || document.getElementById('sl-voice-btn');
    const SR      = window.SpeechRecognition || window.webkitSpeechRecognition;
    _rec          = new SR();
    _rec.continuous    = false;
    _rec.interimResults = true;
    _rec.lang = lang === 'auto' ? 'bn-BD' : lang;  // Default Bengali for this platform

    _active = true;
    vbtn?.classList.add('rec');
    toast('Listening… (speak in Bengali or English)', subj);

    let final = '';
    _rec.onresult = e => {
      let interim = ''; final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      if (input) input.value = final || interim;
    };

    _rec.onend = () => {
      _active = false;
      vbtn?.classList.remove('rec');
      if (final.trim()) {
        input.value = final.trim();
        // Auto-send
        const sendFn = window.ChatUI?.sendMessage || (() => {
          const s = targetInputId.split('-')[0];
          if (typeof askAI === 'function') askAI(s);
        });
        sendFn();
      }
    };

    _rec.onerror = ev => {
      _active = false;
      vbtn?.classList.remove('rec');
      if (ev.error !== 'no-speech' && ev.error !== 'aborted')
        toast('Voice error: ' + ev.error, 'math');
    };

    _rec.start();
  }

  function stop() {
    _rec?.stop();
    _active = false;
  }

  return { start, stop, supported };
})();


/* ══════════════════════════════════════════════════════════════════════════
   10. CSS INJECTION  (styles for new chat UI elements)
══════════════════════════════════════════════════════════════════════════ */
(function injectStyles() {
  const css = `
/* ── Sidebar ── */
#sl-sidebar { width:280px;background:var(--bg2,#111118);border-right:1px solid var(--border,#2a2a3a);display:flex;flex-direction:column;height:100vh;transition:transform .3s;z-index:100;flex-shrink:0; }
#sl-sidebar.collapsed { transform:translateX(-280px);position:absolute; }
.sl-sb-header { padding:14px 16px;border-bottom:1px solid var(--border,#2a2a3a); }
.sl-sb-logo { font-size:17px;font-weight:800;letter-spacing:-.5px; }
.sl-sb-logo span { color:var(--chem,#4f8ef7); }
#sl-new-chat { display:flex;align-items:center;gap:8px;width:100%;padding:9px 12px;background:var(--chem,#4f8ef7);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700;margin-top:10px;transition:opacity .2s; }
#sl-new-chat:hover { opacity:.85; }
.sl-search-wrap { padding:8px 12px;border-bottom:1px solid var(--border,#2a2a3a); }
.sl-search-wrap input { width:100%;background:var(--bg3,#1a1a25);border:1px solid var(--border,#2a2a3a);border-radius:8px;padding:6px 10px;color:var(--text,#e8e8f0);font-size:13px;outline:none; }
.sl-search-wrap input:focus { border-color:var(--acc,#4f8ef7); }
#sl-chat-list { flex:1;overflow-y:auto;padding:4px 8px; }
.sl-group-label { font-size:10px;font-weight:700;color:var(--text3,#5a5a78);text-transform:uppercase;letter-spacing:1px;padding:6px 8px 2px; }
.sl-chat-item { display:flex;align-items:center;gap:8px;padding:8px 8px;border-radius:8px;cursor:pointer;margin-bottom:2px;transition:background .15s;position:relative; }
.sl-chat-item:hover { background:var(--bg3,#1a1a25); }
.sl-chat-item.active { background:var(--bg4,#22222e);border-left:3px solid var(--acc,#4f8ef7); }
.sl-dot { width:8px;height:8px;border-radius:50%;flex-shrink:0; }
.sl-dot.chem { background:var(--chem,#4f8ef7); }
.sl-dot.phys { background:var(--phys,#00e87a); }
.sl-dot.math { background:var(--math,#ff6b9d); }
.sl-chat-info { flex:1;min-width:0; }
.sl-chat-title { font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
.sl-chat-time { font-size:11px;color:var(--text3,#5a5a78);margin-top:1px; }
.sl-chat-actions { display:none;gap:3px; }
.sl-chat-item:hover .sl-chat-actions { display:flex; }
.sl-chat-btn { background:none;border:none;cursor:pointer;font-size:13px;padding:2px 3px;border-radius:4px;opacity:.6;transition:opacity .15s; }
.sl-chat-btn:hover { opacity:1; }
.sl-chat-btn.del:hover { color:#ef4444; }
.sl-empty-convs { padding:20px 16px;color:var(--text3,#5a5a78);font-size:13px;text-align:center;line-height:1.6; }
.sl-sb-bottom { padding:10px 12px;border-top:1px solid var(--border,#2a2a3a);display:flex;gap:6px; }
.sl-sb-icon-btn { flex:1;padding:7px;background:var(--bg3,#1a1a25);border:1px solid var(--border,#2a2a3a);border-radius:8px;color:var(--text2,#9090b0);cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;gap:4px;transition:background .15s; }
.sl-sb-icon-btn:hover { background:var(--bg4,#22222e); }

/* ── Messages ── */
#sl-messages { flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:16px; }
.sl-message { display:flex;gap:12px;animation:msgIn .25s ease; }
.sl-message.user { flex-direction:row-reverse; }
@keyframes msgIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
.sl-msg-avatar { width:36px;height:36px;border-radius:50%;background:var(--bg3,#1a1a25);border:1px solid var(--border,#2a2a3a);display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0;margin-top:2px; }
.sl-msg-body { max-width:80%;display:flex;flex-direction:column;gap:4px; }
.sl-message.user .sl-msg-body { align-items:flex-end; }
.sl-msg-text { background:var(--bg2,#111118);border:1px solid var(--border,#2a2a3a);border-radius:12px;padding:12px 14px;font-size:14px;line-height:1.65;word-break:break-word; }
.sl-message.user .sl-msg-text { background:var(--acc,#4f8ef7);color:#fff;border-color:transparent; }
.sl-message.bookmarked .sl-msg-text { border-color:var(--gold,#f59e0b); }
.sl-msg-meta { display:flex;align-items:center;gap:8px;flex-wrap:wrap; }
.sl-message.user .sl-msg-meta { flex-direction:row-reverse; }
.sl-msg-time { font-size:11px;color:var(--text3,#5a5a78); }
.sl-msg-actions { display:flex;gap:3px;opacity:0;transition:opacity .2s; }
.sl-message:hover .sl-msg-actions { opacity:1; }
.sl-act-btn { background:none;border:none;cursor:pointer;font-size:13px;padding:2px 4px;border-radius:5px;opacity:.6;transition:all .15s; }
.sl-act-btn:hover { opacity:1;background:var(--bg3,#1a1a25); }
.sl-act-btn.active { opacity:1; }
.sl-act-btn.del:hover { color:#ef4444; }
.sl-edited { font-size:11px;color:var(--text3,#5a5a78);font-style:italic; }

/* ── Thinking ── */
.sl-message.thinking .sl-msg-text { background:var(--bg3,#1a1a25); }
.sl-thinking-dots { display:flex;gap:5px;padding:4px 0; }
.sl-thinking-dots span { width:8px;height:8px;border-radius:50%;background:var(--acc,#4f8ef7);animation:dot .8s infinite; }
.sl-thinking-dots span:nth-child(2) { animation-delay:.15s; }
.sl-thinking-dots span:nth-child(3) { animation-delay:.3s; }
@keyframes dot { 0%,60%,100%{transform:translateY(0);opacity:.6} 30%{transform:translateY(-6px);opacity:1} }
.sl-thinking-label { font-size:12px;color:var(--text3,#5a5a78); }

/* ── Error ── */
.sl-error-bubble { display:flex;align-items:center;justify-content:space-between;background:#2a0a0a;border:1px solid #ef444440;border-radius:10px;padding:10px 14px;font-size:13px;color:#ef4444;gap:12px; }
.sl-error-bubble button { background:none;border:none;color:#ef4444;cursor:pointer;font-size:14px; }

/* ── Image handling ── */
.sl-img-previews { display:flex;flex-wrap:wrap;gap:8px;padding:8px 14px; }
.sl-img-thumb { position:relative;border-radius:8px;overflow:hidden;border:1px solid var(--border,#2a2a3a); }
.sl-img-thumb img { width:72px;height:72px;object-fit:cover;display:block; }
.sl-img-remove { position:absolute;top:3px;right:3px;background:rgba(0,0,0,.7);border:none;color:#fff;border-radius:50%;width:18px;height:18px;cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:center; }
.sl-img-name { display:block;font-size:10px;color:var(--text3,#5a5a78);padding:2px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:72px; }
.sl-msg-images { display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px; }
.sl-msg-img { width:160px;height:110px;object-fit:cover;border-radius:8px;cursor:pointer;border:1px solid var(--border,#2a2a3a);transition:opacity .2s; }
.sl-msg-img:hover { opacity:.9; }
.sl-img-modal { position:fixed;inset:0;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;z-index:9999; }
.sl-img-modal-inner { position:relative;max-width:90vw;max-height:90vh; }
.sl-img-modal-inner img { max-width:90vw;max-height:80vh;border-radius:10px; }
.sl-img-modal-inner button { display:block;margin:12px auto 0;padding:8px 20px;background:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600; }
.sl-drag-over { outline:3px dashed var(--chem,#4f8ef7);outline-offset:-4px; }

/* ── Welcome screen ── */
.sl-welcome { display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;text-align:center;flex:1;gap:12px; }
.sl-welcome-icon { font-size:56px;line-height:1; }
.sl-welcome-title { font-size:26px;font-weight:800; }
.sl-welcome-sub { font-size:14px;color:var(--text2,#9090b0); }
.sl-suggestions { display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:8px;max-width:600px; }
.sl-suggestion { padding:8px 14px;background:var(--bg2,#111118);border:1px solid var(--border,#2a2a3a);border-radius:20px;cursor:pointer;font-size:13px;font-family:var(--bengali,'Noto Sans Bengali',sans-serif);transition:border-color .2s,background .2s; }
.sl-suggestion:hover { border-color:var(--acc,#4f8ef7);background:var(--bg3,#1a1a25); }

/* ── Markdown content ── */
.md-content { font-family:var(--bengali,'Noto Sans Bengali',sans-serif) !important; }
.md-content p { margin-bottom:.8em;line-height:1.7; }
.md-content h2.md-h1,.md-content h3.md-h2,.md-content h4.md-h3 { color:var(--acc,#4f8ef7);margin:1em 0 .4em;font-weight:700; }
.md-content ul.md-ul,.md-content ol.md-ol { padding-left:20px;margin:.6em 0; }
.md-content ul.md-ul li,.md-content ol.md-ol li { margin-bottom:.3em;line-height:1.65; }
.md-content strong { font-weight:700;color:var(--text,#e8e8f0); }
.md-content em { font-style:italic;color:var(--text2,#9090b0); }
.md-content code.inline-code { background:var(--bg3,#1a1a25);border:1px solid var(--border,#2a2a3a);border-radius:4px;padding:1px 5px;font-family:'Space Mono',monospace;font-size:.88em; }
.md-content pre.code-block { background:#0d1117;border:1px solid var(--border,#2a2a3a);border-radius:8px;padding:12px 14px;overflow-x:auto;margin:.8em 0;position:relative; }
.md-content pre.code-block::after { content:attr(data-lang);position:absolute;top:6px;right:10px;font-size:10px;color:var(--text3,#5a5a78);font-family:'Space Mono',monospace; }
.md-content pre.code-block code { font-family:'Space Mono',monospace;font-size:13px;line-height:1.6;color:#e6edf3; }
.md-content blockquote.md-bq { border-left:3px solid var(--acc,#4f8ef7);padding:6px 12px;margin:.6em 0;color:var(--text2,#9090b0);font-style:italic; }
.md-content hr.md-hr { border:none;border-top:1px solid var(--border,#2a2a3a);margin:1em 0; }
.md-content .table-wrap { overflow-x:auto;margin:.8em 0; }
.md-content table.resp-table { border-collapse:collapse;width:100%;font-size:13px; }
.md-content table.resp-table th,.md-content table.resp-table td { border:1px solid var(--border,#2a2a3a);padding:7px 10px;text-align:left; }
.md-content table.resp-table th { background:var(--bg3,#1a1a25);font-weight:700; }
.md-content table.resp-table tr:hover td { background:var(--bg3,#1a1a25); }

/* ── Input area ── */
#sl-input-area { padding:12px 16px;border-top:1px solid var(--border,#2a2a3a);background:var(--bg2,#111118); }
#sl-input-row { display:flex;align-items:flex-end;gap:8px;background:var(--bg3,#1a1a25);border:1px solid var(--border,#2a2a3a);border-radius:12px;padding:8px 10px;transition:border-color .2s; }
#sl-input-row:focus-within { border-color:var(--acc,#4f8ef7); }
#sl-input { flex:1;background:transparent;border:none;outline:none;color:var(--text,#e8e8f0);font-size:14px;font-family:var(--bengali,'Noto Sans Bengali',sans-serif);line-height:1.6;resize:none;min-height:24px;max-height:160px; }
#sl-input::placeholder { color:var(--text3,#5a5a78); }
.sl-input-btns { display:flex;align-items:center;gap:4px; }
.sl-inp-btn { background:none;border:none;color:var(--text2,#9090b0);cursor:pointer;padding:5px 6px;border-radius:7px;font-size:16px;display:flex;align-items:center;justify-content:center;transition:color .15s,background .15s; }
.sl-inp-btn:hover { color:var(--acc,#4f8ef7);background:var(--bg4,#22222e); }
.sl-inp-btn.rec { color:#ef4444;animation:pulse .8s infinite; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
#sl-send-btn { background:var(--acc,#4f8ef7);color:#fff;border:none;border-radius:8px;width:36px;height:36px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity .2s; }
#sl-send-btn:disabled { opacity:.5;cursor:not-allowed; }
#sl-send-btn svg { width:16px;height:16px; }
.sl-input-hint { font-size:11px;color:var(--text3,#5a5a78);margin-top:5px;padding:0 4px; }

/* ── Voice btn ── */
#sl-voice-btn.rec { color:#ef4444 !important; }

/* ── Spin ── */
.spin { animation:spin .7s linear infinite; }
@keyframes spin { to{transform:rotate(360deg)} }
  `;
  const style = document.createElement('style');
  style.id = 'sl-injected-styles';
  style.textContent = css;
  document.head.appendChild(style);
})();


/* ══════════════════════════════════════════════════════════════════════════
   11. CHAT UI HTML INJECTION
   Injects the entire Chat UI into whatever container exists in your HTML.
   If you have a specific container (e.g. #chat-container), change the
   CHAT_MOUNT_ID below. Otherwise it appends to body.
══════════════════════════════════════════════════════════════════════════ */
const CHAT_MOUNT_ID = 'chat-container'; // ← change to match your HTML

function buildChatHTML() {
  return `
<div id="sl-app" style="display:flex;height:100%;min-height:100vh;">
  <!-- SIDEBAR -->
  <aside id="sl-sidebar">
    <div class="sl-sb-header">
      <div class="sl-sb-logo"><span>Science</span>Lab AI</div>
      <button id="sl-new-chat">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        New Chat
      </button>
    </div>
    <div class="sl-search-wrap">
      <input id="sl-search-input" placeholder="Search conversations…" autocomplete="off">
    </div>
    <div id="sl-chat-list"></div>
    <div class="sl-sb-bottom">
      <button class="sl-sb-icon-btn" onclick="document.getElementById('sl-import-input').click()" title="Import">
        ⬆️ Import
      </button>
      <input id="sl-import-input" type="file" accept=".json" style="display:none" id="sl-import-btn">
      <button class="sl-sb-icon-btn" onclick="toggleTheme && toggleTheme()" title="Theme">
        🌙 Theme
      </button>
    </div>
  </aside>

  <!-- MAIN -->
  <div id="sl-main" style="flex:1;display:flex;flex-direction:column;height:100vh;overflow:hidden;min-width:0;">
    <!-- TOP BAR -->
    <div id="sl-top-bar" style="height:52px;background:var(--bg2,#111118);border-bottom:1px solid var(--border,#2a2a3a);display:flex;align-items:center;gap:10px;padding:0 14px;flex-shrink:0;">
      <button id="sl-sidebar-toggle" style="background:none;border:none;color:var(--text2,#9090b0);cursor:pointer;padding:6px;border-radius:6px;font-size:18px;">☰</button>
      <div style="display:flex;gap:6px;flex:1;justify-content:center;">
        <button class="sl-tab-btn" data-subj="chem" onclick="switchSLSubject('chem')">⚗️ Chemistry</button>
        <button class="sl-tab-btn" data-subj="phys" onclick="switchSLSubject('phys')">⚡ Physics</button>
        <button class="sl-tab-btn" data-subj="math" onclick="switchSLSubject('math')">∫ Maths</button>
      </div>
      <div style="display:flex;gap:6px;align-items:center;">
        <button id="sl-voice-btn" class="sl-inp-btn" onclick="VoiceInput.start('sl-input')" title="Voice (Bengali/English)">🎤</button>
        <button id="sl-theme-btn" class="sl-inp-btn" onclick="toggleTheme && toggleTheme()" title="Toggle theme">🌙</button>
      </div>
    </div>

    <!-- MESSAGES -->
    <div id="sl-chat-area" style="flex:1;overflow:hidden;display:flex;flex-direction:column;">
      <div id="sl-messages" style="flex:1;overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:16px;"></div>

      <!-- INPUT AREA -->
      <div id="sl-input-area">
        <div id="sl-input-row">
          <textarea id="sl-input" placeholder="Ask anything in English or বাংলায় লিখুন… (Shift+Enter for new line)" rows="1"></textarea>
          <div class="sl-input-btns">
            <button id="sl-img-btn" class="sl-inp-btn" title="Attach image (PNG/JPG/GIF/WebP)">📎</button>
            <button id="sl-camera-btn" class="sl-inp-btn" title="Camera">📷</button>
            <input id="sl-img-input" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" multiple style="display:none">
            <button id="sl-send-btn" aria-label="Send">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </div>
        </div>
        <div class="sl-input-hint">Enter to send · Shift+Enter for new line · Paste or drag images · 🎤 Voice supports Bengali &amp; English</div>
      </div>
    </div>
  </div>
</div>

<style>
  .sl-tab-btn{padding:5px 14px;border-radius:16px;border:1px solid var(--border,#2a2a3a);background:transparent;color:var(--text2,#9090b0);cursor:pointer;font-size:13px;font-weight:600;transition:all .2s;}
  .sl-tab-btn.active-chem{background:var(--chem,#4f8ef7);color:#fff;border-color:var(--chem,#4f8ef7);}
  .sl-tab-btn.active-phys{background:var(--phys,#00e87a);color:#000;border-color:var(--phys,#00e87a);}
  .sl-tab-btn.active-math{background:var(--math,#ff6b9d);color:#fff;border-color:var(--math,#ff6b9d);}
</style>
`;
}

function switchSLSubject(s) {
  ChatUI.setSubject(s);
  document.querySelectorAll('.sl-tab-btn').forEach(b => {
    b.className = 'sl-tab-btn' + (b.dataset.subj === s ? ` active-${s}` : '');
  });
  // Also trigger existing gotoSubject if available
  if (typeof gotoSubject === 'function') gotoSubject(s);
}

// Mount chat UI
(function mountChatUI() {
  const mount = document.getElementById(CHAT_MOUNT_ID) || (() => {
    // If no dedicated container, inject at end of body
    const d = document.createElement('div');
    d.id = CHAT_MOUNT_ID;
    d.style.cssText = 'width:100%;height:100vh;';
    document.body.appendChild(d);
    return d;
  })();

  mount.innerHTML = buildChatHTML();

  // Wire import input
  const imp = document.getElementById('sl-import-input');
  if (imp) imp.addEventListener('change', async e => {
    if (e.target.files[0]) await ChatUI.importChat ? ChatUI.importChat(e.target.files[0]) : ConvMgr.importConv(e.target.files[0]);
    e.target.value = '';
  });
})();


/* ══════════════════════════════════════════════════════════════════════════
   12. INIT on DOMContentLoaded (or immediately if already loaded)
══════════════════════════════════════════════════════════════════════════ */
function initScienceLabAI() {
  ChatUI.init('chem');
  // Set initial tab active
  document.querySelector('.sl-tab-btn[data-subj="chem"]')?.classList.add('active-chem');
  // Extend existing askAI to also update conversation history
  const _origAskAI = window.askAI;
  if (typeof _origAskAI === 'function') {
    window.askAI = async function(subject) {
      const inp  = document.getElementById(subject + '-q');
      const text = inp?.value?.trim();
      if (text) {
        if (!ConvMgr.current || ConvMgr.current.subject !== subject)
          await ConvMgr.start(subject);
        await ConvMgr.addMessage('user', text);
      }
      const result = await _origAskAI(subject);
      // Grab AI answer from DOM after original function
      const ans = document.getElementById(subject + '-acont');
      if (ans && ans.innerText?.trim()) {
        await ConvMgr.addMessage('assistant', ans.innerText.trim());
        await ChatUI.renderSidebar();
      }
      return result;
    };
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initScienceLabAI);
} else {
  initScienceLabAI();
}


/* ══════════════════════════════════════════════════════════════════════════
   13. UTILITY FUNCTIONS  (shared with rest of app)
══════════════════════════════════════════════════════════════════════════ */
function formatRelTime(ts) {
  const diff = Date.now() - ts;
  const mins  = Math.floor(diff / 60000);
  const hrs   = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hrs  < 24)  return `${hrs}h ago`;
  if (days < 7)   return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/* ══════════════════════════════════════════════════════════════════════════
   EXPORTS  (accessible globally for inline HTML handlers)
══════════════════════════════════════════════════════════════════════════ */
window.ChatUI       = ChatUI;
window.ConvMgr      = ConvMgr;
window.VoiceInput   = VoiceInput;
window.LangDetector = LangDetector;
window.BengaliTerms = BengaliTerms;
window.AIEngine     = AIEngine;
window.mdToHtml     = mdToHtml;
window.switchSLSubject = switchSLSubject;
