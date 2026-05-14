'use strict';

// ─── STATIC IMPORTS ───────────────────────────────────────────────────────────
// Only exports confirmed stable across ST versions.
// addOneMessage is loaded dynamically in init() to avoid crash-on-missing-export.
import {
    eventSource,
    event_types,
    saveSettingsDebounced,
    chat,
} from '../../../../script.js';

import {
    extension_settings,
} from '../../../extensions.js';

// Filled in during init via dynamic import (safe — returns undefined if not exported)
let _addOneMessage = null;

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

// ─── TRACKER CSS ──────────────────────────────────────────────────────────────
const TRACKER_CSS = `
@keyframes enaenn-fade {
    from { opacity: 0; transform: translateY(-5px); }
    to { opacity: 1; transform: translateY(0); }
}

.enaenn-tracker-block {
    width: 100% !important;
    display: block;
    box-sizing: border-box;
    margin: 10px 0 !important;
    padding: 0 !important;
    font: 12px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: var(--SmartThemeBodyColor);
}

.enaenn-tracker {
    width: 100% !important;
    display: block;
    box-sizing: border-box;
    margin: 0 !important;
    padding: 0 !important;
    background: rgba(128, 128, 128, 0.03);
    background: color-mix(in srgb, var(--SmartThemeBodyColor) 2%, transparent);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid color-mix(in srgb, var(--SmartThemeBodyColor) 15%, transparent);
    border-radius: 20px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.05);
    position: relative;
    overflow: hidden;
}

.enaenn-tracker::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--SmartThemeBodyColor) 45%, transparent), transparent);
    pointer-events: none;
}

.enaenn-tracker > summary {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    width: 100%;
    box-sizing: border-box;
    padding: 14px 18px;
    margin: 0;
    list-style: none;
    cursor: pointer;
    font-weight: 800;
    opacity: 0.9;
    outline: none;
    transition: all 0.25s ease;
}

.enaenn-tracker > summary::-webkit-details-marker,
.enaenn-card > summary::-webkit-details-marker {
    display: none;
}

.enaenn-tracker > summary:hover {
    background: color-mix(in srgb, var(--SmartThemeBodyColor) 4%, transparent);
}

.enaenn-tracker[open] > summary {
    border-bottom: 1px solid color-mix(in srgb, var(--SmartThemeBodyColor) 10%, transparent);
}

.enaenn-tracker-summary span {
    display: flex;
    align-items: center;
    gap: 8px;
}

.enaenn-summary-chip,
.enaenn-pill {
    flex-shrink: 0;
    padding: 2px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--SmartThemeBodyColor) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--SmartThemeBodyColor) 12%, transparent);
    font-size: 0.82em;
    font-weight: 800;
    opacity: 0.9;
}

.enaenn-tracker-content {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    animation: enaenn-fade 0.35s ease;
}

.enaenn-section,
.enaenn-card,
.enaenn-agent-card,
.enaenn-rel-card {
    background: color-mix(in srgb, var(--SmartThemeBodyColor) 3%, transparent);
    border: 1px solid color-mix(in srgb, var(--SmartThemeBodyColor) 9%, transparent);
    border-radius: 14px;
    box-sizing: border-box;
}

.enaenn-section { padding: 12px; }

.enaenn-section-title,
.enaenn-card-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    font-size: 0.92em;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    font-weight: 900;
    opacity: 0.82;
}

.enaenn-section-title i,
.enaenn-card-title i { opacity: 0.7; }

.enaenn-text {
    margin: 0;
    line-height: 1.45;
    opacity: 0.9;
}

.enaenn-empty {
    padding: 10px 12px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--SmartThemeBodyColor) 4%, transparent);
    border: 1px dashed color-mix(in srgb, var(--SmartThemeBodyColor) 14%, transparent);
    opacity: 0.65;
    font-style: italic;
}

.enaenn-agent-card {
    padding: 12px;
    margin-top: 10px;
}

.enaenn-agent-head {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding-bottom: 10px;
    margin-bottom: 10px;
    border-bottom: 1px solid color-mix(in srgb, var(--SmartThemeBodyColor) 8%, transparent);
}

.enaenn-agent-name {
    font-size: 1.25em;
    font-weight: 900;
    letter-spacing: 0.3px;
}

.enaenn-agent-attire {
    opacity: 0.75;
    line-height: 1.35;
}

.enaenn-vitals {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(135px, 1fr));
    gap: 6px;
}

.enaenn-vital {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 7px 9px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--SmartThemeBodyColor) 4%, transparent);
    border: 1px solid color-mix(in srgb, var(--SmartThemeBodyColor) 7%, transparent);
}

.enaenn-vital-label {
    flex-shrink: 0;
    font-weight: 800;
    opacity: 0.8;
}

.enaenn-vital-value {
    min-width: 0;
    text-align: right;
    font-weight: 800;
    opacity: 0.95;
    word-break: break-word;
}

.enaenn-impulse,
.enaenn-condition {
    display: flex;
    gap: 8px;
    align-items: baseline;
    margin-top: 9px;
    padding: 8px 10px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--SmartThemeBodyColor) 3%, transparent);
    border: 1px solid color-mix(in srgb, var(--SmartThemeBodyColor) 7%, transparent);
    line-height: 1.35;
}

.enaenn-impulse span,
.enaenn-condition span:first-child {
    flex-shrink: 0;
    font-weight: 900;
    opacity: 0.75;
}

.enaenn-card {
    padding: 0;
    overflow: hidden;
}

.enaenn-card > summary {
    padding: 12px;
    margin: 0;
    cursor: pointer;
    list-style: none;
}

.enaenn-card[open] > summary {
    border-bottom: 1px solid color-mix(in srgb, var(--SmartThemeBodyColor) 8%, transparent);
}

.enaenn-card-title { margin-bottom: 0; }

.enaenn-offscreen-row {
    padding: 12px;
    border-bottom: 1px solid color-mix(in srgb, var(--SmartThemeBodyColor) 7%, transparent);
}

.enaenn-offscreen-row:last-child { border-bottom: none; }

.enaenn-offscreen-main {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    align-items: center;
    margin-bottom: 6px;
}

.enaenn-offscreen-main span {
    opacity: 0.72;
    font-size: 0.9em;
}

.enaenn-offscreen-row p {
    margin: 0 0 8px 0;
    line-height: 1.4;
    opacity: 0.86;
}

.enaenn-offscreen-vitals {
    padding: 8px 10px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--SmartThemeBodyColor) 4%, transparent);
    border: 1px solid color-mix(in srgb, var(--SmartThemeBodyColor) 7%, transparent);
    font-size: 0.9em;
    line-height: 1.35;
    opacity: 0.78;
}

.enaenn-rel-card {
    padding: 12px;
    margin-top: 10px;
}

.enaenn-rel-title {
    font-size: 1.15em;
    font-weight: 900;
    padding-bottom: 9px;
    margin-bottom: 10px;
    border-bottom: 1px solid color-mix(in srgb, var(--SmartThemeBodyColor) 8%, transparent);
}

.enaenn-rel-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 10px;
}

.enaenn-rel-group-title {
    font-size: 0.86em;
    text-transform: uppercase;
    letter-spacing: 0.7px;
    font-weight: 900;
    opacity: 0.65;
}

.enaenn-rel-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(90px, auto);
    gap: 8px;
    align-items: center;
    padding: 7px 9px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--SmartThemeBodyColor) 4%, transparent);
    border: 1px solid color-mix(in srgb, var(--SmartThemeBodyColor) 7%, transparent);
}

.enaenn-change {
    opacity: 0.7;
    font-size: 0.9em;
    text-align: right;
}

.enaenn-rel-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding-top: 10px;
    border-top: 1px solid color-mix(in srgb, var(--SmartThemeBodyColor) 8%, transparent);
}

.enaenn-rel-meta span {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 9px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--SmartThemeBodyColor) 4%, transparent);
    border: 1px solid color-mix(in srgb, var(--SmartThemeBodyColor) 7%, transparent);
    opacity: 0.82;
}

.enaenn-plans {
    margin: 0;
    padding-left: 1.2em;
    line-height: 1.45;
}

.enaenn-plans li { margin: 4px 0; }

.enaenn-tracker-archived {
    width: 100%;
    box-sizing: border-box;
    margin: 8px 0;
    padding: 10px 12px;
    border-radius: 14px;
    background: color-mix(in srgb, var(--SmartThemeBodyColor) 3%, transparent);
    border: 1px dashed color-mix(in srgb, var(--SmartThemeBodyColor) 14%, transparent);
    opacity: 0.6;
    font-size: 0.9em;
    text-align: center;
}

@media (max-width: 500px) {
    .enaenn-tracker > summary {
        flex-direction: column;
        align-items: flex-start;
    }

    .enaenn-rel-row { grid-template-columns: 1fr; }
    .enaenn-change { text-align: left; }
    .enaenn-offscreen-main {
        flex-direction: column;
        align-items: flex-start;
    }
}
`;

