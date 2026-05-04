// ============================================================
// IBÉRICA SEGURIDAD - Bot de WhatsApp
// Integración: Woztell (WhatsApp) + Zoho CRM + OpenAI GPT-4o
// ============================================================

require("dotenv").config();
const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
// Parsear JSON con o sin Content-Type correcto (Woztell puede omitirlo)
app.use(express.json({ type: "*/*" }));
app.use(express.urlencoded({ extended: true }));
app.use('/static', require('express').static(require('path').join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// ── Cliente OpenAI ──────────────────────────────────────────
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── ID del asistente de OpenAI ──────────────────────────────
const ASSISTANT_ID = "asst_TGm5TBJYuHyAAKirANa1n0QC";

// ── Estado de conversaciones en memoria ────────────────────
// Estructura por cliente: { step, nombre, telefono, direccion, descripcion, thread_id, memberId, channelId }
const conversaciones = {};

// ── Control del bot por cliente ─────────────────────────────
// true = bot activo (por defecto), false = agente humano atiende
const botActivo = {};

// ── Registro de actividad por cliente (para el panel admin) ─
// { [telefono]: { ultimoMensaje, ultimaActividad, mensajesTotal } }
const actividad = {};

// ── Nombres conocidos de agentes internos ───────────────────
const NOMBRES_AGENTES = {
  "34664658254": "Isabel",
  "34674163818": "Jose",
  "34674163817": "Mari",
  "34663303461": "Nieves",
};

// ── Canales Woztell → agente ─────────────────────────────────
const CANALES_AGENTES = {
  "69af0932bd6b88aaf5da3887": "Noe",
  "69a6981752ac843492cb9ed5": "Mari",
  "69af0e9ee1c709083b065b8a": "Jose",
  "69bd11ce7614bf4b4d6f2d3c": "Isabel",
  "69c3a0276c369daa9f0bbf81": "Nieves",
};

// ── Horarios de activación del bot por canal ──────────────────
// El bot solo responde automáticamente en las franjas indicadas.
// Sin horario = siempre activo (ej: Noe).
// cruzaMedianoche: true → la franja va de inicio hasta el día siguiente a fin.
const HORARIOS_CANALES = {
  "69a6981752ac843492cb9ed5": [ // Mari: 15:00 → 07:30
    { inicio: 15 * 60, fin: 7 * 60 + 30, cruzaMedianoche: true },
  ],
  "69af0e9ee1c709083b065b8a": [ // Jose: 15:00 → 07:30
    { inicio: 15 * 60, fin: 7 * 60 + 30, cruzaMedianoche: true },
  ],
  "69bd11ce7614bf4b4d6f2d3c": [ // Isabel: 15:00 → 07:30
    { inicio: 15 * 60, fin: 7 * 60 + 30, cruzaMedianoche: true },
  ],
  "69c3a0276c369daa9f0bbf81": [ // Nieves: 14:00-17:00 y 20:00-09:00
    { inicio: 14 * 60, fin: 17 * 60,     cruzaMedianoche: false },
    { inicio: 20 * 60, fin: 9 * 60,      cruzaMedianoche: true  },
  ],
};

/**
 * Devuelve los minutos desde medianoche en la zona horaria de Madrid.
 */
function minutosActualesMadrid() {
  const partes = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const h = parseInt(partes.find(p => p.type === "hour").value);
  const m = parseInt(partes.find(p => p.type === "minute").value);
  return h * 60 + m;
}

/**
 * Comprueba si el bot debe estar activo ahora para un canal dado.
 * Sin horario configurado → siempre activo.
 */
function dentroDeHorario(channelId) {
  const franjas = HORARIOS_CANALES[channelId];
  if (!franjas) return true; // Sin restricción (Noe)
  const minutos = minutosActualesMadrid();
  return franjas.some(f => {
    if (f.cruzaMedianoche) {
      return minutos >= f.inicio || minutos < f.fin;
    }
    return minutos >= f.inicio && minutos < f.fin;
  });
}

// ============================================================
// NOTIFICACIONES A AGENTES - Configuración
// ============================================================

// Canal de Noe (siempre activo) → desde aquí salen los avisos a Mari y Nieves
const CANAL_NOTIFICACIONES = "69af0932bd6b88aaf5da3887";

// Destinatarios según horario:
//   Mari:    lunes-viernes 07:30–15:00
//   Nieves:  lunes-viernes 17:00–20:00
//   Guardia: resto del tiempo y fines de semana
//
// El memberId es el ID que Woztell asigna al agente en ese canal.
// Se obtiene la primera vez que el agente envíe un mensaje al canal de Noe
// y se guarda como variable de entorno en Railway.
// Cada agente recibe la notificación por su propio canal de Woztell.
// El memberId se obtiene de los logs cuando el agente escribe al bot desde su número.
// Todos los avisos salen desde el canal de Noe (siempre activo).
// El memberId es el del agente cuando escribe desde SU número al canal de Noe.
const NOTIFICACIONES_CONFIG = {
  mari: {
    nombre: "Mari",
    channelId: CANAL_NOTIFICACIONES,         // Canal de Noe
    memberId: "69af09efc4b8eeaf96583f6e",   // ✅ Mari (34674163817) → canal Noe
  },
  nieves: {
    nombre: "Nieves",
    channelId: CANAL_NOTIFICACIONES,         // Canal de Noe
    memberId: "69af09f1eb88709353922dbb",   // ✅ Nieves (34663303461) → canal Noe
  },
  guardia: {
    nombre: "Guardia",
    channelId: CANAL_NOTIFICACIONES,         // Canal de Noe
    memberId: "69af09f1be5f7a26df1c2d32",   // ✅ Guardia (34674891529) → canal Noe
  },
};

/**
 * Devuelve el destinatario correcto de la notificación según el día y la hora.
 * - Lunes-Viernes 07:30-15:00 → Mari
 * - Lunes-Viernes 17:00-20:00 → Nieves
 * - Resto (noche/madrugada) y fines de semana → Guardia
 */
function determinarDestinatarioNotificacion() {
  const ahora = new Date();
  const diaSemana = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    weekday: "long",
  }).format(ahora).toLowerCase();

  const esFinDeSemana = ["sábado", "domingo"].includes(diaSemana);
  if (esFinDeSemana) return NOTIFICACIONES_CONFIG.guardia;

  const min = minutosActualesMadrid();
  const MARI_INI   = 7 * 60 + 30;  // 07:30
  const MARI_FIN   = 15 * 60;      // 15:00
  const NIEVES_INI = 17 * 60;      // 17:00
  const NIEVES_FIN = 20 * 60;      // 20:00

  if (min >= MARI_INI   && min < MARI_FIN)   return NOTIFICACIONES_CONFIG.mari;
  if (min >= NIEVES_INI && min < NIEVES_FIN) return NOTIFICACIONES_CONFIG.nieves;
  return NOTIFICACIONES_CONFIG.guardia;
}

/**
 * Envía una notificación de parte a un agente usando la plantilla aprobada
 * "nuevo_parte_urgencia" de WhatsApp. Funciona aunque hayan pasado más de
 * 24h desde el último mensaje del agente (no tiene restricción de sesión).
 *
 * @param {object} destinatario - { nombre, channelId, memberId }
 * @param {object} datos - { nombre, telefono, direccion, descripcion, apertura, refParte, agente }
 */
async function enviarNotificacionAgente(destinatario, datos) {
  if (!destinatario.memberId) {
    console.warn(`[Notificación] ⚠️ Sin memberId para ${destinatario.nombre}`);
    return;
  }
  const body = {
    channelId: destinatario.channelId,
    memberId:  destinatario.memberId,
    response: [{
      type: "template",
      template: {
        name:     "nuevo_parte_urgencia",
        language: { code: "es" },
        components: [{
          type: "body",
          parameters: [
            { type: "text", text: datos.nombre      },
            { type: "text", text: datos.telefono    },
            { type: "text", text: datos.direccion   },
            { type: "text", text: datos.descripcion },
            { type: "text", text: datos.apertura    },
            { type: "text", text: datos.refParte    },
            { type: "text", text: datos.agente      },
          ],
        }],
      },
    }],
  };
  try {
    const res = await axios.post(
      `https://bot.api.woztell.com/sendResponses?accessToken=${process.env.WOZTELL_TOKEN}`,
      body
    );
    console.log(`[Notificación] Woztell response:`, JSON.stringify(res.data));
    if (res.data?.ok === 1) {
      console.log(`[Notificación] ✅ Plantilla enviada a ${destinatario.nombre}`);
    } else {
      console.error(`[Notificación] ❌ ok:0 — ${JSON.stringify(res.data)}`);
    }
  } catch (err) {
    console.error(`[Notificación] ❌ Error enviando a ${destinatario.nombre}:`, err.response?.data || err.message);
  }
}

