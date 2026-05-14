/**
 * enaennTracker — SillyTavern Extension
 *
 * After each AI reply, calls a separate OpenAI-compatible API to update
 * the roleplay tracker. Inserts the result as a real chat message so the
 * main model can see it. Keeps only the most recent N snapshots as full
 * content; older ones are archived to a tiny placeholder to save tokens.
 *
 * Install path: SillyTavern/public/extensions/third-party/enaennTracker/
 */

'use strict';

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
const MODULE_NAME = 'enaennTracker';
const TRACKER_FLAG = 'enaenn_tracker';
const DEFAULT_SETTINGS = {
    enabled: true,
    autoUpdate: true,
    profiles: [],
    activeProfileIndex: -1,
    lastTracker: '',
    contextMessages: 20,
    windowSize: 7,
};

// ─── TRACKER STYLES (injected once into <head>) ───────────────────────────────
const TRACKER_CSS = `
.enaenn-tracker-block{
    width:100%!important; display:block; box-sizing:border-box;
    margin:12px 0!important;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    font-size:12.5px; color:var(--SmartThemeBodyColor);
}
.enaenn-tracker-block * { box-sizing:border-box; }
.ent-cont{
    width:100%; display:block; margin:0; padding:0;
    background:color-mix(in srgb,var(--SmartThemeBodyColor) 2%,transparent);
    backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
    border:1px solid color-mix(in srgb,var(--SmartThemeBodyColor) 18%,transparent);
    border-radius:20px;
    box-shadow:0 8px 32px rgba(0,0,0,0.06);
    position:relative; overflow:hidden; transition:all .3s ease;
}
.ent-cont::before{
    content:''; position:absolute; top:0; left:0; right:0; height:1px;
    background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--SmartThemeBodyColor) 45%,transparent),transparent);
    pointer-events:none;
}
.ent-top{
    display:flex; justify-content:space-between; align-items:center;
    flex-wrap:wrap; gap:12px;
    padding:12px 18px; margin:0;
    font-weight:700; opacity:.9; font-size:.95em;
    cursor:pointer; list-style:none; outline:none;
}
.ent-top::-webkit-details-marker{ display:none; }
.ent-cont[open] .ent-top{
    border-bottom:1px solid color-mix(in srgb,var(--SmartThemeBodyColor) 12%,transparent);
}
.ent-top span{ display:flex; align-items:center; gap:6px; white-space:nowrap; }
.ent-content{
    display:flex; flex-direction:column; gap:14px;
    padding:16px; animation:ent-fade .4s ease;
}
.ent-section{
    background:color-mix(in srgb,var(--SmartThemeBodyColor) 3%,transparent);
    border:1px solid color-mix(in srgb,var(--SmartThemeBodyColor) 10%,transparent);
    border-radius:14px; padding:12px;
    display:flex; flex-direction:column; gap:8px;
}
.ent-h{
    font-size:.82em; text-transform:uppercase; letter-spacing:.6px;
    font-weight:800; opacity:.78;
    display:flex; align-items:center; gap:8px;
    padding-bottom:6px;
    border-bottom:1px solid color-mix(in srgb,var(--SmartThemeBodyColor) 10%,transparent);
}
.ent-scene{
    font-family:'Georgia',serif; font-style:italic;
    font-size:.95em; opacity:.88; line-height:1.45;
    padding-left:10px;
    border-left:2px solid color-mix(in srgb,var(--SmartThemeBodyColor) 45%,transparent);
}
/* Agents grid */
.ent-agents{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
@media(max-width:520px){ .ent-agents{ grid-template-columns:1fr; } }
.ent-agent{
    background:color-mix(in srgb,var(--SmartThemeBodyColor) 4%,transparent);
    border:1px solid color-mix(in srgb,var(--SmartThemeBodyColor) 10%,transparent);
    border-radius:12px; padding:10px;
    display:flex; flex-direction:column; gap:6px;
}
.ent-agent-name{
    font-size:1.05em; font-weight:800; opacity:.95;
    display:flex; align-items:center; gap:6px; flex-wrap:wrap;
}
.ent-agent-attire{
    font-size:.88em; opacity:.75; line-height:1.35;
}
.ent-vitals{
    display:flex; flex-wrap:wrap; gap:4px;
    padding:6px 8px;
    background:color-mix(in srgb,var(--SmartThemeBodyColor) 5%,transparent);
    border-radius:8px; font-size:.82em;
}
.ent-vital{
    padding:2px 6px;
    background:color-mix(in srgb,var(--SmartThemeBodyColor) 8%,transparent);
    border-radius:6px; font-weight:600; white-space:nowrap;
}
.ent-impulse{
    font-size:.88em; opacity:.85;
    display:flex; align-items:center; gap:6px;
    padding-top:4px;
    border-top:1px dashed color-mix(in srgb,var(--SmartThemeBodyColor) 12%,transparent);
}
.ent-impulse i{ opacity:.7; }
/* Collapsible card (off-screen agents, etc.) */
.ent-card{
    background:color-mix(in srgb,var(--SmartThemeBodyColor) 3%,transparent);
    border:1px solid color-mix(in srgb,var(--SmartThemeBodyColor) 10%,transparent);
    border-radius:12px; padding:10px;
    display:flex; flex-direction:column; gap:6px;
}
.ent-card-h{
    font-size:.85em; text-transform:uppercase; font-weight:800; opacity:.75;
    display:flex; align-items:center; gap:8px;
    cursor:pointer; list-style:none; outline:none;
}
.ent-card-h::-webkit-details-marker{ display:none; }
.ent-card-h::after{
    content:'\\f078'; font-family:'Font Awesome 6 Free'; font-weight:900;
    margin-left:auto; font-size:.78em; opacity:.7; transition:transform .2s;
}
.ent-card[open] .ent-card-h{
    padding-bottom:6px; margin-bottom:4px;
    border-bottom:1px solid color-mix(in srgb,var(--SmartThemeBodyColor) 10%,transparent);
}
.ent-card[open] .ent-card-h::after{ transform:rotate(180deg); }
.ent-offscreen-row{
    font-size:.88em; line-height:1.4; opacity:.9;
    padding:4px 0;
    border-bottom:1px solid color-mix(in srgb,var(--SmartThemeBodyColor) 5%,transparent);
}
.ent-offscreen-row:last-child{ border-bottom:none; }
/* Relationship Matrix */
.ent-matrix{
    display:flex; flex-direction:column; gap:8px;
}
.ent-matrix-card{
    background:color-mix(in srgb,var(--SmartThemeBodyColor) 4%,transparent);
    border:1px solid color-mix(in srgb,var(--SmartThemeBodyColor) 10%,transparent);
    border-radius:10px; padding:10px;
    display:flex; flex-direction:column; gap:6px;
    font-size:.88em; line-height:1.4;
}
.ent-matrix-title{
    font-weight:800; opacity:.95;
    display:flex; align-items:center; gap:6px;
    padding-bottom:4px;
    border-bottom:1px solid color-mix(in srgb,var(--SmartThemeBodyColor) 8%,transparent);
}
.ent-matrix-sub{
    font-size:.78em; text-transform:uppercase; letter-spacing:.4px;
    font-weight:700; opacity:.6; margin-top:4px;
}
.ent-matrix-row{
    display:flex; align-items:baseline; gap:6px; flex-wrap:wrap;
    padding:2px 0;
}
.ent-matrix-row .lbl{ font-weight:700; opacity:.85; }
.ent-matrix-row .delta{ opacity:.6; font-size:.85em; font-style:italic; }
.ent-matrix-tag{
    display:inline-block; padding:2px 8px;
    background:color-mix(in srgb,var(--SmartThemeBodyColor) 10%,transparent);
    border-radius:8px; font-size:.85em; font-weight:700;
}
/* Future plans */
.ent-plans{
    list-style:none; margin:0; padding:0;
    display:flex; flex-direction:column; gap:6px;
}
.ent-plans li{
    display:flex; gap:8px; align-items:baseline;
    font-size:.9em; line-height:1.4;
    padding:4px 8px;
    background:color-mix(in srgb,var(--SmartThemeBodyColor) 4%,transparent);
    border-left:2px solid color-mix(in srgb,var(--SmartThemeBodyColor) 35%,transparent);
    border-radius:6px;
}
.ent-plans li i{ opacity:.7; }
.ent-plans .date{ font-weight:800; opacity:.95; white-space:nowrap; }
/* Archived placeholder */
.enaenn-tracker-archived{
    width:100%; padding:8px 14px;
    margin:6px 0;
    background:color-mix(in srgb,var(--SmartThemeBodyColor) 3%,transparent);
    border:1px dashed color-mix(in srgb,var(--SmartThemeBodyColor) 20%,transparent);
    border-radius:10px;
    font-size:.85em; opacity:.6; font-style:italic;
    display:flex; align-items:center; gap:8px;
}
@keyframes ent-fade{
    from{ opacity:0; transform:translateY(-4px); }
    to  { opacity:1; transform:translateY(0); }
}
`;