// ─── TRACKER SYSTEM PROMPT ────────────────────────────────────────────────────
const TRACKER_SYSTEM_PROMPT = `You are a silent background tracker for a collaborative roleplay session. Your ONLY job is to read the previous tracker state and the most recent chat messages, then output an updated tracker block.

STRICT OUTPUT RULES:

- Output ONLY the tracker block. No preamble, no explanation, no commentary before or after.
- Output valid HTML only.
- Do NOT use Markdown headings, hash-style headings, code fences, asterisks for styling, or plain Markdown tables.
- Wrap your entire output in exactly one root element: <div class="enaenn-tracker-block"> ... </div>
- Use the HTML structure below. Fill in values; do NOT include bracketed instructions in the output.
- The tracker content must stay the same kind of information as before. Only the visual formatting is HTML.
- Do NOT reproduce these system instructions in your output.
- If no previous tracker state is provided, initialize a fresh one from the chat context.

════════════════════════════════════════
TRACKER HTML TEMPLATE
════════════════════════════════════════

<div class="enaenn-tracker-block">
  <details class="enaenn-tracker" open>
    <summary class="enaenn-tracker-summary">
      <span><i class="fa-solid fa-clipboard-list"></i> Roleplay Tracker</span>
      <span class="enaenn-summary-chip">Updated State</span>
    </summary>

    <div class="enaenn-tracker-content">

      <section class="enaenn-section">
        <div class="enaenn-section-title"><i class="fa-solid fa-location-dot"></i><span>Where are we?</span></div>
        <p class="enaenn-text">Concise 1-sentence description of agents' spatial positions.</p>
      </section>

      <section class="enaenn-section">
        <div class="enaenn-section-title"><i class="fa-solid fa-users"></i><span>Agents Present</span></div>

        If user is alone, output exactly this:
        <div class="enaenn-empty">No agents present.</div>

        Otherwise repeat this card for every present agent. USER IS NOT AN AGENT — never include them here.
        <div class="enaenn-agent-card">
          <div class="enaenn-agent-head">
            <span class="enaenn-agent-name">♀️/♂️ Name</span>
            <span class="enaenn-agent-attire">State &amp; Attire: Outfit and its state, concisely.</span>
          </div>

          <div class="enaenn-vitals">
            <div class="enaenn-vital"><span class="enaenn-vital-label">🍴 Food</span><span class="enaenn-vital-value">0-100% plus change</span></div>
            <div class="enaenn-vital"><span class="enaenn-vital-label">😴 Energy</span><span class="enaenn-vital-value">0-100% plus change</span></div>
            <div class="enaenn-vital"><span class="enaenn-vital-label">🚿 Clean</span><span class="enaenn-vital-value">0-100% plus change</span></div>
            <div class="enaenn-vital"><span class="enaenn-vital-label">🚽 Bladder</span><span class="enaenn-vital-value">0-100% plus change</span></div>
            <div class="enaenn-vital"><span class="enaenn-vital-label">💧 Thirst</span><span class="enaenn-vital-value">0-100% plus change</span></div>
            <div class="enaenn-vital"><span class="enaenn-vital-label">🔥 Arousal</span><span class="enaenn-vital-value">0-200% plus change</span></div>
            <div class="enaenn-vital"><span class="enaenn-vital-label">🧠 Stress</span><span class="enaenn-vital-value">0-100% plus change</span></div>
          </div>

          <div class="enaenn-impulse"><span>🎯 Active impulse:</span><strong>Active impulse.</strong></div>
          <div class="enaenn-condition"><span>🩹 Condition:</span><span>Injuries, intoxication, illness, pain, medication, temperature discomfort, or None noted.</span></div>
        </div>
      </section>

      <details class="enaenn-card enaenn-offscreen" open>
        <summary class="enaenn-card-title"><i class="fa-solid fa-earth-americas"></i><span>Off-screen Agents</span></summary>

        Only agents who have a relationship with the user. Otherwise output:
        <div class="enaenn-empty">No relevant off-screen agents.</div>

        Otherwise repeat this for each relevant off-screen agent.
        <div class="enaenn-offscreen-row">
          <div class="enaenn-offscreen-main"><strong>♂️/♀️ Name</strong><span>📍 Location</span></div>
          <p>What they are doing right now.</p>
          <div class="enaenn-offscreen-vitals">🍴 hungry/fine/full | 😴 exhausted/fine/rested | 🚿 smelly/fine/fresh | 🚽 fine/pressing/urgent | 💧 fine/thirsty/dehydrated | 🔥 none/simmering/high/sexual activity | 🧠 calm/tense/stressed</div>
          <div class="enaenn-impulse"><span>🎯 Active impulse:</span><strong>Active impulse.</strong></div>
        </div>
      </details>

      <section class="enaenn-section">
        <div class="enaenn-section-title"><i class="fa-solid fa-heart"></i><span>Relationship Matrix</span></div>

        Repeat this relationship card for every tracked relationship.
        <div class="enaenn-rel-card">
          <div class="enaenn-rel-title">Name → Target</div>

          <div class="enaenn-rel-group">
            <div class="enaenn-rel-group-title">Main</div>
            <div class="enaenn-rel-row"><span>Emoji Feeling</span><span class="enaenn-pill">Value/1000</span><span class="enaenn-change">+/-N from action</span></div>
          </div>

          <div class="enaenn-rel-group">
            <div class="enaenn-rel-group-title">In The Moment</div>
            <div class="enaenn-rel-row"><span>Emoji TempFeeling1</span><span class="enaenn-pill">Value/100</span><span class="enaenn-change">+/-N from action</span></div>
            <div class="enaenn-rel-row"><span>Emoji TempFeeling2</span><span class="enaenn-pill">Value/100</span><span class="enaenn-change">+/-N from action</span></div>
          </div>

          <div class="enaenn-rel-meta">
            <span><i class="fa-solid fa-clock"></i> Known for: AgentName ↔ User: Time since first meeting</span>
            <span><i class="fa-solid fa-link"></i> Stage: e.g. Strangers, Growing Friendship</span>
          </div>
        </div>
      </section>

      <section class="enaenn-section">
        <div class="enaenn-section-title"><i class="fa-solid fa-calendar-days"></i><span>Future Plans</span></div>
        <ul class="enaenn-plans"><li><strong>day, month</strong> — Concise note of upcoming agreed events, chronological.</li></ul>
      </section>

    </div>
  </details>
</div>

════════════════════════════════════════
VITAL TRACKING GUIDELINES
════════════════════════════════════════

VITAL POLARITIES — do NOT confuse these:

  LOW = critical: 🍴 food satiation | 😴 energy | 🚿 cleanliness

  HIGH = critical: 💧 thirst | 🔥 arousal | 🚽 bladder | 🧠 stress

VITAL RATES per 5 min / per hour:

  🍴 decay -0.2–0.4% / -2.4–4.8%. Meal: +60–80%. Snack: +10–17%.

  😴 decay -0.25–0.33% / -3–4% normal; -0.4–0.6% / -5–7% strenuous.
      Sleep restores +10–15%/hr. At 100% → wake unless less than 6 hr slept at night, then continue for circadian realism. Never use sleep as scene-closer.

  🚿 decay -0.05–0.15% / -0.6–1.8%, multiplied by 3–4 during exertion, heat, or dirt.
      Shower: +95–100%. Quick wash: +5–10%. Clean clothes: +3–5%.

  💧/🚽 rise +0.3–0.7% / +4–8%. Glass of water: 💧 −45–55%, 🚽 +8–12%. Bottle: 💧 −100%, 🚽 +20–25%.

  🧠 decay -0.3–0.5% / -3.6–6% during restful, positive, or sleep. Rises from unmet needs, friction, danger. If 🧠 > 75% → agent seeks stress relief.

  🔥 build +2–8%/5min. Decay with no stimulus about -0.5%/5min. Values >100% = sexual activity only. 200% = climax.

NEED PRIORITY when critical: 🚽 > 💧 > 🍴 > 😴 > 🚿.

DISPLAY every change, e.g. "55.8% (−0.2%)", for every vital of every present agent.

🩹 CONDITION: Track injuries, intoxication, illness, pain, medication, temperature discomfort. Affects vitals and behavior.

RELATIONSHIP MATRIX RULES:

  Main feeling 0–1000: develops slowly. Max +10 pts/in-game day unless major event. Naturally evolves at 0 or 1000.

  In The Moment 0–100, max 4 feelings: tied to current events.
    At 100 or 0 → transform into natural successor/predecessor.
    Negative transformation → deduct 1–20 from Main. Positive → add 1–5 to Main.

  Off-screen agents: keep only Main feeling + status + known for.

  Avoidant agents: 🧠 +10–15/day after 48 hr sustained proximity.

  Choose feeling words as the AGENT would define them.`;

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

