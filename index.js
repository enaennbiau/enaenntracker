'use strict';

// ─── IMPORTS ──────────────────────────────────────────────────────────────────

import {
    eventSource,
    event_types,
    saveSettingsDebounced,
    chat,
    getRequestHeaders,
} from '../../../../script.js';

import {
    extension_settings,
    getContext,
} from '../../../extensions.js';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const MODULE_NAME  = 'enaennTracker';
const TRACKER_FLAG = 'enaenn_tracker';

const DEFAULT_SETTINGS = {
    enabled:            true,
    autoUpdate:         true,
    contextMessages:    20,
    windowSize:         7,
    overlayVisible:     true,
    trackerStates:      {},

    // ─── Character & World Info ───────────────────────────────────────────
    useCharDescription: true,          // inject character description into tracker prompt
    useWorldInfo:       true,          // inject active WI entries into tracker prompt
    wiTokenLimit:       8000,          // max tokens for WI block (0 = unlimited)

    // ─── Last-generation stats (display only, not persisted across sessions) ─
    lastGenTokensTotal: null,
    lastGenTokensWI:    null,

    // ─── API connection ───────────────────────────────────────────────────
    connectionProfile:  '',
    quickApiEnabled:    false,
    quickApiUrl:        '',
    quickApiKey:        '',
    quickApiModel:      '',
};

// ─── TRACKER SYSTEM PROMPT ───────────────────────────────────────────────────

const TRACKER_SYSTEM_PROMPT = `You are a meticulous silent background tracker for a collaborative simulation. Your job: read the previous tracker state and recent chat, analyze the events, including elapsed in-simulation time, and output one updated tracker state block in plain-text format. Be precise about the calculations — think deeply and carefully before the final output. Output ONLY the data lines — no preamble, no explanation, nothing else.

════════════════════════════════════
STRICT OUTPUT RULES
════════════════════════════════════
- Output only the plain-text data lines defined in STEP 4. No HTML. No markdown. No code fences. No commentary.
- Never include user/{{user}} as an agent. USER IS NOT AN AGENT. Track {{char}} and NPCs only.
- PREVIOUS STATE FORMAT CHECK: If the previous tracker state does not begin with "LOC:" it is in an outdated format — ignore it entirely and rebuild fresh from the chat context instead.
- If no previous tracker state exists OR it is outdated, initialize all values fresh from chat context.

════════════════════════════════════
STEP 1 — ESTIMATE ELAPSED IN-GAME TIME
════════════════════════════════════
Before touching any numbers, read the recent roleplay and estimate how much in-game time has passed between two last scenes. Write your estimate mentally (e.g. "~25 minutes passed"). Use this duration to drive ALL vital calculations below. IMPORTANT: Do NOT just subtract 1% per turn — use the actual rates below scaled to the elapsed time.

════════════════════════════════════
STEP 2 — VITAL CALCULATION RULES
════════════════════════════════════

LOW-critical vitals (🍴 food/satiation, 😴 energy, 🚿 hygiene) — low values are bad:
  Output integers 0–100. Severity reference: ≥50% = ok; 25–49% = warn; <25% = critical.

HIGH-critical vitals (💧 thirst, 🚽 bladder, 🧠 stress) — high values are bad:
  Output integers 0–100. Severity reference: ≤50% = ok; 51–74% = warn; ≥75% = critical.

🔥 Arousal (0–200%) — output actual integer value. Values above 100% reserved for sexual activity only.

RATES — scale these by your Step 1 time estimate. These are NOT "per turn" values:
🍴  decay −0.2–0.4% per 5 min (−2.4–4.8%/hr).  Meal: +60–80%. Snack: +10–17%.
😴  decay −0.25–0.33% per 5 min (−3–4%/hr, normal); −0.4–0.6% per 5 min (strenuous).
    Sleep: +10–15%/hr. 
🚿  decay −0.05–0.15% per 5 min (×3–4 during exertion/heat).
    Shower: +95–100%. Quick wash: +5–10%. Clean clothes +3-5%. Swimming may restore or reduce 🚿 depending on the water source.
💧/🚽 rise +0.3–0.7% per 5 min. Caffeine/alcohol/heat/exercise accelerate 💧. Glass of water: 💧 −45-55%, 🚽 +8-12%. Meal w/ drinks: 💧 −30-45%. One sip: 💧 −10-15%. Bottle of water: -100, 🚽 +20-25.
🧠  decays −0.3–0.5% per 5 min during restful/positive events. Rises from friction, danger, unmet needs. Halted during active stressors. Agent coping mechanisms may modify rate. 🧠 increases from unmet needs, social friction, danger, or active 🩹 conditions. High stress affects all "In The Moment" feelings and accelerates decay of 😴. 
🔥  builds +2–8% per 5 min with sexual stimulus. Decays ~−0.5% per 5 min without. Modified by psychological engagement, comfort, sensitivity. Anxious/distracted → slower or plateau. Decay (no stimulus): ~-0.5%/5min. IMPORTANT: values past 100% reserved for sexual activity only.  200% = climax.

NEED PRIORITY when critical: 🚽 > 💧 > 🍴 > 😴 > 🚿.
Multiple vitals shift at once from events (sex: drops 🚿🍴🔥, raises 🚽💧; exertion: drops 😴🚿, raises 🚽💧🧠).

🩹 CONDITION: Track injuries, intoxication, illness, pain, medication, temperature discomfort. Show only when active.

════════════════════════════════════
STEP 3 — RELATIONSHIP RULES
════════════════════════════════════

► RULES FOR EXISTING RELATIONSHIP TRACKING SYSTEM:
  IMPORTANT: Before applying any rules below, scan the chat for an existing in-world relationship tracking system — e.g. named relationship scores or any structured code/html block that tracks feelings/affinity for agents.
  IF such system had been detected:
    - Use it as the authoritative source for the Main feeling value and relationship stage.
    - Map its scale to 0–1000 proportionally (e.g. if it uses 0–100 scale, like 'Apathy 100/100', multiply by 10 to make it 1000 like 'Apathy 1000/1000').
    - Display In The Moment feelings from scene context as usual unless system doesn't already do it. 
    - Do NOT override the Main value with your own math — copy it faithfully from the latest scene message and multiply to match 1000-scale.
    - If the internal system names a feeling or relationship stage, use that name verbatim in your tracker.
  IF no such system is detected: apply the standard rules below as normal.

► STANDARD RULES: 
Apply DIFFERENT rules based strictly on whether the agent is physically present in the current scene.
  ON-SCREEN AGENTS (physically in the current scene):
  Main feeling (0–1000): develops slowly. Max +20 pts/in-game day unless a major positive event occurs. Track the amount by adding "limit for [DD, MM]: value/20" after the Main feeling value.
    VALENCE: the feeling NAME determines whether it is positive or negative — output "+" for positive feelings, "-" for negative. The scale is always 0–1000.
    At 1000 → transforms into a STRONGER version of the same valence (positive → deeper positive; negative → deeper negative).
    At 0 → transforms into a WEAKER / more neutral version moving toward the opposite valence (positive fades toward indifference; negative softens toward neutrality or slight positive).
  In The Moment feelings (0–100, max 4 feelings per agent): reflect what is happening right now in the scene.
    Dissipate ONLY when the specific event or mood that caused them has clearly ended within the scene.
    At 100 → intensifies into a stronger successor of the same valence.
    At 0 → dissolves into a milder predecessor or fades entirely.
    Negative ITM transformation → deduct 1–20 from Main. Positive ITM transformation → add 1–20 to Main even if bypassing the daily limit. 
  Relationship stage + "known for" duration: update only when warranted by scene events.

  OFF-SCREEN AGENTS (not physically in the current scene):
  HARD FREEZE — copy every value (Main AND all In The Moment feelings) EXACTLY
  from the previous tracker state. Do not change any numbers. Do not apply decay. Do not apply
  dissipation. Do not apply transformation. Do not let In The Moment feelings "fade out naturally."
  The ONLY exception: if the current roleplay messages contain an explicit event directly involving
  the off-screen agent (a letter arrives, a phone call, someone delivers specific news about them) —
  apply only the single targeted change that event warrants, and nothing else.
  Time passing alone is NEVER a reason to change an off-screen agent's relationship.

Choose ALL feeling names as the AGENT would personally describe them.
Track personality-consistent behavior: e.g. an avoidant agent in sustained proximity → 🧠 +10–15/day.

════════════════════════════════════
STEP 4 — OUTPUT FORMAT (plain text only)
════════════════════════════════════

Output ONLY the data lines below. No HTML. No markdown. No explanations. Fields separated by " | ".

LOC: [1–2 sentence spatial positions for each agent ({{user}} is not an agent!)]

[One AGENT line per agent physically present in the scene — never the user. Omit all AGENT lines if user is alone.]
AGENT: [gender emoji] | [Name] | [attire, concise] | [satiation] | [energy] | [cleanliness] | [thirst] | [bladder] | [arousal] | [stress] | [Δsat] | [Δnrg] | [Δcln] | [Δthr] | [Δbld] | [Δaro] | [Δstr] | [impulse] | [condition or -]

  Vital values: integers 0–100 (arousal 0–200).
  Delta format: +N or -N (e.g. +2.4 or -1.8). First snapshot: —
  Condition: concise text and its effect, or - if none.

[One REL line per ALL tracked agents — on-screen AND off-screen. Always output these. Copy off-screen values VERBATIM from previous state.]
REL: [Name] | [main 0–1000] | [main feeling name] | [+ or -] | [known duration] | [stage] | [e1] | [itm1 name] | [itm1 0–100] | [e2] | [itm2 name] | [itm2 0–100] | [e3] | [itm3 name] | [itm3 0–100] | [e4] | [itm4 name] | [itm4 0–100]
  Fewer than 4 ITM feelings: fill remaining slots with: - | - | -
  Feeling names: as the agent would personally describe them.

[One OFFSCREEN line per agent NOT in current scene who has a relationship with the user.]
OFFSCREEN: [gender emoji] | [Name] | [location] | [activity] | [hunger] | [energy] | [clean] | [bladder] | [thirst] | [arousal] | [stress] | [impulse]
  Vitals: text labels only — no numbers: hungry/fine/full | exhausted/tired/fine/rested | dirty/fine/fresh | urgent/pressing/fine | dehydrated/thirsty/fine | none/low/simmering/high | stressed/tense/calm

[Only if upcoming plans exist:]
PLAN: [date] | [description]

EXAMPLE OUTPUT:
LOC: Ena stands in the doorway of her dorm room. The courier waits in the hallway with a tablet.
AGENT: ♂️ | Courier | Black uniform, Ambrose insignia, tablet and folio | 68 | 82 | 91 | 32 | 44 | 2 | 18 | — | — | — | — | — | — | — | Complete delivery efficiently | -
REL: Rune | 648 | Confused Fascination | + | 8 months | Enemies with Benefits — Transactional Phase | 😑 | Amused Curiosity | 60 | 😐 | Reluctant Respect | 53 | 😤 | Frustrated Arousal | 38 | - | - | -
OFFSCREEN: ♂️ | Rune | Old Quarters penthouse | Having late lunch with Kyren | fine | rested | fresh | fine | fine | none | calm | Eat. Act normal.
PLAN: 18 May | Rune's gallery opening — Ena invited by Clara`;

