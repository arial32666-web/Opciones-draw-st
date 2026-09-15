/*
 * Crossroads — arranque de la extensión para SillyTavern
 * ========================================================
 * Este archivo es el único que SillyTavern ejecuta directamente (ver manifest.json).
 * Su trabajo es solo de "plomería": no contiene lógica de Crossroads.
 *
 *   1. Carga tavo-shim.js, que expone `window.__crossroadsBuildTavo()` — una
 *      fábrica que arma un objeto `tavo` nuevo cada vez que se llama.
 *   2. Llama a esa fábrica UNA vez para obtener la copia de `tavo` de esta
 *      extensión (no se guarda en ningún lado global, así que no puede
 *      chocar con la de otra extensión CCC portada de la misma forma).
 *   3. Inyecta panel.html tal cual (mismo HTML/CSS/JS, sin editar una sola
 *      línea) dentro de <body>, y ejecuta su <script> pasándole esa copia
 *      de `tavo` como si fuera una variable local del archivo.
 *   4. Ejecuta entry.js de la misma forma.
 *
 * Si algo de esto falla, aparece un aviso rojo abajo de la pantalla (no solo
 * en la consola), porque en apps envolventes como TauriTavern en celular no
 * siempre hay forma fácil de abrir las herramientas de desarrollador.
 */

import "./tavo-shim.js";

const BASE_URL = new URL(".", import.meta.url).href;

function showVisibleError(label, err) {
  const message = err && err.message ? err.message : String(err);
  console.error("[Crossroads] " + label + ":", err);
  try {
    const box = document.createElement("div");
    box.textContent = "[Crossroads] " + label + ": " + message;
    box.style.cssText = "position:fixed;left:8px;right:8px;bottom:8px;z-index:999999;"
      + "background:#3a0d0d;color:#ffb3b3;border:1px solid #ff6b6b;border-radius:8px;"
      + "padding:10px 12px;font:12px/1.4 monospace;white-space:pre-wrap;max-height:40vh;"
      + "overflow:auto;box-shadow:0 2px 10px rgba(0,0,0,.5);";
    const closeBtn = document.createElement("div");
    closeBtn.textContent = "✕ cerrar";
    closeBtn.style.cssText = "float:right;cursor:pointer;opacity:.8;margin-left:8px;";
    closeBtn.addEventListener("click", () => box.remove());
    box.prepend(closeBtn);
    document.body.appendChild(box);
  } catch (_) {}
}

// Ejecuta el texto de un script tal cual (sin modificarlo) pero dentro de una
// función que recibe `tavo` como parámetro, en vez de depender de una
// variable global compartida con otras extensiones.
function runWithLocalTavo(code, tavo, label) {
  try {
    const fn = new Function("tavo", code);
    fn(tavo);
  } catch (err) {
    showVisibleError("error ejecutando " + label, err);
  }
}

async function fetchText(path) {
  const res = await fetch(BASE_URL + path);
  if (!res.ok) throw new Error("No se pudo leer " + path + " (" + res.status + ")");
  return res.text();
}

async function mountPanelFragment(tavo) {
  const html = await fetchText("panel.html");

  const tmp = document.createElement("div");
  tmp.innerHTML = html;

  // El <script> insertado vía innerHTML no se ejecuta solo (así lo hacen los
  // navegadores por seguridad), así que se saca su texto y se corre aparte
  // con runWithLocalTavo, en vez de dejar que el navegador lo ejecute solo.
  const inlineScripts = Array.from(tmp.querySelectorAll("script"));
  inlineScripts.forEach((node) => node.remove());

  while (tmp.firstChild) {
    document.body.appendChild(tmp.firstChild);
  }

  inlineScripts.forEach((node) => {
    runWithLocalTavo(node.textContent, tavo, "panel.html");
  });
}

async function boot() {
  if (typeof window.__crossroadsBuildTavo !== "function") {
    showVisibleError("arranque", new Error("tavo-shim.js no cargó correctamente."));
    return;
  }
  const tavo = window.__crossroadsBuildTavo();

  try {
    await mountPanelFragment(tavo);
  } catch (err) {
    showVisibleError("no se pudo montar panel.html", err);
    return;
  }

  try {
    const entryCode = await fetchText("entry.js");
    runWithLocalTavo(entryCode, tavo, "entry.js");
  } catch (err) {
    showVisibleError("no se pudo cargar entry.js", err);
  }

  console.log("[Crossroads] extensión cargada.");
}

if (document.body) {
  boot();
} else {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
}