// ── Token de Zoho en memoria ────────────────────────────────
let zohoAccessToken = null;
let zohoTokenExpira = 0; // timestamp en ms cuando expira

// ============================================================
// UPSTASH REDIS - Persistencia de estado
// ============================================================

async function redisGet(key) {
  if (!process.env.UPSTASH_REDIS_REST_URL) return null;
  try {
    const res = await axios.post(process.env.UPSTASH_REDIS_REST_URL, ["GET", key], {
      headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
    });
    const val = res.data.result;
    return val ? JSON.parse(val) : null;
  } catch (err) {
    console.error(`[Redis] Error GET ${key}:`, err.message);
    return null;
  }
}

async function redisSet(key, value) {
  if (!process.env.UPSTASH_REDIS_REST_URL) return;
  try {
    await axios.post(process.env.UPSTASH_REDIS_REST_URL, ["SET", key, JSON.stringify(value)], {
      headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
    });
  } catch (err) {
    console.error(`[Redis] Error SET ${key}:`, err.message);
  }
}

async function cargarEstadoDesdeRedis() {
  const [botActivoGuardado, actividadGuardada] = await Promise.all([
    redisGet("iberica:botActivo"),
    redisGet("iberica:actividad"),
  ]);
  if (botActivoGuardado) Object.assign(botActivo, botActivoGuardado);
  if (actividadGuardada) Object.assign(actividad, actividadGuardada);
  console.log(`[Redis] Estado cargado — ${Object.keys(actividad).length} contactos, ${Object.keys(botActivo).length} estados de bot`);
}

// ============================================================
// ZOHO CRM - Gestión de tokens
// ============================================================

/**
 * Renueva el access token de Zoho usando el refresh token permanente.
 * El access token dura 1 hora; lo guardamos en memoria.
 */
async function renovarTokenZoho() {
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN;
  console.log("[Zoho] Renovando access token...");
  console.log("[Zoho] REFRESH_TOKEN (primeros 30 chars):", refreshToken?.slice(0, 30));
  console.log("[Zoho] CLIENT_ID:", process.env.ZOHO_CLIENT_ID);

  try {
    const res = await axios.post("https://accounts.zoho.eu/oauth/v2/token", null, {
      params: {
        refresh_token: refreshToken,
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        redirect_uri: process.env.ZOHO_REDIRECT_URI,
        grant_type: "refresh_token",
      },
    });

    console.log("[Zoho] Respuesta renovación HTTP:", res.status);
    console.log("[Zoho] Respuesta renovación body:", JSON.stringify(res.data));

    if (res.data.error) {
      console.error("[Zoho] Error en respuesta de renovación:", res.data.error);
      throw new Error("Zoho devolvió error: " + res.data.error);
    }

    zohoAccessToken = res.data.access_token;
    zohoTokenExpira = Date.now() + (res.data.expires_in - 60) * 1000;
    console.log("[Zoho] ✅ Access token renovado. Expira en:", res.data.expires_in, "segundos");
    return zohoAccessToken;
  } catch (err) {
    console.error("[Zoho] ❌ Error renovando token — HTTP:", err.response?.status);
    console.error("[Zoho] ❌ Body:", JSON.stringify(err.response?.data));
    console.error("[Zoho] ❌ Message:", err.message);
    throw new Error("No se pudo renovar el token de Zoho");
  }
}

/**
 * Devuelve un access token válido, renovándolo si es necesario.
 */
async function obtenerTokenZoho() {
  if (!zohoAccessToken || Date.now() >= zohoTokenExpira) {
    await renovarTokenZoho();
  }
  return zohoAccessToken;
}

// ============================================================
// ZOHO CRM - Operaciones sobre Cases (Partes)
// ============================================================

/**
 * Busca un contacto en Zoho por teléfono (9 dígitos).
 * Si existe → devuelve su ID. Si no existe → lo crea y devuelve el nuevo ID.
 * @param {object} datos - { nombre, telefono (9 dígitos), direccion }
 * @returns {string} - ID del contacto en Zoho
 */
async function buscarOCrearContactoZoho(datos) {
  const token = await obtenerTokenZoho();
  const tel9 = datos.telefono.slice(-9);

  // 1. Buscar contacto existente por Phone o Mobile
  for (const campo of ["Phone", "Mobile"]) {
    try {
      const res = await axios.get("https://www.zohoapis.eu/crm/v2/Contacts/search", {
        params: { criteria: `(${campo}:equals:${tel9})` },
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      });
      if (res.data.data?.length > 0) {
        const contacto = res.data.data[0];
        console.log(`[Zoho] Contacto existente encontrado: ${contacto.id} (${contacto.Full_Name})`);
        return contacto.id;
      }
    } catch (e) {
      if (e.response?.status !== 204) throw e;
    }
  }

  // 2. Crear contacto nuevo
  console.log(`[Zoho] Contacto no encontrado — creando nuevo para ${datos.nombre} (${tel9})`);
  const bodyContacto = {
    data: [{
      Last_Name: datos.nombre,
      Phone: tel9,
      Mobile: tel9,
      Mailing_Street: datos.direccion,
    }],
  };

  const res = await axios.post(
    "https://www.zohoapis.eu/crm/v2/Contacts",
    bodyContacto,
    { headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" } }
  );

  const contactoNuevo = res.data.data?.[0];
  if (!contactoNuevo || contactoNuevo.code !== "SUCCESS") {
    console.error("[Zoho] ❌ No se pudo crear el contacto:", JSON.stringify(contactoNuevo));
    throw new Error(`Zoho rechazó el contacto: ${contactoNuevo?.message || "error desconocido"}`);
  }

  const contactoId = contactoNuevo.details?.id;
  console.log(`[Zoho] ✅ Contacto creado: ${contactoId}`);
  return contactoId;
}

/**
 * Crea un parte (Case) en Zoho CRM.
 * @param {object} datos - { nombre, telefono, direccion, descripcion, agente }
 * @returns {{ id: string, refParte: string }}
 */
async function crearParteZoho(datos) {
  const token = await obtenerTokenZoho();

  // 1. Buscar o crear el contacto en Zoho
  const contactoId = await buscarOCrearContactoZoho(datos);

  // 2. Preparar fechas en hora de Madrid
  const ahora = new Date();
  const unHoraDespues = new Date(ahora.getTime() + 60 * 60 * 1000);

  const formatFechaZoho = (date) => {
    const p = new Intl.DateTimeFormat("es-ES", {
      timeZone: "Europe/Madrid",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const g = (type) => p.find(x => x.type === type).value;
    return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}:${g("second")}`;
  };

  const tel9 = datos.telefono.slice(-9);
  const agente = datos.agente || "Bot";
  const asunto = `Urgencia - ${datos.nombre} - ${ahora.toLocaleDateString("es-ES")}`;
  const descripcionCompleta = `${datos.descripcion}\n\n📲 Canal: ${agente}`;

  const body = {
    data: [{
      Subject:          asunto,
      Description:      descripcionCompleta,
      Phone:            tel9,
      Direccion:        datos.direccion,
      Status:           "Open",
      Priority:         "Urgencia",
      Fecha_Hora_Inicio: formatFechaZoho(ahora),
      Fecha_Hora_Final:  formatFechaZoho(unHoraDespues),
      Related_To:       { id: contactoId },
    }],
  };

  console.log("[Zoho] Creando parte con body:", JSON.stringify(body));

  try {
    const res = await axios.post(
      "https://www.zohoapis.eu/crm/v2/Cases",
      body,
      { headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" } }
    );

    console.log(`[Zoho] HTTP ${res.status} | Response:`, JSON.stringify(res.data));

    const parte = res.data.data?.[0];

    if (!parte || parte.status === "error" || parte.code !== "SUCCESS") {
      console.error(`[Zoho] ❌ Creación rechazada: code=${parte?.code} message=${parte?.message}`);
      console.error(`[Zoho] ❌ Detalles:`, JSON.stringify(parte?.details));
      throw new Error(`Zoho rechazó el parte: ${parte?.message || "error desconocido"} (${parte?.code})`);
    }

    const id = parte?.details?.id || parte?.id;
    console.log(`[Zoho] ✅ Parte creado con ID interno: ${id}`);

    // 3. Obtener la Ref. Parte (campo auto-asignado por Zoho, no viene en la respuesta de creación)
    let refParte = "N/D";
    try {
      const detalle = await axios.get(
        `https://www.zohoapis.eu/crm/v2/Cases/${id}`,
        { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
      );
      refParte = detalle.data.data?.[0]?.ref_Parte || "N/D";
      console.log(`[Zoho] ✅ Ref. Parte: ${refParte}`);
    } catch (e) {
      console.warn("[Zoho] No se pudo obtener ref_Parte tras creación:", e.message);
    }

    return { id, refParte };
  } catch (err) {
    console.error("[Zoho] ❌ HTTP status:", err.response?.status);
    console.error("[Zoho] ❌ Response body:", JSON.stringify(err.response?.data));
    console.error("[Zoho] ❌ Message:", err.message);
    throw new Error("Error al crear el parte en Zoho");
  }
}

/**
 * Consulta el estado de un parte en Zoho CRM por ref_Parte (ej: "2026-9866").
 * @param {string} numeroParte - Referencia del parte
 * @returns {object|null} - Datos del parte o null si no se encuentra
 */
async function consultarParteZoho(numeroParte) {
  const token = await obtenerTokenZoho();

  try {
    const res = await axios.get(
      "https://www.zohoapis.eu/crm/v2/Cases/search",
      {
        params: {
          criteria: `(ref_Parte:equals:${numeroParte})`,
        },
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
        },
      }
    );

    const casos = res.data.data;
    if (!casos || casos.length === 0) return null;
    return casos[0];
  } catch (err) {
    if (err.response?.status === 204) return null;
    console.error("[Zoho] Error consultando parte:", err.response?.data || err.message);
    throw new Error("Error al consultar el parte en Zoho");
  }
}