// ─── VITAL METADATA & HELPERS ─────────────────────────────────────────────────

const VITAL_META = [
    { key: 'satiation',   emoji: '🍴', label: 'Satiation',   text: 'food',    polarity: 'low'    },
    { key: 'energy',      emoji: '😴', label: 'Energy',      text: 'energy',  polarity: 'low'    },
    { key: 'cleanliness', emoji: '🚿', label: 'Cleanliness', text: 'hygiene', polarity: 'low'    },
    { key: 'thirst',      emoji: '💧', label: 'Thirst',      text: 'thirst',  polarity: 'high'   },
    { key: 'bladder',     emoji: '🚽', label: 'Bladder',     text: 'bladder', polarity: 'high'   },
    { key: 'arousal',     emoji: '🔥', label: 'Arousal',     text: 'arousal', polarity: 'arousal'},
    { key: 'stress',      emoji: '🧠', label: 'Stress',      text: 'stress',  polarity: 'high'   },
];

const numVal = (s) => parseFloat(String(s ?? '').replace(/[^0-9.]/g, '')) || 0;

function vitalColorClass(polarity, value) {
    if (polarity === 'arousal') return 'enaenn-fill-arousal';
    if (polarity === 'low')     return value >= 50 ? 'enaenn-fill-ok' : value >= 25 ? 'enaenn-fill-warn' : 'enaenn-fill-crit';
    return value <= 50 ? 'enaenn-fill-ok' : value <= 74 ? 'enaenn-fill-warn' : 'enaenn-fill-crit';
}

function esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── TOKEN ESTIMATION ─────────────────────────────────────────────────────────
// Uses ST's tokenizer API if available, falls back to chars/4 approximation.
// We use approximation for the WI budget check (fast, called per-entry) and
// the tokenizer for the after-generation stats display (called once, async).

function estimateTokensRough(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
}

async function estimateTokensAccurate(text) {
    if (!text) return 0;
    try {
        const ctx = getContext();
        // ST exposes a tokenizeText / getTokenCount helper depending on version
        if (typeof ctx.getTokenCount === 'function') {
            return await ctx.getTokenCount(text);
        }
        // Older ST versions expose it under a different name
        if (typeof ctx.tokenizeText === 'function') {
            const result = await ctx.tokenizeText(text);
            return result?.count ?? estimateTokensRough(text);
        }
    } catch {
        // fall through
    }
    return estimateTokensRough(text);
}

// ─── WORLD INFO CACHE ─────────────────────────────────────────────────────────
// We hook into WORLDINFO_USED (fired during ST's own prompt assembly) and
// cache the entries that ST decided were active. The tracker then reads this
// cache at generation time.

let _wiCache = [];          // array of { uid, key, content, order, position, depth }
let _wiCacheTimestamp = 0;

function onWorldInfoUsed(wiData) {
    // ST fires this event with different shapes across versions.
    // Normalise into a flat array of entry objects.
    try {
        let entries = [];

        if (Array.isArray(wiData)) {
            entries = wiData;
        } else if (wiData && typeof wiData === 'object') {
            // Some versions pass { worldInfoBefore, worldInfoAfter } or { entries }
            if (Array.isArray(wiData.entries)) {
                entries = wiData.entries;
            } else if (Array.isArray(wiData.worldInfoBefore) || Array.isArray(wiData.worldInfoAfter)) {
                entries = [
                    ...(wiData.worldInfoBefore || []),
                    ...(wiData.worldInfoAfter  || []),
                ];
            } else {
                // Flat object keyed by uid
                entries = Object.values(wiData);
            }
        }

        // Normalise each entry to a consistent shape
        _wiCache = entries
            .filter(e => e && (e.content || e.text))
            .map(e => ({
                uid:      e.uid      ?? e.id    ?? '',
                key:      Array.isArray(e.key) ? e.key.join(', ') : (e.key ?? ''),
                content:  e.content  ?? e.text  ?? '',
                order:    e.order    ?? e.insertion_order ?? 0,
                position: e.position ?? 0,
                depth:    e.depth    ?? e.scan_depth ?? 0,
                priority: e.priority ?? e.order ?? 0,
            }))
            // Sort by priority descending so we include highest-priority entries first
            // when the token budget forces us to truncate
            .sort((a, b) => (b.priority - a.priority) || (b.order - a.order));

        _wiCacheTimestamp = Date.now();
    } catch (err) {
        console.warn('[enaennTracker] Failed to parse WORLDINFO_USED payload:', err);
    }
}

// ─── CHARACTER DESCRIPTION RETRIEVAL ─────────────────────────────────────────

function getCharacterDescription() {
    try {
        const ctx = getContext();

        // Group chat: use the character who sent the last message
        if (ctx.groupId) {
            // Find the last non-user message
            for (let i = chat.length - 1; i >= 0; i--) {
                const msg = chat[i];
                if (!msg.is_user && msg.original_avatar) {
                    // Try to find this character in the characters list
                    const char = ctx.characters?.find(c => c.avatar === msg.original_avatar);
                    if (char?.description) return char.description.trim();
                    // Fallback: check name match
                    const charByName = ctx.characters?.find(c => c.name === msg.name);
                    if (charByName?.description) return charByName.description.trim();
                }
            }
            return '';
        }

        // Solo chat: current character
        const char = ctx.characters?.[ctx.characterId];
        if (!char) return '';

        // ST card v2/v3 stores description at data.description or top-level description
        const desc = char.data?.description ?? char.description ?? '';
        return desc.trim();
    } catch (err) {
        console.warn('[enaennTracker] Could not retrieve character description:', err);
        return '';
    }
}

