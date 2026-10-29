# Campañas de Marta — Navidad 2026 y reactivación

Basado en «Instrucciones para Marta · Navidad y reactivación» (28/10/2026).
Marta envía las plantillas desde su número (661 66 59 29), consigue el «Sí,
llamadme» y se lo pasa a Nieves con su etiqueta. A los clientes de la
plantilla no les da precios.

## Cómo se lanza una tanda

1. Adm3 prepara la lista ya cruzada: sin compañías, sin los 173, sin los
   clientes con 3 servicios o más y sin la casilla «Llamada Nieves».
2. En **/admin/campanas** se elige la campaña y se pega la lista desde el
   Excel, con cabecera:
   - **Navidad:** `telefono`, `nombre`, `cuando` («en marzo», «hace un
     tiempo») y `trabajo` («abrirte la puerta de casa»).
   - **T4 (aniversario):** `telefono`, `nombre` y `trabajo`.
   - **T3, T5, T6 y T7:** `telefono` y `nombre`.
3. La lista queda **en revisión**. Con «Ver» sale el mensaje exacto de cada
   cliente; se revisa a mano (obligatorio con los 120 de la prueba).
4. «Activar»: Marta envía en la siguiente ventana.

## Qué comprueba Marta sola

**Al subir la lista** quita:
- los teléfonos fijos y los duplicados;
- las BAJAs;
- las comunidades, empresas, hoteles e inmobiliarias (por el nombre);
- las filas sin nombre o sin las variables de la plantilla.

También aparta al azar un **10 % de grupo de control**, salvo en la T7.

**Antes de cada envío** quita a quien:
- tenga un presupuesto abierto;
- haya recibido un mensaje comercial hace menos de 30 días;
- ya lleve 4 mensajes comerciales este año;
- no haya contestado a 3 seguidos (pasa a «solo aniversario»);
- haya dicho «No, gracias» a esa campaña;
- tenga la casilla **WhatsApp Opt Out** en Zoho.

**Cuándo envía:**
- de **10:00 a 10:30**, nunca en festivo;
- **Navidad:** de lunes a jueves, 40 al día (20 los jueves), solo en las
  fechas del plan:
  - del 10 al 12 de noviembre;
  - del 16 de noviembre al 3 de diciembre, salvo el 26 y el 27;
  - del 9 al 17 de diciembre;
- **reactivación:** de martes a jueves;
- como máximo **60 mensajes al día** en total desde el número de Marta.

**Recordatorio único de Navidad:** del 9 al 17 de diciembre, una sola vez, a
quien tiene el primer mensaje entregado hace 5 días o más y no ha contestado.

**Frenos:**
- **Nieves con más de 12 conversaciones abiertas** (pasadas en las últimas
  48 h): no se envía la tanda.
- **BAJAs + fallos por encima del 4 %** (a partir de 25 envíos): la lista
  se para y se avisa a Nieves y a Mari.
- **La plantilla falla en Meta:** la lista se para y se avisa.

La calidad del número («en verde») hay que mirarla a mano en WhatsApp
Manager.

## Qué contesta Marta

| El cliente… | Marta |
|---|---|
| Escribe por primera vez | Se presenta como asistente automático; las llamadas y los precios los lleva Nieves |
| «Sí, llamadme» | Te llama Nieves desde el 950 088 086 + ¿mañana o tarde? → después pide la marca de la llave o una foto. A Nieves le llegan dos avisos: uno al «Sí» y otro con la franja y la llave juntas (o a los 10 minutos si no manda la llave) |
| «Mejor en enero» | Nieves te lo deja con fecha para la 2.ª quincena de enero; si dice que sí, aviso a Nieves |
| «No, gracias» | No le escribimos más con esto (no es BAJA) |
| ¿Cuánto cuesta? | Te lo dice Nieves por teléfono con precio cerrado |
| ¿Es gratis? ¿Venís a verla? | La llamada y la orientación no cuestan; el técnico va a instalar, no a mirar |
| ¿Es un timo? ¿Es vuestro? | Sí, es nuestro; para comprobarlo, el 950 088 086 o Google |
| ¿Vais hasta [pueblo]? | A toda la provincia, en días de ruta. **Levante: no llegamos** |
| Fuera de horario | «Ahora la oficina está cerrada. Nieves te llama mañana / el lunes» |
| Audio | Que lo escriba en una línea, o le llama Nieves |
| Alquiler, negocio, robo cercano, recomienda a alguien, «¿eres un robot?» | Respuesta tranquila y aviso a Nieves con el caso |
| Ex pareja, amenaza, llave no devuelta | Mensaje con el 112 y el 016 y aviso a Nieves con **PRIORIDAD** |
| Puerta acorazada | Aviso a Nieves |
| Queja | Aviso para Noemí (hoy llega a Mari) |
| Urgencia («estoy fuera», «sin llaves», «robo»…) | Que llame ya al 950 088 086 (por delante de todo) |
| BAJA, enfado, «quitadme», fallecimiento | BAJA en el momento, casilla WhatsApp Opt Out en Zoho y aviso a Mari para [NOCOM]. Nunca pasa a Nieves |
| Pide borrar sus datos | BAJA y aviso de protección de datos (plazo de un mes) |

En T3, T4, T5 y T6, el «SÍ» se contesta con «Perfecto, se lo paso a Nieves y
te llama desde el 950 088 086. ¿Mejor por la mañana o por la tarde?» y va a
Nieves con su etiqueta (REACT-T3, REACT-T4…).

**Entradas de Navidad desde fuera** («Hola, vengo de la web / he visto
vuestro vídeo / he visto vuestro anuncio … puerta lista para las fiestas»):
Marta las etiqueta **NAV26-WEB / NAV26-ORG / NAV26-ADS**. A estas sí les da
el precio orientativo (bombín 99 €, con escudo 179 €) y les ofrece la
llamada de Nieves.

**Cliente de la casa (T7):** lo que escribe después no lo contesta Marta.
Responde «Recibido, se lo paso a…» y lo pasa a Mari o a Nieves según la
hora. Fuera de horario va a Mari para primera hora, y si es urgente, a la
guardia.

## Variables de Railway (nombre exacto de la plantilla aprobada en Meta)

| Variable | Plantilla |
|---|---|
| `NAV_TEMPLATE` | Navidad, principal (marketing, con los 3 botones) |
| `NAV_TEMPLATE_RECORDATORIO` | Navidad, recordatorio único |
| `T7_TEMPLATE` | Alta «Cliente de la casa» (utilidad) |
| `T3_TEMPLATE` | Cliente top que no contestó |
| `T4_TEMPLATE` | Aniversario |
| `T5_TEMPLATE` | Antes de vacaciones |
| `T6_TEMPLATE` | Cambio de inquilino |
| `ZOHO_CAMPO_OPTOUT` | Opcional. Nombre API de la casilla «WhatsApp Opt Out» (por defecto `WhatsApp_Opt_Out`) |
| `CAMP_TEXTO_PRECIO_WEB` | Opcional. Texto del precio para las entradas web |

Sin la variable, la lista no se puede activar.

## Panel

- **/admin/campanas**: subir, revisar, activar y pausar listas, y ver
  cifras (enviados, entregados, respuestas, rechazo).
- `GET /admin/api/campanas`: las mismas cifras en JSON, más las
  conversaciones pasadas a Nieves por etiqueta.
- `GET /admin/api/campanas/tanda?forzar=1`: lanza una tanda a mano, fuera
  de la ventana. Solo para pruebas.
