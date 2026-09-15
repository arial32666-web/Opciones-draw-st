# Crossroads para SillyTavern (puerto no oficial)

Esto es el plugin **Crossroads** de Jeppsterrr (originalmente para la app Tavo,
archivo `Crossroads-1_4_1.tpg`) adaptado para correr como extensión de
SillyTavern.

## Qué se tocó y qué no

- **`entry.js` y `panel.html`: cero cambios.** Son copia exacta (byte a byte)
  del `.tpg` original — mismo diseño, mismos textos, misma lógica de tonos,
  Response Paths, arrastre de la barra, todo.
- **`tavo-shim.js` (nuevo):** define un objeto `tavo` falso con la misma forma
  que usa la app Tavo (`tavo.get`, `tavo.generate`, `tavo.plugin.on`, etc.),
  pero por dentro llama a las funciones reales de SillyTavern. Es la única
  pieza "traducida".
- **`index.js` (nuevo):** solo carga los tres archivos anteriores en el orden
  correcto.
- **`manifest.json` (nuevo):** manifest en el formato que espera SillyTavern.

## Instalación

1. Copia toda esta carpeta (tal cual, con su nombre) dentro de:
   `SillyTavern/public/scripts/extensions/third-party/`
   Debe quedar, por ejemplo:
   `.../third-party/crossroads-st/manifest.json`
2. Reinicia SillyTavern (o recarga la pestaña con Ctrl+F5).
3. Ve a **Extensions** (el ícono de enchufe) y confirma que "Crossroads"
   aparezca activada.
4. Deberías ver la barra de Crossroads aparecer sobre el chat, igual que en
   Tavo.

Si no la ves: escribe `/crossroads` en el cuadro de mensaje y presiona enter —
eso alterna mostrar/ocultar la barra sin importar si el botón del menú de
extensiones apareció o no (ver más abajo).

## Cosas que dependen de tu versión de SillyTavern

No tengo forma de probar esto contra una instancia real de SillyTavern desde
aquí, así que escribí `tavo-shim.js` contra la API pública documentada
(`SillyTavern.getContext()`) y contra los nombres más comunes en extensiones
de terceros. Si algo no funciona, es casi seguro que tu versión renombró una
de estas piezas. Todas están marcadas con el comentario `ADAPTA AQUÍ` dentro
de `tavo-shim.js` para que sea fácil encontrarlas.

Guía rápida de síntomas:

| Síntoma | Qué mirar |
|---|---|
| No aparece la barra en absoluto | Abre la consola (F12) y busca líneas que empiecen con `[Crossroads]`. Si dice "no se pudo montar panel.html", el nombre de la carpeta de instalación no coincide con la ruta esperada — reinstala respetando la ruta de arriba. |
| La barra aparece pero "Draw" nunca responde | Busca el error en consola al momento de generar. Es casi seguro un problema en `tavoGenerate()` — puede que tu versión no tenga `generateRaw` (hay un respaldo automático a `generateQuietPrompt`, pero revisa igual). |
| Los nombres de personaje/jugador salen genéricos ("Narrator", "the player") | La función `currentCastEntries()` / `tavoChat.current()` no encontró el personaje activo — revisa cómo se llama `characterId`/`this_chid` en tu versión. |
| "Response Paths" no dirige nada la respuesta | Revisa que tu SillyTavern soporte `generate_interceptor` en el manifest y `setExtensionPrompt` en el contexto — son los dos ganchos que reemplazan el truco que usaba Tavo. |
| El botón para mostrar/ocultar desde el menú de Extensions no aparece | Usa `/crossroads` en su lugar (ver instalación). El menú de extensiones cambia de estructura entre versiones y ese botón es "mejor esfuerzo", no crítico. |
| Las preferencias (tonos, colores, API separada) no se guardan entre sesiones | El shim usa `localStorage` para los ajustes globales — revisa que tu navegador no esté en modo privado/incógnito ni bloqueando almacenamiento para esa pestaña. |
| Las rutas/opciones "se olvidan" al cambiar de chat mucho antes de lo esperado | El shim guarda los datos por chat en `chatMetadata` si tu versión lo expone; si no, cae a un respaldo por `localStorage` menos preciso. Revisa `chatStore()` en `tavo-shim.js`. |

## Diferencia de comportamiento que vale la pena saber

En Tavo, el mensaje del jugador se "retiene" en el cuadro de texto mientras se
arma la ventana de Response Paths (nunca llega a mandarse hasta elegir). En
SillyTavern reproduje ese mismo comportamiento a nivel de navegador
(interceptando el clic de enviar / Enter y reenviando yo mismo si no hacía
falta pausar), así que la experiencia visible debería ser idéntica. Si notas
que el mensaje se envía antes de tiempo en tu versión, es la señal de que el
truco de interceptar clics no está funcionando en tu build — avísame el
comportamiento exacto y lo ajusto.

## Créditos

Crossroads es de **Jeppsterrr**, con el flujo de "enhance" adaptado con
permiso de **Clowuds' Message Enhancer**. Este puerto solo agrega la capa de
compatibilidad con SillyTavern; no reclama autoría del plugin original.
