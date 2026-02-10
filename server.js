const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3460;

// The Pi Lexicon API endpoint (local network)
// In production, we bundle a snapshot and simulate evolution
const PI_API = 'http://192.168.1.111:7890';

// Bundled lexicon snapshot (updated periodically)
let lexiconSnapshot = null;
try {
  lexiconSnapshot = require('./data/snapshot.json');
} catch(e) {
  // Will generate seed data if no snapshot
}

// Simple in-memory evolution engine (mirrors Pi logic)
// This runs independently so the web version works even without Pi access

const CONSONANTS = ['k', 'n', 't', 's', 'm', 'r', 'h', 'p', 'l', 'w', 'v', 'z'];
const VOWELS = ['a', 'i', 'u', 'e', 'o'];
const C_WEIGHTS = [12, 15, 10, 8, 12, 8, 6, 5, 7, 4, 3, 2];
const V_WEIGHTS = [20, 15, 10, 12, 8];

const SOUND_SHIFTS = {
  'k': ['g', 'h'], 't': ['d', 's'], 'p': ['b', 'f'],
  's': ['z', 'sh'], 'h': ['', 'w'], 'n': ['m', 'ng'],
  'r': ['l', '']
};

const CONCEPTS = {
  natural: ['water', 'fire', 'earth', 'wind', 'stone', 'tree', 'river', 'mountain', 
            'sun', 'moon', 'star', 'rain', 'snow', 'flower', 'seed', 'sky', 'ocean', 'cloud'],
  abstract: ['time', 'space', 'change', 'pattern', 'boundary', 'flow', 'balance',
             'emergence', 'connection', 'threshold', 'cycle', 'wave', 'order', 'chaos'],
  quality: ['big', 'small', 'fast', 'slow', 'bright', 'dark', 'warm', 'cold',
            'old', 'new', 'near', 'far', 'deep', 'high', 'soft', 'hard'],
  action: ['move', 'grow', 'break', 'join', 'give', 'take', 'make', 'find',
           'hold', 'release', 'begin', 'end', 'turn', 'fall', 'rise', 'flow'],
  relation: ['with', 'from', 'toward', 'through', 'between', 'within', 'beyond', 'around'],
  being: ['self', 'other', 'many', 'one', 'all', 'none', 'part', 'whole'],
};

const ALL_CONCEPTS = [];
const CONCEPT_CATS = {};
for (const [cat, concepts] of Object.entries(CONCEPTS)) {
  for (const c of concepts) { ALL_CONCEPTS.push(c); CONCEPT_CATS[c] = cat; }
}

function weightedChoice(items, weights) {
  const total = weights.reduce((a,b) => a+b, 0);
  let r = Math.random() * total, cum = 0;
  for (let i = 0; i < items.length; i++) {
    cum += weights[i];
    if (r <= cum) return items[i];
  }
  return items[items.length - 1];
}

function genSyllable() {
  const onset = Math.random() > 0.2 ? weightedChoice(CONSONANTS, C_WEIGHTS) : '';
  const nucleus = weightedChoice(VOWELS, V_WEIGHTS);
  const coda = Math.random() > 0.7 ? ['n','m',''][Math.floor(Math.random()*3)] : '';
  return onset + nucleus + coda;
}

function genWord() {
  const syls = [1,2,3][Math.floor(Math.random() * 3)];
  const weights = [15, 50, 35];
  const total = 100; let r = Math.random() * total, cum = 0;
  let n = 2;
  for (let i = 0; i < 3; i++) { cum += weights[i]; if (r <= cum) { n = i+1; break; } }
  return Array.from({length: n}, () => genSyllable()).join('');
}

// In-memory state (loaded from snapshot or seeded)
let state = lexiconSnapshot || {
  words: {},
  compounds: {},
  generation: 0,
  extinct: [],
  sound_shifts: [],
  events: [],
  stats: { total_generated: 0, total_extinct: 0, total_compounds: 0, total_shifts: 0 }
};

// If no snapshot, seed
if (!state.words || Object.keys(state.words).length === 0) {
  const initial = [];
  for (let i = 0; i < 10; i++) initial.push(ALL_CONCEPTS[Math.floor(Math.random() * ALL_CONCEPTS.length)]);
  const unique = [...new Set(initial)].slice(0, 10);
  for (const concept of unique) {
    const word = genWord();
    state.words[word] = { meaning: concept, category: CONCEPT_CATS[concept], born: 0, uses: 1, fitness: 1.0, history: [word] };
  }
  state.stats.total_generated = Object.keys(state.words).length;
}

if (!state.events) state.events = [];