const S = () => extension_settings[MODULE_NAME];

const save = (patch = {}) => {
    Object.assign(extension_settings[MODULE_NAME], patch);
    saveSettingsDebounced();
};

function getActiveProfile() {
    const idx = S().activeProfileIndex;
    if (idx < 0 || idx >= S().profiles.length) return null;
    return S().profiles[idx];
}

// ─── HTML / STYLE HELPERS ────────────────────────────────────────────────────
function injectTrackerStyles() {
    if ($('#enaenn-tracker-styles').length) return;
    $('head').append(`<style id="enaenn-tracker-styles">${TRACKER_CSS}</style>`);
}

function cleanTrackerOutput(content) {
    return String(content || '')
        .replace(/```html/gi, '')
        .replace(/```/g, '')
        .trim();
}

function normalizeTrackerOutput(content) {
    const cleaned = cleanTrackerOutput(content);
    return cleaned.includes('enaenn-tracker-block')
        ? cleaned
        : `<div class="enaenn-tracker-block">${cleaned}</div>`;
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

    m.mes = m.extra.fullContent || m.mes;
    m.extra.archived = false;
    $(`#chat .mes[mesid="${idx}"]`).find('.mes_text').html(m.mes);
}

async function enforceWindow() {
    const indices = getTrackerIndices();
    if (indices.length === 0) return;

    const cutoff = Math.max(0, indices.length - S().windowSize);
    const toArchive = indices.slice(0, cutoff);
    const toRestore = indices.slice(cutoff);

    for (const idx of toArchive) {
        if (!chat[idx]?.extra?.archived) archiveTrackerAt(idx);
    }

    for (const idx of toRestore) {
        if (chat[idx]?.extra?.archived) restoreTrackerAt(idx);
    }
}

