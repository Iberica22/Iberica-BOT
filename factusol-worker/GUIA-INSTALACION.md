# Guía: conectar las páginas de presupuestos con FACTUSOL

Las páginas de GitHub Pages (buscador de tarifas y configurador de puertas)
envían los presupuestos a un **Cloudflare Worker** (gratuito), que es quien
habla con la API de Software Delsol y graba el presupuesto en FACTUSOL con
la numeración de la serie que corresponde:

| Página | Origen | Serie FACTUSOL |
|---|---|---|
| Configurador de puertas (`puertas.html`) | `puertas` | **5 — Carpintería** |
| Buscador de tarifas (`index.html`) | `tarifas` | **7 — Particular** |

Las credenciales de la API **nunca** están en las páginas (son públicas);
viven cifradas dentro del Worker.

## Paso 1 — Crear cuenta gratuita en Cloudflare

1. Entra en <https://dash.cloudflare.com/sign-up> y regístrate (gratis, sin tarjeta).
2. En el menú lateral: **Workers y Pages** → **Crear** → **Crear Worker**.
3. Ponle de nombre `factusol-iberica` y pulsa **Implementar** (con el código de ejemplo, da igual).

## Paso 2 — Pegar el código del Worker

1. En el Worker recién creado, pulsa **Editar código**.
2. Borra todo y pega el contenido completo del archivo [`worker.js`](./worker.js) de esta carpeta.
3. Pulsa **Implementar** (arriba a la derecha).

## Paso 3 — Guardar las credenciales como secretos

En el Worker: **Configuración** → **Variables y secretos** → **Agregar**.
Crea estos 4 secretos (tipo **Secreto**, no texto plano):

| Nombre | Valor |
|---|---|
| `DELSOL_FABRICANTE` | Código de fabricante (correo "DELSOL API") |
| `DELSOL_CLIENTE` | Código de cliente API |
| `DELSOL_BASEDATOS` | Base de datos (ej. `FS011`) |
| `DELSOL_PASSWORD` | Contraseña de la API |

## Paso 4 — Probar las credenciales

Abre en el navegador:

```
https://factusol-iberica.<tu-subdominio>.workers.dev/ping
```

Si devuelve `{"ok":true,...}` la autenticación funciona.
Si devuelve error, copia el mensaje y pásaselo a Claude.

## Paso 5 — Conectar las páginas

Copia la URL del Worker (aparece en su panel, termina en `.workers.dev`) y
pégala en la constante `FACTUSOL_WEBHOOK_URL` al principio del bloque
`<script>` de `docs/puertas.html` y `docs/index.html`:

```js
const FACTUSOL_WEBHOOK_URL = 'https://factusol-iberica.xxxxx.workers.dev';
```

(O pídeselo a Claude: con darle la URL, actualiza ambas páginas y publica.)

Mientras esa constante esté vacía, el botón «Guardar en FACTUSOL» no se
muestra — las páginas siguen funcionando como siempre.

## Cómo funciona al grabar

1. El usuario rellena el presupuesto y pulsa **💾 Guardar en FACTUSOL**.
2. El Worker busca el cliente por **teléfono**; si no, por **nombre**; si no existe, **lo crea**.
3. Consulta el último presupuesto de la serie y asigna el **siguiente número**.
4. Graba el presupuesto (cabecera + líneas, precios sin IVA + 21%).
5. La página muestra el número real (ej. `5/000123`) y lo usa en el PDF.

## Estado actual

- ⚠️ Los endpoints exactos de la API (clientes y presupuestos) están
  **pendientes de confirmar** con la documentación oficial
  (<https://apidoc.sdelsol.com>) — están marcados como `PENDIENTE` en la
  sección `EP` de `worker.js`. Hasta completarlos, `/ping` funciona pero
  `/presupuesto` devolverá un error explicativo.