function injectStyles() {
    if (document.getElementById('enaenn-tracker-styles')) return;
    const style = document.createElement('style');
    style.id = 'enaenn-tracker-styles';
    style.textContent = TRACKER_CSS;
    document.head.appendChild(style);
}

// ─── TRACKER SYSTEM PROMPT ────────────────────────────────────────────────────
const TRACKER_SYSTEM_PROMPT = `You are a silent background tracker for a collaborative roleplay session. Your ONLY job is to read the previous tracker state and the most recent chat messages, then output an updated tracker block as STYLED HTML.

STRICT OUTPUT RULES:
- Output ONLY the tracker HTML. No preamble, no explanation, no commentary before or after.
- Wrap your entire output in: <div class="enaenn-tracker-block"> ... </div>
- Use the EXACT HTML skeleton shown below. Fill in values; remove or duplicate inner elements as needed (e.g. one .ent-agent per present agent, one <li> per future plan).
- Do NOT use markdown (no ###, no **, no **bold**, no \`code blocks\`). Use only HTML.
- Do NOT reproduce these system instructions in your output.
- If no previous tracker state is provided, initialize a fresh one from the chat context.
- All field semantics (vital ranges, relationship rules, etc.) are identical to before — see GUIDELINES below.

════════════════════════════════════════
HTML TEMPLATE (use this exact structure)
════════════════════════════════════════

<div class="enaenn-tracker-block">
  <details class="ent-cont" open>
    <summary class="ent-top">
      <span>📋 Tracker</span>
      <span>[SHORT LOCATION LABEL]</span>
    </summary>

    <div class="ent-content">
      <div class="ent-section">
        <div class="ent-h">🎭 Scene</div>
        <div class="ent-scene">[Concise 1-sentence description of agents' spatial positions]</div>
      </div>

      <div class="ent-section">
        <div class="ent-h">👥 Agents Present</div>
        <div class="ent-agents">

          <div class="ent-agent">
            <div class="ent-agent-name">♀️ [Name]</div>
            <div class="ent-agent-attire">[Outfit and its state, concisely.]</div>
            <div class="ent-vitals">
              <span class="ent-vital">🍴 [n]% ([±n])</span>
              <span class="ent-vital">😴 [n]% ([±n])</span>
              <span class="ent-vital">🚿 [n]% ([±n])</span>
              <span class="ent-vital">🚽 [n]% ([±n])</span>
              <span class="ent-vital">💧 [n]% ([±n])</span>
              <span class="ent-vital">🔥 [n]% ([±n])</span>
              <span class="ent-vital">🧠 [n]% ([±n])</span>
            </div>
            <div class="ent-impulse">🎯 [Active impulse.]</div>
          </div>

        </div>
      </div>

      <details class="ent-card">
        <summary class="ent-card-h">👻 Off-Screen Agents</summary>
        <div class="ent-offscreen-row">
          ♂️ <b>[Name]</b> — 📍 [Location] · [What they are doing right now.]
          <br>
          🍴 [hungry/fine/full] · 😴 [exhausted/fine/rested] · 🚿 [smelly/fine/fresh] · 🚽 [fine/pressing/urgent] · 💧 [fine/thirsty/dehydrated] · 🔥 [none/simmering/high/sexual activity] · 🧠 [calm/tense/stressed] · 🎯 [Active impulse.]
        </div>
      </details>

      <div class="ent-section">
        <div class="ent-h">💞 Relationship Matrix</div>
        <div class="ent-matrix">

          <div class="ent-matrix-card">
            <div class="ent-matrix-title">[Name] → [Target]</div>
            <div class="ent-matrix-sub">Main</div>
            <div class="ent-matrix-row">
              <span class="lbl">[Emoji] [Feeling]</span>
              <span class="ent-matrix-tag">[Value]/1000</span>
              <span class="delta">(+/-N from [action])</span>
            </div>
            <div class="ent-matrix-sub">In The Moment</div>
            <div class="ent-matrix-row">
              <span class="lbl">[Emoji] [TempFeeling1]</span>
              <span class="ent-matrix-tag">[Value]/100</span>
              <span class="delta">(+/-N from [action])</span>
            </div>
            <div class="ent-matrix-row">
              <span class="lbl">[Emoji] [TempFeeling2]</span>
              <span class="ent-matrix-tag">[Value]/100</span>
              <span class="delta">(+/-N from [action])</span>
            </div>
            <div class="ent-matrix-sub">Known For</div>
            <div class="ent-matrix-row">
              <span class="lbl">[AgentName] ↔ [User]: [Time since first meeting]</span>
            </div>
            <div class="ent-matrix-sub">Stage</div>
            <div class="ent-matrix-row">
              <span class="ent-matrix-tag">[e.g. "Strangers", "Growing Friendship"]</span>
            </div>
          </div>

        </div>
      </div>

      <div class="ent-section">
        <div class="ent-h">📅 Future Plans</div>
        <ul class="ent-plans">
          <li>
            <span class="date">[day, month]</span>
            — [Concise note of upcoming agreed event.]
          </li>
        </ul>
      </div>

    </div>
  </details>
</div>

════════════════════════════════════════
VITAL TRACKING GUIDELINES
════════════════════════════════════════
VITAL POLARITIES — do NOT confuse these:
LOW = critical: 🍴 food satiation | 😴 energy | 🚿 cleanliness
HIGH = critical: 💧 thirst | 🔥 arousal | 🚽 bladder | 🧠 stress

VITAL RATES (per 5 min / per hour):
🍴 decay -0.2–0.4% / -2.4–4.8%. Meal: +60–80%. Snack: +10–17%.
😴 decay -0.25–0.33% / -3–4% (normal); -0.4–0.6% / -5–7% (strenuous).
   Sleep restores +10–15%/hr. At 100% → wake (unless <6 hr slept at night, then continue for circadian realism). Never use sleep as scene-closer.
🚿 decay -0.05–0.15% / -0.6–1.8% (×3–4 during exertion/heat/dirt).
   Shower: +95–100%. Quick wash: +5–10%. Clean clothes: +3–5%.
💧/🚽 rise +0.3–0.7% / +4–8%. Glass of water: 💧 −45–55%, 🚽 +8–12%. Bottle: 💧 −100%, 🚽 +20–25%.
🧠 decay -0.3–0.5% / -3.6–6% during restful/positive/sleep. Rises from unmet needs, friction, danger. If 🧠 > 75% → agent seeks stress relief.
🔥 build +2–8%/5min. Decay (no stimulus) ~-0.5%/5min. Values >100% = sexual activity only. 200% = climax.

NEED PRIORITY when critical: 🚽 > 💧 > 🍴 > 😴 > 🚿.

DISPLAY every change as e.g. "😴 55.8% (−0.2%)" inside the .ent-vital span for every agent.

🩹 CONDITION: Track injuries, intoxication, illness, pain, medication, temperature discomfort. Affects vitals and behavior. If any condition exists, add an extra 🩹 [condition] at the end of that agent's vitals row.

RELATIONSHIP MATRIX RULES:
Main feeling (0–1000): develops slowly. Max +10 pts/in-game day unless major event. Naturally evolves at 0 or 1000.
In The Moment (0–100, max 4 feelings): tied to current events.
At 100 or 0 → transform into natural successor/predecessor.
Negative transformation → deduct 1–20 from Main. Positive → add 1–5 to Main.
Off-screen agents: keep only Main feeling + status + 'known for'.
Avoidant agents: 🧠 +10–15/day after 48 hr sustained proximity.
Choose feeling words as the AGENT would define them.

REMEMBER: Output ONLY the styled HTML block. No markdown. No commentary.`;

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

