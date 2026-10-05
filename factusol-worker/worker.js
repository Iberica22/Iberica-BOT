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
 * F_LPS (líneas de presupuesto).
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

      // Informe de servicios y clientes (estrategia "de servicio suelto a
      // programa"). Protegido con la misma clave que /diag.
      //   /analisis?k=CLAVE&ejercicios=2025,2026[&coste_hora=25][&subida_costes=8][&formato=json]
      // El plan gratuito de Workers solo da ~10 ms de CPU por petición, así que
      // el Worker NO procesa las facturas: devuelve una página que pide los
      // datos tabla a tabla (&dato=...), que el Worker pasa tal cual desde la
      // API Delsol sin leerlos, y el cálculo se hace en el navegador.
      if (url.pathname === '/analisis') {
        if (!env.DIAG_KEY || url.searchParams.get('k') !== env.DIAG_KEY) {
          return json({ ok: false, error: 'Análisis deshabilitado o clave incorrecta' }, 403, cors);
        }
        const dato = url.searchParams.get('dato');
        if (!dato) {
          return new Response(paginaAnalisis(Number(env.COSTE_HORA_TECNICO) || 0), {
            status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
          });
        }
        const sql = CONSULTAS_ANALISIS[dato]?.[url.searchParams.get('todo') ? 1 : 0];
        const ej = url.searchParams.get('ej') || ejercicioActual();
        if (!sql || !/^\d{4}$/.test(ej)) return json({ ok: false, error: 'Dato o ejercicio no válido' }, 400, cors);
        const token = await autenticar(env);
        const res = await fetch(DELSOL_BASE + EP.consulta, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ ejercicio: ej, consulta: sql }),
        });
        // Se reenvía el cuerpo sin parsearlo (no consume CPU del Worker)
        return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
      }

      if (url.pathname === '/presupuesto' && request.method === 'POST') {
        const datos = await request.json();
        const resultado = await grabarPresupuesto(env, datos);
        return json({ ok: true, ...resultado }, 200, cors);
      }

      return json({ ok: false, error: 'Ruta no válida. Usa POST /presupuesto, GET /ping o GET /analisis' }, 404, cors);
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
async function consulta(env, token, sql, ejercicio = ejercicioActual()) {
  const j = await llamadaApi(env, token, EP.consulta, { ejercicio, consulta: sql });
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

  // Líneas — tabla F_LPS, verificada con /diag contra la base real.
  // El IVA va solo en cabecera: las líneas llevan precio sin IVA e IVALPS=0.
  let nivelLineas = 0;
  for (let i = 0; i < datos.lineas.length; i++) {
    const l = datos.lineas[i];
    const cant = Number(l.cantidad) || 1;
    const precio = redondear(l.precioBase);
    const totLinea = redondear(precio * cant);
    const desc = String(l.descripcion || '').slice(0, 250);
    nivelLineas = Math.max(nivelLineas, await insertarConAlternativas(env, token, 'F_LPS', [
      { TIPLPS: serie, CODLPS: numero, POSLPS: i + 1, ARTLPS: l.codigo || '', DESLPS: desc, CANLPS: cant, DT1LPS: 0, DT2LPS: 0, DT3LPS: 0, PRELPS: precio, TOTLPS: totLinea, IVALPS: 0 },
      { TIPLPS: serie, CODLPS: numero, POSLPS: i + 1, ARTLPS: l.codigo || '', DESLPS: desc, CANLPS: cant, PRELPS: precio, TOTLPS: totLinea },
      { TIPLPS: serie, CODLPS: numero, POSLPS: i + 1, DESLPS: desc, CANLPS: cant, PRELPS: precio },
    ]));
  }

  return { nivelCabecera, nivelLineas };
}

