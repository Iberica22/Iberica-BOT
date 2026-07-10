/**
 * Ibérica Seguridad — Proxy FACTUSOL (Cloudflare Worker)
 *
 * Recibe presupuestos desde las páginas de GitHub Pages y los graba en
 * FACTUSOL (nube) a través de la API de Software Delsol, respetando la
 * numeración de la serie correspondiente:
 *
 *   origen "puertas" → serie 5 (Carpintería)
 *   origen "tarifas" → serie 7 (Particular)
 *
 * El cliente se busca primero por teléfono, después por nombre; si no
 * existe, se crea con los datos del formulario.
 *
 * SECRETOS (Configuración → Variables y secretos del Worker):
 *   DELSOL_FABRICANTE  → código de fabricante (int)
 *   DELSOL_CLIENTE     → código de cliente API (int)
 *   DELSOL_BASEDATOS   → base de datos (ej. FS011)
 *   DELSOL_PASSWORD    → contraseña de la API (en claro; se codifica aquí)
 *
 * VARIABLE opcional:
 *   ALLOWED_ORIGIN     → origen permitido para CORS
 *                        (por defecto https://iberica22.github.io)
 */

const DELSOL_BASE = 'https://api.sdelsol.com';

/* ═══════════════════════════════════════════════════════════════════════
 * ⚠️ ENDPOINTS PENDIENTES DE VALIDAR con https://apidoc.sdelsol.com
 * Solo /login/autenticar está confirmado. El resto se rellenará con la
 * documentación oficial (sección FACTUSOL → Clientes / Presupuestos).
 * ═══════════════════════════════════════════════════════════════════════ */
const EP = {
  login:               '/login/autenticar',
  obtenerClientes:     'PENDIENTE',   // listar/filtrar clientes
  nuevoCliente:        'PENDIENTE',   // alta de cliente
  obtenerPresupuestos: 'PENDIENTE',   // para calcular el siguiente número de la serie
  nuevoPresupuesto:    'PENDIENTE',   // alta de presupuesto (cabecera + líneas)
};

const SERIES = { puertas: 5, tarifas: 7 };

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || 'https://iberica22.github.io';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);

    try {
      // Diagnóstico: comprueba credenciales sin tocar datos
      if (url.pathname === '/ping') {
        const token = await autenticar(env);
        return json({ ok: true, mensaje: 'Autenticación correcta contra la API Delsol', tokenRecibido: Boolean(token) }, 200, cors);
      }

      if (url.pathname === '/presupuesto' && request.method === 'POST') {
        const datos = await request.json();
        const resultado = await grabarPresupuesto(env, datos);
        return json({ ok: true, ...resultado }, 200, cors);
      }

      return json({ ok: false, error: 'Ruta no válida. Usa POST /presupuesto o GET /ping' }, 404, cors);
    } catch (err) {
      return json({ ok: false, error: String(err.message || err) }, 500, cors);
    }
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors },
  });
}

/* ───────────────────────── Autenticación ───────────────────────── */