// ─── CHAT / WINDOW HELPERS ──────────────────────────────────────────────────────
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

// ─── TRACKER API CALL ───────────────────────────────────────────────────────────
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

    const userMessage = `${prevState}\n\n---\n\n` +
        `RECENT ROLEPLAY (${recentRoleplay.length} messages):\n${chatText}\n\n---\n\n` +
        `Output the updated tracker wrapped in <div class="enaenn-tracker-block">...</div>. Styled HTML only — no markdown, no commentary.`;

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
                    { role: 'user', content: userMessage },
                ],
                max_tokens: 2000,
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

// ─── INSERT TRACKER MESSAGE ─────────────────────────────────────────────────────
async function insertTrackerMessage(content) {
    const wrapped = content.includes('enaenn-tracker-block')
        ? content
        : `<div class="enaenn-tracker-block">${content}</div>`;

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

    if (_addOneMessage) {
        try {
            await _addOneMessage(mesObj, { scroll: true, type: 'narrator' });
            return;
        } catch (e) {
            console.warn('[enaennTracker] addOneMessage threw, falling back to DOM:', e);
        }
    }

    $('#chat').append(
        `<div class="mes narrator_mes" mesid="${mesId}">` +
        `<div class="mes_block">` +
        `<div class="ch_name">` +
        `<span class="name_text">Tracker</span>` +
        `</div>` +
        `<div class="mes_text">${wrapped}</div>` +
        `</div>` +
        `</div>`
    );
    const $chat = $('#chat');
    $chat.scrollTop($chat[0].scrollHeight);
}