function redondear(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/* ─────────────── Análisis: "de tratamiento suelto a programa" ───────────────
 *
 * Responde, con los datos de facturación de FACTUSOL, a las dos listas de la
 * estrategia:
 *
 *  SERVICIOS                                CLIENTES
 *  · qué hemos vendido más                  · cuánto compra cada cliente
 *  · qué casi nadie compra                  · cada cuánto vuelve
 *  · qué factura mucho y deja poco          · qué servicios combina
 *  · qué ocupa demasiada agenda             · cuánto producto (material) vendemos
 *  · qué tiene potencial de ser un "pack"   · qué se ofrece en oficina (presupuestos)
 *                                           · qué podría venderse antes de que el
 *                                             técnico se vaya (oportunidades)
 *
 * Tablas (esquema estándar FACTUSOL): F_FAC (cabecera factura), F_LFA (líneas),
 * F_ART (artículos, PCOART = precio de coste), F_FAM (familias), F_PRE.
 * Todo se lee con SELECT * y se interpreta en JS, para no romper si alguna
 * columna no existe en esta base.
 *
 * Mano de obra: las líneas cuya descripción habla de "hora"/"mano de obra"
 * cuentan como horas de técnico (CANLFA = horas). Si se indica ?coste_hora=N
 * (o la variable COSTE_HORA_TECNICO), esas horas se imputan como coste.
 */

// Horas de técnico: "mano (de) obra", "hora(s)". OJO: "H.COMERCIAL" o
// "HORARIO GUARDIA" son franjas horarias, no horas.
const RE_HORAS = /\b(mano (de )?obra|horas?)\b/i;
const RE_SERVICIO = /(mano (de )?obra|\bhoras?\b|desplazamiento|apertura|urgen|nocturn|festivo|guardia|incremento|\bplus\b|asistencia|intervenci|instalaci|montaje|reparaci|revisi|ajuste|servicio|visita|retirada|mantenimiento|sustituci|igualar|engrase|copia)/i;
// Recargos sin coste de material (el precio es casi todo margen)
const RE_RECARGO = /(desplazamiento|incremento|\bplus\b|urgen|guardia|nocturn|festivo|recargo|kilometr)/i;
// Líneas que no son una venta: anticipos/entregas a cuenta (se compensan en la factura final)
const RE_ANTICIPO = /^\s*(entrega|anticipo)\b/i;
// Clientes que son compañías de seguros / gestoras de siniestros
const RE_ASEGURADORA = /(seguro|asegurador|reasegur|mapfre|generali|ocaso|caser\b|santa luc|sta\.? ?luc|asitur|allianz|\baxa\b|mutua|\breale\b|iris global|e\.?a\.?s\.?i\.?g|zurich|liberty|helvetia|pelayo|catalana occidente|linea directa|l[ií]nea directa|coris|multiasistencia|homeserve|europ assistance|inter partner|plus ultra|fiatc|occident|verti\b)/i;
// Cuentas genéricas (no son un cliente concreto)
const RE_GENERICO = /clientes? (de )?(mostrador|varios|contado)/i;

// Consultas que puede pedir la página del informe: [columnas justas, todas]
const CONSULTAS_ANALISIS = {
  art: ['SELECT CODART, DESART, FAMART, PCOART FROM F_ART', 'SELECT * FROM F_ART'],
  fam: ['SELECT CODFAM, DESFAM FROM F_FAM', 'SELECT * FROM F_FAM'],
  cli: ['SELECT CODCLI, TELCLI, MOVCLI FROM F_CLI', 'SELECT * FROM F_CLI'],
  fac: ['SELECT TIPFAC, CODFAC, FECFAC, CLIFAC, CNOFAC FROM F_FAC', 'SELECT * FROM F_FAC'],
  lfa: ['SELECT TIPLFA, CODLFA, ARTLFA, DESLFA, CANLFA, PRELFA, TOTLFA, COSLFA FROM F_LFA', 'SELECT * FROM F_LFA'],
  pre: ['SELECT TIPPRE, ESTPRE, TOTPRE FROM F_PRE', 'SELECT * FROM F_PRE'],
};

/** Página que descarga los datos y calcula el informe en el navegador.
 *  Reutiliza calcularInforme/informeHtml enviando su código fuente. */
function paginaAnalisis(costeHoraDefecto) {
  const cliente = async () => {
    const P = new URLSearchParams(location.search);
    const K = P.get('k');
    const anio = String(new Date().getFullYear());
    const ejercicios = (P.get('ejercicios') || anio).split(',').map((e) => e.trim()).filter((e) => /^\d{4}$/.test(e));
    const costeHora = Number(P.get('coste_hora')) || COSTE_HORA_DEFECTO;
    const subidaCostes = P.has('subida_costes') ? Number(P.get('subida_costes')) || 0 : 8;
    const estado = document.getElementById('estado');
    const paso = (t) => { estado.textContent = t; };

    const filas = (j) => (Array.isArray(j?.resultado) ? j.resultado : []).map((reg) => {
      const f = {};
      for (const c of reg || []) f[String(c.columna).toUpperCase()] = c.dato;
      return f;
    });
    const leer = async (dato, ej) => {
      let error = '';
      for (const todo of [false, true]) {
        try {
          const r = await fetch(`/analisis?k=${encodeURIComponent(K)}&dato=${dato}&ej=${ej}${todo ? '&todo=1' : ''}`);
          const t = await r.text();
          let j;
          try { j = JSON.parse(t); } catch { error = `HTTP ${r.status}: ${t.slice(0, 200)}`; continue; }
          if (j.ok === false) { error = j.error; continue; }
          if (!r.ok || (j.respuesta && String(j.respuesta).toUpperCase() !== 'OK')) { error = JSON.stringify(j).slice(0, 300); continue; }
          return filas(j);
        } catch (e) { error = String(e.message || e); }
      }
      return { error };
    };

    const avisos = [];
    const ultimo = ejercicios[ejercicios.length - 1];
    paso('Leyendo artículos y clientes…');
    const arts = await leer('art', ultimo);
    const fams = await leer('fam', ultimo);
    const clis = await leer('cli', ultimo);
    const articulos = new Map();
    if (Array.isArray(arts)) for (const a of arts) articulos.set(String(a.CODART || '').trim(), a);
    else avisos.push('No se pudo leer F_ART: ' + arts.error);
    const familias = new Map();
    if (Array.isArray(fams)) for (const f of fams) familias.set(String(f.CODFAM || '').trim(), f.DESFAM || f.CODFAM);
    const telefonos = new Map();
    if (Array.isArray(clis)) for (const c of clis) telefonos.set(String(c.CODCLI ?? '').trim(), c.MOVCLI || c.TELCLI || '');

    const facturas = new Map();
    const presupuestos = [];
    for (const ej of ejercicios) {
      paso(`Leyendo facturas de ${ej}…`);
      const cab = await leer('fac', ej);
      if (!Array.isArray(cab)) { avisos.push(`Ejercicio ${ej}: no se pudo leer F_FAC (${cab.error})`); continue; }
      for (const f of cab) {
        facturas.set(`${ej}|${f.TIPFAC}|${f.CODFAC}`, {
          id: `${f.TIPFAC}/${f.CODFAC}`, cliente: String(f.CLIFAC ?? '').trim(), nombre: f.CNOFAC || '',
          fecha: String(f.FECFAC || '').slice(0, 10), lineas: [],
        });
      }
      paso(`Leyendo líneas de factura de ${ej}…`);
      const lin = await leer('lfa', ej);
      if (!Array.isArray(lin)) { avisos.push(`Ejercicio ${ej}: no se pudo leer F_LFA (${lin.error})`); continue; }
      for (const l of lin) {
        const fac = facturas.get(`${ej}|${l.TIPLFA}|${l.CODLFA}`);
        if (fac) fac.lineas.push(l);
      }
      const pre = await leer('pre', ej);
      if (Array.isArray(pre)) presupuestos.push(...pre);
    }

    paso('Calculando…');
    const informe = calcularInforme({ ejercicios, facturas: [...facturas.values()], articulos, familias, presupuestos, costeHora, subidaCostes, telefonos, avisos });
    if (P.get('formato') === 'json') {
      document.body.innerHTML = '<pre style="white-space:pre-wrap;font:12px monospace;padding:16px"></pre>';
      document.querySelector('pre').textContent = JSON.stringify(informe, null, 1);
      return;
    }
    document.open();
    document.write(informeHtml(informe));
    document.close();
  };

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Análisis de servicios y clientes</title>
<style>body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#f6f7f9;color:#1d2330;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
@media (prefers-color-scheme:dark){body{background:#14171c;color:#e8eaed}}</style></head>
<body><p id="estado">Preparando el informe…</p>
<script>
// Cloudflare (esbuild keepNames) inserta llamadas __name(fn, "nombre") en el
// código de las funciones; al copiarlas al navegador hace falta definirla.
var __name = (f) => f;
const COSTE_HORA_DEFECTO = ${Number(costeHoraDefecto) || 0};
const RE_HORAS = ${RE_HORAS};
const RE_SERVICIO = ${RE_SERVICIO};
const RE_RECARGO = ${RE_RECARGO};
const RE_ANTICIPO = ${RE_ANTICIPO};
const RE_ASEGURADORA = ${RE_ASEGURADORA};
const RE_GENERICO = ${RE_GENERICO};
${redondear}
${calcularInforme}
${informeHtml}
(${cliente})().catch((e) => { document.getElementById('estado').textContent = 'Error: ' + (e.message || e); });
</script></body></html>`;
}

/** Cálculo puro (sin red) — separado para poder probarlo con datos de ejemplo. */
function calcularInforme({ ejercicios, facturas, articulos, familias, presupuestos, costeHora = 0, subidaCostes = 0, telefonos = new Map(), avisos = [] }) {
  const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
  const r2 = redondear;
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  const items = new Map();   // clave → stats del servicio/artículo (solo negocio directo)
  const clientes = new Map();
  const aseguradoras = new Map();
  const pares = new Map();
  let fechaMax = '';
  let totalFact = 0, totalAseg = 0, nFacAseg = 0;
  let totalProd = 0, totalServ = 0, costeConocido = 0, facturasSoloServicio = 0, horasTot = 0, baseDirecta = 0;
  let costeReal = 0, factCosteReal = 0; // líneas con coste real (material/horas), para la simulación
  const facturasValidas = [];

  // Normaliza una línea de factura. Devuelve null si no es una venta
  // (notas, direcciones, nº de siniestro, entregas a cuenta…).
  const leerLinea = (l) => {
    const codArt = String(l.ARTLFA || '').trim();
    const art = codArt ? articulos.get(codArt) : null;
    const desc = String(l.DESLFA || art?.DESART || '').replace(/\s+/g, ' ').trim();
    const cant = num(l.CANLFA) || 0;
    const importe = l.TOTLFA !== undefined && l.TOTLFA !== null && l.TOTLFA !== '' ? num(l.TOTLFA) : num(l.PRELFA) * cant;
    if (RE_ANTICIPO.test(desc)) return null;
    if (!codArt && Math.abs(importe) < 0.005) return null;      // texto/nota sin importe
    const texto = art?.DESART || desc;                          // se clasifica por el artículo, no por el texto retocado
    const esHoras = RE_HORAS.test(texto);
    const esRecargo = !esHoras && RE_RECARGO.test(texto);
    const famArt = art ? familias.get(String(art.FAMART || '').trim()) : null;
    const esServicio = esHoras || RE_SERVICIO.test(texto);
    let costeLinea = null, costeEsReal = false;
    if (art && num(art.PCOART) > 0) { costeLinea = num(art.PCOART) * cant; costeEsReal = true; }
    else if (num(l.COSLFA) > 0) { costeLinea = num(l.COSLFA) * cant; costeEsReal = true; }
    else if (esHoras && costeHora) { costeLinea = costeHora * cant; costeEsReal = true; }
    else if (esRecargo) costeLinea = 0;                         // desplazamientos/recargos: sin material
    const clave = codArt || 'TXT:' + norm(desc).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 4).join(' ');
    return {
      codArt, clave, nombre: (art?.DESART || desc).slice(0, 80), cant, importe, esHoras, esRecargo,
      tipo: esServicio ? 'servicio' : 'producto',
      familia: famArt || (esServicio ? 'Servicios / mano de obra' : 'Sin familia'),
      costeLinea, costeEsReal, descuento: !codArt && importe < 0,
    };
  };

  for (const fac of facturas) {
    if (!fac.lineas.length) continue;
    const lineas = fac.lineas.map(leerLinea).filter(Boolean);
    if (!lineas.length) continue;
    const base = lineas.reduce((a, x) => a + x.importe, 0);
    totalFact += base;
    if (fac.fecha > fechaMax) fechaMax = fac.fecha;
    for (const x of lineas) if (x.costeEsReal) { costeReal += x.costeLinea; factCosteReal += x.importe; }

    // ── Compañías de seguros: tarifas pactadas, se analizan aparte ──
    if (RE_ASEGURADORA.test(fac.nombre)) {
      totalAseg += base; nFacAseg++;
      // Agrupa por compañía aunque tenga varias fichas (p. ej. Generali con dos códigos)
      const n = norm(fac.nombre);
      const marca = n.match(/(mapfre|generali|ocaso|asitur|allianz|\baxa\b|iris global|e\.?a\.?s\.?i\.?g|zurich|liberty|helvetia|pelayo|catalana occidente|l[ií]nea directa|coris|multiasistencia|homeserve|europ assistance|plus ultra|fiatc|santa luc|sta\.? ?luc|\breale\b)/);
      const k = marca ? marca[0].replace(/[^a-z]/g, '').replace(/^staluc/, 'santaluc') : n.split(/\s+/).slice(0, 2).join(' ');
      let a = aseguradoras.get(k);
      if (!a) { a = { nombre: fac.nombre, fichas: new Set(), facturas: 0, total: 0, ultima: '' }; aseguradoras.set(k, a); }
      a.fichas.add(fac.cliente); a.facturas++; a.total += base;
      if (fac.fecha > a.ultima) { a.ultima = fac.fecha; a.nombre = fac.nombre; }
      continue;
    }

    // ── Negocio directo (particulares, empresas, comunidades) ──
    baseDirecta += base;
    let horas = 0, coste = 0, prod = 0;
    const claves = new Set();
    const fams = new Set();
    for (const x of lineas) {
      if (x.descuento) continue; // descuentos/promos sin artículo: cuentan en el total, no son un servicio
      let it = items.get(x.clave);
      if (!it) {
        it = { clave: x.clave, catalogo: Boolean(x.codArt), nombre: x.nombre, familia: x.familia, tipo: x.tipo, esHoras: x.esHoras, esRecargo: x.esRecargo, facturas: 0, unidades: 0, facturacion: 0, coste: 0, conCoste: 0, clientes: new Set(), horasFacturas: 0, margenFacturas: 0, acomp: new Map(), _vistoEn: null };
        items.set(x.clave, it);
      }
      if (it._vistoEn !== fac) { it.facturas++; it._vistoEn = fac; }
      it.unidades += x.cant;
      it.facturacion += x.importe;
      if (x.costeLinea !== null) { it.coste += x.costeLinea; it.conCoste += x.importe; costeConocido += x.importe; coste += x.costeLinea; }
      it.clientes.add(fac.cliente);
      if (x.esHoras) horas += x.cant;
      claves.add(x.clave);
      fams.add(x.familia);
      if (x.tipo === 'servicio') totalServ += x.importe; else { totalProd += x.importe; prod += x.importe; }
    }
    if (!claves.size) continue;
    horasTot += horas;
    if (prod <= 0) facturasSoloServicio++;
    const margenFac = base - coste;
    for (const c of claves) {
      const it = items.get(c);
      it.horasFacturas += horas;
      it.margenFacturas += margenFac;
      for (const o of claves) if (o !== c && !items.get(o).esRecargo && !items.get(o).esHoras) it.acomp.set(o, (it.acomp.get(o) || 0) + 1);
    }
    const fl = [...fams].sort();
    for (let i = 0; i < fl.length; i++) for (let j = i + 1; j < fl.length; j++) {
      const k = fl[i] + ' + ' + fl[j];
      pares.set(k, (pares.get(k) || 0) + 1);
    }
    facturasValidas.push(fac);

    if (RE_GENERICO.test(fac.nombre)) continue; // mostrador/varios: no es un cliente concreto
    let cl = clientes.get(fac.cliente);
    if (!cl) { cl = { codigo: fac.cliente, nombre: fac.nombre, fechas: [], total: 0, producto: 0, servicios: new Set() }; clientes.set(fac.cliente, cl); }
    cl.fechas.push(fac.fecha);
    cl.total += base;
    cl.producto += prod;
    for (const c of claves) cl.servicios.add(c);
  }

  // ── Servicios (negocio directo) ──
  const lista = [...items.values()].map((it) => {
    const cobertura = pct(it.conCoste, it.facturacion);
    const margen = it.conCoste && cobertura >= 80 ? it.conCoste - it.coste : null; // sin coste fiable no se inventa margen
    const acomp = [...it.acomp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, n]) => ({ nombre: items.get(k).nombre, tipo: items.get(k).tipo, catalogo: items.get(k).catalogo, clave: k, facturas: n, pct: pct(n, it.facturas) }));
    return {
      clave: it.clave, catalogo: it.catalogo, nombre: it.nombre, familia: it.familia, tipo: it.tipo, esHoras: it.esHoras, esRecargo: it.esRecargo,
      facturas: it.facturas, unidades: r2(it.unidades), facturacion: r2(it.facturacion),
      margen: margen === null ? null : r2(margen),
      margenPct: margen === null ? null : pct(margen, it.conCoste),
      coberturaCoste: cobertura,
      clientes: it.clientes.size,
      horasMediasPorFactura: r2(it.horasFacturas / it.facturas),
      margenPorHora: it.horasFacturas > 0 && costeHora ? r2(it.margenFacturas / it.horasFacturas) : null,
      facturacionPorHora: it.horasFacturas > 0 ? r2(it.facturacion / it.horasFacturas) : null,
      acompanantes: acomp,
    };
  });
  const porFacturas = [...lista].sort((a, b) => b.facturas - a.facturas || b.facturacion - a.facturacion);
  const mediana = (arr) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const conMargen = lista.filter((x) => x.margenPct !== null && x.facturacion > 0 && !x.esRecargo && x.facturas >= 3);
  const medMargen = mediana(conMargen.map((x) => x.margenPct));
  const umbralBajo = Math.max(0, Math.min(30, medMargen - 15));
  const p70Fact = (() => { const s = lista.filter((x) => x.facturas >= 3).map((x) => x.facturacion).sort((a, b) => a - b); return s[Math.floor(s.length * 0.7)] || 0; })();
  // Agenda: horas facturadas en las facturas donde aparece y lo que se factura por hora
  const conHoras = lista.filter((x) => x.facturacionPorHora !== null && x.facturas >= 3 && x.horasMediasPorFactura >= 1 && !x.esRecargo);
  const medFactHora = mediana(conHoras.map((x) => x.facturacionPorHora));

  const servicios = {
    masVendidos: porFacturas.filter((x) => !x.esRecargo).slice(0, 15),
    casiNadie: lista.filter((x) => x.catalogo && x.facturas <= 2 && x.facturacion > 0).sort((a, b) => b.facturacion - a.facturacion).slice(0, 20),
    articulosCatalogoSinVentas: [...articulos.keys()].filter((k) => k && !items.has(k)).length,
    muchoFacturacionPocoBeneficio: conMargen.filter((x) => x.facturacion >= p70Fact && x.margenPct < umbralBajo)
      .sort((a, b) => b.facturacion - a.facturacion).slice(0, 15),
    medianaMargenPct: medMargen,
    umbralMargenBajo: umbralBajo,
    margenRaro: conMargen.filter((x) => x.margenPct < 0).map((x) => ({ nombre: x.nombre, clave: x.clave, margenPct: x.margenPct })).slice(0, 15),
    ocupanAgenda: conHoras.filter((x) => x.facturacionPorHora <= medFactHora)
      .sort((a, b) => a.facturacionPorHora - b.facturacionPorHora).slice(0, 15),
    medianaFacturacionPorHora: medFactHora,
    potencialPrograma: lista.filter((x) => x.facturas >= 5 && !x.esRecargo && !x.esHoras && (x.acompanantes[0]?.pct || 0) >= 10 && (x.margenPct === null || x.margenPct >= umbralBajo))
      .map((x) => ({ ...x, puntuacion: r2(x.facturas * (x.acompanantes[0]?.pct || 0) / 100 * (x.facturacion / x.facturas)) }))
      .sort((a, b) => b.puntuacion - a.puntuacion)
      .filter(function (x) { // el pack A+B y el B+A son el mismo: se deja uno
        const par = [x.clave, x.acompanantes[0].clave].sort().join('|');
        if (this.has(par)) return false; this.add(par); return true;
      }, new Set()).slice(0, 10),
  };

  // Las 4 decisiones del reel: desaparece, sube de precio, se transforma o
  // pasa a programa (o se mantiene). Solo servicios con 3+ ventas.
  const enPrograma = new Set(servicios.potencialPrograma.map((x) => x.clave));
  const decidir = (x) => {
    if (enPrograma.has(x.clave)) return { decision: 'Convertir en programa', motivo: `el ${x.acompanantes[0].pct.toString().replace('.', ',')} % ya lo compra con ${x.acompanantes[0].nombre}` };
    if (x.margenPct !== null && x.margenPct < 0) return { decision: 'Revisar coste', motivo: 'sale con pérdidas: revisa el precio de coste en FACTUSOL' };
    if (x.margenPct !== null && x.margenPct < umbralBajo) return { decision: 'Subir precio', motivo: `margen ${String(x.margenPct).replace('.', ',')} % (la mediana es ${String(medMargen).replace('.', ',')} %)` };
    if (x.facturacionPorHora !== null && x.horasMediasPorFactura >= 1 && x.facturacionPorHora < medFactHora * 0.75) return { decision: 'Transformar', motivo: `ocupa ${String(x.horasMediasPorFactura).replace('.', ',')} h por trabajo y se factura a ${Math.round(x.facturacionPorHora)} €/h (la mediana es ${Math.round(medFactHora)} €/h)` };
    return { decision: 'Mantener', motivo: x.margenPct === null ? 'sin precio de coste: no se puede juzgar el margen' : '' };
  };
  servicios.decisiones = lista.filter((x) => x.facturas >= 3 && !x.esRecargo).sort((a, b) => b.facturacion - a.facturacion).slice(0, 30)
    .map((x) => ({ nombre: x.nombre, familia: x.familia, facturas: x.facturas, facturacion: x.facturacion, margenPct: x.margenPct, ...decidir(x) }));

  // ── Clientes (directos, sin cuentas genéricas) ──
  const dias = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;
  const listaCli = [...clientes.values()].map((c) => {
    const f = c.fechas.filter(Boolean).sort();
    const gaps = []; for (let i = 1; i < f.length; i++) gaps.push(dias(f[i - 1], f[i]));
    return {
      codigo: c.codigo, nombre: c.nombre, facturas: f.length, total: r2(c.total), ticketMedio: r2(c.total / Math.max(f.length, 1)),
      primera: f[0] || '', ultima: f[f.length - 1] || '',
      diasEntreVisitas: gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null,
      pctProducto: pct(c.producto, c.total), serviciosDistintos: c.servicios.size,
    };
  }).sort((a, b) => b.total - a.total);
  const nCli = listaCli.length;
  const corte = fechaMax ? new Date(Date.parse(fechaMax) - 182 * 86400000).toISOString().slice(0, 10) : '';
  const reactivar = listaCli.filter((c) => c.ultima && c.ultima < corte && c.total > 0)
    .map((c) => ({ ...c, telefono: telefonos.get(c.codigo) || '' }))
    .sort((a, b) => b.total - a.total);
  const unaVez = listaCli.filter((c) => c.facturas === 1).length;
  const dosVeces = listaCli.filter((c) => c.facturas === 2).length;
  const totalCli = listaCli.reduce((a, c) => a + c.total, 0);
  const top10 = listaCli.slice(0, 10).reduce((a, c) => a + c.total, 0);
  const gapsTodos = listaCli.map((c) => c.diasEntreVisitas).filter((x) => x !== null);

  // "Antes de que el técnico se vaya": en cada servicio frecuente, el
  // artículo de catálogo que más le acompaña y cuántas veces NO se vendió.
  const oportunidades = porFacturas.filter((x) => x.tipo === 'servicio' && !x.esHoras && !x.esRecargo && x.facturas >= 5).slice(0, 25).map((x) => {
    const it = items.get(x.clave);
    const prodAcomp = [...it.acomp.entries()].filter(([k]) => { const o = items.get(k); return o.tipo === 'producto' && o.catalogo; }).sort((a, b) => b[1] - a[1])[0];
    if (!prodAcomp) return null;
    const p = items.get(prodAcomp[0]);
    const precioMedio = p.facturacion / Math.max(p.facturas, 1);
    const sin = x.facturas - prodAcomp[1];
    return { servicio: x.nombre, facturas: x.facturas, producto: p.nombre, conProducto: prodAcomp[1], pctConProducto: pct(prodAcomp[1], x.facturas), sinProducto: sin, importeMedioProducto: r2(precioMedio), potencialSi20pct: r2(sin * 0.2 * precioMedio) };
  }).filter((o) => o && o.sinProducto > 0 && o.importeMedioProducto > 0).slice(0, 12);

  // Presupuestos (lo que se ofrece desde oficina). En FACTUSOL ESTPRE 0 = pendiente.
  const porSerie = {};
  for (const p of presupuestos) {
    const s = String(p.TIPPRE ?? '?');
    const e = String(p.ESTPRE ?? '?');
    porSerie[s] ??= { serie: s, presupuestos: 0, importe: 0, pendientes: 0, importePendiente: 0, porEstado: {} };
    porSerie[s].presupuestos++;
    porSerie[s].importe = r2(porSerie[s].importe + num(p.TOTPRE));
    if (e === '0') { porSerie[s].pendientes++; porSerie[s].importePendiente = r2(porSerie[s].importePendiente + num(p.TOTPRE)); }
    porSerie[s].porEstado[e] = (porSerie[s].porEstado[e] || 0) + 1;
  }

  const nFac = facturasValidas.length;
  return {
    generado: new Date().toISOString(),
    ejercicios,
    avisos,
    costeHora,
    resumen: {
      facturacionTotal: r2(totalFact), facturacionAseguradoras: r2(totalAseg), pctAseguradoras: pct(totalAseg, totalFact),
      facturas: nFac, facturacion: r2(baseDirecta), ticketMedio: r2(baseDirecta / Math.max(nFac, 1)),
      clientes: nCli, horasManoObra: r2(horasTot),
      pctFacturacionProducto: pct(totalProd, baseDirecta), pctFacturacionServicio: pct(totalServ, baseDirecta),
      pctFacturasSinMaterial: pct(facturasSoloServicio, nFac),
      coberturaCoste: pct(costeConocido, baseDirecta),
    },
    aseguradoras: [...aseguradoras.values()].map((a) => ({ nombre: a.nombre, fichas: a.fichas.size, facturas: a.facturas, total: r2(a.total), ticketMedio: r2(a.total / a.facturas), pctTotal: pct(a.total, totalFact), ultima: a.ultima }))
      .sort((a, b) => b.total - a.total),
    // "Si sigo cobrando lo mismo, lo único que baja es el beneficio" (todas las
    // facturas, líneas con coste real: material y, si se indica, horas)
    subidaCostes: (() => {
      const margen = factCosteReal - costeReal;
      const costeNuevo = costeReal * (1 + subidaCostes / 100);
      return {
        pct: subidaCostes, base: r2(factCosteReal), margenActual: r2(margen), margenActualPct: pct(margen, factCosteReal),
        margenTrasSubida: r2(factCosteReal - costeNuevo), margenTrasSubidaPct: pct(factCosteReal - costeNuevo, factCosteReal),
        beneficioPerdido: r2(costeNuevo - costeReal),
        subidaPreciosNecesariaPct: factCosteReal ? Math.round(((costeNuevo - costeReal) / factCosteReal) * 1000) / 10 : 0,
      };
    })(),
    servicios,
    clientes: {
      top: listaCli.slice(0, 20),
      recurrentes: listaCli.filter((c) => c.facturas >= 3).sort((a, b) => b.facturas - a.facturas).slice(0, 20),
      distribucion: { unaVez, dosVeces, tresOMas: nCli - unaVez - dosVeces, pctUnaVez: pct(unaVez, nCli) },
      pctFacturacionTop10: pct(top10, totalCli),
      diasMediosEntreVisitas: gapsTodos.length ? Math.round(gapsTodos.reduce((a, b) => a + b, 0) / gapsTodos.length) : null,
      combinaciones: [...pares.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([par, n]) => ({ par, facturas: n, pct: pct(n, nFac) })),
    },
    oportunidades,
    reactivar: { desde: corte, total: reactivar.length, importeHistorico: r2(reactivar.reduce((a, c) => a + c.total, 0)), lista: reactivar.slice(0, 40) },
    presupuestos: Object.values(porSerie),
  };
}

/* ───────────────────────── Informe HTML ───────────────────────── */

function informeHtml(inf) {
  const e = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const eur = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }));
  const p = (n) => (n === null || n === undefined ? '—' : `${String(n).replace('.', ',')} %`);
  const tabla = (cols, filas, vacio = 'Sin datos suficientes en el periodo.') => !filas.length ? `<p class="vacio">${vacio}</p>` :
    `<div class="tw"><table><thead><tr>${cols.map((c) => `<th>${e(c[0])}</th>`).join('')}</tr></thead><tbody>${
      filas.map((f) => `<tr>${cols.map((c) => `<td>${c[1](f)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const acomp = (x) => x.acompanantes.map((a) => `${e(a.nombre)} <small>(${p(a.pct)})</small>`).join('<br>');
  const r = inf.resumen, s = inf.servicios, c = inf.clientes;

  const colsServ = [
    ['Servicio / artículo', (x) => `${e(x.nombre)}<br><small>${e(x.familia)}</small>`],
    ['Facturas', (x) => x.facturas], ['Facturación', (x) => eur(x.facturacion)],
    ['Margen', (x) => `${eur(x.margen)}<br><small>${p(x.margenPct)}</small>`],
  ];

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Análisis de servicios y clientes</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--tx:#1d2330;--mu:#5f6b7a;--ac:#b4232a;--bd:#e3e6ea}
@media (prefers-color-scheme:dark){:root{--bg:#14171c;--card:#1d2128;--tx:#e8eaed;--mu:#9aa4b1;--ac:#ff6b6b;--bd:#2c323b}}
body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:1000px;margin:0 auto;padding:16px}
h1{font-size:1.5rem;margin:.2em 0}h2{font-size:1.15rem;margin:0 0 .3em;color:var(--ac)}
.sub{color:var(--mu);margin:0 0 1em}
section{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:16px;margin:0 0 16px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.kpi{background:var(--bg);border-radius:10px;padding:10px}.kpi b{display:block;font-size:1.3rem}.kpi span{color:var(--mu);font-size:.85rem}
.tw{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:.9rem}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--bd);vertical-align:top}th{color:var(--mu);font-weight:600}
small,.nota,.vacio{color:var(--mu)}.aviso{background:#fff3cd;color:#664d03;padding:8px 12px;border-radius:8px}
.q{font-weight:600;margin:1.2em 0 .4em}
</style></head><body><main>
<h1>De servicio suelto a programa · plan 90 días</h1>
<p class="sub">Ejercicio(s) ${e(inf.ejercicios.join(', '))} · generado ${e(inf.generado.slice(0, 16).replace('T', ' '))} UTC · datos de FACTUSOL (facturas, sin IVA)</p>
${inf.avisos.map((a) => `<p class="aviso">⚠️ ${e(a)}</p>`).join('')}

<section><h2>Resumen</h2><div class="kpis">
<div class="kpi"><b>${eur(r.facturacionTotal)}</b><span>facturación total</span></div>
<div class="kpi"><b>${p(r.pctAseguradoras)}</b><span>viene de compañías de seguros (${eur(r.facturacionAseguradoras)})</span></div>
<div class="kpi"><b>${eur(r.facturacion)}</b><span>negocio directo (particulares, empresas, comunidades)</span></div>
<div class="kpi"><b>${r.facturas}</b><span>facturas directas · ticket medio ${eur(r.ticketMedio)}</span></div>
<div class="kpi"><b>${p(r.pctFacturacionProducto)}</b><span>del negocio directo es material</span></div>
<div class="kpi"><b>${p(r.pctFacturasSinMaterial)}</b><span>facturas directas sin ningún material</span></div>
</div>
<p class="nota">Los bloques 1, 2 y 3 analizan solo el <b>negocio directo</b>: en las compañías el precio lo marca la tarifa pactada, no se decide servicio a servicio. Coste conocido para el ${p(r.coberturaCoste)} del negocio directo${inf.costeHora ? ` (horas a ${eur(inf.costeHora)}/h)` : ' — añade &amp;coste_hora=N a la URL para imputar el coste de las horas de técnico'}.</p>
</section>

<section><h2>Compañías de seguros</h2>
<p class="nota">Lo que hay que negociar para 2027 es la <b>tarifa con cada compañía</b>: si los costes suben y la tarifa no, cada aviso deja menos.</p>
${tabla([['Compañía', (x) => `${e(x.nombre)}${x.fichas > 1 ? `<br><small>${x.fichas} fichas de cliente</small>` : ''}`], ['Facturas', (x) => x.facturas], ['Total', (x) => eur(x.total)], ['Ticket medio', (x) => eur(x.ticketMedio)], ['% de la facturación', (x) => p(x.pctTotal)], ['Última', (x) => e(x.ultima)]], inf.aseguradoras, 'No se ha detectado ninguna compañía de seguros por el nombre del cliente.')}
</section>

<section><h2>Si los costes suben un ${p(inf.subidaCostes.pct)} y seguimos igual…</h2>
${inf.subidaCostes.base ? `<div class="kpis">
<div class="kpi"><b>${p(inf.subidaCostes.margenActualPct)}</b><span>margen bruto actual</span></div>
<div class="kpi"><b>${p(inf.subidaCostes.margenTrasSubidaPct)}</b><span>margen con los costes nuevos</span></div>
<div class="kpi"><b>${eur(inf.subidaCostes.beneficioPerdido)}</b><span>de beneficio que se pierde</span></div>
<div class="kpi"><b>${p(inf.subidaCostes.subidaPreciosNecesariaPct)}</b><span>de subida media solo para quedarse igual</span></div>
</div>
<p class="nota">Cambia el % con &amp;subida_costes=N. Subir precios en el mismo porcentaje solo sirve para sobrevivir a la subida: el objetivo es entrar en enero con nuevos precios, packs y márgenes.</p>`
  : '<p class="vacio">Falta el precio de coste de los artículos para calcularlo.</p>'}
</section>

<section><h2>1 · Qué hacen nuestros servicios</h2>
<p class="q">¿Qué servicios hemos vendido más?</p>
${tabla([...colsServ, ['Clientes', (x) => x.clientes], ['Suele ir con…', acomp]], s.masVendidos)}

<p class="q">¿Cuáles casi nadie ha comprado? <small>(artículos de catálogo con 1–2 ventas: candidatos a eliminar; además hay ${s.articulosCatalogoSinVentas} artículos del catálogo sin ninguna venta)</small></p>
${tabla(colsServ, s.casiNadie)}

<p class="q">¿Cuáles facturan mucho pero dejan poco beneficio? <small>(de los que más facturan, margen por debajo del ${p(s.umbralMargenBajo)}; la mediana es ${p(s.medianaMargenPct)})</small></p>
${tabla(colsServ, s.muchoFacturacionPocoBeneficio, 'Ninguno destaca, o falta precio de coste en los artículos (revisa PCOART en FACTUSOL).')}
${s.margenRaro.length ? `<p class="aviso">⚠️ Estos artículos salen con <b>pérdidas</b>; casi seguro el precio de coste en FACTUSOL está mal (coste por caja en vez de por unidad, o desactualizado): ${s.margenRaro.map((x) => `${e(x.nombre)} <small>(${e(x.clave)}, ${p(x.margenPct)})</small>`).join(' · ')}</p>` : ''}

<p class="q">¿Cuáles ocupan demasiado tiempo de agenda? <small>(≥ 1 h de técnico por trabajo y lo que se factura por hora está por debajo de la mediana, ${eur(s.medianaFacturacionPorHora)}/h)</small></p>
${tabla([['Servicio', (x) => e(x.nombre)], ['Facturas', (x) => x.facturas], ['Horas por trabajo', (x) => String(x.horasMediasPorFactura).replace('.', ',')], ['Facturado por hora', (x) => eur(x.facturacionPorHora)], ['Margen por hora', (x) => eur(x.margenPorHora)]], s.ocupanAgenda,
  'Sin datos: las horas solo se detectan en líneas de "mano de obra"/"hora". Si no se facturan así, apúntalo en el parte de Zoho.')}

<p class="q">¿Cuáles tienen potencial para convertirse en algo más grande? <small>(5+ ventas y al menos 1 de cada 10 clientes ya lo compra junto a otra cosa: ese es el pack natural)</small></p>
${tabla([['Servicio base', (x) => e(x.nombre)], ['Facturas', (x) => x.facturas], ['Margen', (x) => p(x.margenPct)], ['Pack natural: ya lo compran con…', acomp]], s.potencialPrograma)}

<p class="q">Decisión por servicio: ¿sube de precio, se transforma o pasa a programa? <small>(los 30 que más facturan con 3+ ventas; propuesta automática, la decisión final es vuestra. Los candidatos a eliminar están en "casi nadie ha comprado")</small></p>
${tabla([['Servicio', (x) => `${e(x.nombre)}<br><small>${e(x.familia)}</small>`], ['Facturación', (x) => eur(x.facturacion)], ['Margen', (x) => p(x.margenPct)], ['Propuesta', (x) => `<b>${e(x.decision)}</b><br><small>${e(x.motivo)}</small>`]], s.decisiones)}
</section>

<section><h2>2 · Qué hace nuestro cliente</h2>
<div class="kpis">
<div class="kpi"><b>${p(c.distribucion.pctUnaVez)}</b><span>clientes que solo vinieron 1 vez</span></div>
<div class="kpi"><b>${c.distribucion.tresOMas}</b><span>clientes con 3+ facturas</span></div>
<div class="kpi"><b>${c.diasMediosEntreVisitas ?? '—'} días</b><span>entre visitas (repetidores)</span></div>
<div class="kpi"><b>${p(c.pctFacturacionTop10)}</b><span>de lo facturado a clientes directos está en los 10 mayores</span></div>
</div>
<p class="q">¿Cuánto compra cada cliente? <small>(20 mayores)</small></p>
${tabla([['Cliente', (x) => e(x.nombre || x.codigo)], ['Facturas', (x) => x.facturas], ['Total', (x) => eur(x.total)], ['Ticket medio', (x) => eur(x.ticketMedio)], ['% material', (x) => p(x.pctProducto)], ['Última', (x) => e(x.ultima)]], c.top)}
<p class="q">¿Cada cuánto vuelve? <small>(clientes con 3+ facturas)</small></p>
${tabla([['Cliente', (x) => e(x.nombre || x.codigo)], ['Facturas', (x) => x.facturas], ['Cada… días', (x) => x.diasEntreVisitas ?? '—'], ['Servicios distintos', (x) => x.serviciosDistintos], ['Última', (x) => e(x.ultima)]], c.recurrentes)}
<p class="q">¿Qué servicios combina? <small>(familias que aparecen juntas en la misma factura)</small></p>
${tabla([['Combinación', (x) => e(x.par)], ['Facturas', (x) => x.facturas], ['% del total', (x) => p(x.pct)]], c.combinaciones)}
<p class="q">¿Qué estamos ofreciendo en oficina? <small>(presupuestos por serie)</small></p>
${tabla([['Serie', (x) => e(x.serie)], ['Presupuestos', (x) => x.presupuestos], ['Importe', (x) => eur(x.importe)], ['Sin respuesta (estado 0)', (x) => `<b>${x.pendientes}</b> · ${eur(x.importePendiente)}`], ['Por estado', (x) => Object.entries(x.porEstado).map(([k, v]) => `${e(k)}: ${v}`).join(' · ')]], inf.presupuestos)}
<p class="nota">Los presupuestos pendientes son la venta más fácil de recuperar: el cliente ya pidió precio. Marta puede hacer el seguimiento (GUIA-SEGUIMIENTO-PRESUPUESTOS.md).</p>
<p class="q">¿Qué podría venderse antes de que el técnico se vaya?</p>
${tabla([['Servicio', (x) => e(x.servicio)], ['Facturas', (x) => x.facturas], ['Producto que mejor encaja', (x) => e(x.producto)], ['Ya lo llevan', (x) => p(x.pctConProducto)], ['Se fue sin él', (x) => x.sinProducto], ['Si se ofrece y acepta 1 de cada 5', (x) => eur(x.potencialSi20pct)]], inf.oportunidades)}
</section>

<section><h2>3 · Campañas: a quién reactivar</h2>
<p class="nota">Halloween, Black Friday y Navidad no como "promociones desesperadas" sino para captar, <b>reactivar</b>, vender packs y crear recurrencia. ${inf.reactivar.total} clientes directos (sin compañías ni cuentas genéricas) compraron y no han vuelto desde el ${e(inf.reactivar.desde)} (${eur(inf.reactivar.importeHistorico)} facturados en el periodo). Los 40 de más valor:</p>
${tabla([['Cliente', (x) => e(x.nombre || x.codigo)], ['Contacto', (x) => e(x.telefono)], ['Facturas', (x) => x.facturas], ['Total', (x) => eur(x.total)], ['Última', (x) => e(x.ultima)]], inf.reactivar.lista)}
</section>
<p class="nota">Servicio/material se clasifica por la descripción del artículo (mano de obra, apertura, instalación, desplazamiento… = servicio). Las compañías de seguros se detectan por el nombre del cliente. No cuentan como venta las notas sin importe ni las entregas a cuenta. Guía de uso: GUIA-ESTRATEGIA-SERVICIOS.md</p>
</main></body></html>`;
}

export { calcularInforme, informeHtml };
