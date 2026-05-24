'use strict';

// ─── STATIC IMPORTS ───────────────────────────────────────────────────────────

import {
    eventSource,
    event_types,
    saveSettingsDebounced,
    chat,
    addOneMessage,
    getRequestHeaders,
} from '../../../../script.js';

import {
    extension_settings,
} from '../../../extensions.js';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const MODULE_NAME  = 'enaennTracker';
const TRACKER_FLAG = 'enaenn_tracker';

const DEFAULT_SETTINGS = {
    enabled:            true,
    autoUpdate:         true,
    profiles:           [],
    activeProfileIndex: -1,
    lastTracker:        '',
    contextMessages:    20,
    windowSize:         7,
};

// ─── TRACKER SYSTEM PROMPT ────────────────────────────────────────────────────

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

LOC: [1–2 sentence location and spatial description]

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
REL: Clara | 295 | Interested Amiability | + | 8 months | Acquaintances | 😊 | Curious | 58 | 😊 | Friendly | 34 | - | - | - | - | - | -
OFFSCREEN: ♂️ | Rune | Old Quarters penthouse | Having late lunch with Kyren | fine | rested | fresh | fine | fine | none | calm | Eat. Act normal.
PLAN: 18 May | Rune's gallery opening — Ena invited by Clara`;

// ─── VITAL METADATA & COLOR LOGIC ────────────────────────────────────────────

const VITAL_META = [
    { key: 'satiation',   emoji: '🍴', label: 'Satiation',   text: 'food',    polarity: 'low'    },
    { key: 'energy',      emoji: '😴', label: 'Energy',      text: 'energy',  polarity: 'low'    },
    { key: 'cleanliness', emoji: '🚿', label: 'Cleanliness', text: 'hygiene', polarity: 'low'    },
    { key: 'thirst',      emoji: '💧', label: 'Thirst',      text: 'thirst',  polarity: 'high'   },
    { key: 'bladder',     emoji: '🚽', label: 'Bladder',     text: 'bladder', polarity: 'high'   },
    { key: 'arousal',     emoji: '🔥', label: 'Arousal',     text: 'arousal', polarity: 'arousal'},
    { key: 'stress',      emoji: '🧠', label: 'Stress',      text: 'stress',  polarity: 'high'   },
];

// Strip any non-numeric prefix (word labels, emoji) so parseFloat works on
// both raw ("76") and labeled ("food:76" or "🍴76") vital strings.
const numVal = (s) => parseFloat(String(s ?? '').replace(/[^0-9.]/g, '')) || 0;

// ─── TRACKER CONTEXT FORMATTER ───────────────────────────────────────────────
// Transforms the raw tracker output (LOC/AGENT/REL pipe format) into a labeled,
// human-readable format stored in `mes` so the main model understands each field.
//
//  AGENT vitals:  76 | 83 | …  →  food:76 | energy:83 | hygiene:90 | …
//  AGENT deltas: -2 | -2 | …   →  Δfood:-2 | Δenergy:-2 | …
//  REL:           →  RELATIONSHIP:
//  OFFSCREEN vitals: fine | rested | …  →  food:fine | energy:rested | hygiene:fresh | …
//
// The SillyTavern find-regex is updated to match this labeled format and still
// renders the same emoji-illustrated HTML card.
//
// OFFSCREEN vital order differs from AGENT (bladder/thirst are swapped):
const OFFSCREEN_VITAL_TEXTS = ['food', 'energy', 'hygiene', 'bladder', 'thirst', 'arousal', 'stress'];

