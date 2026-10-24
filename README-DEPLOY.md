# Mi Plata · despliegue en Vercel con sincronización PC ↔ celular

La app es un solo HTML (`index.html`). Para que los cambios que hagas en el PC
se vean en el celular con la misma URL, el proyecto incluye una API mínima
(`/api/data`) que guarda todo tu estado en **Vercel KV** (una base clave-valor
gratis que Vercel conecta con un clic).

## Pasos (10 minutos)

1. **Sube el proyecto**
   - Opción A (Git): sube esta carpeta `vercel/` a un repo de GitHub y en
     https://vercel.com → *Add New… → Project* → importa el repo. Framework: *Other*.
   - Opción B (CLI): `npm i -g vercel` → dentro de esta carpeta: `vercel` y luego `vercel --prod`.
2. **Conecta el almacenamiento KV**
   - En el dashboard de Vercel: *Storage → Create Database → KV* → créala y
     dale *Connect* a tu proyecto. Eso inyecta solo las variables
     `KV_REST_API_URL` / `KV_REST_API_TOKEN` que usa `/api/data`.
   - Haz *Redeploy* del proyecto para que tome las variables.
3. **Listo**: abre la URL (`https://tu-proyecto.vercel.app`) en el PC y en el celular.
   - El botón **☁️** del encabezado significa "sincronizado con la nube";
     **⚠️** significa "solo este dispositivo" (revisa el paso 2).
   - Cada *💾 Guardar* / cierre de mes sube el estado (con 0,8 s de debounce);
     el otro dispositivo lo baja al abrir, al volver a la pestaña, cada 45 s,
     o al pulsar ☁️. Gana el último cambio guardado (last-write-wins).

## Privacidad y respaldos
- Todo tu estado viaja como un solo JSON a tu propia KV (nadie más tiene la URL de escritura).
- El botón **⬇ Respaldo** sigue existiendo para bajar una copia local en cualquier momento.
- Si KV no está conectada, la app funciona igual pero en modo local (⚠️).

## Estructura
```
vercel/
  index.html      ← la app completa (sin dependencias externas)
  api/data.js     ← GET/PUT del estado en Vercel KV
  package.json    ← dependencia @vercel/kv
  vercel.json     ← rewrite de / a index.html
```