function evolveStep() {
  // Ensure all required state fields exist
  if (!state.words) state.words = {};
  if (!state.compounds) state.compounds = {};
  if (!state.extinct) state.extinct = [];
  if (!state.sound_shifts) state.sound_shifts = [];
  if (!state.events) state.events = [];
  if (!state.stats) state.stats = { total_generated: 0, total_extinct: 0, total_compounds: 0, total_shifts: 0 };
  if (!state.stats.total_generated) state.stats.total_generated = 0;
  if (!state.stats.total_extinct) state.stats.total_extinct = 0;
  if (!state.stats.total_compounds) state.stats.total_compounds = 0;
  if (!state.stats.total_shifts) state.stats.total_shifts = 0;

  const gen = (state.generation || 0) + 1;
  state.generation = gen;
  const events = [];

  // 1. Birth (70% chance)
  if (Math.random() < 0.7) {
    const covered = new Set(Object.values(state.words).map(w => w.meaning));
    const uncovered = ALL_CONCEPTS.filter(c => !covered.has(c));
    const concept = uncovered.length > 0 ? uncovered[Math.floor(Math.random() * uncovered.length)] : ALL_CONCEPTS[Math.floor(Math.random() * ALL_CONCEPTS.length)];
    let word = genWord();
    while (state.words[word]) word = genWord();
    state.words[word] = { meaning: concept, category: CONCEPT_CATS[concept], born: gen, uses: 0, fitness: 0.5, history: [word] };
    state.stats.total_generated++;
    events.push({ type: 'birth', gen, word, meaning: concept, category: CONCEPT_CATS[concept] });
  }

  // 2. Usage
  const words = Object.keys(state.words);
  const usedCount = Math.max(1, Math.floor(words.length / 3));
  const shuffled = [...words].sort(() => Math.random() - 0.5);
  for (let i = 0; i < Math.min(usedCount, shuffled.length); i++) {
    state.words[shuffled[i]].uses++;
    state.words[shuffled[i]].fitness = Math.min(2.0, state.words[shuffled[i]].fitness + 0.1);
  }

  // 3. Decay
  for (const w of Object.keys(state.words)) {
    const d = state.words[w];
    const age = gen - d.born;
    if (age > 0) {
      d.fitness -= 0.05;
      if (d.uses === 0 && age > 3) d.fitness -= 0.2;
    }
  }

  // 4. Extinction
  for (const w of Object.keys(state.words)) {
    if (state.words[w].fitness <= 0) {
      const d = state.words[w];
      if (!state.extinct) state.extinct = [];
      state.extinct.push({ word: w, meaning: d.meaning, born: d.born, died: gen, uses: d.uses });
      if (state.extinct.length > 50) state.extinct = state.extinct.slice(-50);
      events.push({ type: 'extinct', gen, word: w, meaning: d.meaning });
      state.stats.total_extinct++;
      delete state.words[w];
    }
  }

  // 5. Sound shift (10%)
  if (Math.random() < 0.1 && Object.keys(state.words).length > 0) {
    const target = Object.keys(state.words)[Math.floor(Math.random() * Object.keys(state.words).length)];
    let result = target.split('');
    let shifted = false;
    for (let i = 0; i < result.length; i++) {
      if (SOUND_SHIFTS[result[i]] && Math.random() < 0.15) {
        const opts = SOUND_SHIFTS[result[i]];
        result[i] = opts[Math.floor(Math.random() * opts.length)];
        shifted = true;
      }
    }
    const newForm = result.join('');
    if (shifted && newForm !== target && !state.words[newForm]) {
      const data = state.words[target];
      delete state.words[target];
      data.history.push(newForm);
      state.words[newForm] = data;
      state.stats.total_shifts++;
      if (!state.sound_shifts) state.sound_shifts = [];
      state.sound_shifts.push({ gen, from: target, to: newForm, meaning: data.meaning });
      if (state.sound_shifts.length > 30) state.sound_shifts = state.sound_shifts.slice(-30);
      events.push({ type: 'shift', gen, from: target, to: newForm, meaning: data.meaning });
    }
  }

  // 6. Compound (15%)
  if (Math.random() < 0.15 && Object.keys(state.words).length >= 4) {
    const keys = Object.keys(state.words);
    const [w1, w2] = [keys[Math.floor(Math.random()*keys.length)], keys[Math.floor(Math.random()*keys.length)]];
    if (w1 !== w2) {
      const compound = w1.slice(0, Math.max(2, Math.floor(w1.length/2))) + w2.slice(Math.floor(w2.length/2));
      const meaning = `${state.words[w1].meaning}-${state.words[w2].meaning}`;
      if (!state.words[compound] && !state.compounds[compound]) {
        if (!state.compounds) state.compounds = {};
        state.compounds[compound] = { parts: [w1,w2], meanings: [state.words[w1].meaning, state.words[w2].meaning], compound_meaning: meaning, born: gen };
        state.stats.total_compounds++;
        events.push({ type: 'compound', gen, word: compound, meaning, parts: [w1,w2] });
      }
    }
  }

  // Store events
  for (const e of events) {
    state.events.push({ ...e, time: new Date().toISOString() });
  }
  if (state.events.length > 200) state.events = state.events.slice(-200);

  return events;
}

