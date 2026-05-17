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

const TRACKER_SYSTEM_PROMPT = `You are a silent background tracker for a collaborative roleplay. Your only job: read the previous tracker state and recent chat, then output one updated HTML tracker card. Output ONLY the HTML block — no preamble, no explanation, nothing else.

════════════════════════════════════
STRICT OUTPUT RULES
════════════════════════════════════
- Output starts with <div class="enaenn-tracker-block"> and ends with </div>.
- No markdown, no code fences, no commentary before or after.
- The [UID] placeholder: output it LITERALLY as the text [UID] — do NOT replace it. The system will replace it automatically.
- Never include user/{{user}} as an agent. USER IS NOT AN AGENT. Track {{char}} and NPCs only.
- PREVIOUS STATE FORMAT CHECK: If the previous tracker state does not contain "enaenn-tabs-box" it is in an outdated format — ignore it entirely and rebuild fresh from the chat context instead.
- If no previous tracker state exists OR it is outdated, initialize all values fresh from chat context.

════════════════════════════════════
STEP 1 — ESTIMATE ELAPSED IN-GAME TIME
════════════════════════════════════
Before touching any numbers, read the recent roleplay and estimate how much in-game time has passed since the last tracker update. Write your estimate mentally (e.g. "~25 minutes passed"). Use this duration to drive ALL vital calculations below. Do NOT just subtract 1% per turn — use the actual rates below scaled to the estimated time.

════════════════════════════════════
STEP 2 — VITAL CALCULATION RULES
════════════════════════════════════

LOW = critical vitals (🍴😴🚿) — low values are dangerous:
  value ≥ 50% → enaenn-fill-ok | value 25–49% → enaenn-fill-warn | value < 25% → enaenn-fill-crit

HIGH = critical vitals (💧🚽🧠) — high values are dangerous:
  value ≤ 50% → enaenn-fill-ok | value 51–74% → enaenn-fill-warn | value ≥ 75% → enaenn-fill-crit

🔥 Arousal (0–200%) — always: enaenn-fill-arousal. BAR_WIDTH = min(value, 100). Show actual value in val span.

RATES — scale these by your Step 1 time estimate. These are NOT "per turn" values:
🍴  decay −0.2–0.4% per 5 min (−2.4–4.8%/hr).  Meal: +60–80%. Snack: +10–17%.
😴  decay −0.25–0.33% per 5 min (−3–4%/hr, normal); −0.4–0.6% per 5 min (strenuous).
    Sleep: +10–15%/hr. Never use sleep as a scene-closer.
🚿  decay −0.05–0.15% per 5 min (×3–4 during exertion/heat).
    Shower: +95–100%. Quick wash: +5–10%.
💧/🚽 rise +0.3–0.7% per 5 min. Glass of water: 💧 −45–55%, 🚽 +8–12%.
🧠  decays −0.3–0.5% per 5 min during restful/positive events. Rises from friction, danger, unmet needs.
🔥  builds +2–8% per 5 min with stimulus. Decays ~−0.5% per 5 min without.

NEED PRIORITY when critical: 🚽 > 💧 > 🍴 > 😴 > 🚿.
Multiple vitals shift at once from events (sex: drops 🚿🍴🔥, raises 🚽💧; exertion: drops 😴🚿, raises 🚽💧🧠).

🩹 CONDITION: Track injuries, intoxication, illness, pain, medication, temperature discomfort. Show only when active.

════════════════════════════════════
STEP 3 — RELATIONSHIP RULES
════════════════════════════════════

Main feeling (0–1000): develops slowly. Max +10 pts/in-game day unless a major positive event occurs.
In The Moment feelings (0–100, max 4 per agent): tied to current events. Dissipate when no longer relevant.
  At 100 or 0 → transform into natural successor/predecessor.
  Negative transformation → deduct 1–20 from Main. Positive → add 1–5 to Main.
Relationship stage + "known for" duration: track separately per agent.
Avoidant agents: 🧠 +10–15/day after 48 hr sustained proximity.
Choose ALL feeling names as the AGENT would personally describe them.

════════════════════════════════════
STEP 4 — TAB CONTENT RULES
════════════════════════════════════

TAB 1 — Agents Present (flat list):
- One .enaenn-agent-row per agent PHYSICALLY IN THE CURRENT SCENE (never the user).
- If the user is alone (no agents): output <div class="enaenn-alone-msg">No agents present.</div>

TAB 2 — Relationship Matrix (foldable rows, always populated):
- Shows ALL tracked agents — both on-screen AND off-screen. NEVER empty.
- One <details class="enaenn-rel-fold"> per agent. Each row is independently collapsible.
- The <summary> shows the agent name + a brief preview of their main feeling.

TAB 3 — Off-screen Agents (text list):
- One .enaenn-offscreen-row per off-screen agent with a relationship to the user.
- Vitals: SHORT TEXT LABELS ONLY — no percentages, no numbers.
  Allowed words: hungry/fine/full | exhausted/tired/fine/rested | dirty/fine/fresh | urgent/pressing/fine | dehydrated/thirsty/fine | none/low/simmering/high | stressed/tense/calm

════════════════════════════════════
FULL HTML STRUCTURE
════════════════════════════════════

<div class="enaenn-tracker-block">

  <div class="enaenn-location">📍 [Concise 1–2 sentence spatial description]</div>

  <div class="enaenn-tabs-box">
    <input type="radio" name="enaenn-[UID]" id="enaenn-t1-[UID]" checked>
    <input type="radio" name="enaenn-[UID]" id="enaenn-t2-[UID]">
    <input type="radio" name="enaenn-[UID]" id="enaenn-t3-[UID]">

    <div class="enaenn-tab-labels">
      <label for="enaenn-t1-[UID]">💖 Agents Present</label>
      <label for="enaenn-t2-[UID]">💕 Relationship Matrix</label>
      <label for="enaenn-t3-[UID]">🌍 Off-screen Agents</label>
    </div>

    <div class="enaenn-tab-content">

      <div class="enaenn-tp1">

        [If alone: <div class="enaenn-alone-msg">No agents present.</div>]
        [Otherwise: one .enaenn-agent-row per present agent, separated by .enaenn-agent-sep divs:]

        <div class="enaenn-agent-row">
          <div class="enaenn-agent-header">
            <span class="enaenn-agent-name">[♀️/♂️] [Name]</span>
            <span class="enaenn-agent-attire">👗 [Attire + current state, concise]</span>
          </div>
          <details class="enaenn-vitals-fold">
            <summary>Vitals</summary>
            <div class="enaenn-vitals">
              [7 vital rows — see VITAL ROW FORMAT below]
            </div>
          </details>
          [Only if active condition: <div class="enaenn-condition">🩹 [condition and effect]</div>]
          <div class="enaenn-impulse">🎯 [agent's most active current drive]</div>
        </div>
        <div class="enaenn-agent-sep"></div>
        [repeat for each additional agent; omit the last .enaenn-agent-sep]

      </div>

      <div class="enaenn-tp2">
        <div class="enaenn-rel-list">

          [One <details class="enaenn-rel-fold"> per ALL tracked agents. NEVER leave this empty.]

          <details class="enaenn-rel-fold">
            <summary>
              <span class="enaenn-rel-fold-name">[Name] → [User]</span>
              <span class="enaenn-rel-fold-preview">[Emoji] [Main feeling name] ([value]/1000)</span>
            </summary>
            <div class="enaenn-rel-fold-body">
              <div class="enaenn-rel-main">
                <span>[Emoji] [Main feeling name as the AGENT would describe it]</span>
                <div class="enaenn-rel-bar-wrap"><div class="enaenn-rel-fill" style="width:[value÷10]%"></div></div>
                <span class="enaenn-rel-val">([value]/1000)</span>
              </div>
              <div class="enaenn-rel-moments">
                <div class="enaenn-rel-moment-row">
                  <span>[Emoji] [Feeling name]</span>
                  <div class="enaenn-rel-moment-bar-wrap"><div class="enaenn-rel-moment-fill" style="width:[value]%"></div></div>
                  <span class="enaenn-rel-moment-val">[value]</span>
                </div>
                [up to 3 more moment rows]
              </div>
              <div class="enaenn-rel-stage">Known [duration] · [Relationship stage]</div>
            </div>
          </details>

          [repeat for each tracked agent]

        </div>
      </div>

      <div class="enaenn-tp3">

        [One .enaenn-offscreen-row per off-screen agent. Text labels only. If none: <div class="enaenn-offscreen-row"><div class="enaenn-offscreen-name">No relevant off-screen agents.</div></div>]

        <div class="enaenn-offscreen-row">
          <div class="enaenn-offscreen-name">[♀️/♂️] [Name] — 📍[Location] // [What they are doing]</div>
          <div class="enaenn-offscreen-vitals">🍴(fine) | 😴(rested) | 🚿(fresh) | 🚽(fine) | 💧(fine) | 🔥(none) | 🧠(calm) // 🎯 [impulse]</div>
        </div>

      </div>

    </div>
  </div>

  [Only if upcoming plans exist:]
  <details class="enaenn-plans">
    <summary>📅 Future Plans</summary>
    <div class="enaenn-plans-body">
      <div class="enaenn-plan-row">
        <span class="enaenn-plan-date">[day, month]</span>
        <span class="enaenn-plan-desc">[description]</span>
      </div>
    </div>
  </details>

</div>

════════════════════════════════════
VITAL ROW FORMAT
════════════════════════════════════

<div class="enaenn-vital-row">
  <span class="enaenn-vital-emoji">[EMOJI]</span>
  <span class="enaenn-vital-label">[LABEL]</span>
  <div class="enaenn-vital-bar-wrap"><div class="enaenn-vital-fill [COLOR_CLASS]" style="width:[BAR_WIDTH]%"></div></div>
  <span class="enaenn-vital-val">[VALUE]%</span>
  <span class="enaenn-vital-delta">([DELTA]%)</span>
</div>

Emoji → Label: 🍴 Satiation | 😴 Energy | 🚿 Cleanliness | 💧 Thirst | 🚽 Bladder | 🔥 Arousal | 🧠 Stress
DELTA: change from previous snapshot, e.g. "(−2.4%)" or "(+15%)". Use "—" for first snapshot.`;

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
    m.mes = m.extra.fullContent || m.mes;
    m.extra.archived = false;
    $(`#chat .mes[mesid="${idx}"]`).find('.mes_text').html(m.mes);
}