const ESTADOS_CERRADOS = ["Cerrado", "Facturado", "Solucionado", "Acabado", "Resuelto", "Closed"];

/**
 * Busca todos los partes de un cliente buscando primero su Contacto en Zoho
 * (por Phone o Mobile) y luego obteniendo los Cases relacionados.
 * Devuelve los partes ordenados: activos primero, luego por Fecha_Hora_Inicio desc.
 * @param {string} telefono - Número en formato Woztell (ej: "34633765620")
 * @returns {Array}
 */
async function consultarPartesPorContacto(telefono) {
  const token = await obtenerTokenZoho();
  const tel9 = telefono.slice(-9);

  // 1. Buscar contacto por Phone o Mobile
  let contactoId = null;
  for (const campo of ["Phone", "Mobile"]) {
    try {
      const res = await axios.get("https://www.zohoapis.eu/crm/v2/Contacts/search", {
        params: { criteria: `(${campo}:equals:${tel9})` },
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      });
      if (res.data.data?.length > 0) {
        contactoId = res.data.data[0].id;
        break;
      }
    } catch (e) {
      if (e.response?.status !== 204) throw e;
    }
  }

  if (!contactoId) return [];

  // 2. Obtener partes relacionados con ese contacto
  try {
    const res = await axios.get(
      `https://www.zohoapis.eu/crm/v2/Contacts/${contactoId}/Cases`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
    );
    const casos = res.data.data || [];

    casos.sort((a, b) => {
      const activo = (s) => !ESTADOS_CERRADOS.includes(s);
      if (activo(a.Status) && !activo(b.Status)) return -1;
      if (!activo(a.Status) && activo(b.Status)) return 1;
      return new Date(b.Fecha_Hora_Inicio || b.Created_Time) - new Date(a.Fecha_Hora_Inicio || a.Created_Time);
    });

    return casos;
  } catch (err) {
    if (err.response?.status === 204) return [];
    console.error("[Zoho] Error obteniendo partes del contacto:", err.response?.data || err.message);
    throw new Error("Error al consultar los partes en Zoho");
  }
}

/**
 * Usa OpenAI para generar una respuesta amigable sobre el estado de un parte,
 * interpretando los campos más relevantes del Case de Zoho.
 * @param {object} caso - Objeto Case devuelto por Zoho CRM
 * @returns {string} - Mensaje natural para enviar al cliente
 */
async function interpretarParteConIA(caso) {
  const formatFecha = (iso) => {
    if (!iso) return "no especificada";
    const d = new Date(iso);
    return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }) +
      " a las " + d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  };

  const datosParte = {
    referencia: caso.ref_Parte || "N/D",
    asunto: caso.Subject || "N/D",
    estado: caso.Status || "N/D",
    subestado: caso.Subestado || null,
    prioridad: caso.Priority || "N/D",
    operario: caso.Operario || null,
    fechaInicio: formatFecha(caso.Fecha_Hora_Inicio),
    fechaFinal: formatFecha(caso.Fecha_Hora_Final),
    descripcion: caso.Description || null,
    anotaciones: caso.Anotaciones || null,
    solucion: caso.Solution || null,
    comentariosFinales: caso.Comentarios_Finales || null,
  };

  const prompt = `Eres el asistente de atención al cliente de Ibérica Seguridad.
Un cliente pregunta por el estado de su parte de trabajo.
Con los siguientes datos del parte, genera un mensaje claro, amable y profesional en español (máximo 5 líneas) que le explique:
- En qué punto está su parte
- Cuándo está prevista la intervención (si la hay)
- Quién lo va a atender (si hay operario asignado)
- Cualquier información relevante sobre el avance

REGLAS IMPORTANTES:
- Si el estado es "Material" O el subestado es "Material preparado", interpreta SIEMPRE que el parte está pendiente de conseguir el material necesario. Explica que en cuanto esté disponible se contactará para dar cita. NO menciones fechas de intervención en este caso aunque aparezcan, ya que aún no están confirmadas.
- Omite SIEMPRE cualquier comentario interno inapropiado que aparezca en descripción, anotaciones o cualquier otro campo: insultos, expresiones despectivas hacia el cliente, opiniones sobre la dificultad del trabajo, frases del tipo "que se busque la vida", quejas del operario, o cualquier contenido que no sea adecuado comunicar a un cliente.
- NO incluyas datos técnicos internos ni campos vacíos.
- Si hay solución o comentarios finales relevantes y apropiados, menciónalos.
- Usa formato WhatsApp (negrita con *asteriscos*). No uses emojis en exceso.

Datos del parte:
${JSON.stringify(datosParte, null, 2)}`;

  const respuesta = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 300,
  });

  return respuesta.choices[0].message.content.trim();
}

// ============================================================
// WOZTELL - Envío de mensajes
// ============================================================

/**
 * Envía un mensaje de texto al cliente a través de la API de Woztell.
 * Usa el channelId real del webhook entrante (req.body.channel) en lugar
 * del .env, ya que ambos valores pueden diferir.
 * @param {string} telefono - clave del cliente en conversaciones (req.body.from)
 * @param {string} mensaje  - Texto a enviar
 */
async function enviarMensaje(telefono, mensaje) {
  const estado = conversaciones[telefono];
  const memberId  = estado?.memberId;
  // Usar el channelId que llegó en el webhook; el .env es fallback de emergencia
  const channelId = estado?.channelId || process.env.WOZTELL_CHANNEL_ID;

  if (!memberId) {
    console.error(`[Woztell] Sin memberId para ${telefono}, no se puede enviar.`);
    return;
  }

  const body = {
    channelId,
    memberId,   // string: "69df644a0e70e45b41053725"
    response: [{ type: "TEXT", text: mensaje }],
  };

  console.log(`[Woztell] → ${telefono} | channel: ${channelId} | member: ${memberId}`);
  console.log(`[Woztell] Body:`, JSON.stringify(body));

  try {
    const res = await axios.post(
      `https://bot.api.woztell.com/sendResponses?accessToken=${process.env.WOZTELL_TOKEN}`,
      body
    );
    console.log(`[Woztell] HTTP ${res.status} | Response:`, JSON.stringify(res.data));

    if (res.data?.ok === 1) {
      console.log(`[Woztell] ✅ Mensaje enviado correctamente.`);
    } else {
      console.error(`[Woztell] ❌ ok:0 — ${JSON.stringify(res.data)}`);
    }
  } catch (err) {
    console.error(`[Woztell] ❌ Error HTTP ${err.response?.status}:`, JSON.stringify(err.response?.data) || err.message);
  }
}