// ─── WORLD INFO BLOCK BUILDER ─────────────────────────────────────────────────
// Respects the token budget. Includes whole entries only (no mid-entry cuts).
// Entries are already sorted by priority descending from onWorldInfoUsed().

function buildWorldInfoBlock(tokenLimit) {
    if (!_wiCache.length) return { text: '', tokenCount: 0, entryCount: 0, truncated: false };

    const unlimited = !tokenLimit || tokenLimit <= 0;
    const lines  = [];
    let   usedTokens = 0;
    let   truncated  = false;

    for (const entry of _wiCache) {
        if (!entry.content) continue;
        const entryText = `[${entry.key || 'WI'}]: ${entry.content}`;
        const entryTokens = estimateTokensRough(entryText);

        if (!unlimited && usedTokens + entryTokens > tokenLimit) {
            truncated = true;
            continue; // skip this entry — adding it would exceed the budget
        }

        lines.push(entryText);
        usedTokens += entryTokens;
    }

    const text = lines.length
        ? `[WORLD INFO — active entries]\n${lines.join('\n')}\n[/WORLD INFO]`
        : '';

    return { text, tokenCount: usedTokens, entryCount: lines.length, truncated };
}

// ─── DATA PARSER ──────────────────────────────────────────────────────────────

function parseTrackerData(text) {
    const data = { location: '', agents: [], relationships: [], offscreen: [], plans: [] };
    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;
        const p = (prefix) => line.slice(prefix.length).split('|').map(s => s.trim());
        if (line.startsWith('LOC:')) {
            data.location = line.slice(4).trim();
        } else if (line.startsWith('AGENT:')) {
            const f = p('AGENT:');
            if (f.length < 19) continue;
            data.agents.push({
                gender: f[0], name: f[1], attire: f[2],
                vitals: {
                    satiation:   { val: numVal(f[3]),  delta: f[10] },
                    energy:      { val: numVal(f[4]),  delta: f[11] },
                    cleanliness: { val: numVal(f[5]),  delta: f[12] },
                    thirst:      { val: numVal(f[6]),  delta: f[13] },
                    bladder:     { val: numVal(f[7]),  delta: f[14] },
                    arousal:     { val: numVal(f[8]),  delta: f[15] },
                    stress:      { val: numVal(f[9]),  delta: f[16] },
                },
                impulse:   f[17] || '',
                condition: (f[18] && f[18] !== '-') ? f[18] : null,
            });
        } else if (line.startsWith('RELATIONSHIP:') || line.startsWith('REL:')) {
            const prefix = line.startsWith('RELATIONSHIP:') ? 'RELATIONSHIP:' : 'REL:';
            const f = p(prefix);
            if (f.length < 6) continue;
            const itm = [];
            for (let i = 6; i + 2 < f.length; i += 3) {
                if (f[i] && f[i] !== '-') itm.push({ emoji: f[i], name: f[i+1] || '', val: parseFloat(f[i+2]) || 0 });
            }
            data.relationships.push({ name: f[0], mainVal: parseFloat(f[1]) || 0, mainName: f[2], valence: f[3], duration: f[4], stage: f[5], itm });
        } else if (line.startsWith('OFFSCREEN:')) {
            const f = p('OFFSCREEN:');
            if (f.length < 12) continue;
            data.offscreen.push({
                gender: f[0], name: f[1], location: f[2], activity: f[3],
                vitals: { hunger: f[4], energy: f[5], clean: f[6], bladder: f[7], thirst: f[8], arousal: f[9], stress: f[10] },
                impulse: f[11],
            });
        } else if (line.startsWith('PLAN:')) {
            const f = p('PLAN:');
            if (f.length >= 2) data.plans.push({ date: f[0], desc: f[1] });
        }
    }
    return data;
}

// ─── HTML BUILDER FOR TRACKER CARD ───────────────────────────────────────────

function buildVitalsHTML(vitals) {
    return VITAL_META.map(({ key, emoji, label, polarity }) => {
        const v = vitals[key] || { val: 0, delta: '—' };
        const colorCls = vitalColorClass(polarity, v.val);
        const barWidth = polarity === 'arousal' ? Math.min(v.val, 100) : v.val;
        return `<div class="enaenn-vital-row"><span class="enaenn-vital-emoji">${emoji}</span><span class="enaenn-vital-label">${label}</span><div class="enaenn-vital-bar-wrap"><div class="enaenn-vital-fill ${colorCls}" style="width:${barWidth}%"></div></div><span class="enaenn-vital-val">${v.val}%</span><span class="enaenn-vital-delta">(${esc(v.delta)})</span></div>`;
    }).join('\n');
}

function buildTrackerHTML(data) {
    const uid  = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const tab1 = data.agents.length === 0 ? '<div class="enaenn-alone-msg">No agents present.</div>' : data.agents.map(a => {
        const cond = a.condition ? `<div class="enaenn-condition">🩹 ${esc(a.condition)}</div>` : '';
        return `<div class="enaenn-agent-row"><div class="enaenn-agent-header"><span class="enaenn-agent-name">${esc(a.gender)} ${esc(a.name)}</span><span class="enaenn-agent-attire">👗 ${esc(a.attire)}</span></div><details class="enaenn-vitals-fold"><summary>Vitals</summary><div class="enaenn-vitals">${buildVitalsHTML(a.vitals)}</div></details>${cond}<div class="enaenn-impulse">🎯 ${esc(a.impulse)}</div></div>`;
    }).join('<div class="enaenn-agent-sep"></div>');

    const tab2 = data.relationships.length === 0 ? '<div class="enaenn-offscreen-row"><div class="enaenn-offscreen-name">No relationships tracked yet.</div></div>' : data.relationships.map(r => {
        const barClass = r.valence === '-' ? 'enaenn-rel-fill-neg' : 'enaenn-rel-fill';
        const barWidth = Math.min((r.mainVal / 1000) * 100, 100).toFixed(1);
        const itmHTML  = r.itm.map(f => `<div class="enaenn-rel-moment-row"><span>${esc(f.emoji)} ${esc(f.name)}</span><div class="enaenn-rel-moment-bar-wrap"><div class="enaenn-rel-moment-fill" style="width:${f.val}%"></div></div><span class="enaenn-rel-moment-val">${f.val}</span></div>`).join('');
        return `<details class="enaenn-rel-fold"><summary><span class="enaenn-rel-fold-name">${esc(r.name)} → User</span><span class="enaenn-rel-fold-preview">${esc(r.mainName)} (${r.mainVal}/1000)</span></summary><div class="enaenn-rel-fold-body"><div class="enaenn-rel-main"><span>${esc(r.mainName)}</span><div class="enaenn-rel-bar-wrap"><div class="${barClass}" style="width:${barWidth}%"></div></div><span class="enaenn-rel-val">(${r.mainVal}/1000)</span></div><div class="enaenn-rel-moments">${itmHTML}</div><div class="enaenn-rel-stage">Known ${esc(r.duration)} · ${esc(r.stage)}</div></div></details>`;
    }).join('');

    const tab3 = data.offscreen.length === 0 ? '<div class="enaenn-offscreen-row"><div class="enaenn-offscreen-name">No relevant off-screen agents.</div></div>' : data.offscreen.map(a => {
        const v = a.vitals;
        return `<div class="enaenn-offscreen-row"><div class="enaenn-offscreen-name">${esc(a.gender)} ${esc(a.name)} — 📍${esc(a.location)} // ${esc(a.activity)}</div><div class="enaenn-offscreen-vitals">🍴(${esc(v.hunger)}) | 😴(${esc(v.energy)}) | 🚿(${esc(v.clean)}) | 🚽(${esc(v.bladder)}) | 💧(${esc(v.thirst)}) | 🔥(${esc(v.arousal)}) | 🧠(${esc(v.stress)}) // 🎯 ${esc(a.impulse)}</div></div>`;
    }).join('');

    const plans = data.plans.length === 0 ? '' : `<details class="enaenn-plans"><summary>📅 Future Plans</summary><div class="enaenn-plans-body">${data.plans.map(p => `<div class="enaenn-plan-row"><span class="enaenn-plan-date">${esc(p.date)}</span><span class="enaenn-plan-desc">${esc(p.desc)}</span></div>`).join('')}</div></details>`;

    return `<div class="enaenn-tracker-block"><div class="enaenn-location">📍 ${esc(data.location)}</div><div class="enaenn-tabs-box"><input type="radio" name="enaenn-${uid}" id="enaenn-t1-${uid}" checked><input type="radio" name="enaenn-${uid}" id="enaenn-t2-${uid}"><input type="radio" name="enaenn-${uid}" id="enaenn-t3-${uid}"><div class="enaenn-tab-labels"><label for="enaenn-t1-${uid}">💖 Present</label><label for="enaenn-t2-${uid}">💕 Relations</label><label for="enaenn-t3-${uid}">🌍 Off‑screen</label></div><div class="enaenn-tab-content"><div class="enaenn-tp1">${tab1}</div><div class="enaenn-tp2"><div class="enaenn-rel-list">${tab2}</div></div><div class="enaenn-tp3">${tab3}</div></div></div>${plans}</div>`;
}

