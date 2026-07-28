'use strict';

// ─── IMPORTS ──────────────────────────────────────────────────────────────────

import {
    eventSource,
    event_types,
    saveSettingsDebounced,
    chat,
} from '../../../../script.js';

import {
    extension_settings,
    getContext,
} from '../../../extensions.js';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const MODULE_NAME  = 'enaennTracker';
const TRACKER_FLAG = 'enaenn_tracker'; // legacy, kept for compatibility

const DEFAULT_SETTINGS = {
    enabled:            true,
    autoUpdate:         true,
    contextMessages:    20,
    windowSize:         7,              // snapshots kept per chat
    selectedProfile:    'same',         // 'same' or profile name
    overlayVisible:     false,          // start hidden
    trackerStates:      {},             // { chatId: [ snapshot, ... ] }
};

// ─── TRACKER SYSTEM PROMPT (unchanged) ──────────────────────────────────────

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

// ─── VITAL METADATA & HELPERS ──────────────────────────────────────────────

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

// ─── DATA PARSER ─────────────────────────────────────────────────────────────

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

// ─── HTML BUILDER FOR TRACKER CARD ──────────────────────────────────────────

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

// ─── FORMAT TRACKER FOR CONTEXT (label vitals with words) ─────────────────

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

// ─── SETTINGS / STATE ────────────────────────────────────────────────────────

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

// ─── PER‑CHAT SNAPSHOT STORAGE ──────────────────────────────────────────────

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

// ─── OVERLAY CREATION ─────────────────────────────────────────────────────────

let overlayVisible = false;
let overlayCollapsed = true;

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

    // Drag logic
    let isDragging = false, startX, startY, origX, origY;
    const header = overlay.querySelector('#enaenn-overlay-header');
    const onDragStart = (e) => {
        if (e.target.closest('button')) return;
        isDragging = true;
        const rect = overlay.getBoundingClientRect();
        const touch = e.touches ? e.touches[0] : e;
        startX = touch.clientX; startY = touch.clientY;
        origX = rect.left; origY = rect.top;
        document.addEventListener('mousemove', onDragMove);
        document.addEventListener('touchmove', onDragMove, { passive: false });
        document.addEventListener('mouseup', onDragEnd);
        document.addEventListener('touchend', onDragEnd);
        e.preventDefault();
    };
    const onDragMove = (e) => {
        if (!isDragging) return;
        const touch = e.touches ? e.touches[0] : e;
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;
        overlay.style.left = (origX + dx) + 'px';
        overlay.style.top = (origY + dy) + 'px';
        overlay.style.right = 'auto';
        overlay.style.bottom = 'auto';
        e.preventDefault();
    };
    const onDragEnd = () => {
        isDragging = false;
        document.removeEventListener('mousemove', onDragMove);
        document.removeEventListener('touchmove', onDragMove);
        document.removeEventListener('mouseup', onDragEnd);
        document.removeEventListener('touchend', onDragEnd);
    };
    header.addEventListener('mousedown', onDragStart);
    header.addEventListener('touchstart', onDragStart);

    // Collapse toggle
    const collapseBtn = overlay.querySelector('#enaenn-overlay-collapse');
    collapseBtn.addEventListener('click', () => {
        overlayCollapsed = !overlayCollapsed;
        overlay.classList.toggle('collapsed', overlayCollapsed);
        collapseBtn.textContent = overlayCollapsed ? '▸' : '▾';
    });

    // Close button
    overlay.querySelector('#enaenn-overlay-close').addEventListener('click', () => {
        toggleOverlay(false);
    });

    // initial state
    overlay.classList.add('collapsed');
    collapseBtn.textContent = '▸';
    overlay.style.display = 'none';
}

function toggleOverlay(show) {
    overlayVisible = (show !== undefined) ? show : !overlayVisible;
    const overlay = document.getElementById('enaenn-overlay');
    if (!overlay) return;
    overlay.style.display = overlayVisible ? 'block' : 'none';
    S().overlayVisible = overlayVisible;
    save({ overlayVisible });
}