function generateSentence() {
  const words = Object.keys(state.words);
  if (words.length === 0) return { text: '(silence)', gloss: '(empty lexicon)', words: [] };
  const len = 3 + Math.floor(Math.random() * 5);
  const catOrder = ['being','quality','action','natural','relation','abstract'];
  const sentWords = [];
  
  for (let i = 0; i < len; i++) {
    if (catOrder.length > 0 && Math.random() > 0.3) {
      const cat = catOrder.shift();
      const candidates = Object.entries(state.words).filter(([_,d]) => d.category === cat);
      if (candidates.length > 0) {
        sentWords.push(candidates[Math.floor(Math.random()*candidates.length)]);
        continue;
      }
    }
    const w = words[Math.floor(Math.random()*words.length)];
    sentWords.push([w, state.words[w]]);
  }

  return {
    text: sentWords.map(([w]) => w).join(' '),
    gloss: sentWords.map(([_,d]) => d.meaning).join(' '),
    words: sentWords.map(([w,d]) => ({ word: w, meaning: d.meaning, category: d.category }))
  };
}

// Try to fetch from Pi on startup and periodically
async function syncFromPi() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${PI_API}/api/state`, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const piState = await res.json();
      // Merge Pi state into our state, preserving our event log
      const ourEvents = state.events || [];
      const ourExtinct = state.extinct || piState.extinct || [];
      const ourShifts = state.sound_shifts || piState.sound_shifts || [];
      const ourStats = piState.stats || state.stats || {};
      state.words = piState.words || {};
      state.compounds = piState.compounds || {};
      state.generation = piState.generation || 0;
      state.extinct = piState.extinct && piState.extinct.length > ourExtinct.length ? piState.extinct : ourExtinct;
      state.sound_shifts = piState.sound_shifts && piState.sound_shifts.length > ourShifts.length ? piState.sound_shifts : ourShifts;
      state.stats = ourStats;
      state.events = ourEvents;
      state.piConnected = true;
      state.lastPiSync = new Date().toISOString();
      console.log(`[sync] Pi Lexicon connected — gen ${piState.generation}, ${Object.keys(piState.words).length} words`);
      return true;
    }
  } catch(e) {
    state.piConnected = false;
  }
  return false;
}

// Serve static
app.use(express.static(path.join(__dirname, 'public')));

// API
app.get('/api/state', (req, res) => {
  res.json({
    ...state,
    wordCount: Object.keys(state.words).length,
    compoundCount: Object.keys(state.compounds || {}).length,
    piConnected: state.piConnected || false,
    lastPiSync: state.lastPiSync || null,
  });
});

app.get('/api/evolve', (req, res) => {
  const events = evolveStep();
  res.json({ generation: state.generation, events, wordCount: Object.keys(state.words).length });
});

app.get('/api/sentence', (req, res) => {
  res.json(generateSentence());
});

app.get('/api/history', (req, res) => {
  res.json({
    events: (state.events || []).slice(-100),
    extinct: (state.extinct || []).slice(-20),
    sound_shifts: (state.sound_shifts || []).slice(-20),
    compounds: state.compounds || {},
  });
});

// Health
app.get('/health', (req, res) => res.json({ status: 'ok', generation: state.generation }));

app.listen(PORT, async () => {
  console.log(`Lexicon Live running on port ${PORT}`);
  
  // Try initial Pi sync
  const connected = await syncFromPi();
  if (!connected) {
    console.log('[sync] Pi not reachable — running with local state');
  }
  
  // Periodic Pi sync (every 5 minutes)
  setInterval(syncFromPi, 5 * 60 * 1000);
  
  // Auto-evolve every 30 minutes (mirrors Pi daemon)
  setInterval(() => {
    if (!state.piConnected) {
      const events = evolveStep();
      if (events.length > 0) {
        console.log(`[evolve] Gen ${state.generation}: ${events.map(e => e.type).join(', ')}`);
      }
    }
  }, 30 * 60 * 1000);
});