// ============================================================
// OPENAI - Rama de Servicios
// ============================================================

/**
 * Envía un mensaje al asistente de OpenAI (Assistants API) y devuelve su respuesta.
 * Cada cliente tiene su propio thread persistente guardado en estado.thread_id.
 * Si no existe, se crea uno nuevo automáticamente.
 * @param {string} telefono - ID del cliente (usado para recuperar su estado)
 * @param {string} mensajeUsuario - Texto enviado por el cliente
 * @returns {string} - Respuesta del asistente
 */
async function consultarAsistente(telefono, mensajeUsuario) {
  const estado = conversaciones[telefono];

  try {
    // Crear thread si el cliente no tiene uno todavía
    if (!estado.thread_id) {
      const thread = await openai.beta.threads.create();
      estado.thread_id = thread.id;
      console.log(`[OpenAI] Nuevo thread creado para ${telefono}: ${thread.id}`);
    }

    // Añadir el mensaje del usuario al thread
    await openai.beta.threads.messages.create(estado.thread_id, {
      role: "user",
      content: mensajeUsuario,
    });

    // Ejecutar el asistente y esperar a que termine (polling automático)
    const run = await openai.beta.threads.runs.createAndPoll(estado.thread_id, {
      assistant_id: ASSISTANT_ID,
    });

    if (run.status !== "completed") {
      console.error(`[OpenAI] Run finalizado con estado inesperado: ${run.status}`);
      throw new Error(`Run no completado: ${run.status}`);
    }

    // Obtener el último mensaje del asistente (el primero de la lista, orden desc)
    const mensajes = await openai.beta.threads.messages.list(estado.thread_id, {
      order: "desc",
      limit: 1,
    });

    const respuesta = mensajes.data[0]?.content[0]?.text?.value;
    if (!respuesta) throw new Error("Respuesta vacía del asistente");

    console.log(`[OpenAI] Respuesta para ${telefono}: ${respuesta.slice(0, 80)}...`);
    return respuesta;
  } catch (err) {
    console.error("[OpenAI] Error en Assistants API:", err.message);
    throw new Error("Error al consultar el asistente de IA");
  }
}

// ============================================================
// MENÚ PRINCIPAL
// ============================================================

const MENU_PRINCIPAL =
  "¡Hola! 👋 Bienvenido a *Ibérica Seguridad*.\n" +
  "Estamos aquí para ayudarte. ¿En qué podemos ayudarte hoy?\n\n" +
  "1️⃣ Urgencia / Avería\n" +
  "2️⃣ Solicitar Presupuesto\n" +
  "3️⃣ Información sobre nuestros servicios\n" +
  "4️⃣ Consultar estado de mi expediente/parte\n" +
  "5️⃣ Hablar con un agente\n\n" +
  "Responde con el número de tu opción.";

/**
 * Comprueba si el mensaje del usuario es un comando de vuelta al menú.
 */
/**
 * Valida que el texto sea un número de teléfono español aceptable.
 * Acepta: 9 dígitos (con o sin espacios/guiones), o con prefijo +34 / 0034.
 * Devuelve el teléfono limpio (solo dígitos, sin prefijo) o null si no es válido.
 */
function validarTelefono(texto) {
  const soloDigitos = texto.replace(/[\s\-().+]/g, "");
  // Quitar prefijo internacional si lo trae
  const numero = soloDigitos.startsWith("0034")
    ? soloDigitos.slice(4)
    : soloDigitos.startsWith("34") && soloDigitos.length === 11
    ? soloDigitos.slice(2)
    : soloDigitos;
  // Teléfono español válido: 9 dígitos empezando por 6, 7, 8 o 9
  return /^[6-9]\d{8}$/.test(numero) ? numero : null;
}

function esComandoMenu(texto) {
  const normalized = texto.toLowerCase().trim();
  return ["menu", "menú", "volver", "inicio", "hola"].includes(normalized);
}

/**
 * Inicializa (o resetea) el estado de conversación de un cliente.
 */
function resetearConversacion(telefono) {
  // Preservar thread_id y memberId entre resets para no perder contexto
  const threadAnterior  = conversaciones[telefono]?.thread_id || null;
  const memberAnterior  = conversaciones[telefono]?.memberId  || null;
  const channelAnterior = conversaciones[telefono]?.channelId || null;
  conversaciones[telefono] = {
    step: null,
    nombre: null,
    telefono: null,
    direccion: null,
    descripcion: null,
    thread_id: threadAnterior,
    memberId:  memberAnterior,
    channelId: channelAnterior,
    partesCandidatos: null,
  };
}

// ============================================================
// PROCESADOR DE MENSAJES - Lógica principal del bot
// ============================================================

/**
 * Procesa el mensaje recibido y gestiona el flujo de la conversación.
 * @param {string} telefono - número del cliente (req.body.from), clave en conversaciones[]
 * @param {string} texto    - Texto del mensaje recibido
 */
