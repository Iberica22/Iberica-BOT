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

// ── Token de Zoho en memoria ────────────────────────────────
let zohoAccessToken = null;
let zohoTokenExpira = 0; // timestamp en ms cuando expira

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
 * Crea un parte (Case) en Zoho CRM.
 * @param {object} datos - { nombre, telefono, direccion, descripcion }
 * @returns {string} - Número / ID del parte creado
 */
async function crearParteZoho(datos) {
  const token = await obtenerTokenZoho();
  const asunto = `Urgencia - ${datos.nombre} - ${new Date().toLocaleDateString("es-ES")}`;

  const body = {
    data: [
      {
        Subject: asunto,
        Description: datos.descripcion,
        Phone: datos.telefono,
        Street: datos.direccion,
        Status: "Open",
        Priority: "High",
      },
    ],
  };

  console.log("[Zoho] Creando parte con body:", JSON.stringify(body));

  try {
    const res = await axios.post(
      "https://www.zohoapis.eu/crm/v2/Cases",
      body,
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(`[Zoho] HTTP ${res.status} | Response:`, JSON.stringify(res.data));

    const parte = res.data.data?.[0];
    const id = parte?.details?.id || parte?.id || "N/D";
    console.log(`[Zoho] Parte creado con ID: ${id}`);
    return id;
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

NO incluyas datos técnicos internos ni campos vacíos. Si hay solución o comentarios finales, menciónalos.
Usa formato WhatsApp (negrita con *asteriscos*). No uses emojis en exceso.

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
    estado.telefono = msg;
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
      const idParte = await crearParteZoho({
        nombre: estado.nombre,
        telefono: estado.telefono,
        direccion: estado.direccion,
        descripcion: estado.descripcion,
      });

      await enviarMensaje(
        telefono,
        `✅ Tu parte de urgencia ha sido registrado correctamente.\n\n` +
          `📋 *Número de parte:* ${idParte}\n` +
          `👤 Nombre: ${estado.nombre}\n` +
          `📍 Dirección: ${estado.direccion}\n\n` +
          `Un técnico se pondrá en contacto contigo lo antes posible. Guarda el número de parte para futuras consultas.`
      );
    } catch (err) {
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
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0f2f5; color: #1a1a2e; }
    header { background: #1a1a2e; color: white; padding: 16px 24px; display: flex; align-items: center; gap: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
    header h1 { font-size: 1.2rem; font-weight: 600; }
    header span { font-size: 0.8rem; opacity: 0.6; margin-left: auto; }
    .container { max-width: 900px; margin: 28px auto; padding: 0 16px; }
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 28px; }
    .stat { background: white; border-radius: 12px; padding: 20px; text-align: center; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
    .stat .num { font-size: 2rem; font-weight: 700; color: #1a1a2e; }
    .stat .lbl { font-size: 0.8rem; color: #888; margin-top: 4px; }
    .stat.verde .num { color: #25d366; }
    .stat.roja .num { color: #e74c3c; }
    h2 { font-size: 1rem; font-weight: 600; color: #555; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
    .card { background: white; border-radius: 12px; padding: 18px 20px; margin-bottom: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); display: flex; align-items: center; gap: 16px; transition: box-shadow 0.2s; }
    .card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.12); }
    .avatar { width: 44px; height: 44px; border-radius: 50%; background: #1a1a2e; color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 1.1rem; flex-shrink: 0; }
    .avatar.inactivo { background: #ccc; }
    .info { flex: 1; min-width: 0; }
    .info .tel { font-weight: 600; font-size: 0.95rem; }
    .info .msg { font-size: 0.82rem; color: #666; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 400px; }
    .info .hora { font-size: 0.75rem; color: #aaa; margin-top: 2px; }
    .badge { font-size: 0.72rem; font-weight: 600; padding: 3px 8px; border-radius: 20px; margin-left: 8px; }
    .badge.activo { background: #d4f8e2; color: #1a8a3a; }
    .badge.pausado { background: #fde8e8; color: #c0392b; }
    .toggle { position: relative; width: 52px; height: 28px; flex-shrink: 0; }
    .toggle input { opacity: 0; width: 0; height: 0; }
    .slider { position: absolute; inset: 0; background: #ccc; border-radius: 28px; cursor: pointer; transition: 0.3s; }
    .slider:before { content: ""; position: absolute; width: 20px; height: 20px; left: 4px; bottom: 4px; background: white; border-radius: 50%; transition: 0.3s; }
    input:checked + .slider { background: #25d366; }
    input:checked + .slider:before { transform: translateX(24px); }
    .empty { text-align: center; padding: 48px; color: #aaa; font-size: 0.95rem; }
    #refreshBar { text-align: right; margin-bottom: 10px; font-size: 0.78rem; color: #aaa; }
    #refreshBar span { font-weight: 600; color: #555; }
  </style>
</head>
<body>
  <header>
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
    <h1>Ibérica Seguridad — Panel Bot WhatsApp</h1>
    <span id="reloj"></span>
  </header>

  <div class="container">
    <div class="stats">
      <div class="stat"><div class="num" id="sTotal">—</div><div class="lbl">Contactos totales</div></div>
      <div class="stat verde"><div class="num" id="sActivos">—</div><div class="lbl">Bot activo</div></div>
      <div class="stat roja"><div class="num" id="sPausados">—</div><div class="lbl">Atendidos por agente</div></div>
    </div>

    <div id="refreshBar">Actualización automática en <span id="cuenta">30</span>s</div>
    <h2>Conversaciones</h2>
    <div id="lista"><div class="empty">Aún no hay mensajes recibidos</div></div>
  </div>

  <script>
    function hora(ts) {
      if (!ts) return '—';
      const d = new Date(ts);
      const hoy = new Date();
      const esHoy = d.toDateString() === hoy.toDateString();
      return esHoy
        ? d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    }

    async function cargar() {
      const res = await fetch('/admin/api/contactos');
      const data = await res.json();
      const lista = document.getElementById('lista');
      const activos = data.filter(c => c.botActivo).length;

      document.getElementById('sTotal').textContent = data.length;
      document.getElementById('sActivos').textContent = activos;
      document.getElementById('sPausados').textContent = data.length - activos;

      if (data.length === 0) {
        lista.innerHTML = '<div class="empty">Aún no hay mensajes recibidos</div>';
        return;
      }

      lista.innerHTML = data.map(c => {
        const etiqueta = c.nombre || c.telefono;
        const inicial = c.nombre ? c.nombre[0].toUpperCase() : c.telefono.slice(-2).toUpperCase();
        return \`
          <div class="card">
            <div class="avatar \${c.botActivo ? '' : 'inactivo'}">\${inicial}</div>
            <div class="info">
              <div class="tel">
                \${etiqueta}
                \${c.nombre ? '<span style="font-size:0.8rem;color:#888;font-weight:400;margin-left:6px;">+\${c.telefono}</span>' : ''}
                <span class="badge \${c.botActivo ? 'activo' : 'pausado'}">\${c.botActivo ? '🤖 Bot activo' : '👤 Agente'}</span>
              </div>
              <div class="msg">\${c.ultimoMensaje || 'Sin mensajes aún'}</div>
              <div class="hora">Último mensaje: \${hora(c.ultimaActividad)} · Total: \${c.mensajesTotal} mensaje\${c.mensajesTotal !== 1 ? 's' : ''}</div>
            </div>
            <label class="toggle">
              <input type="checkbox" \${c.botActivo ? 'checked' : ''} onchange="toggle('\${c.telefono}', this.checked)">
              <span class="slider"></span>
            </label>
          </div>\`;
      }).join('');
    }

    async function toggle(telefono, activo) {
      await fetch('/admin/api/toggle/' + encodeURIComponent(telefono), { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ activo }) });
      cargar();
    }

    // Reloj
    setInterval(() => {
      document.getElementById('reloj').textContent = new Date().toLocaleTimeString('es-ES');
    }, 1000);

    // Auto-refresh cada 30s con cuenta atrás
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
  const lista = Object.keys(actividad).map((telefono) => ({
    telefono,
    nombre: NOMBRES_AGENTES[telefono] || null,
    botActivo: botActivo[telefono] !== false, // true por defecto
    ultimoMensaje: actividad[telefono]?.ultimoMensaje || null,
    ultimaActividad: actividad[telefono]?.ultimaActividad || null,
    mensajesTotal: actividad[telefono]?.mensajesTotal || 0,
  }));
  // Ordenar por última actividad (más reciente primero)
  lista.sort((a, b) => (b.ultimaActividad || 0) - (a.ultimaActividad || 0));
  res.json(lista);
});

// ── API: activar/pausar bot para un cliente ───────────────────
app.post("/admin/api/toggle/:telefono", authAdmin, async (req, res) => {
  const telefono = decodeURIComponent(req.params.telefono);
  const activo = req.body?.activo;
  const estabaActivo = botActivo[telefono] !== false;
  botActivo[telefono] = activo;
  console.log(`[Admin] Bot ${activo ? "activado" : "pausado"} para ${telefono}`);

  // Si se acaba de pausar, avisar al cliente que un agente le atenderá
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

  res.json({ ok: true, telefono, botActivo: activo });
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
    if (tipo !== "TEXT" || eventType !== "INBOUND") {
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

    // ── Comprobar si el bot está pausado para este cliente ──
    if (botActivo[telefono] === false) {
      console.log(`[Webhook] Bot pausado para ${telefono} — mensaje ignorado`);
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

  // Pre-cargar el token de Zoho al arrancar para detectar errores de configuración
  try {
    await obtenerTokenZoho();
    console.log("✅ Token de Zoho obtenido correctamente al arrancar.");
  } catch (err) {
    console.warn("⚠️  No se pudo obtener el token de Zoho al arrancar:", err.message);
    console.warn("   Comprueba ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET y ZOHO_REFRESH_TOKEN en .env");
  }
});