// ─── TRACKER API CALL ─────────────────────────────────────────────────────────
async function callTrackerAPI() {
    const profile = getActiveProfile();

    if (!profile) {
        toastr.warning('enaennTracker: No API profile selected. Open Extensions → enaennTracker.');
        return null;
    }

    if (!profile.endpoint || !profile.model) {
        toastr.warning('enaennTracker: Active profile is missing Endpoint URL or Model name.');
        return null;
    }

    const recentRoleplay = chat
        .filter(m => !m.extra?.[TRACKER_FLAG])
        .slice(-(S().contextMessages));

    const chatText = recentRoleplay
        .map(m => `${m.name || (m.is_user ? 'User' : 'Character')}: ${m.mes || ''}`)
        .join('\n\n');

    const prevState = S().lastTracker
        ? `PREVIOUS TRACKER STATE:\n${S().lastTracker}`
        : 'No previous tracker state. Initialize a fresh one from the chat context.';

    const userMessage =
        `${prevState}\n\n---\n\n` +
        `RECENT ROLEPLAY (${recentRoleplay.length} messages):\n${chatText}\n\n---\n\n` +
        'Output the updated tracker wrapped in <div class="enaenn-tracker-block">...</div>. Nothing else.';

    try {
        const base = profile.endpoint.replace(/\/+$/, '');
        const response = await fetch(`${base}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(profile.apiKey ? { Authorization: `Bearer ${profile.apiKey}` } : {}),
            },
            body: JSON.stringify({
                model: profile.model,
                messages: [
                    { role: 'system', content: TRACKER_SYSTEM_PROMPT },
                    { role: 'user',   content: userMessage },
                ],
                max_tokens: 2500,
                temperature: 0.2,
                stream: false,
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errText.slice(0, 300)}`);
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content?.trim() ?? null;
    } catch (err) {
        console.error('[enaennTracker]', err);
        toastr.error(`enaennTracker: ${err.message}`);
        return null;
    }
}

