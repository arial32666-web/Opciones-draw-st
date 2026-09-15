/*
 * Crossroads — capa de compatibilidad "tavo" para SillyTavern
 * ============================================================
 *
 * NO es una copia de entry.js/panel.html: es una traducción. entry.js y panel.html
 * se dejan exactamente como venían (mismo diseño, mismo HTML/CSS, misma lógica).
 * Este archivo solo crea un objeto global `window.tavo` con la misma forma que la
 * app Tavo, pero que por dentro usa las funciones reales de SillyTavern. entry.js
 * y panel.html siguen llamando a `tavo.get`, `tavo.generate`, `tavo.plugin.on`, etc.
 * sin saber que están hablando con SillyTavern.
 *
 * SUPUESTOS QUE HICE SOBRE LA API INTERNA DE SILLYTAVERN
 * -------------------------------------------------------
 * No tengo forma de ejecutar una instancia real de SillyTavern desde aquí, así que
 * esto está escrito contra la API pública documentada `SillyTavern.getContext()`
 * y contra nombres de función que son estándar en extensiones de terceros. Si algo
 * no funciona, lo más probable es que tu versión de SillyTavern haya renombrado
 * una de estas piezas. Busca los comentarios "ADAPTA AQUÍ" — están puestos
 * justo donde habría que tocar algo, y en el README-SILLYTAVERN.md hay una lista
 * de síntomas -> qué mirar.
 *
 * Diseño general de la traducción:
 *  - tavo.get/tavo.set(scope "global")  -> localStorage del navegador.
 *  - tavo.get/tavo.set(scope "chat")    -> chatMetadata de SillyTavern (se guarda
 *                                           dentro del propio archivo de chat), con
 *                                           localStorage como respaldo si no está
 *                                           disponible.
 *  - tavo.generate(prompt)              -> generación "cruda" (sin meter ficha de
 *                                           personaje/historial), vía generateRaw.
 *  - tavo.generate(prompt,{context:true}) -> generación silenciosa con el contexto
 *                                           normal del chat (generateQuietPrompt).
 *  - tavo.message.find / tavo.chat.current / tavo.character.get / tavo.persona.get
 *                                        -> leen el chat/personaje/persona activos.
 *  - tavo.input.set/send                -> escriben en el textarea de SillyTavern
 *                                           y disparan su envío normal.
 *  - tavo.plugin.on(...) / onSidebarAction(...) -> un emisor de eventos propio que
 *                                           este archivo alimenta a partir de los
 *                                           eventos reales de SillyTavern (ver más
 *                                           abajo, sección "puente de eventos").
 */