// ─── FORMAT TRACKER FOR CONTEXT ───────────────────────────────────────────────

function formatTrackerForContext(raw) {
    return raw.split('\n').map(line => {
        const t = line.trim();
        if (!t) return line;
        if (t.startsWith('AGENT:')) {
            const parts = t.slice('AGENT:'.length).split('|').map(s => s.trim());
            if (parts.length < 19) return line;
            const vt = VITAL_META.map(m => m.text);
            for (let i = 0; i < 7; i++) {
                const rawVal = parts[3 + i].replace(/^[^\d-+.]+/, '');
                const rawDel = parts[10 + i].replace(/^Δ\w+:/, '');
                parts[3 + i]  = `${vt[i]}:${rawVal}`;
                parts[10 + i] = `Δ${vt[i]}:${rawDel}`;
            }
            return 'AGENT: ' + parts.join(' | ');
        }
        if (t.startsWith('REL:')) return 'RELATIONSHIP:' + t.slice('REL:'.length);
        if (t.startsWith('OFFSCREEN:')) {
            const parts = t.slice('OFFSCREEN:'.length).split('|').map(s => s.trim());
            if (parts.length < 12) return line;
            const labels = ['food', 'energy', 'hygiene', 'bladder', 'thirst', 'arousal', 'stress'];
            for (let i = 0; i < 7; i++) {
                const rawVal = parts[4 + i].replace(/^\w+:/, '');
                parts[4 + i] = `${labels[i]}:${rawVal}`;
            }
            return 'OFFSCREEN: ' + parts.join(' | ');
        }
        return line;
    }).join('\n');
}

// ─── SETTINGS / STATE ─────────────────────────────────────────────────────────

function initSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = { ...DEFAULT_SETTINGS };
        return;
    }
    for (const [key, val] of Object.entries(DEFAULT_SETTINGS)) {
        if (extension_settings[MODULE_NAME][key] === undefined) {
            extension_settings[MODULE_NAME][key] = val;
        }
    }
}

const S    = () => extension_settings[MODULE_NAME];
const save = (patch = {}) => {
    Object.assign(extension_settings[MODULE_NAME], patch);
    saveSettingsDebounced();
};

// ─── PER-CHAT SNAPSHOT STORAGE ────────────────────────────────────────────────

function getChatId() {
    try {
        const ctx = getContext();
        return ctx.chatId || ctx.getCurrentChatId?.() || 'default';
    } catch { return 'default'; }
}

function getSnapshots(chatId) {
    const states = S().trackerStates || {};
    return states[chatId] || [];
}

function setSnapshots(chatId, snaps) {
    const states = S().trackerStates || {};
    states[chatId] = snaps;
    save({ trackerStates: states });
}

function getCurrentSnapshot(chatId) {
    const snaps = getSnapshots(chatId);
    return snaps.length ? snaps[snaps.length - 1] : null;
}

function saveSnapshot(chatId, rawText, labeledText, htmlContent, parsedData) {
    let snaps = getSnapshots(chatId);
    const windowSize = S().windowSize || 7;
    snaps.push({ raw: rawText, labeled: labeledText, html: htmlContent, parsed: parsedData });
    if (snaps.length > windowSize) snaps = snaps.slice(-windowSize);
    setSnapshots(chatId, snaps);
    updateOverlayContent(chatId);
}

function restorePreviousSnapshot(chatId) {
    let snaps = getSnapshots(chatId);
    if (snaps.length <= 1) {
        setSnapshots(chatId, []);
        return null;
    }
    snaps.pop();
    setSnapshots(chatId, snaps);
    const restored = snaps[snaps.length - 1] || null;
    updateOverlayContent(chatId);
    return restored;
}

// ─── LAST-GENERATION STATS ────────────────────────────────────────────────────

function updateGenStats(totalTokens, wiTokens, wiTruncated) {
    save({ lastGenTokensTotal: totalTokens, lastGenTokensWI: wiTokens });

    const el = document.getElementById('enaennTracker_genStats');
    if (!el) return;

    if (totalTokens === null) {
        el.textContent = '';
        return;
    }

    const truncNote = wiTruncated ? ' (budget reached — some entries omitted)' : '';
    el.textContent =
        `Last generation: ~${totalTokens.toLocaleString()} tokens total` +
        ` · ~${wiTokens.toLocaleString()} from World Info${truncNote}`;
}

function clearGenStats() {
    save({ lastGenTokensTotal: null, lastGenTokensWI: null });
    const el = document.getElementById('enaennTracker_genStats');
    if (el) el.textContent = '';
}

// ─── OVERLAY CREATION ─────────────────────────────────────────────────────────

let overlayVisible  = false;
let overlayCollapsed = false;

