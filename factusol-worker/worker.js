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
 * SECRETOS (Configuración → Variables y secretos del Worker):
 *   DELSOL_FABRICANTE  → código de fabricante (int)
 *   DELSOL_CLIENTE     → código de cliente API (int)
 *   DELSOL_BASEDATOS   → base de datos (ej. FS011)
 *   DELSOL_PASSWORD    → contraseña de la API (en claro; se codifica aquí)
 *
 * VARIABLES opcionales:
 *   ALLOWED_ORIGIN → origen CORS permitido (defecto https://iberica22.github.io)
 *   DIAG_KEY       → si se define, habilita GET /diag?k=<clave> para
 *                    inspeccionar columnas reales de las tablas
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

      // Diagnóstico de esquema: muestra el último presupuesto, sus líneas y
      // el último cliente para verificar nombres de columnas y formatos.
      if (url.pathname === '/diag') {
        if (!env.DIAG_KEY || url.searchParams.get('k') !== env.DIAG_KEY) {
          return json({ ok: false, error: 'Diagnóstico deshabilitado o clave incorrecta' }, 403, cors);
        }
        const token = await autenticar(env);
        const [pre, lpr, cli] = await Promise.all([
          consultaSegura(env, token, 'SELECT TOP 1 * FROM F_PRE ORDER BY CODPRE DESC'),
          consultaSegura(env, token, 'SELECT TOP 5 * FROM F_LPR ORDER BY CODLPR DESC'),
          consultaSegura(env, token, 'SELECT TOP 1 * FROM F_CLI ORDER BY CODCLI DESC'),
        ]);
        return json({ ok: true, F_PRE: pre, F_LPR: lpr, F_CLI: cli }, 200, cors);
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

function ejercicioActual() {
  return String(new Date().getFullYear());
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

/** Intenta insertar con varios juegos de columnas, del más completo al mínimo.
 *  Si una versión falla (p. ej. por una columna inexistente), prueba la siguiente. */
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
    numeroFormateado: `${serie}/${String(numero).padStart(6, '0')}`,
    cliente: { codigo: cliente.codigo, creado: cliente.creado },
  };
}

const soloDigitos = (s) => String(s || '').replace(/\D/g, '');
const normNombre = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

async function localizarOCrearCliente(env, token, cli) {
  // Cargamos código, nombres y teléfono de todos los clientes y comparamos en
  // JS: evita depender de funciones SQL y de cómo esté formateado el teléfono.
  const lista = await consulta(env, token, 'SELECT CODCLI, NOFCLI, NOCCLI, TELCLI FROM F_CLI');

  const tel = soloDigitos(cli.telefono);
  if (tel.length >= 9) {
    const t9 = tel.slice(-9); // últimos 9 dígitos (sin prefijo país)
    for (const f of lista) {
      if (soloDigitos(f.TELCLI).slice(-9) === t9 && soloDigitos(f.TELCLI).length >= 9) {
        return { codigo: Number(f.CODCLI), nombre: f.NOFCLI || f.NOCCLI, creado: false };
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

  await insertarConAlternativas(env, token, 'F_CLI', [
    { CODCLI: codigo, NOFCLI: cli.nombre, NOCCLI: cli.nombre, DOMCLI: cli.direccion || '', TELCLI: cli.telefono || '', EMACLI: cli.email || '' },
    { CODCLI: codigo, NOFCLI: cli.nombre, NOCCLI: cli.nombre, DOMCLI: cli.direccion || '', TELCLI: cli.telefono || '' },
    { CODCLI: codigo, NOFCLI: cli.nombre },
  ]);
  return { codigo, nombre: cli.nombre, creado: true };
}

async function siguienteNumero(env, token, serie) {
  // Nota: si dos presupuestos se grabaran exactamente a la vez podrían
  // colisionar en número; con el volumen de uso previsto no es un problema.
  let filasMax;
  try {
    filasMax = await consulta(env, token, `SELECT MAX(CODPRE) AS MAXNUM FROM F_PRE WHERE TIPPRE = ${serie}`);
  } catch {
    filasMax = await consulta(env, token, `SELECT MAX(CODPRE) AS MAXNUM FROM F_PRE WHERE TIPPRE = '${serie}'`);
  }
  const max = Number(filasMax?.[0]?.MAXNUM) || 0;
  return max + 1;
}

async function crearPresupuesto(env, token, { serie, numero, cliente, datos }) {
  const d = new Date();
  const fecha = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // Totales calculados a partir de las líneas (precios sin IVA)
  let base = 0;
  for (const l of datos.lineas) base += (Number(l.precioBase) || 0) * (Number(l.cantidad) || 1);
  base = redondear(base);
  const cuota = redondear(base * IVA_PCT_DEFECTO / 100);
  const total = redondear(base + cuota);

  // Cabecera — de más completa a mínima
  const nivelCab = await insertarConAlternativas(env, token, 'F_PRE', [
    { TIPPRE: serie, CODPRE: numero, FECPRE: fecha, CLIPRE: cliente.codigo, CNOPRE: cliente.nombre, OBSPRE: datos.notas || '', BA1PRE: base, PI1PRE: IVA_PCT_DEFECTO, CI1PRE: cuota, TOTPRE: total, ESTPRE: 0 },
    { TIPPRE: serie, CODPRE: numero, FECPRE: fecha, CLIPRE: cliente.codigo, TOTPRE: total },
    { TIPPRE: serie, CODPRE: numero, FECPRE: fecha, CLIPRE: cliente.codigo },
  ]);

  // Líneas
  let nivelLin = 0;
  for (let i = 0; i < datos.lineas.length; i++) {
    const l = datos.lineas[i];
    const cant = Number(l.cantidad) || 1;
    const precio = redondear(l.precioBase);
    const totLinea = redondear(precio * cant);
    nivelLin = Math.max(nivelLin, await insertarConAlternativas(env, token, 'F_LPR', [
      { TIPLPR: serie, CODLPR: numero, POSLPR: i + 1, ARTLPR: l.codigo || '', DESLPR: l.descripcion, CANLPR: cant, PRELPR: precio, IVALPR: l.ivaPct ?? IVA_PCT_DEFECTO, TOTLPR: totLinea },
      { TIPLPR: serie, CODLPR: numero, POSLPR: i + 1, ARTLPR: l.codigo || '', DESLPR: l.descripcion, CANLPR: cant, PRELPR: precio },
      { TIPLPR: serie, CODLPR: numero, POSLPR: i + 1, DESLPR: l.descripcion, CANLPR: cant, PRELPR: precio },
    ]));
  }

  return { nivelCabecera: nivelCab, nivelLineas: nivelLin };
}

function redondear(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
