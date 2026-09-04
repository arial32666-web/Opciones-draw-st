// Opciones (Draw) v2 — extensión para SillyTavern / TauriTavern
// Inspirada en "Crossroads" de Jeppsterrr para Tavo. Solo la función "Draw":
// tonos editables en una barra de iconos, una tarjeta por tono con
// Usar/Redibujar, y burbuja arrastrable.

(function () {
  const MODULE_NAME = 'crossroads_lite';

  const SEED_TONES = [
    { id: 't1', icon: '⚡', name: 'Bold',     brief: '' },
    { id: 't2', icon: '🛡',  name: 'Guarded',  brief: '' },
    { id: 't3', icon: '♥',  name: 'Warm',     brief: '' },
    { id: 't4', icon: '🎭', name: 'Sly',      brief: '' },
    { id: 't5', icon: '🔍', name: 'Curious',  brief: '' },
    { id: 't6', icon: '🙂', name: 'Wry',      brief: '' },
    { id: 't7', icon: '⚠',  name: 'Grim',     brief: '' },
    { id: 't8', icon: '💗', name: 'Tender',   brief: '' },
  ];

  const DEFAULT_SETTINGS = {
    tones: SEED_TONES,
    contextMessages: 12,
    language: '',
    instruction: '',
    fabPos: null, // { right, bottom } en px, null = posición por defecto
  };

  function getCtx() { return SillyTavern.getContext(); }

  function loadSettings() {
    const ctx = getCtx();
    if (!ctx.extensionSettings[MODULE_NAME]) {
      ctx.extensionSettings[MODULE_NAME] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }
    const s = ctx.extensionSettings[MODULE_NAME];
    if (!Array.isArray(s.tones) || s.tones.length === 0) s.tones = JSON.parse(JSON.stringify(SEED_TONES));
    if (s.contextMessages === undefined) s.contextMessages = DEFAULT_SETTINGS.contextMessages;
    if (s.language === undefined) s.language = '';
    if (s.instruction === undefined) s.instruction = '';
    if (s.fabPos === undefined) s.fabPos = null;
    return s;
  }

  function saveSettings() { getCtx().saveSettingsDebounced(); }

  function uid() { return 't' + Math.random().toString(36).slice(2, 9); }

  // ---------- construcción del prompt ----------

  function stripImages(text) {
    return (text || '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/<img[^>]*>/gi, '')
      .replace(/<picture[^>]*>[\s\S]*?<\/picture>/gi, '');
  }

  function buildSceneWindow(settings) {
    const ctx = getCtx();
    const chat = ctx.chat || [];
    const slice = chat.slice(-Math.max(2, settings.contextMessages));
    const lines = slice.map((m) => {
      const tag = m.is_user ? '[PLAYER]' : '[CHARACTER]';
      const name = m.name || (m.is_user ? 'Player' : 'Character');
      return `${tag} ${name}: ${stripImages(m.mes || '').trim()}`;
    });
    return lines.join('\n');
  }

  function buildDrawPrompt(tone, settings) {
    const scene = buildSceneWindow(settings);
    const player = getCtx().name1 || 'the player';
    const langLine = settings.language && settings.language.trim()
      ? `Write the option in ${settings.language.trim()}.`
      : '';
    const extra = settings.instruction && settings.instruction.trim() ? settings.instruction.trim() : '';
    const brief = tone.brief && tone.brief.trim() ? ` Tone guidance: ${tone.brief.trim()}.` : '';

    return [
      `CURRENT SCENE (most recent lines last):`,
      scene || '(no previous messages yet)',
      '',
      `[OOC: Draft ONE short option for what ${player} (the [PLAYER]) could say or do NEXT, `
      + `as a single next turn. Do not write anything for [CHARACTER]. Do not continue the scene `
      + `beyond that one player turn. The tone must be "${tone.name}".${brief} `
      + `FORMAT: study the CURRENT SCENE above — physical actions and gestures are wrapped in `
      + `*asterisks*, spoken dialogue is in "quotes", and they are usually mixed together in the `
      + `same passage. Your option MUST follow that same mixed format: include at least one short `
      + `physical action/gesture in asterisks AND spoken dialogue in quotes when it fits the tone — `
      + `never output dialogue-only with no action. `
      + `${langLine} ${extra} `
      + `Respond with ONLY a valid JSON object, no commentary, no markdown fences, in this exact `
      + `shape: {"text":"<the option, 1-3 sentences, mixing action and dialogue>"}]`,
    ].join('\n');
  }

  // ---------- reparación/parseo de JSON ----------

  function extractBalancedObject(text) {
    const start = text.indexOf('{');
    if (start === -1) return null;
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return null;
  }

  function repairJson(str) {
    return str
      .replace(/[""]/g, '"')
      .replace(/['']/g, "'")
      .replace(/,\s*([}\]])/g, '$1');
  }

  function parseSingle(raw) {
    const cleaned = (raw || '').replace(/```json|```/g, '').trim();
    let candidate = extractBalancedObject(cleaned) || cleaned;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed.text === 'string') return parsed.text;
    } catch (e) { /* try repair */ }
    try {
      const parsed = JSON.parse(repairJson(candidate));
      if (parsed && typeof parsed.text === 'string') return parsed.text;
    } catch (e) { /* give up */ }
    return null;
  }

  function buildDrawAllPrompt(tones, settings) {
    const scene = buildSceneWindow(settings);
    const player = getCtx().name1 || 'the player';
    const langLine = settings.language && settings.language.trim()
      ? `Write every option in ${settings.language.trim()}.`
      : '';
    const extra = settings.instruction && settings.instruction.trim() ? settings.instruction.trim() : '';
    const toneList = tones.map((t, i) => {
      const brief = t.brief && t.brief.trim() ? ` — ${t.brief.trim()}` : '';
      return `${i + 1}. "${t.name}"${brief}`;
    }).join('\n');

    return [
      `CURRENT SCENE (most recent lines last):`,
      scene || '(no previous messages yet)',
      '',
      `TONES (write exactly one option per tone, in this exact order):`,
      toneList,
      '',
      `[OOC: Draft ${tones.length} DIFFERENT short options for what ${player} (the [PLAYER]) could `
      + `say or do NEXT, as a single next turn. Do not write anything for [CHARACTER]. Do not `
      + `continue the scene beyond that one player turn. Each option must match the tone listed `
      + `next to it, in the same order. `
      + `FORMAT: study the CURRENT SCENE above — physical actions/gestures are wrapped in `
      + `*asterisks*, spoken dialogue is in "quotes", usually mixed together. Every option MUST `
      + `follow that same mixed format — include at least one short physical action/gesture in `
      + `asterisks AND spoken dialogue in quotes when it fits the tone — never dialogue-only. `
      + `${langLine} ${extra} `
      + `Respond with ONLY a valid JSON object, no commentary, no markdown fences, in this exact `
      + `shape: {"options":[{"text":"<option 1>"},{"text":"<option 2>"}, ... exactly `
      + `${tones.length} items, same order as the tone list above]}]`,
    ].join('\n');
  }

  function parseMultiple(raw, expectedCount) {
    const cleaned = (raw || '').replace(/```json|```/g, '').trim();
    let candidate = extractBalancedObject(cleaned) || cleaned;
    function tryParse(str) {
      try {
        const parsed = JSON.parse(str);
        if (Array.isArray(parsed.options)) {
          return parsed.options.map((o) => (o && typeof o.text === 'string' ? o.text : null));
        }
      } catch (e) { /* ignore */ }
      return null;
    }
    return tryParse(candidate) || tryParse(repairJson(candidate)) || null;
  }

  // ---------- HTML base ----------

  function injectHtml() {
    const html = `
      <div id="crd-bar" title="Arrastra para mover">
        <div id="crd-draw-pill">
          <span class="crd-drawall-icon">✳</span>
          <span id="crd-drawall-label">Draw</span>
        </div>
        <div id="crd-bar-gear" title="Personalizar tonos">⚙</div>
      </div>

      <div id="crd-overlay" class="crd-hidden">
        <div id="crd-panel">
          <span id="crd-panel-close" title="Cerrar">✕</span>
          <div id="crd-tonebar"></div>
          <div id="crd-error" class="crd-error crd-hidden"></div>
          <div id="crd-card" class="crd-hidden"></div>
        </div>
      </div>

      <div id="crd-config-overlay" class="crd-hidden">
        <div id="crd-config-panel">
          <div class="crd-header">
            <span class="crd-title">Crossroads</span>
            <span id="crd-config-close">✕</span>
          </div>
          <div class="crd-tabs">
            <span class="crd-tab is-on" data-tab="tones">Tonos</span>
            <span class="crd-tab" data-tab="instruction">Instrucción</span>
            <span class="crd-tab" data-tab="settings">Ajustes</span>
            <span class="crd-tab" data-tab="appearance">Apariencia</span>
          </div>
          <div id="crd-tab-tones" class="crd-tabpanel"></div>
          <div id="crd-tab-instruction" class="crd-tabpanel crd-hidden">
            <label class="crd-label">Instrucción extra aplicada a todos los tonos</label>
            <textarea id="crd-cfg-instruction" rows="4" placeholder="Ej: mantén un tono formal, evita groserías..."></textarea>
          </div>
          <div id="crd-tab-settings" class="crd-tabpanel crd-hidden">
            <label class="crd-label">Mensajes recientes a considerar (2-40)</label>
            <input id="crd-cfg-context" type="number" min="2" max="40" />
            <label class="crd-label">Idioma de las opciones (opcional)</label>
            <input id="crd-cfg-language" type="text" placeholder="Ej: español" />
          </div>
          <div id="crd-tab-appearance" class="crd-tabpanel crd-hidden">
            <p class="crd-hint">Puedes arrastrar la barra "Draw" a cualquier parte de la pantalla.</p>
            <button id="crd-reset-pos" class="crd-secondary">Restablecer posición de la barra</button>
          </div>
        </div>
      </div>

      <div id="crd-tone-editor" class="crd-hidden">
        <div id="crd-tone-editor-panel">
          <div class="crd-header">
            <span class="crd-title" id="crd-te-title">Nuevo tono</span>
            <span id="crd-te-close">✕</span>
          </div>
          <label class="crd-label">Ícono (un emoji)</label>
          <input id="crd-te-icon" type="text" maxlength="4" placeholder="✨" />
          <label class="crd-label">Nombre</label>
          <input id="crd-te-name" type="text" placeholder="Ej: Juguetón" />
          <label class="crd-label">Guía de tono (opcional)</label>
          <textarea id="crd-te-brief" rows="2" placeholder="Ej: coqueto pero nervioso"></textarea>
          <div class="crd-actions">
            <button id="crd-te-delete" class="crd-secondary crd-hidden">Eliminar</button>
            <button id="crd-te-save" class="crd-primary">Guardar</button>
          </div>
        </div>
      </div>`;
    $('body').append(html);
  }

  // ---------- barra de tonos + tarjeta ----------

  function toneBtnHtml(tone, isActive) {
    return `<div class="crd-tone-btn${isActive ? ' is-on' : ''}" data-id="${tone.id}">${tone.icon || '✨'}</div>`;
  }

  function renderToneBar(settings, activeId) {
    const $bar = $('#crd-tonebar');
    $bar.empty();
    settings.tones.forEach((t) => $bar.append(toneBtnHtml(t, t.id === activeId)));
    $bar.append('<div class="crd-tone-btn crd-tone-add" id="crd-tone-add-inline" title="Añadir tono">+</div>');
  }

  function cardHtml(tone, text, expanded) {
    const desc = tone.brief && tone.brief.trim() ? ` · ${tone.brief.trim()}` : '';
    return `
      <div class="crd-card-inner${expanded ? ' is-expanded' : ''}">
        <div class="crd-card-top">
          <span class="crd-card-tone">${tone.icon || ''} ${tone.name}${desc}</span>
          <span id="crd-card-expand" title="Expandir">⤢</span>
          <span id="crd-card-wand" title="Redibujar">🪄</span>
          <span id="crd-card-x" title="Cerrar">✕</span>
        </div>
        <div class="crd-card-text" id="crd-card-text">${text}</div>
        <div class="crd-card-actions">
          <button id="crd-use" class="crd-primary">Use this</button>
          <button id="crd-redraw" class="crd-secondary">Redraw this</button>
        </div>
      </div>`;
  }

  // ---------- lógica principal ----------

  function wireUp() {
    let cache = {}; // toneId -> texto generado
    let activeId = null;
    let busy = false;
    let expanded = false;

    const $bar = $('#crd-bar');
    const $overlay = $('#crd-overlay');
    const $error = $('#crd-error');
    const $card = $('#crd-card');

    function openPanel() {
      const settings = loadSettings();
      renderToneBar(settings, activeId);
      $overlay.removeClass('crd-hidden');
    }
    function closePanel() { $overlay.addClass('crd-hidden'); }
    $('#crd-panel-close').on('click', closePanel);

    function showError(msg) { $error.text(msg).removeClass('crd-hidden'); }
    function clearError() { $error.text('').addClass('crd-hidden'); }

    function renderCard(tone, text) {
      $card.html(cardHtml(tone, text, expanded)).removeClass('crd-hidden');
      $('#crd-card-expand').on('click', () => { expanded = !expanded; renderCard(tone, text); });
      $('#crd-card-wand').on('click', () => redraw(tone));
      $('#crd-card-x').on('click', () => {
        activeId = null;
        $card.addClass('crd-hidden');
        renderToneBar(loadSettings(), activeId);
      });
      $('#crd-use').on('click', () => {
        $('#send_textarea').val(text || '').trigger('input');
        closePanel();
      });
      $('#crd-redraw').on('click', () => redraw(tone));
    }

    async function showTone(tone) {
      activeId = tone.id;
      renderToneBar(loadSettings(), activeId);
      clearError();
      if (cache[tone.id]) {
        renderCard(tone, cache[tone.id]);
        return;
      }
      await generate(tone);
    }

    function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

    // Genera un tono y lo guarda en caché, sin tocar la tarjeta visible.
    // Reintenta automáticamente si el fallo parece ser el servidor saturado
    // (502/503/"high demand"), con una pequeña espera entre intentos.
    // Devuelve true si salió bien, false si falló (deja el error visible).
    async function generateAndCache(tone, attempt) {
      attempt = attempt || 1;
      try {
        const settings = loadSettings();
        const ctx = getCtx();
        if (!ctx.chat || ctx.chat.length === 0) {
          showError('Todavía no hay suficiente contexto en este chat.');
          return false;
        }
        const prompt = buildDrawPrompt(tone, settings);
        const raw = await ctx.generateQuietPrompt({ quietPrompt: prompt });
        const text = parseSingle(raw);
        if (!text) {
          showError(`"${tone.name}" no se pudo leer, se omitió. Puedes redibujarlo luego.`);
          return false;
        }
        cache[tone.id] = text;
        return true;
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        const serverBusy = /502|503|overloaded|high demand/i.test(msg);
        if (serverBusy && attempt < 3) {
          await sleep(1500 * attempt);
          return generateAndCache(tone, attempt + 1);
        }
        showError(`"${tone.name}" falló tras reintentar: ` + msg);
        return false;
      }
    }

    async function generate(tone) {
      if (busy) return;
      busy = true;
      $card.removeClass('crd-hidden').html('<div class="crd-loading">Generando...</div>');
      const ok = await generateAndCache(tone);
      if (ok) {
        renderCard(tone, cache[tone.id]);
      } else {
        $card.addClass('crd-hidden');
      }
      busy = false;
    }

    function redraw(tone) {
      delete cache[tone.id];
      generate(tone);
    }

    async function drawAll(attempt) {
      attempt = attempt || 1;
      if (busy) return;
      const settings = loadSettings();
      const tones = settings.tones;
      if (!tones.length) { showError('Añade al menos un tono primero.'); return; }
      busy = true;
      clearError();
      openPanel();
      $('#crd-tonebar').empty();
      $card.removeClass('crd-hidden').html('<div class="crd-loading">Generando...</div>');
      const $label = $('#crd-drawall-label');
      $bar.addClass('is-busy');
      $label.text(attempt > 1 ? `Reintentando (${attempt - 1})...` : 'Generando...');

      try {
        const ctx = getCtx();
        if (!ctx.chat || ctx.chat.length === 0) {
          showError('Todavía no hay suficiente contexto en este chat.');
          $card.addClass('crd-hidden');
          $label.text('Draw');
          $bar.removeClass('is-busy');
          busy = false;
          return;
        }
        const prompt = buildDrawAllPrompt(tones, settings);
        const raw = await ctx.generateQuietPrompt({ quietPrompt: prompt });
        const texts = parseMultiple(raw, tones.length);

        $label.text('Draw');
        $bar.removeClass('is-busy');
        busy = false;

        if (!texts) {
          showError('No se pudo leer la respuesta completa. Intenta de nuevo con Draw.');
          $card.addClass('crd-hidden');
          renderToneBar(loadSettings(), activeId);
          return;
        }
        let firstOkTone = null;
        tones.forEach((tone, i) => {
          if (texts[i]) {
            cache[tone.id] = texts[i];
            if (!firstOkTone) firstOkTone = tone;
          }
        });
        if (texts.length < tones.length) {
          showError(`Solo llegaron ${texts.length}/${tones.length} opciones. Puedes redibujar las que falten individualmente.`);
        }
        if (firstOkTone) {
          activeId = firstOkTone.id;
          renderToneBar(loadSettings(), activeId);
          renderCard(firstOkTone, cache[firstOkTone.id]);
        } else {
          showError('No se pudo generar ninguna opción. Intenta de nuevo.');
          $card.addClass('crd-hidden');
          renderToneBar(loadSettings(), activeId);
        }
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        const serverBusy = /502|503|overloaded|high demand/i.test(msg);
        if (serverBusy && attempt < 3) {
          busy = false;
          await sleepMs(1500 * attempt);
          return drawAll(attempt + 1);
        }
        $label.text('Draw');
        $bar.removeClass('is-busy');
        busy = false;
        $card.addClass('crd-hidden');
        showError('Falló la generación: ' + msg);
      }
    }

    function sleepMs(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }


    $('#crd-tonebar').on('click', '.crd-tone-btn:not(.crd-tone-add)', function () {
      const id = $(this).data('id');
      const settings = loadSettings();
      const tone = settings.tones.find((t) => t.id === id);
      if (tone) showTone(tone);
    });
    $('#crd-tonebar').on('click', '#crd-tone-add-inline', function () {
      openToneEditor(null);
    });

    // ---------- barra "Draw" arrastrable ----------
    let dragging = false;
    let moved = false;
    let startX, startY, startRight, startBottom, downTarget;

    function applyBarPos(settings) {
      if (settings.fabPos) {
        $bar.css({ right: settings.fabPos.right + 'px', bottom: settings.fabPos.bottom + 'px' });
      } else {
        $bar.css({ right: '', bottom: '' });
      }
    }
    applyBarPos(loadSettings());

    function onPointerDown(e) {
      dragging = true;
      moved = false;
      downTarget = e.target;
      const p = e.touches ? e.touches[0] : e;
      startX = p.clientX;
      startY = p.clientY;
      const rect = $bar[0].getBoundingClientRect();
      startRight = window.innerWidth - rect.right;
      startBottom = window.innerHeight - rect.bottom;
      e.preventDefault();
    }
    function onPointerMove(e) {
      if (!dragging) return;
      const p = e.touches ? e.touches[0] : e;
      const dx = p.clientX - startX;
      const dy = p.clientY - startY;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
      let right = startRight - dx;
      let bottom = startBottom - dy;
      const rect = $bar[0].getBoundingClientRect();
      right = Math.max(4, Math.min(window.innerWidth - rect.width - 4, right));
      bottom = Math.max(4, Math.min(window.innerHeight - rect.height - 4, bottom));
      $bar.css({ right: right + 'px', bottom: bottom + 'px' });
    }
    function onPointerUp() {
      if (!dragging) return;
      dragging = false;
      if (moved) {
        const settings = loadSettings();
        const rect = $bar[0].getBoundingClientRect();
        settings.fabPos = {
          right: Math.round(window.innerWidth - rect.right),
          bottom: Math.round(window.innerHeight - rect.bottom),
        };
        saveSettings();
        return;
      }
      // fue un toque, no un arrastre: decide qué se tocó
      if ($(downTarget).closest('#crd-bar-gear').length) {
        renderTonesTab();
        $('#crd-config-overlay').removeClass('crd-hidden');
      } else {
        drawAll();
      }
    }

    $bar.on('mousedown touchstart', onPointerDown);
    $(document).on('mousemove touchmove', onPointerMove);
    $(document).on('mouseup touchend', onPointerUp);

    // ---------- panel de configuración ----------

    const $configOverlay = $('#crd-config-overlay');
    $('#crd-config-close').on('click', () => $configOverlay.addClass('crd-hidden'));

    $('.crd-tab').on('click', function () {
      const tab = $(this).data('tab');
      $('.crd-tab').removeClass('is-on');
      $(this).addClass('is-on');
      $('.crd-tabpanel').addClass('crd-hidden');
      $('#crd-tab-' + tab).removeClass('crd-hidden');
    });

    function toneRowHtml(t) {
      return `
        <div class="crd-tone-row" data-id="${t.id}">
          <span class="crd-tone-row-icon">${t.icon || '✨'}</span>
          <span class="crd-tone-row-name">${t.name}</span>
          <span class="crd-tone-row-edit" data-id="${t.id}">✎</span>
        </div>`;
    }

    function renderTonesTab() {
      const settings = loadSettings();
      const $wrap = $('#crd-tab-tones');
      $wrap.empty();
      $wrap.append('<div class="crd-tones-header"><span>TONOS (' + settings.tones.length + ')</span>'
        + '<button id="crd-add-tone" class="crd-secondary">+ Añadir tono</button></div>');
      settings.tones.forEach((t) => $wrap.append(toneRowHtml(t)));
      $('#crd-add-tone').on('click', () => openToneEditor(null));
      $wrap.find('.crd-tone-row-edit').on('click', function () {
        const id = $(this).data('id');
        const tone = loadSettings().tones.find((t) => t.id === id);
        if (tone) openToneEditor(tone);
      });
    }

    $('#crd-cfg-instruction').on('input', function () {
      const s = loadSettings(); s.instruction = $(this).val(); saveSettings();
    });
    $('#crd-cfg-context').on('input', function () {
      const s = loadSettings();
      s.contextMessages = Math.max(2, Math.min(40, parseInt($(this).val(), 10) || 12));
      saveSettings();
    });
    $('#crd-cfg-language').on('input', function () {
      const s = loadSettings(); s.language = $(this).val(); saveSettings();
    });
    $('#crd-reset-pos').on('click', function () {
      const s = loadSettings();
      s.fabPos = null;
      saveSettings();
      applyBarPos(s);
    });

    (function initConfigFields() {
      const s = loadSettings();
      $('#crd-cfg-instruction').val(s.instruction);
      $('#crd-cfg-context').val(s.contextMessages);
      $('#crd-cfg-language').val(s.language);
    })();

    // ---------- editor de tono ----------

    const $toneEditor = $('#crd-tone-editor');
    let editingId = null;

    function openToneEditor(tone) {
      editingId = tone ? tone.id : null;
      $('#crd-te-title').text(tone ? 'Editar tono' : 'Nuevo tono');
      $('#crd-te-icon').val(tone ? tone.icon : '✨');
      $('#crd-te-name').val(tone ? tone.name : '');
      $('#crd-te-brief').val(tone ? tone.brief : '');
      $('#crd-te-delete').toggleClass('crd-hidden', !tone);
      $toneEditor.removeClass('crd-hidden');
    }
    $('#crd-te-close').on('click', () => $toneEditor.addClass('crd-hidden'));

    $('#crd-te-save').on('click', () => {
      const name = $('#crd-te-name').val().trim();
      if (!name) { return; }
      const icon = $('#crd-te-icon').val().trim() || '✨';
      const brief = $('#crd-te-brief').val().trim();
      const settings = loadSettings();
      if (editingId) {
        const t = settings.tones.find((t) => t.id === editingId);
        if (t) { t.name = name; t.icon = icon; t.brief = brief; }
      } else {
        settings.tones.push({ id: uid(), name, icon, brief });
      }
      saveSettings();
      $toneEditor.addClass('crd-hidden');
      renderTonesTab();
      renderToneBar(settings, activeId);
    });

    $('#crd-te-delete').on('click', () => {
      if (!editingId) return;
      const settings = loadSettings();
      settings.tones = settings.tones.filter((t) => t.id !== editingId);
      delete cache[editingId];
      if (activeId === editingId) { activeId = null; $card.addClass('crd-hidden'); }
      saveSettings();
      $toneEditor.addClass('crd-hidden');
      renderTonesTab();
      renderToneBar(settings, activeId);
    });
  }

  $(document).ready(function () {
    const check = setInterval(() => {
      if ($('#send_textarea').length && $('#extensions_settings2').length) {
        clearInterval(check);
        loadSettings();
        injectHtml();
        wireUp();
      }
    }, 500);
  });
})();