function updateOverlayContent(chatId) {
    const overlay = document.getElementById('enaenn-overlay');
    if (!overlay) return;
    const body = overlay.querySelector('#enaenn-overlay-body');
    const snap = getCurrentSnapshot(chatId);
    if (snap) {
        body.innerHTML = snap.html || '<div style="padding:8px;opacity:0.5;">No data</div>';
    } else {
        body.innerHTML = '<div style="padding:8px;opacity:0.5;">No tracker snapshot yet.</div>';
    }
}

// ─── CONTEXT INJECTION ──────────────────────────────────────────────────────

function getInjectionText(chatId) {
    const snap = getCurrentSnapshot(chatId);
    if (!snap) return '';
    return `\n\n[TRACKER STATE]\n${snap.labeled}\n[/TRACKER STATE]\n`;
}

// ─── BUILD TRACKER PROMPT ────────────────────────────────────────────────────

function buildTrackerPrompt(chatId) {
    const recentRoleplay = chat
        .filter(m => !m.extra?.[TRACKER_FLAG])
        .slice(-(S().contextMessages || 20));

    const chatText = recentRoleplay
        .map(m => `${m.name || (m.is_user ? 'User' : 'Character')}: ${m.mes || ''}`)
        .join('\n\n');

    const prevSnap = getCurrentSnapshot(chatId);
    const prevState = prevSnap
        ? `PREVIOUS TRACKER STATE (plain text — update from this):\n${prevSnap.raw}`
        : 'No previous tracker state. Initialize fresh from chat context.';

    return (
        `${prevState}\n\n---\n\n` +
        `RECENT ROLEPLAY (${recentRoleplay.length} messages):\n${chatText}\n\n---\n\n` +
        `Output the updated tracker data in the exact plain-text format specified. Nothing else.`
    );
}

// ─── API CALL (uses ST's currently connected main API) ─────────────────────
// NOTE: We rely on SillyTavern's own generateRaw() helper instead of manually
// building a fetch request. generateRaw() automatically talks to whatever
// API you already have connected in SillyTavern (Claude, OpenAI, a local
// model, anything) — it doesn't matter which one, so there's no separate
// "profile" to configure or get wrong.