// ─── MAIN UPDATE FLOW ───────────────────────────────────────────────────────────
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

    const wrapped = result.includes('enaenn-tracker-block')
        ? result
        : `<div class="enaenn-tracker-block">${result}</div>`;

    save({ lastTracker: wrapped });
    await insertTrackerMessage(wrapped);
    await enforceWindow();
    toastr.success('Tracker updated!', '', { timeOut: 1500 });
}

// ─── UI ─────────────────────────────────────────────────────────────────────────
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
<div id="enaennTracker_settings">
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>🔄 enaennTracker</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <div>
                <label>
                    <input type="checkbox" id="enaennTracker_enabled" />
                    Enabled
                </label>
                <br>
                <label>
                    <input type="checkbox" id="enaennTracker_autoUpdate" />
                    Auto-update after each reply
                </label>
            </div>
            <div>
                Roleplay messages → tracker API:
                <input type="number" id="enaennTracker_ctxSize" min="5" max="100" style="width:60px" />
            </div>
            <div>
                Tracker snapshots visible to model:
                <input type="number" id="enaennTracker_windowSize" min="1" max="50" style="width:60px" />
                <small>(older ones archived)</small>
            </div>

            <hr>
            <div><b>API Profiles</b></div>
            <div>
                <select id="enaennTracker_profileSelect" style="width:100%"></select>
                <button id="enaennTracker_addProfile">➕</button>
                <button id="enaennTracker_deleteProfile">🗑️</button>
            </div>

            <div id="enaennTracker_profileEditor" style="display:none">
                <div><b>Edit Profile</b></div>
                <label>Name</label>
                <input type="text" id="enaennTracker_pName" style="width:100%" />
                <label>Endpoint URL</label>
                <input type="text" id="enaennTracker_pEndpoint" placeholder="https://api.example.com/v1" style="width:100%" />
                <label>API Key (leave blank if not needed)</label>
                <input type="password" id="enaennTracker_pKey" style="width:100%" />
                <label>Model name</label>
                <input type="text" id="enaennTracker_pModel" style="width:100%" />
                <button id="enaennTracker_saveProfile">💾 Save Profile</button>
            </div>

            <hr>
            <div>
                <button id="enaennTracker_refreshBtn">🔄 Refresh Tracker</button>
                <button id="enaennTracker_clearBtn">🗑️ Clear State</button>
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
    const $btn = $('<div id="enaennTracker_toolbarBtn" class="list-group-item flex-container flexGap5" title="Update Tracker">🔄</div>');
    $btn.on('click', () => updateTracker());
    $('#send_but_sheld').prepend($btn);
}

// ─── INIT ───────────────────────────────────────────────────────────────────────
jQuery(async () => {
    initSettings();
    injectStyles();

    try {
        const mod = await import('../../../../script.js');
        _addOneMessage = mod.addOneMessage ?? null;
        console.log(
            _addOneMessage
                ? '[enaennTracker] addOneMessage loaded.'
                : '[enaennTracker] addOneMessage not found, using DOM fallback.'
        );
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
