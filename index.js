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
// Estructura por cliente: { step, nombre, telefono, direccion, descripcion, thread_id }
const conversaciones = {};

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
  console.log("[Zoho] Renovando access token...");
  try {
    const res = await axios.post("https://accounts.zoho.eu/oauth/v2/token", null, {
      params: {
        refresh_token: process.env.ZOHO_REFRESH_TOKEN,
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        redirect_uri: process.env.ZOHO_REDIRECT_URI,
        grant_type: "refresh_token",
      },
    });

    zohoAccessToken = res.data.access_token;
    // Restamos 60 s de margen para renovar antes de que caduque
    zohoTokenExpira = Date.now() + (res.data.expires_in - 60) * 1000;
    console.log("[Zoho] Access token renovado correctamente.");
    return zohoAccessToken;
  } catch (err) {
    console.error("[Zoho] Error renovando token:", err.response?.data || err.message);
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

  try {
    const res = await axios.post(
      "https://www.zohoapis.eu/crm/v2/Cases",
      {
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
      },
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    const parte = res.data.data?.[0];
    const id = parte?.details?.id || parte?.id || "N/D";
    console.log(`[Zoho] Parte creado con ID: ${id}`);
    return id;
  } catch (err) {
    console.error("[Zoho] Error creando parte:", err.response?.data || err.message);
    throw new Error("Error al crear el parte en Zoho");
  }
}

/**
 * Consulta el estado de un parte en Zoho CRM por número/referencia.
 * @param {string} numeroParte - Número o texto de búsqueda
 * @returns {object|null} - Datos del parte o null si no se encuentra
 */
async function consultarParteZoho(numeroParte) {
  const token = await obtenerTokenZoho();

  try {
    const res = await axios.get(
      "https://www.zohoapis.eu/crm/v2/Cases/search",
      {
        params: {
          criteria: `(Subject:contains:${numeroParte})`,
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
    // 204 No Content = no hay resultados, no es un error real
    if (err.response?.status === 204) return null;
    console.error("[Zoho] Error consultando parte:", err.response?.data || err.message);
    throw new Error("Error al consultar el parte en Zoho");
  }
}

// ============================================================
// WOZTELL - Envío de mensajes
// ============================================================

/**
 * Envía un mensaje de texto al cliente a través de la API de Woztell.
 * Usa memberId (ID interno de Woztell) guardado en el estado del cliente.
 * @param {string} telefono - clave del cliente en conversaciones (req.body.from)
 * @param {string} mensaje  - Texto a enviar
 */
async function enviarMensaje(telefono, mensaje) {
  // memberId es el identificador interno de Woztell (req.body.member)
  const memberId = conversaciones[telefono]?.memberId;
  if (!memberId) {
    console.error(`[Woztell] Sin memberId para ${telefono}, no se puede enviar el mensaje.`);
    return;
  }
  console.log(`[Woztell] → ${telefono} (member: ${memberId}): ${mensaje.slice(0, 80)}...`);
  try {
    await axios.post(
      `https://bot.api.woztell.com/sendResponses?accessToken=${process.env.WOZTELL_TOKEN}`,
      {
        channelId: process.env.WOZTELL_CHANNEL_ID,
        memberId,
        response: [{ type: "TEXT", text: mensaje }],
      }
    );
  } catch (err) {
    console.error("[Woztell] Error enviando mensaje:", err.response?.data || err.message);
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
  conversaciones[telefono] = {
    step: null,
    nombre: null,
    telefono: null,
    direccion: null,
    descripcion: null,
    thread_id: threadAnterior,
    memberId: memberAnterior,   // ID interno de Woztell para enviar mensajes
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
      estado.step = "estado_numero";
      await enviarMensaje(telefono, "Por favor, indícame el número de tu parte o expediente.");
      return;
    }
    if (["5", "agente", "persona", "humano"].includes(msgLower)) {
      await enviarMensaje(
        telefono,
        "Perfecto, te pongo en contacto con uno de nuestros agentes. En breve alguien del equipo atenderá tu conversación."
      );
      resetearConversacion(telefono);
      await enviarMensaje(telefono, MENU_PRINCIPAL);
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
    await enviarMensaje(telefono, MENU_PRINCIPAL);
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
    await enviarMensaje(telefono, MENU_PRINCIPAL);
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

  // ── RAMA 4: ESTADO DE PARTE ──────────────────────────────
  if (estado.step === "estado_numero") {
    const numeroParte = msg;
    estado.step = "estado_consultar";

    await enviarMensaje(telefono, `🔍 Buscando el parte *${numeroParte}*...`);

    try {
      const parte = await consultarParteZoho(numeroParte);

      if (!parte) {
        await enviarMensaje(
          telefono,
          `No hemos encontrado ningún parte con la referencia *${numeroParte}*.\n\nComprueba el número e inténtalo de nuevo, o contacta con nosotros directamente.`
        );
      } else {
        await enviarMensaje(
          telefono,
          `📋 *Información del parte ${numeroParte}*\n\n` +
            `📌 *Asunto:* ${parte.Subject || "N/D"}\n` +
            `🔄 *Estado:* ${parte.Status || "N/D"}\n` +
            `⚡ *Prioridad:* ${parte.Priority || "N/D"}\n` +
            `📅 *Fecha de creación:* ${parte.Created_Time ? new Date(parte.Created_Time).toLocaleDateString("es-ES") : "N/D"}\n` +
            `📝 *Descripción:* ${parte.Description || "Sin descripción"}`
        );
      }
    } catch (err) {
      await enviarMensaje(
        telefono,
        "Ha ocurrido un error al consultar el parte. Por favor, inténtalo más tarde o contacta con nosotros directamente."
      );
    }

    resetearConversacion(telefono);
    await enviarMensaje(telefono, MENU_PRINCIPAL);
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

// ── Health check ─────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// ── Webhook de Woztell ───────────────────────────────────────
app.post("/webhook", async (req, res) => {
  try {
    // Extraer datos del body según la estructura real de Woztell
    const telefono = req.body?.from;           // número del cliente (clave de estado)
    const memberId = req.body?.member;          // ID interno Woztell para enviar mensajes
    const texto    = req.body?.data?.text;

    if (!telefono || !memberId || !texto) {
      console.warn("[Webhook] Payload incompleto:", JSON.stringify(req.body));
      return res.status(400).json({ error: "Payload incompleto" });
    }

    console.log(`[Webhook] Mensaje de ${telefono} (member: ${memberId}): "${texto}"`);

    // Inicializar conversación si no existe y mostrar menú en primer contacto
    if (!conversaciones[telefono]) {
      resetearConversacion(telefono);
      conversaciones[telefono].memberId = memberId;
      conversaciones[telefono].step = "menu_principal";
      await enviarMensaje(telefono, MENU_PRINCIPAL);
      return res.sendStatus(200);
    }

    // Actualizar memberId siempre (puede cambiar de sesión en sesión)
    conversaciones[telefono].memberId = memberId;

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
