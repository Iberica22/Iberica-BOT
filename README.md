# Ibérica Seguridad — Bot de WhatsApp

Bot conversacional para WhatsApp integrado con **Woztell**, **Zoho CRM** (dominio EU) y **OpenAI GPT-4o**.

## Tecnologías

| Componente | Uso |
|---|---|
| Express.js | Servidor HTTP y endpoints |
| Woztell API | Envío/recepción de mensajes de WhatsApp |
| Zoho CRM (EU) | Gestión de partes (Cases) |
| OpenAI GPT-4o | Asistente de información de servicios |

## Requisitos

- Node.js >= 18
- Cuenta de Woztell con canal de WhatsApp configurado
- Aplicación OAuth en Zoho CRM (dominio EU) con scope `ZohoCRM.modules.ALL`
- Clave de API de OpenAI

## Instalación

```bash
# 1. Clona o copia el proyecto
cd iberica-bot

# 2. Instala dependencias
npm install

# 3. Configura las variables de entorno
cp .env.example .env
# Edita .env con tus credenciales reales

# 4. Arranca el servidor
npm start

# Para desarrollo con recarga automática:
npm run dev
```

## Variables de entorno

| Variable | Descripción |
|---|---|
| `OPENAI_API_KEY` | Clave de API de OpenAI |
| `ZOHO_CLIENT_ID` | Client ID de la app OAuth en Zoho |
| `ZOHO_CLIENT_SECRET` | Client Secret de la app OAuth en Zoho |
| `ZOHO_REFRESH_TOKEN` | Refresh token permanente de Zoho |
| `ZOHO_REDIRECT_URI` | URI de callback OAuth (debe coincidir en Zoho) |
| `WOZTELL_TOKEN` | JWT de acceso a la API de Woztell |
| `WOZTELL_CHANNEL_ID` | ID del canal de WhatsApp en Woztell |
| `PORT` | Puerto del servidor (por defecto 3000) |

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/health` | Health check — devuelve `{"status":"ok"}` |
| `POST` | `/webhook` | Recibe mensajes entrantes de Woztell |
| `GET` | `/zoho/callback` | Callback OAuth para obtener/renovar refresh token |

## Flujo de conversación

```
Cliente escribe
       │
       ▼
  ¿Comando menú?  ──── sí ────▶  Mostrar menú principal
       │ no
       ▼
  ¿Step actual?
       │
   ┌───┴────────────────────────┐
   │                            │
   ▼                            ▼
Opción 1: Urgencia        Opción 2: Presupuesto
  → nombre                  → nombre
  → teléfono                → descripción
  → dirección               → confirmar y volver
  → descripción
  → crear parte Zoho
  → confirmar con nº parte

   ▼                            ▼
Opción 3: Servicios        Opción 4: Estado parte
  → GPT-4o en bucle          → pedir nº parte
  → historial 10 msgs        → buscar en Zoho
  → "menú" para salir        → mostrar estado

   ▼
Opción 5: Agente
  → mensaje de transferencia
  → volver al menú
```

## Lógica de tokens Zoho

- El **refresh token** es permanente y se guarda en `.env`.
- Al arrancar, el servidor obtiene automáticamente un **access token** (válido 1 hora).
- Antes de cada llamada a Zoho, se comprueba si el token ha expirado y se renueva automáticamente con 60 segundos de margen.
- No es necesario intervención manual para renovar tokens.

## Obtener el refresh token de Zoho (primera vez)

1. Genera la URL de autorización en la consola de Zoho y visítala en el navegador.
2. Acepta los permisos; Zoho redirigirá a `ZOHO_REDIRECT_URI?code=XXXX`.
3. El endpoint `/zoho/callback` intercambia ese código por los tokens y los muestra en pantalla.
4. Copia el `refresh_token` al `.env`.

## Despliegue en Railway

1. Sube el repositorio a GitHub (sin `.env`).
2. Crea un proyecto en Railway y conéctalo al repo.
3. Añade las variables de entorno en el panel de Railway.
4. Railway detecta automáticamente Node.js y ejecuta `npm start`.
5. Configura en Woztell el webhook apuntando a `https://tu-app.up.railway.app/webhook`.

## Estructura de archivos

```
iberica-bot/
├── index.js          # Servidor principal y toda la lógica del bot
├── package.json      # Dependencias y scripts
├── .env.example      # Plantilla de variables de entorno
├── .gitignore        # Excluye .env y node_modules
└── README.md         # Este archivo
```