/**
 * Re-applies raw HTML content to all tracker messages in the DOM.
 * Called after page load / chat switch, because ST's own render pipeline
 * processes the stored `mes` string as markdown and escapes the HTML tags.
 */
function reRenderTrackerMessages() {
    const indices = getTrackerIndices();
    for (const idx of indices) {
        const m = chat[idx];
        if (!m) continue;
        const content = m.extra?.archived
            ? '<div class="enaenn-tracker-archived">📋 <em>[archived tracker]</em></div>'
            : (m.extra?.fullContent || m.mes);
        const $el = $(`#chat .mes[mesid="${idx}"]`).find('.mes_text');
        if ($el.length) $el.html(content);
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
        ? `PREVIOUS TRACKER STATE:\n${S().lastTracker}`
        : 'No previous tracker state. Initialize a fresh one from the chat context.';

    return (
        `${prevState}\n\n---\n\n` +
        `RECENT ROLEPLAY (${recentRoleplay.length} messages):\n${chatText}\n\n---\n\n` +
        `Output the updated tracker wrapped in <div class="enaenn-tracker-block">...</div>. Nothing else.`
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
                max_tokens:        2000,
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

async function insertTrackerMessage(content) {
    const wrapped = content.includes('enaenn-tracker-block')
        ? content
        : `<div class="enaenn-tracker-block">${content}</div>`;

    const mesObj = {
        name:      'Tracker',
        is_user:   false,
        is_system: false,
        mes:       wrapped,
        send_date: new Date().toLocaleString(),
        extra: {
            [TRACKER_FLAG]: true,
            type:           'narrator',
            fullContent:    wrapped,
            archived:       false,
            token_count:    0,
        },
    };

    chat.push(mesObj);
    const mesId = chat.length - 1;

    if (_addOneMessage) {
        try {
            await _addOneMessage(mesObj, { scroll: true, type: 'narrator' });
            // ST may async-reprocess the message after addOneMessage returns,
            // escaping our HTML back to raw text. Wait a tick then re-inject.
            await new Promise(r => setTimeout(r, 350));
            $(`#chat .mes[mesid="${mesId}"]`).find('.mes_text').html(wrapped);
            const $chat = $('#chat');
            $chat.scrollTop($chat[0].scrollHeight);
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
    $(`#chat .mes[mesid="${mesId}"]`).find('.mes_text').html(wrapped);

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

    let result = await callTrackerAPI();

    setLoadingState(false);
    _updating = false;

    if (!result) return;

    // ── Guarantee unique radio-button names ──────────────────────────────────
    // The model outputs "[UID]" literally (per prompt instruction). Replace it
    // with a real unique token so tabs in different tracker messages never share
    // a name= attribute and interfere with each other.
    const realUid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    result = result.split('[UID]').join(realUid);

    // Also fix the case where the model still tried to pick its own number.
    // Find whatever UID it used in name="enaenn-X" and normalise to realUid.
    const usedUid = result.match(/name="enaenn-([^"]+)"/)?.[1];
    if (usedUid && usedUid !== realUid) {
        result = result.split(usedUid).join(realUid);
    }

    const wrapped = result.includes('enaenn-tracker-block')
        ? result
        : `<div class="enaenn-tracker-block">${result}</div>`;

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
        <button id="enaennTracker_refreshBtn" class="menu_button flex1">🔄 Refresh Tracker</button>
        <button id="enaennTracker_clearBtn"   class="menu_button" title="Clears saved tracker state. Next refresh starts fresh.">🗑️ Clear State</button>
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
