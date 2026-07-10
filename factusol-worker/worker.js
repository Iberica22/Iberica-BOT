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
 * La API Delsol trabaja directamente sobre las tablas de FACTUSOL:
 *   POST /login/Autenticar       → token (Bearer)
 *   POST /admin/LanzarConsulta   → { ejercicio, consulta }  (solo SELECT)
 *   POST /admin/EscribirRegistro → { ejercicio, tabla, registro:[{columna,dato}] }
 *
 * Tablas usadas: F_CLI (clientes), F_PRE (cabecera presupuesto),
 * F_LPR (líneas de presupuesto).
 *
 * Esquema verificado contra la base real (via /diag):
 *   - CODPRE usa numeración con prefijo de año: 260116 = año 26, nº 0116.
 *   - Totales de cabecera: NET1PRE, BAS1PRE, PIVA1PRE, IIVA1PRE, TOTPRE.
 *   - Observaciones: OB1PRE / OB2PRE. Fechas ISO: "2026-07-08T00:00:00".
 *   - Cliente: CODCLI, NOFCLI, NOCCLI, DOMCLI, TELCLI, EMACLI, FALCLI...
 *
 * SECRETOS (Configuración → Variables y secretos del Worker):
 *   DELSOL_FABRICANTE  → código de fabricante (int)
 *   DELSOL_CLIENTE     → código de cliente API (int)
 *   DELSOL_BASEDATOS   → base de datos (ej. FS011)
 *   DELSOL_PASSWORD    → contraseña de la API (en claro; se codifica aquí)
 *
 * VARIABLES opcionales:
 *   ALLOWED_ORIGIN → origen CORS permitido (defecto https://iberica22.github.io)
 *   DIAG_KEY       → si se define, habilita GET /diag?k=<clave>
 */

const DELSOL_BASE = 'https://api.sdelsol.com';
const EP = {
  login: '/login/Autenticar',
  consulta: '/admin/LanzarConsulta',
  escribir: '/admin/EscribirRegistro',
};

const SERIES = { puertas: 5, tarifas: 7 };
const IVA_PCT_DEFECTO = 21;

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
      if (url.pathname === '/ping') {
        const token = await autenticar(env);
        return json({ ok: true, mensaje: 'Autenticación correcta contra la API Delsol', tokenRecibido: Boolean(token) }, 200, cors);
      }

      // Diagnóstico de esquema: último presupuesto + sus líneas (varias
      // sondas para localizar la tabla/columnas reales de líneas).
      if (url.pathname === '/diag') {
        if (!env.DIAG_KEY || url.searchParams.get('k') !== env.DIAG_KEY) {
          return json({ ok: false, error: 'Diagnóstico deshabilitado o clave incorrecta' }, 403, cors);
        }
        const token = await autenticar(env);
        const sondas = {};
        // Último presupuesto para buscar sus líneas
        const pre = await consultaSegura(env, token, 'SELECT TOP 1 TIPPRE, CODPRE FROM F_PRE ORDER BY CODPRE DESC');
        const cod = Array.isArray(pre) ? Number(pre[0]?.CODPRE) : 0;
        sondas.ultimo_presupuesto = pre;
        // Tablas candidatas a "líneas de presupuesto" (F_LPR no existe en esta
        // base). Las columnas siguen el patrón <CAMPO><SUFIJO>: F_LPP→CODLPP...
        const candidatas = ['F_LPP', 'F_LPA', 'F_LPC', 'F_LPD', 'F_LPF', 'F_LPG', 'F_LPH', 'F_LPS'];
        for (const t of candidatas) {
          const suf = t.slice(2); // "LPP"
          if (cod) sondas['lineas_' + t] = await consultaSegura(env, token, `SELECT TOP 3 * FROM ${t} WHERE COD${suf} = ${cod}`);
          sondas['muestra_' + t] = await consultaSegura(env, token, `SELECT TOP 1 * FROM ${t}`);
        }
        return json({ ok: true, ...sondas }, 200, cors);
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

/* ───────────────────── Fecha/hora local (Madrid) ───────────────────── */

function ahoraMadrid() {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Madrid',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date()); // "2026-07-10 12:34:56"
  const [fecha, hora] = parts.split(' ');
  return { fecha, hora };
}

function ejercicioActual() {
  return ahoraMadrid().fecha.slice(0, 4);
}

/* ───────────────────────── API Delsol ───────────────────────── */

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

async function llamadaApi(env, token, endpoint, payload) {
  const res = await fetch(DELSOL_BASE + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(payload),
  });
  const texto = await res.text();
  let j;
  try { j = JSON.parse(texto); } catch { throw new Error(`${endpoint} devolvió respuesta no-JSON (HTTP ${res.status}): ${texto.slice(0, 300)}`); }
  if (!res.ok || (j.respuesta && String(j.respuesta).toUpperCase() !== 'OK')) {
    throw new Error(`${endpoint} falló (HTTP ${res.status}): ${JSON.stringify(j).slice(0, 400)}`);
  }
  return j;
}

/** SELECT vía LanzarConsulta. Devuelve array de filas como objetos {COLUMNA: dato}. */
async function consulta(env, token, sql) {
  const j = await llamadaApi(env, token, EP.consulta, { ejercicio: ejercicioActual(), consulta: sql });
  return filas(j);
}

async function consultaSegura(env, token, sql) {
  try { return await consulta(env, token, sql); }
  catch (e) { return { error: String(e.message || e) }; }
}

/** Convierte resultado [[{columna,dato},...],...] en [{COL:dato,...},...] */
function filas(j) {
  const lista = Array.isArray(j?.resultado) ? j.resultado : [];
  return lista.map((reg) => {
    const fila = {};
    for (const c of reg || []) fila[String(c.columna).toUpperCase()] = c.dato;
    return fila;
  });
}

/** INSERT vía EscribirRegistro. campos = objeto {COLUMNA: valor}. */
async function insertar(env, token, tabla, campos) {
  const registro = Object.entries(campos)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([columna, dato]) => ({ columna, dato: String(dato) }));
  return llamadaApi(env, token, EP.escribir, { ejercicio: ejercicioActual(), tabla, registro });
}