async function procesarMensaje(telefono, texto) {
  const msg = texto.trim();
  const msgLower = msg.toLowerCase();

  // Obtener o inicializar estado del cliente
  if (!conversaciones[telefono]) {
    resetearConversacion(telefono);
  }
  const estado = conversaciones[telefono];

  console.log(`[Bot] ${telefono} | step: ${estado.step} | msg: "${msg}"`);

  // ── Comando de vuelta al menú desde cualquier punto ──────
  if (esComandoMenu(msgLower) || estado.step === null) {
    resetearConversacion(telefono);
    await enviarMensaje(telefono, MENU_PRINCIPAL);
    return;
  }

  // ── Selección del menú principal ────────────────────────
  if (estado.step === "menu_principal") {
    if (["1", "urgencia", "averia", "avería", "emergencia"].includes(msgLower)) {
      estado.step = "urg_nombre";
      await enviarMensaje(telefono, "¿Cuál es tu nombre completo?");
      return;
    }
    if (["2", "presupuesto", "precio"].includes(msgLower)) {
      estado.step = "pres_nombre";
      await enviarMensaje(telefono, "¿Cuál es tu nombre completo?");
      return;
    }
    if (["3", "servicios", "información", "informacion"].includes(msgLower)) {
      estado.step = "servicios";
      await enviarMensaje(
        telefono,
        "Estoy aquí para informarte sobre nuestros servicios. ¿Qué quieres saber? (Escribe *menú* cuando quieras volver al inicio)"
      );
      return;
    }
    if (["4", "estado", "expediente", "parte"].includes(msgLower)) {
      await enviarMensaje(telefono, "🔍 Consultando tus partes...");
      try {
        const partes = await consultarPartesPorContacto(telefono);
        if (partes.length === 0) {
          await enviarMensaje(
            telefono,
            "No hemos encontrado ningún parte asociado a tu número de teléfono.\n\nSi crees que es un error, contacta con nosotros directamente."
          );
          await enviarMensaje(telefono, "¿Puedo ayudarte en algo más? Escribe *menú* para volver al inicio.");
        } else {
          const principal = partes[0];
          estado.partesCandidatos = partes;
          estado.step = "estado_confirmar";
          const activo = !ESTADOS_CERRADOS.includes(principal.Status);
          await enviarMensaje(
            telefono,
            `Hemos encontrado tu parte más reciente${activo ? " en curso" : ""}:\n\n` +
            `📋 *${principal.ref_Parte}* — ${principal.Subject}\n` +
            `🔄 Estado: *${principal.Status}*\n\n` +
            `¿Quieres consultar el estado de este parte? Responde *sí* o *no*.`
          );
        }
      } catch (err) {
        console.error("[Bot] Error consultando partes por teléfono:", err.message);
        await enviarMensaje(telefono, "Ha ocurrido un error al consultar el parte. Por favor, inténtalo más tarde.");
        await enviarMensaje(telefono, "¿Puedo ayudarte en algo más? Escribe *menú* para volver al inicio.");
      }
      return;
    }
    if (["5", "agente", "persona", "humano"].includes(msgLower)) {
      await enviarMensaje(
        telefono,
        "Perfecto, te pongo en contacto con uno de nuestros agentes. En breve alguien del equipo atenderá tu conversación."
      );
      resetearConversacion(telefono);
      await enviarMensaje(telefono, "¿Puedo ayudarte en algo más? Escribe *menú* para volver al inicio.");
      return;
    }
    // Opción no reconocida
    await enviarMensaje(telefono, "No he entendido tu opción. Por favor, responde con un número del 1 al 5.");
    return;
  }

  // ── RAMA 1: URGENCIA / AVERÍA ────────────────────────────
  if (estado.step === "urg_nombre") {
    estado.nombre = msg;
    estado.step = "urg_telefono";
    await enviarMensaje(telefono, `Gracias, ${estado.nombre}. ¿Cuál es tu número de teléfono de contacto?`);
    return;
  }

  if (estado.step === "urg_telefono") {
    const telLimpio = validarTelefono(msg);
    if (!telLimpio) {
      await enviarMensaje(
        telefono,
        "⚠️ El número de teléfono no parece correcto.\n\nPor favor, indícame un teléfono español válido de 9 dígitos (ej: *612 345 678*)."
      );
      return;
    }
    estado.telefono = telLimpio;
    estado.step = "urg_direccion";
    await enviarMensaje(telefono, "¿Cuál es la dirección exacta donde se ha producido la avería?");
    return;
  }

  if (estado.step === "urg_direccion") {
    estado.direccion = msg;
    estado.step = "urg_descripcion";
    await enviarMensaje(telefono, "Describe brevemente el problema o la avería:");
    return;
  }

  if (estado.step === "urg_descripcion") {
    estado.descripcion = msg;
    estado.step = "urg_crear";

    await enviarMensaje(telefono, "⏳ Estamos registrando tu urgencia, un momento...");

    try {
      const agente = CANALES_AGENTES[estado.channelId] || "Bot";
      const { id, refParte } = await crearParteZoho({
        nombre:      estado.nombre,
        telefono:    estado.telefono,
        direccion:   estado.direccion,
        descripcion: estado.descripcion,
        agente,
      });

      // Mensaje de confirmación al cliente
      await enviarMensaje(
        telefono,
        `✅ Tu parte de urgencia ha sido registrado correctamente.\n\n` +
        `📋 *Ref. Parte:* ${refParte}\n` +
        `👤 Nombre: ${estado.nombre}\n` +
        `📞 Teléfono: ${estado.telefono}\n` +
        `📍 Dirección: ${estado.direccion}\n\n` +
        `Un técnico se pondrá en contacto contigo lo antes posible. Guarda la referencia del parte para futuras consultas.`
      );

      // Notificación al agente de turno (plantilla aprobada por Meta)
      const destinatario = determinarDestinatarioNotificacion();
      const ahoraStr = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid", hour12: false });
      await enviarNotificacionAgente(destinatario, {
        nombre:      estado.nombre,
        telefono:    estado.telefono,
        direccion:   estado.direccion,
        descripcion: estado.descripcion,
        apertura:    ahoraStr,
        refParte:    refParte,
        agente:      agente,
      });

    } catch (err) {
      console.error("[Bot] Error en creación de parte:", err.message);
      await enviarMensaje(
        telefono,
        "Lo sentimos, hubo un problema al registrar tu parte. Por favor, llámanos directamente para atenderte."
      );
    }

    resetearConversacion(telefono);
    await enviarMensaje(telefono, "¿Puedo ayudarte en algo más? Escribe *menú* para volver al inicio.");
    return;
  }

  // ── RAMA 2: PRESUPUESTO ──────────────────────────────────
  if (estado.step === "pres_nombre") {
    estado.nombre = msg;
    estado.step = "pres_descripcion";
    await enviarMensaje(
      telefono,
      `Encantados, ${estado.nombre}. Describe el trabajo o servicio para el que necesitas presupuesto:`
    );
    return;
  }

  if (estado.step === "pres_descripcion") {
    estado.descripcion = msg;
    estado.step = "pres_ok";

    await enviarMensaje(
      telefono,
      `✅ Hemos recibido tu solicitud de presupuesto.\n\n` +
        `📝 *Descripción:* ${estado.descripcion}\n\n` +
        `Nuestro equipo comercial revisará tu solicitud y se pondrá en contacto contigo a la mayor brevedad. ¡Gracias por confiar en Ibérica Seguridad!`
    );

    resetearConversacion(telefono);
    await enviarMensaje(telefono, "¿Puedo ayudarte en algo más? Escribe *menú* para volver al inicio.");
    return;
  }

  // ── RAMA 3: SERVICIOS (OpenAI) ───────────────────────────
  if (estado.step === "servicios") {
    // El cliente puede escribir "menú" para volver
    if (msgLower === "menú" || msgLower === "menu") {
      resetearConversacion(telefono);
      await enviarMensaje(telefono, MENU_PRINCIPAL);
      return;
    }

    try {
      const respuestaIA = await consultarAsistente(telefono, msg);
      await enviarMensaje(telefono, respuestaIA);
    } catch (err) {
      await enviarMensaje(
        telefono,
        "Lo siento, en este momento no puedo responder. Escribe *menú* para volver al inicio o contacta con nosotros directamente."
      );
    }
    return;
  }


  // ── RAMA 4: CONFIRMAR PARTE SUGERIDO ────────────────────
  if (estado.step === "estado_confirmar") {
    if (["si", "sí", "s", "yes"].includes(msgLower)) {
      const parte = estado.partesCandidatos[0];
      await enviarMensaje(telefono, "⏳ Analizando tu parte...");
      try {
        const respuestaIA = await interpretarParteConIA(parte);
        await enviarMensaje(telefono, respuestaIA);
      } catch (err) {
        await enviarMensaje(telefono, "Ha ocurrido un error al analizar el parte. Inténtalo más tarde.");
      }
      resetearConversacion(telefono);
      await enviarMensaje(telefono, "¿Puedo ayudarte en algo más? Escribe *menú* para volver al inicio.");
    } else if (["no", "n"].includes(msgLower)) {
      const otros = estado.partesCandidatos.slice(1);
      if (otros.length === 0) {
        await enviarMensaje(telefono, "No hay más partes registrados con tu número de teléfono.");
        resetearConversacion(telefono);
        await enviarMensaje(telefono, "¿Puedo ayudarte en algo más? Escribe *menú* para volver al inicio.");
      } else {
        const lista = otros.map((p, i) =>
          `${i + 1}. *${p.ref_Parte}* — ${p.Subject} (${p.Status})`
        ).join("\n");
        estado.step = "estado_elegir";
        await enviarMensaje(telefono, `Aquí tienes el resto de tus partes:\n\n${lista}\n\nResponde con el número del que quieres consultar.`);
      }
    } else {
      await enviarMensaje(telefono, "Por favor responde *sí* o *no*.");
    }
    return;
  }

  // ── RAMA 4: ELEGIR PARTE DE LA LISTA ────────────────────
  if (estado.step === "estado_elegir") {
    const otros = estado.partesCandidatos.slice(1);
    const idx = parseInt(msg) - 1;
    if (isNaN(idx) || idx < 0 || idx >= otros.length) {
      await enviarMensaje(telefono, `Por favor responde con un número del 1 al ${otros.length}.`);
      return;
    }
    const parte = otros[idx];
    await enviarMensaje(telefono, "⏳ Analizando tu parte...");
    try {
      const respuestaIA = await interpretarParteConIA(parte);
      await enviarMensaje(telefono, respuestaIA);
    } catch (err) {
      await enviarMensaje(telefono, "Ha ocurrido un error al analizar el parte. Inténtalo más tarde.");
    }
    resetearConversacion(telefono);
    await enviarMensaje(telefono, "¿Puedo ayudarte en algo más? Escribe *menú* para volver al inicio.");
    return;
  }

  // ── Fallback: mensaje no reconocido ─────────────────────
  console.warn(`[Bot] Step desconocido o mensaje no manejado. step: ${estado.step}`);
  await enviarMensaje(
    telefono,
    "No he entendido tu mensaje. Escribe *menú* para volver al inicio."
  );
}

// ============================================================
// ENDPOINTS EXPRESS
// ============================================================

// ── Middleware: Basic Auth para rutas /admin ──────────────────
function authAdmin(req, res, next) {
  const header = req.headers["authorization"] || "";
  const b64 = header.replace("Basic ", "");
  const [user, pass] = Buffer.from(b64, "base64").toString().split(":");
  if (user === "admin" && pass === process.env.ADMIN_PASSWORD) return next();
  res.set("WWW-Authenticate", 'Basic realm="Ibérica Seguridad Admin"');
  res.status(401).send("Acceso restringido");
}