function createOverlay() {
    if (document.getElementById('enaenn-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'enaenn-overlay';
    overlay.innerHTML = `
        <div id="enaenn-overlay-header">
            <span>📊 Tracker</span>
            <div>
                <button id="enaenn-overlay-collapse" title="Collapse/Expand">▸</button>
                <button id="enaenn-overlay-close" title="Close overlay">✕</button>
            </div>
        </div>
        <div id="enaenn-overlay-body"></div>
    `;
    document.body.appendChild(overlay);

    let isDragging = false, startX, startY, origX, origY;
    const header = overlay.querySelector('#enaenn-overlay-header');
    const onDragStart = (e) => {
        if (e.target.closest('button')) return;
        isDragging = true;
        const rect  = overlay.getBoundingClientRect();
        const touch = e.touches ? e.touches[0] : e;
        startX = touch.clientX; startY = touch.clientY;
        origX  = rect.left;     origY  = rect.top;
        document.addEventListener('mousemove', onDragMove);
        document.addEventListener('touchmove', onDragMove, { passive: false });
        document.addEventListener('mouseup',   onDragEnd);
        document.addEventListener('touchend',  onDragEnd);
        e.preventDefault();
    };
    const onDragMove = (e) => {
        if (!isDragging) return;
        const touch = e.touches ? e.touches[0] : e;
        overlay.style.left   = (origX + touch.clientX - startX) + 'px';
        overlay.style.top    = (origY + touch.clientY - startY) + 'px';
        overlay.style.right  = 'auto';
        overlay.style.bottom = 'auto';
        e.preventDefault();
    };
    const onDragEnd = () => {
        isDragging = false;
        document.removeEventListener('mousemove', onDragMove);
        document.removeEventListener('touchmove', onDragMove);
        document.removeEventListener('mouseup',   onDragEnd);
        document.removeEventListener('touchend',  onDragEnd);
    };
    header.addEventListener('mousedown', onDragStart);
    header.addEventListener('touchstart', onDragStart);

    const collapseBtn = overlay.querySelector('#enaenn-overlay-collapse');
    collapseBtn.addEventListener('click', () => {
        overlayCollapsed = !overlayCollapsed;
        overlay.classList.toggle('collapsed', overlayCollapsed);
        collapseBtn.textContent = overlayCollapsed ? '▸' : '▾';
    });

    overlay.querySelector('#enaenn-overlay-close').addEventListener('click', () => {
        toggleOverlay(false);
    });

    collapseBtn.textContent = overlayCollapsed ? '▸' : '▾';
    overlay.classList.toggle('collapsed', overlayCollapsed);
    overlay.style.display = 'none';
}

function toggleOverlay(show) {
    const overlay = document.getElementById('enaenn-overlay');
    if (!overlay) return;
    overlayVisible = (show !== undefined) ? Boolean(show) : !overlayVisible;
    overlay.style.display = overlayVisible ? 'block' : 'none';
    save({ overlayVisible });
}

function updateOverlayContent(chatId) {
    const overlay = document.getElementById('enaenn-overlay');
    if (!overlay) return;
    const body = overlay.querySelector('#enaenn-overlay-body');
    const snap  = getCurrentSnapshot(chatId);
    body.innerHTML = snap
        ? (snap.html || '<div style="padding:8px;opacity:0.5;">No data</div>')
        : '<div style="padding:8px;opacity:0.5;">No tracker snapshot yet.</div>';
}

// ─── CONTEXT INJECTION (main chat — tracker state only) ───────────────────────
// NOTE: Only the compact tracker state (LOC/AGENT/REL/etc.) is ever injected
// into the main chat context. Character description and world info are sent
// exclusively to the tracker's own API call and never reach the chat AI.

function getInjectionText(chatId) {
    const snap = getCurrentSnapshot(chatId);
    if (!snap) return '';
    return `\n\n[TRACKER STATE]\n${snap.labeled}\n[/TRACKER STATE]\n`;
}

// ─── BUILD TRACKER PROMPT ─────────────────────────────────────────────────────

function buildTrackerPrompt(chatId) {
    const s = S();

    // 1. Recent chat messages (already limited by contextMessages setting)
    const recentRoleplay = chat
        .filter(m => !m.extra?.[TRACKER_FLAG])
        .slice(-(s.contextMessages || 20));

    const chatText = recentRoleplay
        .map(m => `${m.name || (m.is_user ? 'User' : 'Character')}: ${m.mes || ''}`)
        .join('\n\n');

    // 2. Previous tracker state
    const prevSnap  = getCurrentSnapshot(chatId);
    const prevState = prevSnap
        ? `PREVIOUS TRACKER STATE (plain text — update from this):\n${prevSnap.raw}`
        : 'No previous tracker state. Initialize fresh from chat context.';

    // 3. Character description (bypasses token limit — always included if enabled)
    let charBlock = '';
    if (s.useCharDescription) {
        const desc = getCharacterDescription();
        if (desc) {
            charBlock = `[CHARACTER DESCRIPTION]\n${desc}\n[/CHARACTER DESCRIPTION]\n\n`;
        }
    }

    // 4. World Info block (token-limited)
    let wiBlock      = '';
    let wiTokenCount = 0;
    let wiTruncated  = false;

    if (s.useWorldInfo && _wiCache.length) {
        const result = buildWorldInfoBlock(s.wiTokenLimit || 0);
        wiBlock      = result.text ? result.text + '\n\n' : '';
        wiTokenCount = result.tokenCount;
        wiTruncated  = result.truncated;
    }

    // 5. Assemble in the agreed order:
    //    [system prompt is passed separately]
    //    char description → world info → chat history → previous state → instruction
    const assembled =
        charBlock +
        wiBlock +
        `RECENT ROLEPLAY (${recentRoleplay.length} messages):\n${chatText}\n\n---\n\n` +
        `${prevState}\n\n---\n\n` +
        `Output the updated tracker data in the exact plain-text format specified. Nothing else.`;

    // 6. Compute rough total token estimate for the stats display
    //    (system prompt counted separately so the user sees the full picture)
    const sysTokens   = estimateTokensRough(TRACKER_SYSTEM_PROMPT);
    const bodyTokens  = estimateTokensRough(assembled);
    const totalTokens = sysTokens + bodyTokens;

    // Store for async accurate update after generation
    _pendingGenStats = { totalTokens, wiTokenCount, wiTruncated };

    return assembled;
}

// Holds stats computed during buildTrackerPrompt so updateTracker() can
// display them after the API call resolves.
let _pendingGenStats = null;

// ─── QUICK API ────────────────────────────────────────────────────────────────

async function postQuickApi(messages, max_tokens) {
    const s = S();
    const base = s.quickApiUrl.replace(/\/+$/, '');
    const headers = { 'Content-Type': 'application/json' };
    if (s.quickApiKey) headers['Authorization'] = `Bearer ${s.quickApiKey}`;

    const res = await fetch(`${base}/chat/completions`, {
        method:  'POST',
        headers,
        body:    JSON.stringify({ model: s.quickApiModel, messages, max_tokens, temperature: 0.2 }),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}${text ? ': ' + text.slice(0, 200) : ''}`);
    }

    const json = await res.json();
    return json.choices?.[0]?.message?.content?.trim() || '';
}

async function generateWithQuickApi(userMessage) {
    const messages = [
        { role: 'system', content: TRACKER_SYSTEM_PROMPT },
        { role: 'user',   content: userMessage },
    ];
    return postQuickApi(messages, 700);
}

async function fetchQuickApiModels() {
    const s      = S();
    const btn    = document.getElementById('enaennTracker_quickapiFetchModels');
    const hint   = document.getElementById('enaennTracker_modelsHint');
    const select = document.getElementById('enaennTracker_quickapiModelSelect');

    if (!s.quickApiUrl) {
        if (hint) { hint.textContent = '⚠️ Enter the API URL first'; hint.style.display = 'block'; }
        return;
    }

    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; }
    if (hint) { hint.textContent = 'Loading…'; hint.style.display = 'block'; }

    try {
        const headers = {};
        if (s.quickApiKey) headers['Authorization'] = `Bearer ${s.quickApiKey}`;
        const res = await fetch(`${s.quickApiUrl.replace(/\/+$/, '')}/models`, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json   = await res.json();
        const models = (json.data || json.models || []).map(m => m.id || m).filter(Boolean).sort();

        if (select) {
            select.innerHTML = '<option value="">— select a model —</option>';
            models.forEach(id => {
                const opt = document.createElement('option');
                opt.value = id; opt.textContent = id;
                if (s.quickApiModel === id) opt.selected = true;
                select.appendChild(opt);
            });
        }
        if (hint) { hint.textContent = `✓ ${models.length} models loaded`; hint.style.display = 'block'; }
    } catch (e) {
        if (hint) { hint.textContent = `✗ ${e.message}`; hint.style.display = 'block'; }
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-rotate"></i>'; }
    }
}

function updateQuickApiStatus() {
    const s  = S();
    const el = document.getElementById('enaennTracker_quickapiStatus');
    if (!el) return;
    if (!s.quickApiEnabled) { el.innerHTML = '<span class="enaenn-status-inactive">Quick API disabled</span>'; return; }
    if (!s.quickApiUrl)     { el.innerHTML = '<span class="enaenn-status-warning">⚠️ Enter the API URL</span>'; return; }
    if (!s.quickApiModel)   { el.innerHTML = '<span class="enaenn-status-warning">⚠️ Enter a model name</span>'; return; }
    el.innerHTML = `<span class="enaenn-status-active">✓ ${esc(s.quickApiUrl)} → <strong>${esc(s.quickApiModel)}</strong></span>`;
}

async function connectQuickApi() {
    const s = S();
    if (!s.quickApiEnabled) { toastr.warning('Enable Quick API first!'); return; }
    if (!s.quickApiUrl)     { toastr.warning('Enter the API URL!'); return; }
    if (!s.quickApiModel)   { toastr.warning('Enter a model name!'); return; }

    const btn  = document.getElementById('enaennTracker_quickapiConnect');
    const orig = btn?.innerHTML;
    try {
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Checking…'; }
        const headers = {};
        if (s.quickApiKey) headers['Authorization'] = `Bearer ${s.quickApiKey}`;
        const res = await fetch(`${s.quickApiUrl.replace(/\/+$/, '')}/models`, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (btn) btn.innerHTML = '<i class="fa-solid fa-check"></i> Reachable!';
        setTimeout(() => { if (btn) { btn.innerHTML = orig; btn.disabled = false; } }, 2000);
    } catch (e) {
        if (btn) { btn.innerHTML = '<i class="fa-solid fa-xmark"></i> Error'; setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 2000); }
        toastr.error(`Could not connect: ${e.message}`);
    }
}

// ─── CONNECTION MANAGER PROFILE ───────────────────────────────────────────────

const PROFILE_API_TO_SECRET_KEY = {
    'oai':                'api_key_openai',
    'google':             'api_key_makersuite',
    'openrouter-text':    'api_key_openrouter',
    'kcpp':               'api_key_koboldcpp',
    'oobabooga':          'api_key_ooba',
    'textgenerationwebui':'api_key_ooba',
};

function profileApiToSecretKey(apiName) {
    if (!apiName) return null;
    const lower = String(apiName).toLowerCase();
    return PROFILE_API_TO_SECRET_KEY[lower] || `api_key_${lower}`;
}

async function getActiveSecretId(secretKey) {
    try {
        const res = await fetch('/api/secrets/read', { method: 'POST', headers: getRequestHeaders() });
        if (!res.ok) return null;
        const state = await res.json();
        const arr   = state?.[secretKey];
        if (!Array.isArray(arr)) return null;
        return arr.find(s => s?.active)?.id || null;
    } catch { return null; }
}

async function rotateSecretServerOnly(secretKey, secretId) {
    try {
        const res = await fetch('/api/secrets/rotate', {
            method:  'POST',
            headers: getRequestHeaders(),
            body:    JSON.stringify({ key: secretKey, id: secretId }),
        });
        return res.ok;
    } catch { return false; }
}

function getConnectionProfile(profileName) {
    if (!profileName) return null;
    try {
        const ctx = getContext();
        const cm  = ctx.extensionSettings?.connectionManager;
        if (!cm?.profiles?.length) return null;
        return cm.profiles.find(p => p.name === profileName) || null;
    } catch { return null; }
}

function extractTextFromProfileResponse(resp) {
    if (!resp) return null;
    if (typeof resp === 'string') return resp;
    if (Array.isArray(resp)) {
        const texts = resp.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text);
        if (texts.length) return texts.join('\n');
    }
    if (resp.content != null) {
        if (typeof resp.content === 'string') return resp.content;
        if (Array.isArray(resp.content)) {
            const texts = resp.content.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text);
            if (texts.length) return texts.join('\n');
        }
    }
    if (resp.choices?.[0]?.message?.content) {
        const c = resp.choices[0].message.content;
        if (typeof c === 'string') return c;
        if (Array.isArray(c)) {
            const texts = c.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text);
            if (texts.length) return texts.join('\n');
        }
    }
    if (typeof resp.text    === 'string') return resp.text;
    if (typeof resp.message === 'string') return resp.message;
    if (resp.message?.content && typeof resp.message.content === 'string') return resp.message.content;
    return null;
}

async function generateWithConnectionProfile(userMessage, max_tokens) {
    const ctx = getContext();
    if (!ctx.ConnectionManagerRequestService) {
        throw new Error('ConnectionManagerRequestService is not available in this SillyTavern version');
    }
    const s       = S();
    const profile = getConnectionProfile(s.connectionProfile);
    if (!profile) throw new Error(`Profile "${s.connectionProfile}" not found`);

    const messages = [
        { role: 'system', content: TRACKER_SYSTEM_PROMPT },
        { role: 'user',   content: userMessage },
    ];

    const profileSecretId  = profile['secret-id'] || null;
    const secretKey        = profileApiToSecretKey(profile.api);
    let   previousSecretId = null;
    let   rotated          = false;

    if (profileSecretId && secretKey) {
        try {
            previousSecretId = await getActiveSecretId(secretKey);
            if (previousSecretId !== profileSecretId) {
                rotated = await rotateSecretServerOnly(secretKey, profileSecretId);
                if (!rotated) console.warn('[enaennTracker] Could not activate profile secret-id.');
            }
        } catch (e) { console.warn('[enaennTracker] secret swap error:', e); }
    }

    try {
        const response = await ctx.ConnectionManagerRequestService.sendRequest(
            profile.id,
            messages,
            max_tokens,
            { stream: false, extractData: true, includePreset: true, includeInstruct: true },
        );
        const text = extractTextFromProfileResponse(response);
        if (text == null) throw new Error('Unexpected response format from API');
        return text.trim();
    } finally {
        if (rotated && previousSecretId && secretKey) {
            await rotateSecretServerOnly(secretKey, previousSecretId).catch(() => {});
        }
    }
}

function populateProfileDropdown() {
    const select = document.getElementById('enaennTracker_profileSelect');
    if (!select) return;
    const s = S();
    select.innerHTML = '<option value="">— Use active ST API —</option>';
    try {
        const ctx      = getContext();
        const profiles = ctx.extensionSettings?.connectionManager?.profiles || [];
        profiles.forEach(p => {
            if (!p?.name) return;
            const opt = document.createElement('option');
            opt.value = p.name; opt.textContent = p.name;
            if (s.connectionProfile === p.name) opt.selected = true;
            select.appendChild(opt);
        });
    } catch (e) { console.warn('[enaennTracker] Error loading profiles:', e); }
    updateProfileStatus();
}

function updateProfileStatus() {
    const s  = S();
    const el = document.getElementById('enaennTracker_profileStatus');
    if (!el) return;
    if (!s.connectionProfile) {
        el.innerHTML = '<span class="enaenn-status-inactive">No profile set — using ST\'s active API</span>';
        return;
    }
    const profile  = getConnectionProfile(s.connectionProfile);
    if (!profile) {
        el.innerHTML = `<span class="enaenn-status-warning">⚠️ Profile "${esc(s.connectionProfile)}" not found</span>`;
        return;
    }
    const details = [profile.api, profile.model].filter(Boolean).join(' · ');
    el.innerHTML = `<span class="enaenn-status-active">✓ <strong>${esc(profile.name)}</strong>${details ? ' — ' + esc(details) : ''}</span>`;
}

// ─── MAIN API DISPATCH ────────────────────────────────────────────────────────

async function callTrackerAPI(chatId) {
    const s           = S();
    const userMessage = buildTrackerPrompt(chatId);

    try {
        if (s.quickApiEnabled && s.quickApiUrl && s.quickApiModel) {
            return (await generateWithQuickApi(userMessage)) || null;
        }
        if (s.connectionProfile) {
            return (await generateWithConnectionProfile(userMessage, 700)) || null;
        }
        const ctx       = getContext();
        const rawResult = await ctx.generateRaw({
            prompt:       userMessage,
            systemPrompt: TRACKER_SYSTEM_PROMPT,
        });
        return rawResult ? rawResult.trim() : null;
    } catch (err) {
        console.error('[enaennTracker]', err);
        toastr.error(`enaennTracker: ${err.message}`);
        return null;
    }
}

// ─── MAIN UPDATE FLOW ─────────────────────────────────────────────────────────

let _updating = false;

async function updateTracker() {
    if (_updating)     return;
    if (!S().enabled)  return;

    const chatId = getChatId();
    _updating = true;
    setLoadingState(true);
    _pendingGenStats = null;

    const rawResult = await callTrackerAPI(chatId);

    setLoadingState(false);
    _updating = false;

    if (!rawResult) {
        // Still update stats display even on failure (shows last attempt)
        if (_pendingGenStats) {
            updateGenStats(
                _pendingGenStats.totalTokens,
                _pendingGenStats.wiTokenCount,
                _pendingGenStats.wiTruncated,
            );
        }
        return;
    }

    const parsed  = parseTrackerData(rawResult);
    const labeled = formatTrackerForContext(rawResult);
    const html    = buildTrackerHTML(parsed);

    saveSnapshot(chatId, rawResult, labeled, html, parsed);

    // Update stats display
    if (_pendingGenStats) {
        updateGenStats(
            _pendingGenStats.totalTokens,
            _pendingGenStats.wiTokenCount,
            _pendingGenStats.wiTruncated,
        );
        _pendingGenStats = null;
    }

    toastr.success('Tracker updated!', '', { timeOut: 1500 });
}

// ─── DELETE / RESTORE ─────────────────────────────────────────────────────────

async function deleteLastTracker() {
    const chatId   = getChatId();
    const restored = restorePreviousSnapshot(chatId);
    if (!restored) {
        toastr.info('No previous snapshot to restore to.');
    } else {
        toastr.success('Restored previous tracker snapshot.');
    }
    return !!restored;
}

// ─── UI HELPERS ───────────────────────────────────────────────────────────────

function setLoadingState(loading) {
    $('#enaennTracker_refreshBtn')
        .prop('disabled', loading)
        .text(loading ? '⏳ Updating…' : '🔄 Refresh Tracker');
    $('#enaennTracker_regenBtn')
        .prop('disabled', loading)
        .text(loading ? '⏳ Updating…' : '♻️ Restore Previous');
    $('#enaennTracker_toolbarBtn')
        .prop('disabled', loading)
        .text(loading ? '⏳' : '📊');
}

// ─── SETTINGS UI ──────────────────────────────────────────────────────────────

const SETTINGS_HTML = `
<div id="enaennTracker_root" class="extension_settings">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>📊 enaennTracker</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">

      <div class="flex-container flexGap5 enaenn-gap">
        <label class="checkbox_label">
          <input type="checkbox" id="enaennTracker_enabled" />
          <span>Enabled</span>
        </label>
        <label class="checkbox_label" style="margin-left:14px;">
          <input type="checkbox" id="enaennTracker_autoUpdate" />
          <span>Auto-update after each reply</span>
        </label>
        <button id="enaennTracker_toggleOverlayBtn" class="menu_button">👁️ Show/Hide Overlay</button>
      </div>

      <div class="flex-container flexGap5 alignItemsCenter enaenn-gap">
        <label style="white-space:nowrap; min-width:175px;">Roleplay messages sent to tracker:</label>
        <input type="number" id="enaennTracker_ctxSize" min="5" max="100" class="text_pole" style="width:60px;" />
      </div>

      <div class="flex-container flexGap5 alignItemsCenter enaenn-gap">
        <label style="white-space:nowrap; min-width:175px;">Tracker snapshots kept per chat:</label>
        <input type="number" id="enaennTracker_windowSize" min="1" max="50" class="text_pole" style="width:60px;" />
      </div>

      <hr />

      <div class="enaenn-gap" style="font-weight:bold;">📖 Context Sources</div>
      <small style="opacity:0.6;">These are sent only to the tracker API — never to the main chat AI.</small>

      <div class="flex-container flexGap5 enaenn-gap" style="margin-top:6px;">
        <label class="checkbox_label">
          <input type="checkbox" id="enaennTracker_useCharDesc" />
          <span>Include character description</span>
        </label>
      </div>

      <div class="flex-container flexGap5 enaenn-gap">
        <label class="checkbox_label">
          <input type="checkbox" id="enaennTracker_useWI" />
          <span>Include active World Info entries</span>
        </label>
      </div>

      <div class="flex-container flexGap5 alignItemsCenter enaenn-gap">
        <label style="white-space:nowrap; min-width:175px;">World Info token budget:</label>
        <input type="number" id="enaennTracker_wiTokenLimit" min="0" max="200000" class="text_pole" style="width:90px;" />
        <small style="opacity:0.6;">tokens (0 = unlimited)</small>
      </div>

      <small style="opacity:0.5; display:block; margin-top:2px;">
        ⚠️ Keep the WI budget well within your model's actual context window.
        The tracker also receives the system prompt, character description, chat history, and previous state —
        none of which count against this budget.
      </small>

      <div id="enaennTracker_genStats" class="enaenn-gen-stats"></div>

      <hr />

      <div class="enaenn-gap" style="font-weight:bold;">🔌 API Connection</div>
      <small style="opacity:0.6;">Priority: Quick API → Connection Profile → SillyTavern's active API.</small>

      <details class="enaenn-api-drawer">
        <summary>🧩 SillyTavern Connection Profile</summary>
        <div class="enaenn-api-drawer-body">
          <small style="opacity:0.6;">Pick one of your saved SillyTavern connection profiles for the tracker to use. Leave empty to use whatever API is currently active in ST.</small>
          <div class="flex-container flexGap5 alignItemsCenter enaenn-gap">
            <select id="enaennTracker_profileSelect" class="text_pole flex1">
              <option value="">— Use active ST API —</option>
            </select>
            <button type="button" id="enaennTracker_profileRefresh" class="menu_button" title="Refresh profile list">
              <i class="fa-solid fa-rotate"></i>
            </button>
          </div>
          <div id="enaennTracker_profileStatus" class="enaenn-api-status">
            <span class="enaenn-status-inactive">No profile set</span>
          </div>
          <div class="flex-container flexGap5 enaenn-gap">
            <button type="button" id="enaennTracker_profileCheck" class="menu_button flex1"><i class="fa-solid fa-plug"></i> Check</button>
            <button type="button" id="enaennTracker_profileTest"  class="menu_button flex1"><i class="fa-solid fa-flask"></i> Test</button>
          </div>
        </div>
      </details>

      <details class="enaenn-api-drawer">
        <summary>⚡ Quick API (manual)</summary>
        <div class="enaenn-api-drawer-body">
          <label class="checkbox_label">
            <input type="checkbox" id="enaennTracker_quickapiEnabled" />
            <span>Enable Quick API override</span>
          </label>
          <div id="enaennTracker_quickapiOptions">
            <div class="enaenn-gap">
              <label style="display:block;">API URL (base):</label>
              <input type="text" id="enaennTracker_quickapiUrl" class="text_pole" placeholder="https://your-server.com/v1" style="width:100%;" />
            </div>
            <div class="enaenn-gap">
              <label style="display:block;">API Key:</label>
              <input type="password" id="enaennTracker_quickapiKey" class="text_pole" placeholder="sk-... (optional)" style="width:100%;" />
            </div>
            <div class="enaenn-gap">
              <label style="display:block;">Model — from list:</label>
              <div class="flex-container flexGap5 alignItemsCenter">
                <select id="enaennTracker_quickapiModelSelect" class="text_pole flex1">
                  <option value="">— click ⟳ to load —</option>
                </select>
                <button type="button" id="enaennTracker_quickapiFetchModels" class="menu_button" title="Fetch model list from API">
                  <i class="fa-solid fa-rotate"></i>
                </button>
              </div>
              <small id="enaennTracker_modelsHint" style="display:none;"></small>
            </div>
            <div style="text-align:center; opacity:0.6; margin:4px 0;">— or —</div>
            <div class="enaenn-gap">
              <label style="display:block;">Model — manual:</label>
              <input type="text" id="enaennTracker_quickapiModelInput" class="text_pole" placeholder="gpt-4o, claude-3-5-sonnet, ..." autocomplete="off" style="width:100%;" />
            </div>
            <div id="enaennTracker_quickapiStatus" class="enaenn-api-status">
              <span class="enaenn-status-inactive">Quick API disabled</span>
            </div>
            <div class="flex-container flexGap5 enaenn-gap">
              <button type="button" id="enaennTracker_quickapiConnect" class="menu_button flex1"><i class="fa-solid fa-plug"></i> Check</button>
              <button type="button" id="enaennTracker_quickapiTest"    class="menu_button flex1"><i class="fa-solid fa-flask"></i> Test</button>
            </div>
          </div>
        </div>
      </details>

      <hr />

      <div class="flex-container flexGap5">
        <button id="enaennTracker_refreshBtn" class="menu_button flex1">🔄 Refresh Tracker</button>
        <button id="enaennTracker_regenBtn"   class="menu_button flex1" title="Undo the last tracker update (restore previous snapshot).">♻️ Restore Previous</button>
        <button id="enaennTracker_clearBtn"   class="menu_button" title="Clear all snapshots for this chat.">🗑️ Clear State</button>
      </div>

    </div>
  </div>
</div>`;

// ─── BIND UI ──────────────────────────────────────────────────────────────────

function bindUI() {
    $('#enaennTracker_enabled').on('change',    function () { save({ enabled:         this.checked }); });
    $('#enaennTracker_autoUpdate').on('change', function () { save({ autoUpdate:      this.checked }); });
    $('#enaennTracker_ctxSize').on('change',    function () { save({ contextMessages: Math.max(5,  parseInt(this.value) || 20) }); });
    $('#enaennTracker_windowSize').on('change', function () {
        const v = Math.max(1, parseInt(this.value) || 7);
        save({ windowSize: v });
        const chatId = getChatId();
        const snaps  = getSnapshots(chatId);
        if (snaps.length > v) setSnapshots(chatId, snaps.slice(-v));
    });

    // Context sources
    $('#enaennTracker_useCharDesc').on('change', function () { save({ useCharDescription: this.checked }); });
    $('#enaennTracker_useWI').on('change',       function () { save({ useWorldInfo:       this.checked }); });
    $('#enaennTracker_wiTokenLimit').on('change', function () {
        const v = Math.max(0, parseInt(this.value) || 0);
        save({ wiTokenLimit: v });
        $(this).val(v);
    });

    $('#enaennTracker_toggleOverlayBtn').on('click', () => toggleOverlay());

    // Connection Profile
    $('#enaennTracker_profileSelect').on('change', function () {
        save({ connectionProfile: this.value });
        updateProfileStatus();
    });
    $('#enaennTracker_profileRefresh').on('click', () => populateProfileDropdown());
    $('#enaennTracker_profileCheck').on('click', async function () {
        const btn  = this;
        const orig = btn.innerHTML;
        const s    = S();
        if (!s.connectionProfile) { toastr.warning('Select a profile first!'); return; }
        const profile = getConnectionProfile(s.connectionProfile);
        if (!profile)  { toastr.warning('Profile not found. Click ⟳ to refresh the list.'); return; }
        try {
            const ctx = getContext();
            if (!ctx.ConnectionManagerRequestService) { toastr.error('Connection Manager is not available in this ST.'); return; }
            const supported = (ctx.ConnectionManagerRequestService.getSupportedProfiles?.() || []).some(p => p.id === profile.id);
            if (!supported) { toastr.warning(`Profile "${profile.name}" isn't supported (API type: ${profile.api || '—'}).`); return; }
            btn.innerHTML = '<i class="fa-solid fa-check"></i> OK';
            setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 1500);
            toastr.success(`Profile "${profile.name}" looks good.`);
        } catch (e) {
            btn.innerHTML = orig;
            toastr.error(`Check failed: ${e.message}`);
        }
    });
    $('#enaennTracker_profileTest').on('click', async function () {
        const btn  = this;
        const orig = btn.innerHTML;
        const s    = S();
        if (!s.connectionProfile) { toastr.warning('Select a profile first!'); return; }
        if (!getConnectionProfile(s.connectionProfile)) { toastr.warning('Profile not found. Click ⟳ to refresh.'); return; }
        try {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating…';
            const reply = await generateWithConnectionProfile('Reply with exactly one short line: "Tracker profile connected!" and nothing else.', 60);
            btn.innerHTML = '<i class="fa-solid fa-check"></i> OK';
            setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 2000);
            toastr.success(`Reply: ${reply || '(empty)'}`);
        } catch (e) {
            btn.innerHTML = '<i class="fa-solid fa-xmark"></i> Error';
            setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 2500);
            toastr.error(`Error: ${e.message}`);
        }
    });

    // Quick API
    $('#enaennTracker_quickapiEnabled').on('change', function () {
        save({ quickApiEnabled: this.checked });
        updateQuickApiStatus();
    });
    $('#enaennTracker_quickapiUrl').on('change', function () {
        save({ quickApiUrl: this.value.trim() });
        updateQuickApiStatus();
    });
    $('#enaennTracker_quickapiKey').on('change', function () {
        save({ quickApiKey: this.value.trim() });
    });
    $('#enaennTracker_quickapiModelSelect').on('change', function () {
        if (!this.value) return;
        save({ quickApiModel: this.value });
        $('#enaennTracker_quickapiModelInput').val('');
        updateQuickApiStatus();
    });
    $('#enaennTracker_quickapiModelInput').on('input', function () {
        const val = this.value.trim();
        save({ quickApiModel: val });
        if (val) $('#enaennTracker_quickapiModelSelect').val('');
        updateQuickApiStatus();
    });
    $('#enaennTracker_quickapiFetchModels').on('click', () => fetchQuickApiModels());
    $('#enaennTracker_quickapiConnect').on('click',     () => connectQuickApi());
    $('#enaennTracker_quickapiTest').on('click', async () => {
        const s = S();
        if (!s.quickApiEnabled)              { toastr.warning('Enable Quick API first!'); return; }
        if (!s.quickApiUrl || !s.quickApiModel) { toastr.warning('Enter both a URL and a model!'); return; }
        toastr.info('Running a tracker update using Quick API…');
        await updateTracker();
    });

    $('#enaennTracker_refreshBtn').on('click', () => updateTracker());
    $('#enaennTracker_regenBtn').on('click',   async () => { await deleteLastTracker(); });
    $('#enaennTracker_clearBtn').on('click', () => {
        const chatId = getChatId();
        setSnapshots(chatId, []);
        updateOverlayContent(chatId);
        clearGenStats();
        toastr.info('Tracker state cleared for this chat.');
    });
}

