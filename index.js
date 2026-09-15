/*
 * Crossroads — arranque de la extensión para SillyTavern
 * ========================================================
 * Este archivo es el único que SillyTavern ejecuta directamente (ver manifest.json).
 * Su trabajo es solo de "plomería": no contiene lógica de Crossroads.
 *
 *   1. Carga tavo-shim.js, que define `window.tavo`.
 *   2. Inyecta panel.html tal cual (mismo HTML/CSS/JS, sin editar una sola línea)
 *      dentro de <body>, igual que Tavo lo montaba en "/chat/body/end".
 *   3. Carga entry.js tal cual, como script normal.
 *
 * Si algo de esto falla, revisa la consola del navegador (F12): cada paso deja
 * un mensaje "[Crossroads]" indicando qué salió mal.
 */

import "./tavo-shim.js";

const BASE_URL = new URL(".", import.meta.url).href;

function loadScriptTag(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("No se pudo cargar " + src));
    document.body.appendChild(s);
  });
}

async function mountPanelFragment() {
  const res = await fetch(BASE_URL + "panel.html");
  if (!res.ok) throw new Error("No se pudo leer panel.html (" + res.status + ")");
  const html = await res.text();

  const tmp = document.createElement("div");
  tmp.innerHTML = html;

  // Los <script> insertados vía innerHTML no se ejecutan solos (así lo hacen los
  // navegadores por seguridad), así que se sacan primero y luego se recrean como
  // elementos <script> nuevos con el mismo contenido, para que sí corran.
  const inlineScripts = Array.from(tmp.querySelectorAll("script"));
  inlineScripts.forEach((node) => node.remove());

  while (tmp.firstChild) {
    document.body.appendChild(tmp.firstChild);
  }

  inlineScripts.forEach((oldScript) => {
    const s = document.createElement("script");
    s.textContent = oldScript.textContent;
    document.body.appendChild(s);
  });
}

async function boot() {
  try {
    await mountPanelFragment();
  } catch (err) {
    console.error("[Crossroads] no se pudo montar panel.html:", err);
    return;
  }
  try {
    await loadScriptTag(BASE_URL + "entry.js");
  } catch (err) {
    console.error("[Crossroads] no se pudo cargar entry.js:", err);
  }
  console.log("[Crossroads] extensión cargada.");
}

if (document.body) {
  boot();
} else {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
}