// ─── INSERT TRACKER MESSAGE ───────────────────────────────────────────────────
async function insertTrackerMessage(content) {
    const wrapped = normalizeTrackerOutput(content);

    const mesObj = {
        name: 'Tracker',
        is_user: false,
        is_system: false,
        mes: wrapped,
        send_date: new Date().toLocaleString(),
        extra: {
            [TRACKER_FLAG]: true,
            fullContent: wrapped,
            archived: false,
            token_count: 0,
        },
    };

    chat.push(mesObj);
    const mesId = chat.length - 1;

    // Try ST's addOneMessage first (loaded dynamically — null if unavailable)
    if (_addOneMessage) {
        try {
            await _addOneMessage(mesObj, { scroll: true, type: 'narrator' });
            return;
        } catch (e) {
            console.warn('[enaennTracker] addOneMessage threw, falling back to DOM:', e);
        }
    }

    // DOM fallback
    $('#chat').append(`
        <div class="mes" mesid="${mesId}" is_system="false">
            <div class="mes_block">
                <div class="ch_name">
                    <span class="name_text">Tracker</span>
                </div>
                <div class="mes_text">${wrapped}</div>
            </div>
        </div>
    `);

    const $chat = $('#chat');
    $chat.scrollTop($chat[0].scrollHeight);
}

