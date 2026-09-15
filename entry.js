(function registerCrossroadsPlugin() {
  "use strict";

  var BAR_VISIBLE_KEY = "crossroads_bar_visible_v1";
  var VISIBILITY_EVENT = "crossroads:visibility";
  var PATH_MODE_KEY = "crossroads_path_mode_v1";
  var PATH_REQUEST_KEY = "crossroads_path_request_v1";
  var PATH_STATE_KEY = "crossroads_paths_v1";
  var PATH_HEARTBEAT_KEY = "crossroads_path_ui_heartbeat_v1";
  var PATH_REQUEST_MAX_AGE_MS = 5 * 60 * 1000;
  var PATH_HEARTBEAT_MAX_AGE_MS = 8000;

  function readVar(key, scope) {
    try {
      var value = tavo.get(key, scope);
      if (typeof value === "string") {
        try { return JSON.parse(value); } catch (_) {}
      }
      return value;
    } catch (_) {
      return null;
    }
  }

  function writeVar(key, value, scope) {
    try {
      tavo.set(key, value, scope);
      return true;
    } catch (_) {
      return false;
    }
  }

  function readVisible() {
    return readVar(BAR_VISIBLE_KEY, "global") !== false;
  }

  function publishVisible(visible) {
    var next = visible !== false;
    writeVar(BAR_VISIBLE_KEY, next, "global");
    try {
      window.dispatchEvent(new CustomEvent(VISIBILITY_EVENT, {
        detail: { visible: next }
      }));
    } catch (_) {}
    return next;
  }

  function pathModeEnabled() {
    return readVar(PATH_MODE_KEY, "global") === true;
  }

  function pathUiReady() {
    var heartbeat = readVar(PATH_HEARTBEAT_KEY, "global");
    return !!(heartbeat && heartbeat.ready === true &&
      Number.isFinite(Number(heartbeat.at)) &&
      Date.now() - Number(heartbeat.at) <= PATH_HEARTBEAT_MAX_AGE_MS);
  }

  function freshRequest(request) {
    return !!(request && typeof request === "object" &&
      Number.isFinite(Number(request.createdAt)) &&
      Date.now() - Number(request.createdAt) <= PATH_REQUEST_MAX_AGE_MS);
  }

  function directionBlock(path) {
    var text = path && typeof path.text === "string" ? path.text.trim() : "";
    if (!text) return "";
    return [
      "[Crossroads response direction - model-only]",
      text,
      "Take the reply in this direction. Do not quote, mention, or acknowledge this note. It is not visible to anyone in the scene.",
      "[/Crossroads response direction]"
    ].join("\n");
  }

  function currentPath(state) {
    if (!state || !Array.isArray(state.paths)) return null;
    var index = Number(state.active);
    return Number.isInteger(index) && index >= 0 && index < state.paths.length
      ? state.paths[index]
      : null;
  }

  async function lastUserMessage() {
    try {
      var found = await tavo.message.find(-1, { role: "user" });
      if (Array.isArray(found) && found.length) return found[0];
      if (found && Array.isArray(found.messages) && found.messages.length) {
        return found.messages[0];
      }
    } catch (_) {}
    try {
      var all = await tavo.message.find();
      var list = Array.isArray(all) ? all :
        (all && Array.isArray(all.messages) ? all.messages :
          (all && Array.isArray(all.items) ? all.items : []));
      for (var i = list.length - 1; i >= 0; i -= 1) {
        var role = String(list[i] && (list[i].role || list[i].author || list[i].sender) || "")
          .toLowerCase();
        if (role === "user" || role === "human" || role === "persona" ||
            (list[i] && (list[i].isUser === true || list[i].is_user === true))) {
          return list[i];
        }
      }
    } catch (_) {}
    return null;
  }

  tavo.plugin.onSidebarAction("toggle-bar", async function () {
    var visible = publishVisible(!readVisible());
    await tavo.utils.toast(visible ? "Crossroads bar shown." : "Crossroads bar hidden.");
  });

  // Tavo's pre-send hook cannot remain open while a user considers a modal. Crossroads
  // therefore cancels the first send immediately (which preserves both input and
  // attachments), lets the HTML fragment draw paths, then re-enters the normal send flow
  // once with `bypass` set. If Advanced Rendering is unavailable, the heartbeat is stale
  // and the message passes through untouched rather than getting stranded.
  tavo.plugin.on("input:beforeSend", async function (event) {
    if (!event || typeof event.text !== "string" || !pathModeEnabled()) return;
    var text = event.text;
    if (!text.trim() || /^\s*\//.test(text)) return;
    if (!pathUiReady()) return;

    var existing = readVar(PATH_REQUEST_KEY, "chat");
    if (freshRequest(existing) && existing.bypass === true &&
        String(existing.text || "") === text) {
      existing.bypass = false;
      existing.status = "sending";
      existing.sendAcceptedAt = Date.now();
      writeVar(PATH_REQUEST_KEY, existing, "chat");
      return;
    }

    if (freshRequest(existing) &&
        /^(?:pending|drawing|choosing|resuming)$/.test(String(existing.status || "")) &&
        String(existing.text || "") === text) {
      event.cancel("Choose a Crossroads response path, or send without one.");
      return;
    }

    var token = String(Date.now()) + "-" + Math.random().toString(36).slice(2);
    writeVar(PATH_STATE_KEY, null, "chat");
    writeVar(PATH_REQUEST_KEY, {
      token: token,
      chatId: event.chatId == null ? null : event.chatId,
      source: event.source || "ui",
      text: text,
      status: "pending",
      bypass: false,
      createdAt: Date.now()
    }, "chat");
    event.cancel("Crossroads is preparing response paths.");
  });

  tavo.plugin.on("input:afterSend", async function (event) {
    var request = readVar(PATH_REQUEST_KEY, "chat");
    if (!freshRequest(request) || String(request.text || "") !== String(event && event.text || "")) {
      writeVar(PATH_STATE_KEY, null, "chat");
      return;
    }
    var message = await lastUserMessage();
    request.status = request.status === "injected" ? "injected" : "accepted";
    request.userMessageId = message && message.id != null ? message.id : null;
    writeVar(PATH_REQUEST_KEY, request, "chat");

    var state = readVar(PATH_STATE_KEY, "chat");
    if (state && typeof state === "object" && state.token === request.token) {
      state.userMessageId = request.userMessageId;
      state.userText = request.text;
      state.updatedAt = Date.now();
      writeVar(PATH_STATE_KEY, state, "chat");
    }
  });

  tavo.plugin.on("generation:prepare", async function (event) {
    if (!event || typeof event.text !== "string") return;
    var source = String(event.source || "");
    var request = readVar(PATH_REQUEST_KEY, "chat");
    var state = readVar(PATH_STATE_KEY, "chat");
    var selected = null;

    var regeneration = /^(?:regeneration|regenerate|swipe)$/i.test(source);
    if (freshRequest(request) && request.selectedPath &&
        /^(?:resuming|sending|accepted)$/.test(String(request.status || "")) &&
        !regeneration) {
      selected = request.selectedPath;
      request.status = "injected";
      request.generationId = event.generationId;
      writeVar(PATH_REQUEST_KEY, request, "chat");
    } else if (regeneration) {
      var last = await lastUserMessage();
      var sameTurn = state && state.userMessageId != null && last &&
        String(last.id) === String(state.userMessageId);
      if (!sameTurn && state && typeof state.userText === "string") {
        sameTurn = state.userText.trim() === event.text.trim();
      }
      if (sameTurn) selected = currentPath(state);
    }

    var block = directionBlock(selected);
    if (block) {
      event.text = block + (event.text.trim()
        ? "\n\nCURRENT USER MESSAGE:\n" + event.text
        : "");
    }
  });

  ["generation:success", "generation:error", "generation:cancelled"].forEach(function (type) {
    tavo.plugin.on(type, async function (event) {
      var request = readVar(PATH_REQUEST_KEY, "chat");
      if (!request || typeof request !== "object") return;
      if (request.generationId && event && event.generationId &&
          request.generationId !== event.generationId) return;
      writeVar(PATH_REQUEST_KEY, null, "chat");
    });
  });
})();