function formatTrackerForContext(raw) {
    return raw.split('\n').map(line => {
        const t = line.trim();
        if (!t) return line;

        if (t.startsWith('AGENT:')) {
            const parts = t.slice('AGENT:'.length).split('|').map(s => s.trim());
            if (parts.length < 19) return line;
            const vt = VITAL_META.map(m => m.text); // food, energy, hygiene, thirst, bladder, arousal, stress
            for (let i = 0; i < 7; i++) {
                // Strip any existing emoji prefix (from a previous labeling pass) before re-labeling
                const rawVal = parts[3 + i].replace(/^[^\d-+.]+/, '');
                const rawDel = parts[10 + i].replace(/^Δ\w+:/, '');
                parts[3 + i]  = `${vt[i]}:${rawVal}`;
                parts[10 + i] = `Δ${vt[i]}:${rawDel}`;
            }
            return 'AGENT: ' + parts.join(' | ');
        }

        if (t.startsWith('REL:')) {
            return 'RELATIONSHIP:' + t.slice('REL:'.length);
        }

        if (t.startsWith('OFFSCREEN:')) {
            const parts = t.slice('OFFSCREEN:'.length).split('|').map(s => s.trim());
            if (parts.length < 12) return line;
            // Fields 4–10 are descriptive vital words (fine, rested, fresh…)
            for (let i = 0; i < 7; i++) {
                const rawVal = parts[4 + i].replace(/^\w+:/, ''); // strip existing label if any
                parts[4 + i] = `${OFFSCREEN_VITAL_TEXTS[i]}:${rawVal}`;
            }
            return 'OFFSCREEN: ' + parts.join(' | ');
        }

        return line;
    }).join('\n');
}