async function callTrackerAPI(chatId) {
    const ctx = getContext();
    const userMessage = buildTrackerPrompt(chatId);

    try {
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

// ─── MAIN UPDATE FLOW ────────────────────────────────────────────────────────

let _updating = false;

async function updateTracker() {
    if (_updating) return;
    if (!S().enabled) return;
    const chatId = getChatId();

    _updating = true;
    setLoadingState(true);

    const rawResult = await callTrackerAPI(chatId);

    setLoadingState(false);
    _updating = false;

    if (!rawResult) return;

    const parsed = parseTrackerData(rawResult);
    const labeled = formatTrackerForContext(rawResult);
    const html = buildTrackerHTML(parsed);

    saveSnapshot(chatId, rawResult, labeled, html, parsed);
    toastr.success('Tracker updated!', '', { timeOut: 1500 });
}

// ─── DELETE / RESTORE ────────────────────────────────────────────────────────

async function deleteLastTracker() {
    const chatId = getChatId();
    const restored = restorePreviousSnapshot(chatId);
    if (!restored) {
        toastr.info('No previous snapshot to restore to.');
    } else {
        toastr.success('Restored previous tracker snapshot.');
    }
    return !!restored;
}

// ─── UI HELPERS ──────────────────────────────────────────────────────────────

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

// ─── SETTINGS UI ─────────────────────────────────────────────────────────────

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
        <label style="white-space:nowrap; min-width:175px;">Roleplay messages → tracker API:</label>
        <input type="number" id="enaennTracker_ctxSize" min="5" max="100" class="text_pole" style="width:60px;" />
      </div>

      <div class="flex-container flexGap5 alignItemsCenter enaenn-gap">
        <label style="white-space:nowrap; min-width:175px;">Tracker snapshots kept per chat:</label>
        <input type="number" id="enaennTracker_windowSize" min="1" max="50" class="text_pole" style="width:60px;" />
      </div>

      <hr />

      <div style="font-size:0.78em; opacity:0.6; margin-bottom:6px;">
        The tracker uses whatever main API you currently have connected in SillyTavern — no separate setup needed.
      </div>

      <hr />

      <div class="flex-container flexGap5">
        <button id="enaennTracker_refreshBtn"    class="menu_button flex1">🔄 Refresh Tracker</button>
        <button id="enaennTracker_regenBtn"      class="menu_button flex1" title="Undo the last tracker update (restore previous snapshot).">♻️ Restore Previous</button>
        <button id="enaennTracker_clearBtn"      class="menu_button" title="Clear all snapshots for this chat.">🗑️ Clear State</button>
      </div>

    </div>
  </div>
</div>`;

// ─── BIND UI ─────────────────────────────────────────────────────────────────

function bindUI() {
    $('#enaennTracker_enabled').on('change',    function () { save({ enabled:         this.checked }); });
    $('#enaennTracker_autoUpdate').on('change', function () { save({ autoUpdate:      this.checked }); });
    $('#enaennTracker_ctxSize').on('change',    function () { save({ contextMessages: Math.max(5,  parseInt(this.value) || 20) }); });
    $('#enaennTracker_windowSize').on('change', function () {
        const v = Math.max(1, parseInt(this.value) || 7);
        save({ windowSize: v });
        const chatId = getChatId();
        const snaps = getSnapshots(chatId);
        if (snaps.length > v) setSnapshots(chatId, snaps.slice(-v));
    });

    $('#enaennTracker_toggleOverlayBtn').on('click', () => toggleOverlay());

    $('#enaennTracker_refreshBtn').on('click', () => updateTracker());
    $('#enaennTracker_regenBtn').on('click', async () => { await deleteLastTracker(); });
    $('#enaennTracker_clearBtn').on('click', () => {
        const chatId = getChatId();
        setSnapshots(chatId, []);
        updateOverlayContent(chatId);
        toastr.info('Tracker state cleared for this chat.');
    });
}

// ─── TOOLBAR BUTTON ──────────────────────────────────────────────────────────

function addToolbarButton() {
    if ($('#enaennTracker_toolbarBtn').length) return;
    const $btn = $(`<div id="enaennTracker_toolbarBtn" title="Toggle enaennTracker overlay" class="interactable">📊</div>`);
    $btn.on('click', () => toggleOverlay());
    $('#send_but_sheld').prepend($btn);
}

// ─── INIT ────────────────────────────────────────────────────────────────────

jQuery(async () => {
    initSettings();
    createOverlay();

    if (S().overlayVisible) toggleOverlay(true);

    $('#enaennTracker_enabled').prop('checked',   S().enabled);
    $('#enaennTracker_autoUpdate').prop('checked', S().autoUpdate);
    $('#enaennTracker_ctxSize').val(S().contextMessages);
    $('#enaennTracker_windowSize').val(S().windowSize);

    $('#extensions_settings2').append(SETTINGS_HTML);
    bindUI();
    addToolbarButton();

    const chatId = getChatId();
    updateOverlayContent(chatId);

    // ─── CONTEXT INJECTION ────────────────────────────────────────────────
    eventSource.on(event_types.GENERATE_AFTER_COMBINE_PROMPTS, (args) => {
        if (!S().enabled) return;
        const chatId = getChatId();
        const injection = getInjectionText(chatId);
        if (!injection) return;

        if (args && typeof args === 'object') {
            if (args.prompt !== undefined) {
                args.prompt += injection;
            } else if (args.messages !== undefined && Array.isArray(args.messages)) {
                let insertIdx = args.messages.length;
                for (let i = args.messages.length - 1; i >= 0; i--) {
                    if (args.messages[i].role === 'user') { insertIdx = i; break; }
                }
                args.messages.splice(insertIdx, 0, { role: 'system', content: injection.trim() });
            }
        }
    });

    // ─── AUTO‑UPDATE AFTER REPLY ──────────────────────────────────────────
    eventSource.on(event_types.MESSAGE_RECEIVED, async () => {
        if (S().enabled && S().autoUpdate) {
            await new Promise(r => setTimeout(r, 700));
            await updateTracker();
        }
    });

    // ─── CHAT CHANGED: reset display, but don't auto‑generate ────────────
    eventSource.on(event_types.CHAT_CHANGED, async () => {
        const chatId = getChatId();
        updateOverlayContent(chatId);
        if (S().overlayVisible) toggleOverlay(true);
    });

    console.log('[enaennTracker] Loaded successfully (overlay mode).');
});