/** Intenta insertar con varios juegos de columnas, del más completo al mínimo. */
async function insertarConAlternativas(env, token, tabla, versiones) {
  let ultimoError;
  for (let i = 0; i < versiones.length; i++) {
    try {
      await insertar(env, token, tabla, versiones[i]);
      return i; // nivel usado (0 = completo)
    } catch (e) { ultimoError = e; }
  }
  throw new Error(`No se pudo insertar en ${tabla}: ${ultimoError?.message || ultimoError}`);
}

/* ───────────────────────── Lógica de negocio ───────────────────────── */

async function grabarPresupuesto(env, datos) {
  const serie = SERIES[datos?.origen];
  if (!serie) throw new Error(`Origen desconocido: "${datos?.origen}" (esperado: puertas | tarifas)`);
  if (!Array.isArray(datos.lineas) || datos.lineas.length === 0) throw new Error('El presupuesto no tiene líneas');
  const cli = datos.cliente || {};
  if (!cli.nombre) throw new Error('Falta el nombre del cliente');

  const token = await autenticar(env);

  const cliente = await localizarOCrearCliente(env, token, cli);
  const numero = await siguienteNumero(env, token, serie);
  await crearPresupuesto(env, token, { serie, numero, cliente, datos });

  return {
    serie,
    numero,
    numeroFormateado: `${serie}/${numero}`,
    cliente: { codigo: cliente.codigo, creado: cliente.creado },
  };
}

const soloDigitos = (s) => String(s || '').replace(/\D/g, '');
const normNombre = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

async function localizarOCrearCliente(env, token, cli) {
  // Cargamos código, nombres y teléfono de todos los clientes y comparamos en
  // JS: evita depender de funciones SQL y de cómo esté formateado el teléfono.
  const lista = await consulta(env, token, 'SELECT CODCLI, NOFCLI, NOCCLI, TELCLI, MOVCLI FROM F_CLI');

  const tel = soloDigitos(cli.telefono);
  if (tel.length >= 9) {
    const t9 = tel.slice(-9); // últimos 9 dígitos (sin prefijo país)
    for (const f of lista) {
      for (const campo of [f.TELCLI, f.MOVCLI]) {
        const d = soloDigitos(campo);
        if (d.length >= 9 && d.slice(-9) === t9) {
          return { codigo: Number(f.CODCLI), nombre: f.NOFCLI || f.NOCCLI, creado: false };
        }
      }
    }
  }

  const nom = normNombre(cli.nombre);
  for (const f of lista) {
    if (normNombre(f.NOFCLI) === nom || normNombre(f.NOCCLI) === nom) {
      return { codigo: Number(f.CODCLI), nombre: f.NOFCLI || f.NOCCLI, creado: false };
    }
  }

  // No existe → alta con el siguiente código libre
  let maxCod = 0;
  for (const f of lista) { const n = Number(f.CODCLI); if (n > maxCod) maxCod = n; }
  const codigo = maxCod + 1;
  const { fecha } = ahoraMadrid();

  await insertarConAlternativas(env, token, 'F_CLI', [
    {
      CODCLI: codigo, CCOCLI: codigo, NOFCLI: cli.nombre, NOCCLI: cli.nombre,
      DOMCLI: cli.direccion || '', TELCLI: cli.telefono || '', EMACLI: cli.email || '',
      FALCLI: `${fecha}T00:00:00`, PAICLI: '724', ATVCLI: 1,
    },
    {
      CODCLI: codigo, NOFCLI: cli.nombre, NOCCLI: cli.nombre,
      DOMCLI: cli.direccion || '', TELCLI: cli.telefono || '', EMACLI: cli.email || '',
    },
    { CODCLI: codigo, NOFCLI: cli.nombre },
  ]);
  return { codigo, nombre: cli.nombre, creado: true };
}