function vitalColorClass(polarity, value) {
    if (polarity === 'arousal') return 'enaenn-fill-arousal';
    if (polarity === 'low')     return value >= 50 ? 'enaenn-fill-ok' : value >= 25 ? 'enaenn-fill-warn' : 'enaenn-fill-crit';
    return value <= 50 ? 'enaenn-fill-ok' : value <= 74 ? 'enaenn-fill-warn' : 'enaenn-fill-crit';
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

// ─── HTML BUILDERS (used for restore/re-render; regex handles new messages) ───

function esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildVitalsHTML(vitals) {
    return VITAL_META.map(({ key, emoji, label, polarity }) => {
        const v = vitals[key] || { val: 0, delta: '—' };
        const colorCls = vitalColorClass(polarity, v.val);
        const barWidth = polarity === 'arousal' ? Math.min(v.val, 100) : v.val;
        return `<div class="enaenn-vital-row"><span class="enaenn-vital-emoji">${emoji}</span><span class="enaenn-vital-label">${label}</span><div class="enaenn-vital-bar-wrap"><div class="enaenn-vital-fill ${colorCls}" style="width:${barWidth}%"></div></div><span class="enaenn-vital-val">${v.val}%</span><span class="enaenn-vital-delta">(${esc(v.delta)})</span></div>`;
    }).join('\n');
}

function buildAgentRowHTML(agent) {
    const cond = agent.condition ? `<div class="enaenn-condition">🩹 ${esc(agent.condition)}</div>` : '';
    return `<div class="enaenn-agent-row"><div class="enaenn-agent-header"><span class="enaenn-agent-name">${esc(agent.gender)} ${esc(agent.name)}</span><span class="enaenn-agent-attire">👗 ${esc(agent.attire)}</span></div><details class="enaenn-vitals-fold"><summary>Vitals</summary><div class="enaenn-vitals">${buildVitalsHTML(agent.vitals)}</div></details>${cond}<div class="enaenn-impulse">🎯 ${esc(agent.impulse)}</div></div>`;
}

function buildRelFoldHTML(rel) {
    const barClass = rel.valence === '-' ? 'enaenn-rel-fill-neg' : 'enaenn-rel-fill';
    const barWidth = Math.min((rel.mainVal / 1000) * 100, 100).toFixed(1);
    const itmHTML  = rel.itm.map(f => `<div class="enaenn-rel-moment-row"><span>${esc(f.emoji)} ${esc(f.name)}</span><div class="enaenn-rel-moment-bar-wrap"><div class="enaenn-rel-moment-fill" style="width:${f.val}%"></div></div><span class="enaenn-rel-moment-val">${f.val}</span></div>`).join('');
    return `<details class="enaenn-rel-fold"><summary><span class="enaenn-rel-fold-name">${esc(rel.name)} → User</span><span class="enaenn-rel-fold-preview">${esc(rel.mainName)} (${rel.mainVal}/1000)</span></summary><div class="enaenn-rel-fold-body"><div class="enaenn-rel-main"><span>${esc(rel.mainName)}</span><div class="enaenn-rel-bar-wrap"><div class="${barClass}" style="width:${barWidth}%"></div></div><span class="enaenn-rel-val">(${rel.mainVal}/1000)</span></div><div class="enaenn-rel-moments">${itmHTML}</div><div class="enaenn-rel-stage">Known ${esc(rel.duration)} · ${esc(rel.stage)}</div></div></details>`;
}

function buildOffscreenRowHTML(a) {
    const v = a.vitals;
    return `<div class="enaenn-offscreen-row"><div class="enaenn-offscreen-name">${esc(a.gender)} ${esc(a.name)} — 📍${esc(a.location)} // ${esc(a.activity)}</div><div class="enaenn-offscreen-vitals">🍴(${esc(v.hunger)}) | 😴(${esc(v.energy)}) | 🚿(${esc(v.clean)}) | 🚽(${esc(v.bladder)}) | 💧(${esc(v.thirst)}) | 🔥(${esc(v.arousal)}) | 🧠(${esc(v.stress)}) // 🎯 ${esc(a.impulse)}</div></div>`;
}

function buildTrackerHTML(data) {
    const uid  = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const tab1 = data.agents.length === 0 ? '<div class="enaenn-alone-msg">No agents present.</div>' : data.agents.map(buildAgentRowHTML).join('<div class="enaenn-agent-sep"></div>');
    const tab2 = data.relationships.length === 0 ? '<div class="enaenn-offscreen-row"><div class="enaenn-offscreen-name">No relationships tracked yet.</div></div>' : data.relationships.map(buildRelFoldHTML).join('');
    const tab3 = data.offscreen.length === 0 ? '<div class="enaenn-offscreen-row"><div class="enaenn-offscreen-name">No relevant off-screen agents.</div></div>' : data.offscreen.map(buildOffscreenRowHTML).join('');
    const plans = data.plans.length === 0 ? '' : `<details class="enaenn-plans"><summary>📅 Future Plans</summary><div class="enaenn-plans-body">${data.plans.map(p => `<div class="enaenn-plan-row"><span class="enaenn-plan-date">${esc(p.date)}</span><span class="enaenn-plan-desc">${esc(p.desc)}</span></div>`).join('')}</div></details>`;
    return `<div class="enaenn-tracker-block"><div class="enaenn-location">📍 ${esc(data.location)}</div><div class="enaenn-tabs-box"><input type="radio" name="enaenn-${uid}" id="enaenn-t1-${uid}" checked><input type="radio" name="enaenn-${uid}" id="enaenn-t2-${uid}"><input type="radio" name="enaenn-${uid}" id="enaenn-t3-${uid}"><div class="enaenn-tab-labels"><label for="enaenn-t1-${uid}">💖 Agents Present</label><label for="enaenn-t2-${uid}">💕 Relationships</label><label for="enaenn-t3-${uid}">🌍 Off-screen Agents</label></div><div class="enaenn-tab-content"><div class="enaenn-tp1">${tab1}</div><div class="enaenn-tp2"><div class="enaenn-rel-list">${tab2}</div></div><div class="enaenn-tp3">${tab3}</div></div></div>${plans}</div>`;
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────

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

function getActiveProfile() {
    const idx = S().activeProfileIndex;
    if (idx < 0 || idx >= S().profiles.length) return null;
    return S().profiles[idx];
}

// ─── CHAT / WINDOW HELPERS ────────────────────────────────────────────────────

function getTrackerIndices() {
    return chat
        .map((m, i) => ({ m, i }))
        .filter(({ m }) => m.extra?.[TRACKER_FLAG] === true)
        .map(({ i }) => i);
}

function archiveTrackerAt(idx) {
    const m = chat[idx];
    if (!m || m.extra?.archived) return;
    if (!m.extra.fullContent) m.extra.fullContent = m.mes;
    m.extra.archived = true;
    m.mes = '<div class="enaenn-tracker-archived">📋 <em>[archived tracker]</em></div>';
    $(`#chat .mes[mesid="${idx}"]`).find('.mes_text').html(m.mes);
}

function restoreTrackerAt(idx) {
    const m = chat[idx];
    if (!m || !m.extra?.archived) return;
    m.mes = m.extra.labeledText || m.extra.rawData || m.extra.fullContent || m.mes;
    m.extra.archived = false;
    // Re-inject the pre-built HTML directly so we don't show raw text momentarily
    const html = m.extra.fullContent || buildTrackerHTML(parseTrackerData(m.mes));
    $(`#chat .mes[mesid="${idx}"]`).find('.mes_text').html(html);
}

function reRenderTrackerMessages() {
    for (const idx of getTrackerIndices()) {
        const m = chat[idx];
        if (!m) continue;
        const html = m.extra?.archived
            ? '<div class="enaenn-tracker-archived">📋 <em>[archived tracker]</em></div>'
            : (m.extra?.fullContent || buildTrackerHTML(parseTrackerData(m.mes)));
        const $el = $(`#chat .mes[mesid="${idx}"]`).find('.mes_text');
        if ($el.length) $el.html(html);
    }
}

async function enforceWindow() {
    const indices   = getTrackerIndices();
    if (indices.length === 0) return;
    const cutoff    = Math.max(0, indices.length - S().windowSize);
    const toArchive = indices.slice(0, cutoff);
    const toRestore = indices.slice(cutoff);
    for (const idx of toArchive) { if (!chat[idx]?.extra?.archived) archiveTrackerAt(idx); }
    for (const idx of toRestore) { if (chat[idx]?.extra?.archived)  restoreTrackerAt(idx); }
}

// ─── BUILD THE USER MESSAGE ────────────────────────────────────────────────────

function buildUserMessage() {
    const recentRoleplay = chat
        .filter(m => !m.extra?.[TRACKER_FLAG])
        .slice(-(S().contextMessages));

    const chatText = recentRoleplay
        .map(m => `${m.name || (m.is_user ? 'User' : 'Character')}: ${m.mes || ''}`)
        .join('\n\n');

    const prevState = S().lastTracker
        ? `PREVIOUS TRACKER STATE (plain text — update from this):\n${S().lastTracker}`
        : 'No previous tracker state. Initialize fresh from chat context.';

    return (
        `${prevState}\n\n---\n\n` +
        `RECENT ROLEPLAY (${recentRoleplay.length} messages):\n${chatText}\n\n---\n\n` +
        `Output the updated tracker data in the exact plain-text format specified. Nothing else.`
    );
}

// ─── TRACKER API CALL — VIA ST BACKEND PROXY ─────────────────────────────────

async function callViaSTBackend(userMessage) {
    const profile = getActiveProfile();
    if (!profile) {
        toastr.warning('enaennTracker: No API profile selected. Open Extensions → enaennTracker.');
        return null;
    }

    const endpoint = (profile.endpoint || '').trim().replace(/\/+$/, '');
    const model    = (profile.model    || '').trim();
    const apiKey   = (profile.apiKey   || '').trim();

    if (!endpoint || !model) {
        toastr.warning('enaennTracker: Active profile is missing Endpoint URL or Model name.');
        return null;
    }

    try {
        const response = await fetch('/api/backends/chat-completions/generate', {
            method:  'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                chat_completion_source: 'openai',
                reverse_proxy:  endpoint,
                proxy_password: apiKey,
                model:       model,
                messages: [
                    { role: 'system', content: TRACKER_SYSTEM_PROMPT },
                    { role: 'user',   content: userMessage },
                ],
                max_tokens:        600,
                temperature:       0.2,
                stream:            false,
                top_p:             1,
                presence_penalty:  0,
                frequency_penalty: 0,
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`ST backend returned HTTP ${response.status}: ${errText.slice(0, 400)}`);
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content?.trim() ?? null;

    } catch (err) {
        console.error('[enaennTracker]', err);
        toastr.error(`enaennTracker: ${err.message}`);
        return null;
    }
}

// ─── UNIFIED TRACKER API CALL ─────────────────────────────────────────────────

async function callTrackerAPI() {
    return callViaSTBackend(buildUserMessage());
}

// ─── INSERT TRACKER MESSAGE ───────────────────────────────────────────────────

let _addOneMessage = null;

async function insertTrackerMessage(rawText) {
    // labeledText = emoji-prefixed vitals for main model readability; stored in mes.
    // rawData     = original tracker output; kept for the next API call ("previous state").
    // htmlContent = pre-built card HTML; used by restore/re-render and as DOM fallback.
    const labeledText = formatTrackerForContext(rawText);
    const htmlContent = buildTrackerHTML(parseTrackerData(rawText));

    const mesObj = {
        name:      'Tracker',
        is_user:   false,
        is_system: false,
        mes:       labeledText,   // emoji-labeled plain text — kept short for context tokens
        send_date: new Date().toLocaleString(),
        extra: {
            [TRACKER_FLAG]: true,
            type:           'narrator',
            fullContent:    htmlContent,  // pre-built HTML for restore/re-render
            rawData:        rawText,      // original format for the next tracker API call
            labeledText:    labeledText,  // saved so restore also gives main model labeled text
            archived:       false,
            token_count:    0,
        },
    };

    chat.push(mesObj);
    const mesId = chat.length - 1;

    if (_addOneMessage) {
        try {
            // addOneMessage triggers ST's rendering pipeline which fires the find-regex.
            // Placement [1,2] in the regex JSON covers narrator/AI-output messages.
            await _addOneMessage(mesObj, { scroll: true, type: 'narrator' });

            // Safety fallback: if the regex didn't fire and transform the text into
            // the tracker card, inject the pre-built HTML directly so the card always shows.
            const $el = $(`#chat .mes[mesid="${mesId}"]`).find('.mes_text');
            if ($el.length && !$el.find('.enaenn-tracker-block').length) {
                $el.html(htmlContent);
            }

            const $chat = $('#chat');
            $chat.scrollTop($chat[0].scrollHeight);
            return;
        } catch (e) {
            console.warn('[enaennTracker] addOneMessage threw, falling back to DOM:', e);
        }
    }

    // Full DOM fallback — inject pre-built HTML directly
    $('#chat').append(`<div class="mes" mesid="${mesId}" is_system="false"><div class="mes_block"><div class="ch_name"><span class="name_text">Tracker</span></div><div class="mes_text"></div></div></div>`);
    $(`#chat .mes[mesid="${mesId}"]`).find('.mes_text').html(htmlContent);
    $('#chat').scrollTop($('#chat')[0].scrollHeight);
}

// ─── DELETE LAST TRACKER ──────────────────────────────────────────────────────

async function deleteLastTracker() {
    const indices = getTrackerIndices();
    if (indices.length === 0) {
        toastr.info('No tracker to delete.');
        return false;
    }

    const lastIdx = indices[indices.length - 1];

    // Remove from DOM
    $(`#chat .mes[mesid="${lastIdx}"]`).remove();

    // Remove from chat array (splice and re-index remaining DOM elements)
    chat.splice(lastIdx, 1);

    // Re-index all subsequent DOM messages so mesid attributes stay in sync
    $('#chat .mes').each(function () {
        const id = parseInt($(this).attr('mesid'));
        if (id > lastIdx) $(this).attr('mesid', id - 1);
    });

    // Roll lastTracker back to the previous tracker's plain text (if any)
    const remaining = getTrackerIndices();
    if (remaining.length > 0) {
        const prevMsg = chat[remaining[remaining.length - 1]];
        save({ lastTracker: prevMsg?.extra?.rawData || prevMsg?.extra?.fullContent || prevMsg?.mes || '' });
    } else {
        save({ lastTracker: '' });
    }

    return true;
}

// ─── MAIN UPDATE FLOW ─────────────────────────────────────────────────────────

let _updating = false;

async function updateTracker() {
    if (_updating) return;
    if (!S().enabled) return;

    _updating = true;
    setLoadingState(true);

    const rawResult = await callTrackerAPI();

    setLoadingState(false);
    _updating = false;

    if (!rawResult) return;

    // Save the plain text as the previous state for the next API call
    save({ lastTracker: rawResult });

    // Insert as plain text — ST's regex pipeline renders the HTML card
    await insertTrackerMessage(rawResult);
    await enforceWindow();

    toastr.success('Tracker updated!', '', { timeOut: 1500 });
}

// ─── UI ───────────────────────────────────────────────────────────────────────

function setLoadingState(loading) {
    $('#enaennTracker_refreshBtn')
        .prop('disabled', loading)
        .text(loading ? '⏳ Updating…' : '🔄 Refresh Tracker');
    $('#enaennTracker_regenBtn')
        .prop('disabled', loading)
        .text(loading ? '⏳ Updating…' : '♻️ Regenerate');
    $('#enaennTracker_toolbarBtn')
        .prop('disabled', loading)
        .text(loading ? '⏳' : '🔄');
}

function refreshProfileSelect() {
    const $sel = $('#enaennTracker_profileSelect')
        .empty()
        .append('<option value="-1">— Select a profile —</option>');
    S().profiles.forEach((p, i) => {
        $sel.append(`<option value="${i}"${i === S().activeProfileIndex ? ' selected' : ''}>${p.name || 'Unnamed'}</option>`);
    });
}

function refreshProfileEditor() {
    const idx = S().activeProfileIndex;
    if (idx < 0 || idx >= S().profiles.length) {
        $('#enaennTracker_profileEditor').slideUp(150);
        return;
    }
    const p = S().profiles[idx];
    $('#enaennTracker_pName').val(p.name     || '');
    $('#enaennTracker_pEndpoint').val(p.endpoint || '');
    $('#enaennTracker_pKey').val(p.apiKey    || '');
    $('#enaennTracker_pModel').val(p.model    || '');
    $('#enaennTracker_profileEditor').slideDown(150);
}

const SETTINGS_HTML = `
<div id="enaennTracker_root" class="extension_settings">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>🔄 enaennTracker</b>
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
      </div>

      <div class="flex-container flexGap5 alignItemsCenter enaenn-gap">
        <label style="white-space:nowrap; min-width:175px;">Roleplay messages → tracker API:</label>
        <input type="number" id="enaennTracker_ctxSize" min="5" max="100" class="text_pole" style="width:60px;" />
      </div>

      <div class="flex-container flexGap5 alignItemsCenter enaenn-gap">
        <label style="white-space:nowrap; min-width:175px;">Tracker snapshots visible to model:</label>
        <input type="number" id="enaennTracker_windowSize" min="1" max="50" class="text_pole" style="width:60px;" />
        <span style="font-size:0.78em; opacity:0.5;">(older ones archived)</span>
      </div>

      <hr />

      <div class="enaenn-gap" style="font-weight:bold;">API Profiles</div>
      <div style="font-size:0.78em; opacity:0.6; margin-bottom:6px;">
        Requests are routed through ST's server — works on all browsers including iOS Safari.
      </div>

      <div class="flex-container flexGap5 enaenn-gap">
        <select id="enaennTracker_profileSelect" class="text_pole flex1"></select>
        <button id="enaennTracker_addProfile"    class="menu_button" title="New profile">➕</button>
        <button id="enaennTracker_deleteProfile" class="menu_button" title="Delete selected">🗑️</button>
      </div>

      <div id="enaennTracker_profileEditor">
        <div class="editor-title">Edit Profile</div>
        <label>Name</label>
        <input type="text"     id="enaennTracker_pName"     class="text_pole" placeholder="e.g. Longcat" />
        <label>Endpoint URL <small>(include /v1, e.g. https://api.openai.com/v1)</small></label>
        <input type="text"     id="enaennTracker_pEndpoint" class="text_pole" placeholder="https://api.openai.com/v1" />
        <label>API Key <small>(leave blank if not needed)</small></label>
        <input type="password" id="enaennTracker_pKey"      class="text_pole" placeholder="sk-..." />
        <label>Model name</label>
        <input type="text"     id="enaennTracker_pModel"    class="text_pole" placeholder="gpt-4o-mini" />
        <button id="enaennTracker_saveProfile" class="menu_button" style="margin-top:8px;">💾 Save Profile</button>
      </div>

      <hr />

      <div class="flex-container flexGap5">
        <button id="enaennTracker_refreshBtn"    class="menu_button flex1">🔄 Refresh Tracker</button>
        <button id="enaennTracker_regenBtn"      class="menu_button flex1" title="Delete the last tracker and generate a fresh one.">♻️ Regenerate</button>
        <button id="enaennTracker_clearBtn"      class="menu_button" title="Clears saved tracker state. Next refresh starts fresh.">🗑️ Clear State</button>
      </div>

    </div>
  </div>
</div>`;

function bindUI() {
    $('#enaennTracker_enabled').on('change',    function () { save({ enabled:         this.checked }); });
    $('#enaennTracker_autoUpdate').on('change', function () { save({ autoUpdate:      this.checked }); });
    $('#enaennTracker_ctxSize').on('change',    function () { save({ contextMessages: Math.max(5,  parseInt(this.value) || 20) }); });
    $('#enaennTracker_windowSize').on('change', function () {
        const v = Math.max(1, parseInt(this.value) || 7);
        save({ windowSize: v });
        enforceWindow();
    });

    $('#enaennTracker_profileSelect').on('change', function () {
        save({ activeProfileIndex: parseInt(this.value) });
        refreshProfileEditor();
    });

    $('#enaennTracker_addProfile').on('click', () => {
        const profiles = [...S().profiles, { name: 'New Profile', endpoint: '', apiKey: '', model: '' }];
        save({ profiles, activeProfileIndex: profiles.length - 1 });
        refreshProfileSelect();
        refreshProfileEditor();
    });

    $('#enaennTracker_deleteProfile').on('click', () => {
        const idx = S().activeProfileIndex;
        if (idx < 0) return;
        const profiles = S().profiles.filter((_, i) => i !== idx);
        const newIdx   = profiles.length === 0 ? -1 : Math.min(idx, profiles.length - 1);
        save({ profiles, activeProfileIndex: newIdx });
        refreshProfileSelect();
        refreshProfileEditor();
    });

    $('#enaennTracker_saveProfile').on('click', () => {
        const idx = S().activeProfileIndex;
        if (idx < 0) return;
        const profiles = [...S().profiles];
        profiles[idx] = {
            name:     $('#enaennTracker_pName').val().trim()     || 'Unnamed',
            endpoint: $('#enaennTracker_pEndpoint').val().trim(),
            apiKey:   $('#enaennTracker_pKey').val().trim(),
            model:    $('#enaennTracker_pModel').val().trim(),
        };
        save({ profiles });
        refreshProfileSelect();
        toastr.success('Profile saved!');
    });

    $('#enaennTracker_refreshBtn').on('click', () => updateTracker());
    $('#enaennTracker_regenBtn').on('click', async () => {
        const deleted = await deleteLastTracker();
        if (deleted) await updateTracker();
    });
    $('#enaennTracker_clearBtn').on('click', () => {
        save({ lastTracker: '' });
        toastr.info('Tracker state cleared. Next refresh will start fresh.');
    });
}

function addToolbarButton() {
    if ($('#enaennTracker_toolbarBtn').length) return;
    const $btn = $(`<div id="enaennTracker_toolbarBtn" title="Refresh enaennTracker" class="interactable">🔄</div>`);
    $btn.on('click', () => updateTracker());
    $('#send_but_sheld').prepend($btn);
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

jQuery(async () => {
    initSettings();

    if (typeof addOneMessage === 'function') {
        _addOneMessage = addOneMessage;
        console.log('[enaennTracker] addOneMessage loaded via static import.');
    } else {
        try {
            const mod = await import('../../../../script.js');
            _addOneMessage = (typeof mod.addOneMessage === 'function') ? mod.addOneMessage : null;
            console.log(_addOneMessage
                ? '[enaennTracker] addOneMessage loaded via dynamic import.'
                : '[enaennTracker] addOneMessage not found in module, using DOM fallback.');
        } catch (e) {
            console.warn('[enaennTracker] Dynamic import failed, using DOM fallback:', e);
        }
    }

    $('#extensions_settings2').append(SETTINGS_HTML);

    $('#enaennTracker_enabled').prop('checked',   S().enabled);
    $('#enaennTracker_autoUpdate').prop('checked', S().autoUpdate);
    $('#enaennTracker_ctxSize').val(S().contextMessages);
    $('#enaennTracker_windowSize').val(S().windowSize);
    refreshProfileSelect();
    refreshProfileEditor();

    bindUI();
    addToolbarButton();

    eventSource.on(event_types.MESSAGE_RECEIVED, async () => {
        if (S().enabled && S().autoUpdate) {
            await new Promise(r => setTimeout(r, 700));
            await updateTracker();
        }
    });

    eventSource.on(event_types.CHAT_CHANGED, async () => {
        save({ lastTracker: '' });
        await enforceWindow();
        setTimeout(reRenderTrackerMessages, 600);
    });

    console.log('[enaennTracker] Loaded successfully.');
});