async function autenticar(env) {
  const body = {
    codigoFabricante: Number(env.DELSOL_FABRICANTE),
    codigoCliente: Number(env.DELSOL_CLIENTE),
    baseDatosCliente: env.DELSOL_BASEDATOS,
    password: btoa(env.DELSOL_PASSWORD), // la API exige la contraseña en BASE64
  };
  const res = await fetch(DELSOL_BASE + EP.login, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Login Delsol falló (HTTP ${res.status}): ${await res.text()}`);
  const j = await res.json();
  const token = j?.resultado?.token || j?.resultado || j?.token;
  if (!token || typeof token !== 'string') {
    throw new Error('Login Delsol no devolvió token. Respuesta: ' + JSON.stringify(j).slice(0, 300));
  }
  return token;
}

/** Llama a la API con el token; si devuelve 401 con el token en crudo,
 *  reintenta con el prefijo "Bearer" (el formato exacto depende de la doc). */
async function llamadaApi(token, endpoint, payload) {
  if (endpoint === 'PENDIENTE') {
    throw new Error('Endpoint sin configurar: falta completar la sección EP de worker.js con la documentación de apidoc.sdelsol.com');
  }
  const doFetch = (auth) => fetch(DELSOL_BASE + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify(payload),
  });
  let res = await doFetch(token);
  if (res.status === 401) res = await doFetch('Bearer ' + token);
  if (!res.ok) throw new Error(`API Delsol ${endpoint} falló (HTTP ${res.status}): ${await res.text()}`);
  return res.json();
}

/* ───────────────────────── Lógica de negocio ───────────────────────── */

async function grabarPresupuesto(env, datos) {
  const serie = SERIES[datos?.origen];
  if (!serie) throw new Error(`Origen desconocido: "${datos?.origen}" (esperado: puertas | tarifas)`);
  if (!Array.isArray(datos.lineas) || datos.lineas.length === 0) throw new Error('El presupuesto no tiene líneas');
  const cli = datos.cliente || {};
  if (!cli.nombre) throw new Error('Falta el nombre del cliente');

  const token = await autenticar(env);

  // 1) Localizar o crear cliente (por teléfono, luego por nombre)
  const cliente = await localizarOCrearCliente(token, cli);

  // 2) Siguiente número de la serie según FACTUSOL
  const numero = await siguienteNumero(token, serie);

  // 3) Crear presupuesto
  await crearPresupuesto(token, { serie, numero, cliente, datos });

  return {
    serie,
    numero,
    numeroFormateado: `${serie}/${String(numero).padStart(6, '0')}`,
    cliente: { codigo: cliente.codigo, creado: cliente.creado },
  };
}

/* Las tres funciones siguientes dependen de los endpoints PENDIENTES.
 * Su estructura interna (nombres de campos del JSON) se ajustará con la
 * documentación oficial. */

async function localizarOCrearCliente(token, cli) {
  const telefono = (cli.telefono || '').replace(/[\s\-.]/g, '');

  // Búsqueda por teléfono
  if (telefono) {
    const porTel = await llamadaApi(token, EP.obtenerClientes, { filtro: { telefono } });
    const encontrado = extraerPrimerCliente(porTel, telefono, null);
    if (encontrado) return { ...encontrado, creado: false };
  }

  // Búsqueda por nombre
  const porNombre = await llamadaApi(token, EP.obtenerClientes, { filtro: { nombre: cli.nombre } });
  const encontrado = extraerPrimerCliente(porNombre, null, cli.nombre);
  if (encontrado) return { ...encontrado, creado: false };

  // Alta de cliente nuevo
  const alta = await llamadaApi(token, EP.nuevoCliente, {
    nombre: cli.nombre,
    telefono: cli.telefono || '',
    email: cli.email || '',
    domicilio: cli.direccion || '',
  });
  const codigo = alta?.resultado?.codigo ?? alta?.codigo;
  if (codigo == null) throw new Error('El alta de cliente no devolvió código: ' + JSON.stringify(alta).slice(0, 300));
  return { codigo, nombre: cli.nombre, creado: true };
}

function extraerPrimerCliente(respuesta, telefono, nombre) {
  const lista = respuesta?.resultado?.clientes || respuesta?.resultado || respuesta?.clientes || [];
  if (!Array.isArray(lista)) return null;
  const norm = (s) => String(s || '').toLowerCase().replace(/[\s\-.]/g, '');
  for (const c of lista) {
    if (telefono && [c.telefono, c.telefono1, c.telefono2, c.movil].some((t) => norm(t) === norm(telefono))) {
      return { codigo: c.codigo ?? c.codigoCliente, nombre: c.nombre };
    }
    if (nombre && norm(c.nombre) === norm(nombre)) {
      return { codigo: c.codigo ?? c.codigoCliente, nombre: c.nombre };
    }
  }
  return null;
}

async function siguienteNumero(token, serie) {
  const res = await llamadaApi(token, EP.obtenerPresupuestos, { filtro: { serie } });
  const lista = res?.resultado?.presupuestos || res?.resultado || res?.presupuestos || [];
  let max = 0;
  if (Array.isArray(lista)) {
    for (const p of lista) {
      const n = Number(p.numero ?? p.codigo ?? 0);
      if (n > max) max = n;
    }
  }
  return max + 1;
}

async function crearPresupuesto(token, { serie, numero, cliente, datos }) {
  const hoy = new Date().toISOString().slice(0, 10);
  const lineas = datos.lineas.map((l, i) => ({
    orden: i + 1,
    articulo: l.codigo || '',
    descripcion: l.descripcion,
    cantidad: l.cantidad || 1,
    precio: redondear(l.precioBase),       // precio unitario SIN IVA
    iva: l.ivaPct ?? 21,
  }));
  return llamadaApi(token, EP.nuevoPresupuesto, {
    serie,
    numero,
    fecha: hoy,
    codigoCliente: cliente.codigo,
    observaciones: datos.notas || '',
    lineas,
  });
}

function redondear(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