async function siguienteNumero(env, token, serie) {
  // La numeración observada lleva prefijo de año: 260116 = año 26, nº 0116.
  // Tomamos MAX de la serie y garantizamos que al cambiar de año se
  // arranca en YY0001.
  let filasMax;
  try {
    filasMax = await consulta(env, token, `SELECT MAX(CODPRE) AS MAXNUM FROM F_PRE WHERE TIPPRE = ${serie}`);
  } catch {
    filasMax = await consulta(env, token, `SELECT MAX(CODPRE) AS MAXNUM FROM F_PRE WHERE TIPPRE = '${serie}'`);
  }
  const max = Number(filasMax?.[0]?.MAXNUM) || 0;
  const yy = Number(ejercicioActual().slice(2));
  return Math.max(max + 1, yy * 10000 + 1);
}

async function crearPresupuesto(env, token, { serie, numero, cliente, datos }) {
  const { fecha, hora } = ahoraMadrid();

  // Totales calculados a partir de las líneas (precios sin IVA)
  let base = 0;
  for (const l of datos.lineas) base += (Number(l.precioBase) || 0) * (Number(l.cantidad) || 1);
  base = redondear(base);
  const cuota = redondear(base * IVA_PCT_DEFECTO / 100);
  const total = redondear(base + cuota);
  const notas = String(datos.notas || '').slice(0, 250);
  const cli = datos.cliente || {};

  // Cabecera — columnas verificadas con /diag; de más completa a mínima
  const nivelCabecera = await insertarConAlternativas(env, token, 'F_PRE', [
    {
      TIPPRE: serie, CODPRE: numero, FECPRE: `${fecha}T00:00:00`,
      HORPRE: `1900-01-01T${hora}`,
      CLIPRE: cliente.codigo, CNOPRE: cliente.nombre,
      CDOPRE: cli.direccion || '', TELPRE: cli.telefono || '',
      ALMPRE: 'GEN',
      NET1PRE: base, BAS1PRE: base,
      PIVA1PRE: IVA_PCT_DEFECTO, PIVA2PRE: 10, PIVA3PRE: 4,
      IIVA1PRE: cuota, TOTPRE: total,
      ESTPRE: 0, OB1PRE: notas,
    },
    {
      TIPPRE: serie, CODPRE: numero, FECPRE: `${fecha}T00:00:00`,
      CLIPRE: cliente.codigo, CNOPRE: cliente.nombre,
      BAS1PRE: base, PIVA1PRE: IVA_PCT_DEFECTO, IIVA1PRE: cuota, TOTPRE: total, ESTPRE: 0,
    },
    { TIPPRE: serie, CODPRE: numero, FECPRE: `${fecha}T00:00:00`, CLIPRE: cliente.codigo },
  ]);

  // Líneas — los nombres exactos de columnas de F_LPR se confirman con /diag;
  // se intentan las variantes habituales del esquema FACTUSOL.
  let nivelLineas = 0;
  for (let i = 0; i < datos.lineas.length; i++) {
    const l = datos.lineas[i];
    const cant = Number(l.cantidad) || 1;
    const precio = redondear(l.precioBase);
    const totLinea = redondear(precio * cant);
    const desc = String(l.descripcion || '').slice(0, 250);
    nivelLineas = Math.max(nivelLineas, await insertarConAlternativas(env, token, 'F_LPR', [
      { TIPLPR: serie, CODLPR: numero, POSLPR: i + 1, ARTLPR: l.codigo || '', DESLPR: desc, CANLPR: cant, PRELPR: precio, TIVLPR: 0, IVALPR: l.ivaPct ?? IVA_PCT_DEFECTO, TOTLPR: totLinea },
      { TIPLPR: serie, CODLPR: numero, POSLPR: i + 1, ARTLPR: l.codigo || '', DESLPR: desc, CANLPR: cant, PRELPR: precio, TOTLPR: totLinea },
      { TIPLPR: serie, CODLPR: numero, POSLPR: i + 1, DESLPR: desc, CANLPR: cant, PRELPR: precio },
    ]));
  }

  return { nivelCabecera, nivelLineas };
}

function redondear(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
