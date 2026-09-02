// Opciones (Draw) — extensión para SillyTavern / TauriTavern
// Versión simplificada e inspirada en "Crossroads" de Jeppsterrr para Tavo,
// enfocada solo en la función "Draw": generar varias opciones de qué podría
// decir/hacer tu personaje a continuación cuando te quedas atascado.

(function () {
  const MODULE_NAME = 'crossroads_lite';

  const DEFAULT_TONES = [
    'Directo', 'Cauteloso', 'Curioso', 'Desafiante',
    'Tierno', 'Sarcástico', 'Nervioso', 'Confiado',
  ];

  const DEFAULT_SETTINGS = {
    count: 4,
    contextMessages: 12,
    language: '',
    instruction: '',
  };

  function getCtx() { return SillyTavern.getContext(); }

  function loadSettings() {
    const ctx = getCtx();
    if (!ctx.extensionSettings[MODULE_NAME]) {
      ctx.extensionSettings[MODULE_NAME] = { ...DEFAULT_SETTINGS };
    }
    for (const key in DEFAULT_SETTINGS) {
      if (ctx.extensionSettings[MODULE_NAME][key] === undefined) {
        ctx.extensionSettings[MODULE_NAME][key] = DEFAULT_SETTINGS[key];
      }
    }
    return ctx.extensionSettings[MODULE_NAME];
  }

  function saveSettings() { getCtx().saveSettingsDebounced(); }

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

  function pickTones(count) {
    const shuffled = [...DEFAULT_TONES].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, DEFAULT_TONES.length));
  }

  function buildDrawPrompt(settings) {
    const scene = buildSceneWindow(settings);
    const tones = pickTones(settings.count);
    const player = getCtx().name1 || 'the player';
    const langLine = settings.language && settings.language.trim()
      ? `Write the options in ${settings.language.trim()}.`
      : '';
    const extra = settings.instruction && settings.instruction.trim()
      ? settings.instruction.trim()
      : '';

    return [
      `CURRENT SCENE (most recent lines last):`,
      scene || '(no previous messages yet)',
      '',
      `[OOC: You are drafting ${settings.count} DIFFERENT short options for what ${player} (the [PLAYER]) `
      + `could say or do NEXT, as a single next turn. Do not write anything for [CHARACTER]. `
      + `Do not continue the scene beyond that one player turn. `
      + `Each option must use a different tone from this list: ${tones.join(', ')}. `
      + `${langLine} ${extra} `
      + `Respond with ONLY a valid JSON object, no commentary, no markdown fences, in this exact shape: `
      + `{"options":[{"tone":"<one of the listed tones>","text":"<the option, 1-3 sentences>"}]}]`,
    ].join('\n');
  }

  function buildExpandPrompt(option, settings) {
    const scene = buildSceneWindow(settings);
    return [
      `CURRENT SCENE (most recent lines last):`,
      scene || '(no previous messages yet)',
      '',
      `Short version of the player's next turn:\n${option.text}`,
      '',
      `[OOC: Expand ONLY that short version above into a longer, more detailed version of the `
      + `SAME single player turn (same intent, same tone: ${option.tone}). Do not add dialogue or `
      + `narration for [CHARACTER]. Respond with only the expanded text, no quotes, no commentary.]`,
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

  function parseOptions(raw) {
    const cleaned = (raw || '').replace(/```json|```/g, '').trim();
    let candidate = extractBalancedObject(cleaned) || cleaned;
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed.options)) return parsed.options;
    } catch (e) { /* try repair */ }
    try {
      const parsed = JSON.parse(repairJson(candidate));
      if (Array.isArray(parsed.options)) return parsed.options;
    } catch (e) { /* give up */ }
    return null;
  }

  // ---------- interfaz ----------

  function injectHtml() {
    const html = `
      <div id="crd-fab" title="Opciones (Draw)">🧭</div>
      <div id="crd-overlay" class="crd-hidden">
        <div id="crd-panel">
          <div class="crd-header">
            <span class="crd-title">¿Qué hago ahora?</span>
            <span id="crd-close">✕</span>
          </div>

          <button id="crd-draw" class="crd-primary"><span id="crd-draw-label">Generar opciones</span></button>
          <div id="crd-error" class="crd-error crd-hidden"></div>
          <div id="crd-options"></div>
          <button id="crd-redraw" class="crd-secondary crd-hidden">Redibujar todo</button>
        </div>
      </div>`;
    $('body').append(html);
  }

  function injectSettingsHtml() {
    const settings = loadSettings();
    const html = `
      <div class="crd-settings-block">
        <div class="inline-drawer">
          <div class="inline-drawer-toggle inline-drawer-header">
            <b>Opciones (Draw)</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
          </div>
          <div class="inline-drawer-content">
            <label class="crd-label">Número de opciones por tanda (1-8)</label>
            <input id="crd-cfg-count" type="number" min="1" max="8" />

            <label class="crd-label">Mensajes recientes a considerar (2-40)</label>
            <input id="crd-cfg-context" type="number" min="2" max="40" />

            <label class="crd-label">Idioma de las opciones (opcional)</label>
            <input id="crd-cfg-language" type="text" placeholder="Ej: español" />

            <label class="crd-label">Instrucción extra (opcional)</label>
            <textarea id="crd-cfg-instruction" rows="2" placeholder="Ej: mantén un tono formal"></textarea>
          </div>
        </div>
      </div>`;
    $('#extensions_settings2').append(html);
    $('#crd-cfg-count').val(settings.count);
    $('#crd-cfg-context').val(settings.contextMessages);
    $('#crd-cfg-language').val(settings.language);
    $('#crd-cfg-instruction').val(settings.instruction);

    $('#crd-cfg-count').on('input', function () {
      settings.count = Math.max(1, Math.min(8, parseInt($(this).val(), 10) || 4));
      saveSettings();
    });
    $('#crd-cfg-context').on('input', function () {
      settings.contextMessages = Math.max(2, Math.min(40, parseInt($(this).val(), 10) || 12));
      saveSettings();
    });
    $('#crd-cfg-language').on('input', function () {
      settings.language = $(this).val();
      saveSettings();
    });
    $('#crd-cfg-instruction').on('input', function () {
      settings.instruction = $(this).val();
      saveSettings();
    });
  }

  function optionCardHtml(index, opt) {
    return `
      <div class="crd-card" data-idx="${index}">
        <div class="crd-card-tone">${opt.tone || ''}</div>
        <div class="crd-card-text">${opt.text || ''}</div>
        <div class="crd-card-actions">
          <button class="crd-use" data-idx="${index}">Usar</button>
          <button class="crd-expand" data-idx="${index}">Expandir</button>
        </div>
      </div>`;
  }

  function wireUp() {
    let options = [];
    let busy = false;

    const $fab = $('#crd-fab');
    const $overlay = $('#crd-overlay');
    const $draw = $('#crd-draw');
    const $drawLabel = $('#crd-draw-label');
    const $error = $('#crd-error');
    const $optionsWrap = $('#crd-options');
    const $redraw = $('#crd-redraw');

    function openPanel() { $overlay.removeClass('crd-hidden'); }
    function closePanel() { $overlay.addClass('crd-hidden'); }
    $fab.on('click', openPanel);
    $('#crd-close').on('click', closePanel);

    function showError(msg) { $error.text(msg).removeClass('crd-hidden'); }
    function clearError() { $error.text('').addClass('crd-hidden'); }
    function setBusy(state, label) {
      busy = state;
      $draw.prop('disabled', state);
      $redraw.prop('disabled', state);
      $drawLabel.text(label || 'Generar opciones');
    }

    function renderOptions() {
      $optionsWrap.empty();
      options.forEach((opt, i) => $optionsWrap.append(optionCardHtml(i, opt)));
      $redraw.toggleClass('crd-hidden', options.length === 0);
      $optionsWrap.find('.crd-use').on('click', function () {
        const idx = parseInt($(this).data('idx'), 10);
        useOption(options[idx]);
      });
      $optionsWrap.find('.crd-expand').on('click', function () {
        const idx = parseInt($(this).data('idx'), 10);
        expandOption(idx);
      });
    }

    function useOption(opt) {
      if (!opt) return;
      $('#send_textarea').val(opt.text || '').trigger('input');
      closePanel();
    }

    async function doDraw() {
      clearError();
      setBusy(true, 'Generando...');
      try {
        const settings = loadSettings();
        const ctx = getCtx();
        if (!ctx.chat || ctx.chat.length === 0) {
          showError('Todavía no hay suficiente contexto en este chat.');
          setBusy(false, 'Generar opciones');
          return;
        }
        const prompt = buildDrawPrompt(settings);
        const raw = await ctx.generateQuietPrompt({ quietPrompt: prompt });
        const parsed = parseOptions(raw);
        if (!parsed || !parsed.length) {
          showError('No se pudo leer la respuesta de la IA. Intenta de nuevo.');
          setBusy(false, 'Generar opciones');
          return;
        }
        options = parsed;
        renderOptions();
        setBusy(false, 'Generar opciones');
      } catch (e) {
        setBusy(false, 'Generar opciones');
        showError('Falló la generación: ' + (e && e.message ? e.message : String(e)));
      }
    }

    async function expandOption(idx) {
      if (busy) return;
      const opt = options[idx];
      if (!opt) return;
      clearError();
      setBusy(true, 'Expandiendo...');
      try {
        const settings = loadSettings();
        const ctx = getCtx();
        const prompt = buildExpandPrompt(opt, settings);
        const text = await ctx.generateQuietPrompt({ quietPrompt: prompt });
        options[idx] = { tone: opt.tone, text: (text || '').trim() };
        renderOptions();
        setBusy(false, 'Generar opciones');
      } catch (e) {
        setBusy(false, 'Generar opciones');
        showError('Falló la expansión: ' + (e && e.message ? e.message : String(e)));
      }
    }

    $draw.on('click', () => { if (!busy) doDraw(); });
    $redraw.on('click', () => { if (!busy) doDraw(); });
  }

  $(document).ready(function () {
    const check = setInterval(() => {
      if ($('#send_textarea').length && $('#extensions_settings2').length) {
        clearInterval(check);
        loadSettings();
        injectHtml();
        injectSettingsHtml();
        wireUp();
      }
    }, 500);
  });
})();