(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // 0. Acceso al contexto de SillyTavern
  // ---------------------------------------------------------------------

  function getCtx() {
    // ADAPTA AQUÍ si tu SillyTavern no expone esto: `SillyTavern.getContext()` es la
    // forma pública y documentada de que un script de terceros hable con la app.
    if (window.SillyTavern && typeof window.SillyTavern.getContext === "function") {
      return window.SillyTavern.getContext();
    }
    if (typeof window.getContext === "function") return window.getContext();
    throw new Error("Crossroads: no se encontró SillyTavern.getContext().");
  }

  function safeCtx() {
    try { return getCtx(); } catch (_) { return null; }
  }

  // ---------------------------------------------------------------------
  // 1. Emisor de eventos interno (lo que entry.js/panel.html consumen)
  // ---------------------------------------------------------------------

  var listeners = Object.create(null);
  var sidebarActions = Object.create(null);

  function on(eventName, handler) {
    if (!listeners[eventName]) listeners[eventName] = [];
    listeners[eventName].push(handler);
  }

  async function emit(eventName, eventObj) {
    var handlers = listeners[eventName];
    if (!handlers || !handlers.length) return eventObj;
    for (var i = 0; i < handlers.length; i += 1) {
      try { await handlers[i](eventObj); } catch (err) {
        console.error("[Crossroads/tavo-shim] error en handler de '" + eventName + "'", err);
      }
    }
    return eventObj;
  }

  function onSidebarAction(id, handler) {
    sidebarActions[id] = handler;
  }

  // ---------------------------------------------------------------------
  // 2. Variables: tavo.get / tavo.set
  // ---------------------------------------------------------------------

  var GLOBAL_PREFIX = "crossroads_global::";

  function currentChatKey() {
    var ctx = safeCtx();
    if (!ctx) return "unknown-chat";
    // ADAPTA AQUÍ si tu versión usa otro nombre para el id de chat activo.
    var id = ctx.chatId || ctx.chat_id || ctx.characterId || ctx.this_chid || "chat";
    var group = ctx.groupId || ctx.group_id || "";
    return String(group) + "::" + String(id);
  }

  function chatStore() {
    var ctx = safeCtx();
    if (ctx) {
      // ADAPTA AQUÍ: nombre real del objeto de metadatos del chat activo.
      if (ctx.chatMetadata && typeof ctx.chatMetadata === "object") return ctx.chatMetadata;
      if (ctx.chat_metadata && typeof ctx.chat_metadata === "object") return ctx.chat_metadata;
    }
    return null;
  }

  function persistChatStore() {
    var ctx = safeCtx();
    if (!ctx) return;
    try {
      if (typeof ctx.saveMetadataDebounced === "function") { ctx.saveMetadataDebounced(); return; }
      if (typeof ctx.saveMetadata === "function") { ctx.saveMetadata(); return; }
      if (typeof ctx.saveChatConditional === "function") { ctx.saveChatConditional(); return; }
    } catch (_) {}
  }

  function readVar(key, scope) {
    try {
      if (scope === "chat") {
        var store = chatStore();
        if (store) {
          var ns = store.crossroads || {};
          return Object.prototype.hasOwnProperty.call(ns, key) ? ns[key] : null;
        }
        var raw = localStorage.getItem("crossroads_chat::" + currentChatKey() + "::" + key);
        return raw == null ? null : JSON.parse(raw);
      }
      var g = localStorage.getItem(GLOBAL_PREFIX + key);
      return g == null ? null : JSON.parse(g);
    } catch (_) { return null; }
  }

  function writeVar(key, value, scope) {
    try {
      if (scope === "chat") {
        var store = chatStore();
        if (store) {
          if (!store.crossroads || typeof store.crossroads !== "object") store.crossroads = {};
          store.crossroads[key] = value;
          persistChatStore();
          return true;
        }
        localStorage.setItem("crossroads_chat::" + currentChatKey() + "::" + key, JSON.stringify(value));
        return true;
      }
      localStorage.setItem(GLOBAL_PREFIX + key, JSON.stringify(value));
      return true;
    } catch (_) { return false; }
  }

  // ---------------------------------------------------------------------
  // 3. Avisos (toast)
  // ---------------------------------------------------------------------

  function toast(message) {
    try {
      if (window.toastr && typeof window.toastr.info === "function") {
        window.toastr.info(String(message || ""), "Crossroads");
      } else {
        console.log("[Crossroads] " + message);
      }
    } catch (_) {}
    return Promise.resolve();
  }

  // ---------------------------------------------------------------------
  // 4. Chat / personajes / persona
  // ---------------------------------------------------------------------

  function nameFromCharacter(entry) {
    return entry && entry.character ? entry.character.name : "";
  }

  function currentCastEntries(ctx) {
    // Devuelve [{id, character}] para el/los personaje(s) activos del chat actual,
    // tanto en chat normal como en chat de grupo.
    var out = [];
    try {
      if (ctx.groupId && Array.isArray(ctx.groups)) {
        var group = ctx.groups.filter(function (g) { return String(g.id) === String(ctx.groupId); })[0];
        var members = group && Array.isArray(group.members) ? group.members : [];
        members.forEach(function (avatar) {
          var idx = (ctx.characters || []).findIndex(function (c) { return c && c.avatar === avatar; });
          if (idx > -1) out.push({ id: idx, character: ctx.characters[idx] });
        });
      } else {
        var cid = ctx.characterId != null ? ctx.characterId : ctx.this_chid;
        if (cid != null && ctx.characters && ctx.characters[cid]) {
          out.push({ id: cid, character: ctx.characters[cid] });
        }
      }
    } catch (_) {}
    return out;
  }

  var tavoChat = {
    current: function () {
      var ctx = safeCtx();
      if (!ctx) return null;
      var cast = currentCastEntries(ctx);
      return {
        persona: { id: "user-persona", name: ctx.name1 || "You" },
        personaId: "user-persona",
        characters: cast.map(function (e) { return { id: e.id, name: nameFromCharacter(e) }; }),
        characterIds: cast.map(function (e) { return e.id; })
      };
    }
  };

  var tavoPersona = {
    get: function () {
      // ADAPTA AQUÍ: SillyTavern guarda la descripción de la persona activa en
      // `power_user.persona_description`, que no siempre viaja dentro de getContext().
      // Si tu versión sí la expone (p. ej. ctx.powerUserSettings), esta función la
      // recogerá sola; si no, Crossroads simplemente sigue sin biografía de persona,
      // que es una degradación segura (el resto del plugin funciona igual).
      var ctx = safeCtx();
      try {
        var pu = ctx && (ctx.powerUserSettings || ctx.power_user || window.power_user);
        if (pu && typeof pu.persona_description === "string") {
          return { description: pu.persona_description };
        }
      } catch (_) {}
      return { description: "" };
    }
  };

  var tavoCharacter = {
    get: function (id) {
      var ctx = safeCtx();
      if (!ctx || !ctx.characters || !ctx.characters[id]) return null;
      return ctx.characters[id];
    }
  };

  // ---------------------------------------------------------------------
  // 5. Mensajes
  // ---------------------------------------------------------------------

  function toTavoMessage(stMsg, index) {
    if (!stMsg) return null;
    return {
      id: index,
      role: stMsg.is_user ? "user" : (stMsg.is_system ? "system" : "assistant"),
      isUser: !!stMsg.is_user,
      isHidden: !!stMsg.is_system,
      speakerName: stMsg.name,
      text: typeof stMsg.mes === "string" ? stMsg.mes : ""
    };
  }

  function allTavoMessages() {
    var ctx = safeCtx();
    var chat = (ctx && Array.isArray(ctx.chat)) ? ctx.chat : [];
    return chat.map(toTavoMessage).filter(Boolean);
  }

  var tavoMessage = {
    find: function (index, filter) {
      var all = allTavoMessages();
      var list = all;
      if (filter && filter.role) {
        list = list.filter(function (m) { return m.role === filter.role; });
      }
      if (index === -1) return list.length ? [list[list.length - 1]] : [];
      if (typeof index === "number") return list[index] ? [list[index]] : [];
      return list;
    }
  };

  // ---------------------------------------------------------------------
  // 6. Generación de texto
  // ---------------------------------------------------------------------

  async function tavoGenerate(prompt, options) {
    var ctx = getCtx();
    var withContext = !!(options && options.context === true);
    if (withContext) {
      // Generación "silenciosa" (no se agrega al chat) pero con el contexto normal
      // del chat: ficha del personaje, historial, jailbreak/instruct, etc.
      if (typeof ctx.generateQuietPrompt === "function") {
        return await ctx.generateQuietPrompt(prompt, false, false);
      }
    } else if (typeof ctx.generateRaw === "function") {
      // Generación "en crudo": solo el texto del prompt, sin meter ficha ni historial,
      // usando el backend/modelo conectado. Esto es lo más parecido a tavo.generate(prompt).
      try {
        return await ctx.generateRaw({ prompt: prompt });
      } catch (_) {
        try { return await ctx.generateRaw(prompt); } catch (_) {}
      }
    }
    // Último recurso si esta versión de SillyTavern no trae generateRaw.
    if (typeof ctx.generateQuietPrompt === "function") {
      return await ctx.generateQuietPrompt(prompt, false, true);
    }
    throw new Error("Crossroads: no se encontró generateRaw ni generateQuietPrompt en esta versión de SillyTavern.");
  }

  // ---------------------------------------------------------------------
  // 7. Caja de texto (input) y envío
  // ---------------------------------------------------------------------

  function textArea() { return document.getElementById("send_textarea"); }
  function sendButton() { return document.getElementById("send_but"); }

  function setInputText(text) {
    var ta = textArea();
    if (!ta) return false;
    ta.value = String(text || "");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  var bypassNextIntercept = false;

  function nativeSend() {
    var btn = sendButton();
    if (!btn) return false;
    bypassNextIntercept = true;
    btn.click();
    return true;
  }

  var tavoInput = {
    set: function (text) { return Promise.resolve(setInputText(text)); },
    send: function () { return Promise.resolve(nativeSend()); }
  };

  // ---------------------------------------------------------------------
  // 8. Puente de eventos: DOM/SillyTavern reales -> tavo.plugin.on(...)
  // ---------------------------------------------------------------------
  //
  // Tavo permite cancelar de verdad un envío antes de que ocurra ("input:beforeSend").
  // El DOM no permite eso de forma "esperable" (no se puede pausar un evento nativo
  // en medio de un await), así que se replica exactamente el mismo truco que ya usa
  // Tavo/entry.js: SIEMPRE se cancela el envío nativo primero, se le pregunta a
  // entry.js si de verdad quiere interceptarlo, y si no, este mismo shim reenvía el
  // mensaje él solito (marcando `bypassNextIntercept` para no volver a interceptarse
  // a sí mismo). Esto es exactamente la idea que el propio entry.js describe en sus
  // comentarios sobre el hook de Tavo — aquí se hace a nivel de DOM.

  async function interceptSend(domEvent) {
    if (bypassNextIntercept) { bypassNextIntercept = false; return; }
    var ta = textArea();
    var text = ta ? ta.value : "";

    domEvent.preventDefault();
    domEvent.stopPropagation();
    if (typeof domEvent.stopImmediatePropagation === "function") domEvent.stopImmediatePropagation();

    var evt = {
      text: text,
      chatId: currentChatKey(),
      source: "ui",
      _cancelled: false,
      cancel: function (reason) { this._cancelled = true; this._reason = reason; }
    };
    await emit("input:beforeSend", evt);

    if (!evt._cancelled) {
      // entry.js no quiso pausar este envío (modo de rutas apagado, comando de barra
      // diagonal, texto vacío, etc.) — se completa el envío que acabamos de bloquear.
      nativeSend();
      return;
    }

    // entry.js tomó el control. Cuando el usuario elija (o cancele) una ruta de
    // respuesta, panel.html llamará a tavo.input.send(), que termina en nativeSend()
    // más arriba.
  }

  function wireDomInterception() {
    document.addEventListener("click", function (e) {
      var btn = sendButton();
      if (btn && (e.target === btn || btn.contains(e.target))) interceptSend(e);
    }, true);

    document.addEventListener("keydown", function (e) {
      var ta = textArea();
      if (!ta || e.target !== ta) return;
      if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      interceptSend(e);
    }, true);
  }

  function wireAfterSend() {
    var ctx = safeCtx();
    if (!ctx || !ctx.eventSource || !ctx.event_types) return;
    var type = ctx.event_types.MESSAGE_SENT || ctx.event_types.USER_MESSAGE_RENDERED;
    if (!type) return;
    ctx.eventSource.on(type, function () {
      emit("input:afterSend", { text: textArea() ? textArea().value : "" });
    });
  }

  function wireChatChanged() {
    var ctx = safeCtx();
    if (!ctx || !ctx.eventSource || !ctx.event_types || !ctx.event_types.CHAT_CHANGED) return;
    ctx.eventSource.on(ctx.event_types.CHAT_CHANGED, function () {
      emit("chat:opened", {});
    });
  }

  function wireGenerationEnd() {
    var ctx = safeCtx();
    if (!ctx || !ctx.eventSource || !ctx.event_types) return;
    var endTypes = [
      ctx.event_types.GENERATION_ENDED,
      ctx.event_types.GENERATION_STOPPED,
      ctx.event_types.MESSAGE_RECEIVED
    ].filter(Boolean);
    endTypes.forEach(function (type) {
      ctx.eventSource.on(type, function (payload) {
        emit("generation:success", { generationId: payload });
      });
    });
  }

  // Response Paths: el bloque de "dirección" que entry.js arma en generation:prepare
  // no se puede insertar como texto plano en un `prompt` de SillyTavern (SillyTavern
  // arma el prompt internamente, no recibe un string único). En vez de eso, se usa
  // el mecanismo hecho justamente para esto: una inyección de prompt oculta, que se
  // limpia sola apenas termina la generación.
  var EXTENSION_PROMPT_KEY = "CROSSROADS_PATH";

  function setHiddenDirection(text) {
    var ctx = safeCtx();
    if (!ctx || typeof ctx.setExtensionPrompt !== "function") return;
    try {
      // position 1 = "en el chat" justo antes de la respuesta, profundidad 0 = pegado
      // al final. Si tu versión usa otras constantes, ajusta aquí.
      var position = (ctx.extension_prompt_types && ctx.extension_prompt_types.IN_CHAT != null)
        ? ctx.extension_prompt_types.IN_CHAT : 1;
      ctx.setExtensionPrompt(EXTENSION_PROMPT_KEY, text || "", position, 0, false, "system");
    } catch (_) {}
  }

  window.crossroads_interceptor = async function () {
    // Esto lo llama SillyTavern justo antes de generar la respuesta del personaje
    // (ver "generate_interceptor" en manifest.json). Es el reemplazo de
    // "generation:prepare" de Tavo.
    var evt = { text: "", source: "" };
    await emit("generation:prepare", evt);
    setHiddenDirection(evt.text);
  };

  // ---------------------------------------------------------------------
  // 9. Botón de mostrar/ocultar barra (equivalente al ítem de la barra lateral)
  // ---------------------------------------------------------------------

  function wireSidebarAction() {
    // Comando de barra diagonal: funciona siempre, sin importar el tema/versión.
    try {
      var ctx = safeCtx();
      if (ctx && typeof ctx.registerSlashCommand === "function") {
        ctx.registerSlashCommand("crossroads", function () {
          var handler = sidebarActions["toggle-bar"];
          if (handler) handler();
          return "";
        }, [], "Muestra u oculta la barra de Crossroads", true, true);
      }
    } catch (_) {}

    // Además, intento (silencioso, no crítico) agregar un ítem al menú de
    // extensiones de SillyTavern. Si tu versión tiene otra estructura, esto
    // simplemente no aparece ahí, pero /crossroads sigue funcionando.
    try {
      var menu = document.getElementById("extensionsMenu");
      if (menu) {
        var item = document.createElement("div");
        item.className = "list-group-item flex-container flexGap5 interactable";
        item.tabIndex = 0;
        item.textContent = "Mostrar/ocultar barra de Crossroads";
        item.addEventListener("click", function () {
          var handler = sidebarActions["toggle-bar"];
          if (handler) handler();
        });
        menu.appendChild(item);
      }
    } catch (_) {}
  }

  // ---------------------------------------------------------------------
  // 10. Ensamblado del objeto global `tavo`
  // ---------------------------------------------------------------------

  window.tavo = {
    get: readVar,
    set: writeVar,
    generate: tavoGenerate,
    chat: tavoChat,
    persona: tavoPersona,
    character: tavoCharacter,
    message: tavoMessage,
    input: tavoInput,
    utils: { toast: toast },
    plugin: {
      on: on,
      onSidebarAction: onSidebarAction,
      config: { get: function () { return null; } }
    }
  };

  wireDomInterception();
  wireAfterSend();
  wireChatChanged();
  wireGenerationEnd();
  wireSidebarAction();
})();