// ─── TOOLBAR BUTTON ───────────────────────────────────────────────────────────

function addToolbarButton() {
    if ($('#enaennTracker_toolbarBtn').length) return;
    const $btn = $(`<div id="enaennTracker_toolbarBtn" title="Toggle enaennTracker overlay" class="interactable">📊</div>`);
    $btn.on('click', () => toggleOverlay());
    const targets = ['#send_but_sheld', '#rightSendForm', '#form_sheld'];
    for (const sel of targets) {
        const $target = $(sel);
        if ($target.length) { $target.prepend($btn); return; }
    }
    console.warn('[enaennTracker] Could not find toolbar container for 📊 button.');
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

jQuery(async () => {
    initSettings();
    createOverlay();

    $('#extensions_settings2').append(SETTINGS_HTML);

    // Restore saved values into form controls
    $('#enaennTracker_enabled').prop('checked',      S().enabled);
    $('#enaennTracker_autoUpdate').prop('checked',   S().autoUpdate);
    $('#enaennTracker_ctxSize').val(S().contextMessages);
    $('#enaennTracker_windowSize').val(S().windowSize);
    $('#enaennTracker_useCharDesc').prop('checked',  S().useCharDescription);
    $('#enaennTracker_useWI').prop('checked',        S().useWorldInfo);
    $('#enaennTracker_wiTokenLimit').val(S().wiTokenLimit);
    $('#enaennTracker_quickapiEnabled').prop('checked', S().quickApiEnabled);
    $('#enaennTracker_quickapiUrl').val(S().quickApiUrl);
    $('#enaennTracker_quickapiKey').val(S().quickApiKey);
    $('#enaennTracker_quickapiModelInput').val(S().quickApiModel);

    bindUI();
    addToolbarButton();
    updateQuickApiStatus();
    populateProfileDropdown();
    setTimeout(populateProfileDropdown, 1000);
    setTimeout(populateProfileDropdown, 3000);

    const chatId = getChatId();
    updateOverlayContent(chatId);
    toggleOverlay(S().overlayVisible);

    // Restore last-gen stats if we have them (they don't survive page reload
    // since they're not in DEFAULT_SETTINGS persistence — that's intentional)
    if (S().lastGenTokensTotal !== null) {
        updateGenStats(S().lastGenTokensTotal, S().lastGenTokensWI ?? 0, false);
    }

    // ─── World Info cache hook ─────────────────────────────────────────────
    // ST fires WORLDINFO_USED during its own prompt assembly (i.e. when the
    // chat AI is about to generate). We cache the active entries here so the
    // tracker can use them at the next generation without re-scanning itself.
    if (event_types.WORLDINFO_USED) {
        eventSource.on(event_types.WORLDINFO_USED, onWorldInfoUsed);
    } else {
        // Older ST versions used a different event name
        const fallback = 'worldinfo_used';
        eventSource.on(fallback, onWorldInfoUsed);
        console.warn('[enaennTracker] event_types.WORLDINFO_USED not found — using fallback event name "worldinfo_used"');
    }

    // ─── Context injection (tracker state → main chat AI only) ────────────
    eventSource.on(event_types.GENERATE_AFTER_COMBINE_PROMPTS, (args) => {
        if (!S().enabled) return;
        const chatId    = getChatId();
        const injection = getInjectionText(chatId);
        if (!injection) return;

        if (args && typeof args === 'object') {
            if (args.prompt !== undefined) {
                args.prompt += injection;
            } else if (Array.isArray(args.messages)) {
                let insertIdx = args.messages.length;
                for (let i = args.messages.length - 1; i >= 0; i--) {
                    if (args.messages[i].role === 'user') { insertIdx = i; break; }
                }
                args.messages.splice(insertIdx, 0, { role: 'system', content: injection.trim() });
            }
        }
    });

    // ─── Auto-update after each reply ─────────────────────────────────────
    eventSource.on(event_types.MESSAGE_RECEIVED, async () => {
        if (S().enabled && S().autoUpdate) {
            // Small delay so the WI cache has time to be populated by
            // WORLDINFO_USED (which fires slightly before MESSAGE_RECEIVED)
            await new Promise(r => setTimeout(r, 700));
            await updateTracker();
        }
    });

    // ─── Chat changed ──────────────────────────────────────────────────────
    eventSource.on(event_types.CHAT_CHANGED, async () => {
        const chatId = getChatId();
        updateOverlayContent(chatId);
        clearGenStats();
        _wiCache = [];              // stale WI entries from previous chat are meaningless
        _wiCacheTimestamp = 0;
        if (S().overlayVisible) toggleOverlay(true);
    });

    // ─── Keep profile dropdown in sync ─────────────────────────────────────
    eventSource.on(event_types.SETTINGS_LOADED, () => {
        setTimeout(populateProfileDropdown, 500);
    });

    console.log('[enaennTracker] Loaded successfully.');
});