// ─── MAIN UPDATE FLOW ─────────────────────────────────────────────────────────
let _updating = false;

async function updateTracker() {
    if (_updating) return;
    if (!S().enabled) return;

    _updating = true;
    setLoadingState(true);

    const result = await callTrackerAPI();

    setLoadingState(false);
    _updating = false;

    if (!result) return;

    const wrapped = normalizeTrackerOutput(result);

    save({ lastTracker: wrapped });
    await insertTrackerMessage(wrapped);
    await enforceWindow();

    toastr.success('Tracker updated!', '', { timeOut: 1500 });
}

// ─── UI ───────────────────────────────────────────────────────────────────────
function setLoadingState(loading) {
    $('#enaennTracker_refreshBtn')
        .prop('disabled', loading)
        .text(loading ? '⏳ Updating…' : '🔄 Refresh Tracker');

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

    $('#enaennTracker_pName').val(p.name || '');
    $('#enaennTracker_pEndpoint').val(p.endpoint || '');
    $('#enaennTracker_pKey').val(p.apiKey || '');
    $('#enaennTracker_pModel').val(p.model || '');
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

      <div class="flex-container flexGap5 enaenn-gap">
        <select id="enaennTracker_profileSelect" class="text_pole flex1"></select>
        <button id="enaennTracker_addProfile" class="menu_button" title="New profile">➕</button>
        <button id="enaennTracker_deleteProfile" class="menu_button" title="Delete selected">🗑️</button>
      </div>

      <div id="enaennTracker_profileEditor">
        <div class="editor-title">Edit Profile</div>
        <label>Name</label>
        <input type="text" id="enaennTracker_pName" class="text_pole" placeholder="e.g. Longcat" />

        <label>Endpoint URL</label>
        <input type="text" id="enaennTracker_pEndpoint" class="text_pole" placeholder="https://api.openai.com/v1" />

        <label>API Key <small>(leave blank if not needed)</small></label>
        <input type="password" id="enaennTracker_pKey" class="text_pole" placeholder="sk-..." />

        <label>Model name</label>
        <input type="text" id="enaennTracker_pModel" class="text_pole" placeholder="gpt-4o-mini" />

        <button id="enaennTracker_saveProfile" class="menu_button" style="margin-top:8px;">💾 Save Profile</button>
      </div>

      <hr />

      <div class="flex-container flexGap5">
        <button id="enaennTracker_refreshBtn" class="menu_button flex1">🔄 Refresh Tracker</button>
        <button id="enaennTracker_clearBtn" class="menu_button" title="Clears saved tracker state. Next refresh starts fresh.">🗑️ Clear State</button>
      </div>
    </div>
  </div>
</div>`;

function bindUI() {
    $('#enaennTracker_enabled').on('change', function () {
        save({ enabled: this.checked });
    });

    $('#enaennTracker_autoUpdate').on('change', function () {
        save({ autoUpdate: this.checked });
    });

    $('#enaennTracker_ctxSize').on('change', function () {
        save({ contextMessages: Math.max(5, parseInt(this.value) || 20) });
    });

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
        const newIdx = profiles.length === 0 ? -1 : Math.min(idx, profiles.length - 1);

        save({ profiles, activeProfileIndex: newIdx });
        refreshProfileSelect();
        refreshProfileEditor();
    });

    $('#enaennTracker_saveProfile').on('click', () => {
        const idx = S().activeProfileIndex;
        if (idx < 0) return;

        const profiles = [...S().profiles];
        profiles[idx] = {
            name: $('#enaennTracker_pName').val().trim() || 'Unnamed',
            endpoint: $('#enaennTracker_pEndpoint').val().trim(),
            apiKey: $('#enaennTracker_pKey').val().trim(),
            model: $('#enaennTracker_pModel').val().trim(),
        };

        save({ profiles });
        refreshProfileSelect();
        toastr.success('Profile saved!');
    });

    $('#enaennTracker_refreshBtn').on('click', () => updateTracker());

    $('#enaennTracker_clearBtn').on('click', () => {
        save({ lastTracker: '' });
        toastr.info('Tracker state cleared. Next refresh will start fresh.');
    });
}

function addToolbarButton() {
    if ($('#enaennTracker_toolbarBtn').length) return;

    const $btn = $('<div id="enaennTracker_toolbarBtn" title="Refresh enaennTracker" class="interactable">🔄</div>');
    $btn.on('click', () => updateTracker());
    $('#send_but_sheld').prepend($btn);
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
jQuery(async () => {
    initSettings();
    injectTrackerStyles();

    // Try to load addOneMessage dynamically — safe, won't crash if missing
    try {
        const mod = await import('../../../../script.js');
        _addOneMessage = mod.addOneMessage ?? null;

        console.log(_addOneMessage
            ? '[enaennTracker] addOneMessage loaded.'
            : '[enaennTracker] addOneMessage not found, using DOM fallback.');
    } catch (e) {
        console.warn('[enaennTracker] Dynamic import failed:', e);
    }

    $('#extensions_settings2').append(SETTINGS_HTML);

    $('#enaennTracker_enabled').prop('checked', S().enabled);
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
    });

    console.log('[enaennTracker] Loaded successfully.');
});