// ── Panel de administración ───────────────────────────────────
app.get("/admin", authAdmin, (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ibérica Seguridad — Panel Bot</title>
  <style>
    :root {
      --navy: #1A5C2B;
      --navy2: #26843D;
      --gold: #747576;
      --gold-bg: rgba(116,117,118,0.10);
      --bg: #F5F7F5;
      --white: #FFFFFF;
      --text: #2A2A2A;
      --muted: #747576;
      --border: #E0E8E2;
      --green: #26843D;
      --shadow: 0 2px 10px rgba(26,92,43,0.09);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }

    /* ── Header ── */
    header {
      background: var(--navy);
      padding: 0 32px;
      height: 62px;
      display: flex;
      align-items: center;
      gap: 14px;
      position: sticky;
      top: 0;
      z-index: 100;
      box-shadow: 0 2px 16px rgba(0,0,0,0.28);
    }
    .logo-icon { color: var(--gold); flex-shrink: 0; }
    .header-title { color: #fff; font-size: 1rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
    .header-sub { color: rgba(255,255,255,0.35); font-size: 0.75rem; margin-left: 4px; font-weight: 400; text-transform: none; letter-spacing: 0; }
    .header-clock { margin-left: auto; color: rgba(255,255,255,0.45); font-size: 0.82rem; font-variant-numeric: tabular-nums; }

    /* ── Stats bar ── */
    .stats-bar {
      background: var(--navy);
      padding: 16px 32px;
      display: flex;
      gap: 12px;
      border-bottom: 2px solid rgba(0,0,0,0.15);
    }
    .stat {
      background: #fff;
      border-radius: 10px;
      padding: 12px 24px;
      min-width: 130px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.10);
    }
    .stat .num { font-size: 1.8rem; font-weight: 800; color: var(--navy); line-height: 1; }
    .stat .num.green { color: var(--green); }
    .stat .num.gray  { color: var(--muted); }
    .stat .lbl { font-size: 0.66rem; color: var(--muted); margin-top: 4px; text-transform: uppercase; letter-spacing: 0.07em; }

    /* ── Tabs ── */
    .tabs-bar {
      background: var(--navy);
      padding: 0 32px;
      display: flex;
      gap: 2px;
      overflow-x: auto;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .tabs-bar::-webkit-scrollbar { display: none; }
    .tab-btn {
      padding: 12px 18px;
      font-size: 0.82rem;
      font-weight: 600;
      color: rgba(255,255,255,0.4);
      background: none;
      border: none;
      border-bottom: 3px solid transparent;
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;
      letter-spacing: 0.02em;
    }
    .tab-btn:hover { color: rgba(255,255,255,0.75); }
    .tab-btn.active { color: var(--gold); border-bottom-color: var(--gold); }
    .tab-count {
      display: inline-block;
      font-size: 0.62rem;
      padding: 1px 6px;
      border-radius: 20px;
      margin-left: 5px;
      background: rgba(255,255,255,0.08);
      color: rgba(255,255,255,0.4);
      font-weight: 700;
    }
    .tab-btn.active .tab-count { background: var(--gold-bg); color: var(--gold); }

    /* ── Content ── */
    .content { max-width: 880px; margin: 28px auto; padding: 0 24px; }
    .refresh-bar { text-align: right; margin-bottom: 14px; font-size: 0.73rem; color: var(--muted); }
    .refresh-bar b { color: var(--text); }
    .section-label { font-size: 0.68rem; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 10px; }

    /* ── Cards ── */
    .card {
      background: var(--white);
      border-radius: 12px;
      padding: 15px 18px;
      margin-bottom: 9px;
      box-shadow: var(--shadow);
      display: flex;
      align-items: center;
      gap: 14px;
      border-left: 3px solid transparent;
      transition: box-shadow 0.18s, border-color 0.18s;
    }
    .card:hover { box-shadow: 0 6px 20px rgba(27,29,53,0.13); }
    .card.bot-on  { border-left-color: var(--green); }
    .card.bot-off { border-left-color: var(--gold); }

    .avatar {
      width: 42px; height: 42px;
      border-radius: 50%;
      background: var(--navy);
      color: #fff;
      display: flex; align-items: center; justify-content: center;
      font-weight: 800; font-size: 1rem;
      flex-shrink: 0;
      letter-spacing: -0.5px;
    }
    .card.bot-off .avatar { background: var(--gold); }

    .info { flex: 1; min-width: 0; }
    .info-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .info-name { font-weight: 700; font-size: 0.92rem; }
    .info-tel { font-size: 0.75rem; color: var(--muted); }
    .status-pill {
      font-size: 0.66rem; font-weight: 700;
      padding: 2px 8px; border-radius: 20px;
    }
    .status-pill.on  { background: #D6EFE0; color: #1A5C2B; }
    .status-pill.off { background: #EBEBEB; color: #747576; }
    .info-msg { font-size: 0.8rem; color: #666; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 420px; }
    .info-meta { font-size: 0.7rem; color: #bbb; margin-top: 3px; }

    /* ── Toggle ── */
    .toggle { position: relative; width: 48px; height: 26px; flex-shrink: 0; }
    .toggle input { opacity: 0; width: 0; height: 0; }
    .slider { position: absolute; inset: 0; background: #D5D8E0; border-radius: 26px; cursor: pointer; transition: 0.28s; }
    .slider:before { content: ""; position: absolute; width: 18px; height: 18px; left: 4px; bottom: 4px; background: white; border-radius: 50%; transition: 0.28s; box-shadow: 0 1px 4px rgba(0,0,0,0.18); }
    input:checked + .slider { background: var(--green); }
    input:checked + .slider:before { transform: translateX(22px); }

    /* ── Empty ── */
    .empty { text-align: center; padding: 60px 20px; color: var(--muted); font-size: 0.88rem; }
    .empty svg { opacity: 0.18; margin-bottom: 14px; display: block; margin-left: auto; margin-right: auto; }
  </style>
</head>
<body>

<header>
  <img src="/static/logo.jpg" alt="Ibérica Seguridad" style="height:44px;width:44px;object-fit:cover;border-radius:50%;border:2px solid rgba(255,255,255,0.25);flex-shrink:0;">
  <div>
    <span class="header-title">Ibérica Seguridad</span>
    <span class="header-sub">Panel Bot WhatsApp</span>
  </div>
  <div class="header-clock" id="reloj"></div>
</header>

<div class="stats-bar">
  <div class="stat"><div class="num" id="sTotal">—</div><div class="lbl">Contactos</div></div>
  <div class="stat"><div class="num green" id="sActivos">—</div><div class="lbl">Bot activo</div></div>
  <div class="stat"><div class="num gray" id="sPausados">—</div><div class="lbl">Con agente</div></div>
</div>

<div class="tabs-bar" id="tabsBar"></div>

<div class="content">
  <div class="refresh-bar">Actualización en <b><span id="cuenta">30</span>s</b></div>
  <div class="section-label" id="secLabel">Conversaciones</div>
  <div id="lista"><div class="empty">Cargando...</div></div>
</div>

<script>
  const CANALES = {
    "69af0932bd6b88aaf5da3887": { nombre: "Noe",      tel: null },
    "69a6981752ac843492cb9ed5": { nombre: "Mari",     tel: "34674163817" },
    "69af0e9ee1c709083b065b8a": { nombre: "Jose",     tel: "34674163818" },
    "69bd11ce7614bf4b4d6f2d3c": { nombre: "Isabel",   tel: "34664658254" },
    "69c3a0276c369daa9f0bbf81": { nombre: "Nieves",   tel: "34663303461" }
  };
  function nombreCanal(id) { return CANALES[id]?.nombre || id; }

  let tabActivo = "todos";
  let todosContactos = [];

  function hora(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const esHoy = d.toDateString() === new Date().toDateString();
    return esHoy
      ? d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  }

  function renderTabs(data) {
    const bar = document.getElementById('tabsBar');
    const conteo = {};
    data.forEach(c => { const id = c.canalId || 'sin-canal'; conteo[id] = (conteo[id] || 0) + 1; });

    const tabs = [{ id: 'todos', nombre: 'Todos', count: data.length }];
    Object.entries(CANALES).forEach(([id, info]) => tabs.push({ id, nombre: info.nombre, count: conteo[id] || 0 }));

    bar.innerHTML = tabs.map(t => \`
      <button class="tab-btn \${tabActivo === t.id ? 'active' : ''}" onclick="cambiarTab('\${t.id}')">
        \${t.nombre}<span class="tab-count">\${t.count}</span>
      </button>\`).join('');
  }

  function renderLista(data) {
    const filtrado = tabActivo === 'todos' ? data : data.filter(c => (c.canalId || 'sin-canal') === tabActivo);
    const lista = document.getElementById('lista');
    document.getElementById('secLabel').textContent =
      tabActivo === 'todos' ? 'Todas las conversaciones' : 'Conversaciones — ' + nombreCanal(tabActivo);

    if (filtrado.length === 0) {
      lista.innerHTML = '<div class="empty"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><p>Sin conversaciones en este canal</p></div>';
      return;
    }

    lista.innerHTML = filtrado.map(c => {
      const nombre = c.nombre || c.telefono;
      const inicial = (c.nombre || c.telefono.slice(-2)).charAt(0).toUpperCase();
      const on = c.botActivo;
      return \`
        <div class="card \${on ? 'bot-on' : 'bot-off'}">
          <div class="avatar">\${inicial}</div>
          <div class="info">
            <div class="info-top">
              <span class="info-name">\${nombre}</span>
              \${c.nombre ? \`<span class="info-tel">+\${c.telefono}</span>\` : ''}
              <span class="status-pill \${on ? 'on' : 'off'}">\${on ? 'Bot activo' : 'Agente'}</span>
            </div>
            <div class="info-msg">\${c.ultimoMensaje || 'Sin mensajes aún'}</div>
            <div class="info-meta">Último: \${hora(c.ultimaActividad)} &middot; \${c.mensajesTotal} mensaje\${c.mensajesTotal !== 1 ? 's' : ''} &middot; \${c.canalNombre}</div>
          </div>
          <label class="toggle">
            <input type="checkbox" \${on ? 'checked' : ''} onchange="toggleBot('\${c.telefono}', this.checked, '\${c.canalId}')">
            <span class="slider"></span>
          </label>
        </div>\`;
    }).join('');
  }

  async function cargar() {
    const res = await fetch('/admin/api/contactos');
    todosContactos = await res.json();
    const activos = todosContactos.filter(c => c.botActivo).length;
    document.getElementById('sTotal').textContent = todosContactos.length;
    document.getElementById('sActivos').textContent = activos;
    document.getElementById('sPausados').textContent = todosContactos.length - activos;
    renderTabs(todosContactos);
    renderLista(todosContactos);
  }

  function cambiarTab(id) {
    tabActivo = id;
    renderTabs(todosContactos);
    renderLista(todosContactos);
  }

  async function toggleBot(telefono, activo, canalId) {
    await fetch('/admin/api/toggle/' + encodeURIComponent(telefono), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activo, canalId })
    });
    cargar();
  }

  setInterval(() => {
    document.getElementById('reloj').textContent = new Date().toLocaleTimeString('es-ES');
  }, 1000);

  let seg = 30;
  setInterval(() => {
    seg--;
    document.getElementById('cuenta').textContent = seg;
    if (seg <= 0) { seg = 30; cargar(); }
  }, 1000);

  cargar();
</script>
</body>
</html>`);
});

// ── API: lista de contactos para el panel ─────────────────────
app.get("/admin/api/contactos", authAdmin, (req, res) => {
  const lista = Object.keys(actividad).map((telefono) => {
    const canalId = actividad[telefono]?.canalId || null;
    const clave = canalId ? `${canalId}_${telefono}` : telefono;
    return {
      telefono,
      nombre: NOMBRES_AGENTES[telefono] || null,
      canalId,
      canalNombre: CANALES_AGENTES[canalId] || "Desconocido",
      botActivo: botActivo[clave] !== false,
      ultimoMensaje: actividad[telefono]?.ultimoMensaje || null,
      ultimaActividad: actividad[telefono]?.ultimaActividad || null,
      mensajesTotal: actividad[telefono]?.mensajesTotal || 0,
    };
  });
  lista.sort((a, b) => (b.ultimaActividad || 0) - (a.ultimaActividad || 0));
  res.json(lista);
});

// ── API: activar/pausar bot para un cliente ───────────────────
app.post("/admin/api/toggle/:telefono", authAdmin, async (req, res) => {
  const telefono = decodeURIComponent(req.params.telefono);
  const activo   = req.body?.activo;
  const canalId  = req.body?.canalId || null;
  const clave    = canalId ? `${canalId}_${telefono}` : telefono;

  const estabaActivo = botActivo[clave] !== false;
  botActivo[clave] = activo;
  redisSet("iberica:botActivo", botActivo);
  console.log(`[Admin] Bot ${activo ? "activado" : "pausado"} para ${telefono} (canal: ${canalId})`);

  // Si se acaba de pausar, avisar al cliente
  if (estabaActivo && !activo && conversaciones[telefono]?.memberId) {
    await enviarMensaje(
      telefono,
      "Un agente de Ibérica Seguridad se pondrá en contacto contigo en breve. ¡Gracias por tu paciencia! 🙏"
    );
  }

  // Si se reactiva el bot, reiniciar la conversación con el menú
  if (!estabaActivo && activo && conversaciones[telefono]?.memberId) {
    resetearConversacion(telefono);
    conversaciones[telefono].step = "menu_principal";
    await enviarMensaje(telefono, MENU_PRINCIPAL);
  }

  res.json({ ok: true, telefono, canalId, botActivo: activo });
});

// ── Health check ─────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// ── Webhook de Woztell ───────────────────────────────────────
app.post("/webhook", async (req, res) => {
  try {
    const tipo       = req.body?.type;
    const eventType  = req.body?.eventType;

    // Ignorar eventos que no son mensajes de texto entrantes del cliente:
    // - type !== "TEXT": READ, DELIVERED, SENT, etc.
    // - eventType !== "INBOUND": mensajes OUTBOUND (los que el propio bot envía)
    //   Woztell los refleja de vuelta al webhook y causarían un bucle infinito
    if (tipo?.toUpperCase() !== "TEXT" || eventType?.toUpperCase() !== "INBOUND") {
      console.log(`[Webhook] Evento ignorado (type: ${tipo}, eventType: ${eventType})`);
      return res.sendStatus(200);
    }

    // Extraer datos del body según la estructura real de Woztell
    const telefono  = req.body?.from;      // número del cliente (clave de estado)
    const memberId  = req.body?.member;    // ID interno Woztell para enviar mensajes
    const channelId = req.body?.channel;   // canal real — puede diferir del .env
    const texto     = req.body?.data?.text;

    if (!telefono || !memberId || !channelId || !texto) {
      console.warn("[Webhook] Payload incompleto:", JSON.stringify(req.body));
      return res.status(400).json({ error: "Payload incompleto" });
    }

    console.log(`[Webhook] De: ${telefono} | member: ${memberId} | channel: ${channelId} | msg: "${texto}"`);

    // Registrar actividad del cliente (para el panel admin)
    if (!actividad[telefono]) actividad[telefono] = { mensajesTotal: 0 };
    actividad[telefono].ultimoMensaje  = texto;
    actividad[telefono].ultimaActividad = Date.now();
    actividad[telefono].mensajesTotal++;
    actividad[telefono].canalId = channelId;
    redisSet("iberica:actividad", actividad);

    // ── Ignorar mensajes de agentes internos (no son clientes) ──────────
    if (NOMBRES_AGENTES[telefono]) {
      console.log(`[Webhook] Mensaje de agente interno ${NOMBRES_AGENTES[telefono]} (${telefono}) — ignorado`);
      return res.sendStatus(200);
    }

    // ── Comprobar si el bot está pausado para este cliente en este canal ──
    const claveBot = `${channelId}_${telefono}`;
    if (botActivo[claveBot] === false) {
      console.log(`[Webhook] Bot pausado para ${telefono} en canal ${channelId} — mensaje ignorado`);
      return res.sendStatus(200);
    }

    // ── Comprobar horario de activación del canal ─────────────
    // En horario comercial el bot está apagado (los agentes atienden en persona)
    // Fuera de horario comercial el bot responde con normalidad
    const minutosMadrid = minutosActualesMadrid();
    const activo = dentroDeHorario(channelId);
    console.log(`[Horario] Canal: ${channelId} | Minutos Madrid: ${minutosMadrid} | Bot activo: ${activo}`);
    if (!activo) {
      console.log(`[Webhook] Horario comercial — bot inactivo para canal ${channelId}, mensaje ignorado`);
      return res.sendStatus(200);
    }

    // Inicializar conversación si no existe y mostrar menú en primer contacto
    if (!conversaciones[telefono]) {
      resetearConversacion(telefono);
      conversaciones[telefono].memberId  = memberId;
      conversaciones[telefono].channelId = channelId;
      conversaciones[telefono].step = "menu_principal";
      await enviarMensaje(telefono, MENU_PRINCIPAL);
      return res.sendStatus(200);
    }

    // Actualizar memberId y channelId en cada mensaje (pueden variar entre sesiones)
    conversaciones[telefono].memberId  = memberId;
    conversaciones[telefono].channelId = channelId;

    // Si el step es null (recién reseteado pero ya tenía estado), forzar menú
    if (conversaciones[telefono].step === null) {
      conversaciones[telefono].step = "menu_principal";
      await enviarMensaje(telefono, MENU_PRINCIPAL);
      return res.sendStatus(200);
    }

    // Procesar el mensaje entrante
    await procesarMensaje(telefono, texto);

    // Asegurarse de que tras el procesamiento el step quede en menu_principal si se reseteó
    if (conversaciones[telefono] && conversaciones[telefono].step === null) {
      conversaciones[telefono].step = "menu_principal";
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("[Webhook] Error inesperado:", err.message);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ── Callback OAuth de Zoho (recibe el código de autorización) ─
app.get("/zoho/callback", async (req, res) => {
  const codigo = req.query.code;

  if (!codigo) {
    return res.status(400).send("No se recibió código de autorización.");
  }

  console.log("[Zoho] Código de autorización recibido:", codigo);

  try {
    const response = await axios.post("https://accounts.zoho.eu/oauth/v2/token", null, {
      params: {
        code: codigo,
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        redirect_uri: process.env.ZOHO_REDIRECT_URI,
        grant_type: "authorization_code",
      },
    });

    console.log("[Zoho] Tokens obtenidos:", response.data);
    res.json({
      mensaje: "Autorización completada. Guarda el refresh_token en tu .env",
      tokens: response.data,
    });
  } catch (err) {
    console.error("[Zoho] Error en callback:", err.response?.data || err.message);
    res.status(500).send("Error al obtener los tokens de Zoho.");
  }
});

// ── Test de conexión Zoho CRM ─────────────────────────────────
// Visita /zoho/test en el navegador para verificar si el token funciona
app.get("/zoho/test", async (req, res) => {
  try {
    const token = await obtenerTokenZoho();
    const resultados = {};

    // Test 1: información de la organización (más básico)
    try {
      const org = await axios.get("https://www.zohoapis.eu/crm/v2/org", {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      });
      resultados.org = { ok: true, nombre: org.data.org?.[0]?.company_name };
    } catch (e) {
      resultados.org = { ok: false, status: e.response?.status, error: e.response?.data };
    }

    // Test 2: listar módulos disponibles
    try {
      const modulos = await axios.get("https://www.zohoapis.eu/crm/v2/settings/modules", {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      });
      resultados.modulos = modulos.data.modules?.map(m => m.api_name) || [];
    } catch (e) {
      resultados.modulos = { ok: false, status: e.response?.status, error: e.response?.data };
    }

    // Test 3: acceso directo al módulo Cases
    try {
      const cases = await axios.get("https://www.zohoapis.eu/crm/v2/Cases?per_page=1", {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      });
      resultados.cases = { ok: true, total: cases.data.info?.count };
    } catch (e) {
      resultados.cases = { ok: false, status: e.response?.status, error: e.response?.data };
    }

    res.json({ token_primeros_20: token?.slice(0, 20), resultados });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Test: ver todos los campos de un Case real ───────────────
// ── Test: buscar parte por teléfono ──────────────────────────
// ── Test: buscar partes via Contacto ─────────────────────────
app.get("/zoho/test-contacto/:tel", async (req, res) => {
  try {
    const token = await obtenerTokenZoho();
    const tel9 = req.params.tel.slice(-9);
    const resultado = { tel9, contacto: null, partes: [] };

    // Buscar contacto por Phone o Mobile
    for (const campo of ["Phone", "Mobile"]) {
      try {
        const res = await axios.get("https://www.zohoapis.eu/crm/v2/Contacts/search", {
          params: { criteria: `(${campo}:equals:${tel9})` },
          headers: { Authorization: `Zoho-oauthtoken ${token}` },
        });
        if (res.data.data?.length > 0) {
          const c = res.data.data[0];
          resultado.contacto = { id: c.id, nombre: c.Full_Name, campo };
          break;
        }
      } catch (e) {
        if (e.response?.status !== 204) resultado[`error_${campo}`] = e.response?.data;
      }
    }

    if (!resultado.contacto) {
      return res.json({ ...resultado, mensaje: "No se encontró contacto con ese teléfono" });
    }

    // Obtener partes del contacto
    try {
      const casesRes = await axios.get(
        `https://www.zohoapis.eu/crm/v2/Contacts/${resultado.contacto.id}/Cases`,
        { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
      );
      resultado.partes = casesRes.data.data?.map(c => ({
        ref: c.ref_Parte, subject: c.Subject, status: c.Status, fecha: c.Fecha_Hora_Inicio
      })) || [];
    } catch (e) {
      resultado.error_cases = { status: e.response?.status, detail: e.response?.data };
    }

    res.json(resultado);
  } catch (err) {
    res.status(500).json({ error: err.message, detail: err.response?.data });
  }
});

app.get("/zoho/test-phone/:tel", async (req, res) => {
  try {
    const token = await obtenerTokenZoho();
    const tel9 = req.params.tel.slice(-9);
    const result = await axios.get("https://www.zohoapis.eu/crm/v2/Cases/search", {
      params: { criteria: `(Phone:equals:${tel9})` },
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    res.json({ tel9, total: result.data.data?.length, casos: result.data.data?.map(c => ({ ref: c.ref_Parte, subject: c.Subject, phone: c.Phone, status: c.Status })) });
  } catch (err) {
    res.status(500).json({ error: err.message, status: err.response?.status, detail: err.response?.data });
  }
});

// ── Diagnóstico de horarios ────────────────────────────────
app.get("/horario", (req, res) => {
  const ahora = new Date();
  const minutos = minutosActualesMadrid();
  const horasMadrid = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    weekday: "long", hour12: false,
  }).format(ahora);

  const estado = {};
  for (const [canalId, nombre] of Object.entries(CANALES_AGENTES)) {
    estado[nombre] = {
      canalId,
      botActivo: dentroDeHorario(canalId),
      horario: HORARIOS_CANALES[canalId] || "siempre activo",
    };
  }

  res.json({
    ahoraUTC: ahora.toISOString(),
    ahoraMadrid: horasMadrid,
    minutosMadrid: minutos,
    canales: estado,
  });
});

app.get("/zoho/campos-case", async (req, res) => {
  try {
    const token = await obtenerTokenZoho();
    const result = await axios.get("https://www.zohoapis.eu/crm/v2/Cases?per_page=1", {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    const caso = result.data.data?.[0];
    if (!caso) return res.json({ mensaje: "No hay Cases en Zoho" });
    res.json({ campos: Object.keys(caso), valores: caso });
  } catch (err) {
    res.status(500).json({ error: err.message, detail: err.response?.data });
  }
});

// ============================================================
// ARRANQUE DEL SERVIDOR
// ============================================================
app.listen(PORT, async () => {
  console.log(`\n🚀 Ibérica Seguridad Bot arrancado en puerto ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   Webhook:      http://localhost:${PORT}/webhook`);

  // Cargar estado persistido desde Redis
  try {
    await cargarEstadoDesdeRedis();
    console.log("✅ Estado cargado desde Redis correctamente.");
  } catch (err) {
    console.warn("⚠️  No se pudo cargar el estado desde Redis:", err.message);
  }

  // Pre-cargar el token de Zoho al arrancar para detectar errores de configuración
  try {
    await obtenerTokenZoho();
    console.log("✅ Token de Zoho obtenido correctamente al arrancar.");
  } catch (err) {
    console.warn("⚠️  No se pudo obtener el token de Zoho al arrancar:", err.message);
    console.warn("   Comprueba ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET y ZOHO_REFRESH_TOKEN en .env");
  }
});
