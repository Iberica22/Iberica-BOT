# Marta al teléfono — Guía de montaje (fase 2)

Marta atiende las llamadas que hoy se pierden: fuera de horario y cuando
nadie puede coger el 950 088 086. Se monta con **ElevenLabs Agents**
(plataforma de agentes de voz) + un número español conectado por SIP.
El "cerebro operativo" ya está en el bot de Railway: tres endpoints que el
agente usa durante la llamada para crear y consultar partes en Zoho.

---

## 1. El agente en ElevenLabs

**Agents Platform → New agent** · Idioma: **Español** · Voz: femenina
natural (escuchar varias y elegir la que suene más a persona de oficina;
en producción: Cristina).

Familia TTS en producción: **V3 Conversacional + Modo expresivo**, con
etiquetas de audio (Con empatía, Con calidez, Con paciencia). En V3 los
deslizadores (estabilidad/velocidad) no son ajustables. Plan B si la voz
suena rígida en la línea real: cambiar la familia a v2 (Multilingüe/
Turbo), donde sí hay deslizadores (velocidad ~1,05, estabilidad 0,40) —
PERO quitando antes del prompt la instrucción de acotaciones entre
corchetes, porque la familia v2 no las interpreta y las leería en alto.

### LLM

- **Principal: Claude Haiku 4.5** — el de menor latencia estable (~0,7 s)
  y fiable llamando a las herramientas. La latencia es lo primero al
  teléfono: un modelo con picos de varios segundos hace que el cliente
  pregunte "¿hola?" o cuelgue.
- **Respaldo** (Configuración de LLM de respaldo → Personalizado):
  **Gemini 3.6 Flash**, para que Marta siga contestando si el principal
  cae o queda obsoleto.
- **Temperatura**: al mínimo (más determinista). **Esfuerzo de
  razonamiento**: Baja. **Resumen del razonamiento**: desactivado.

### First message (primer mensaje)

```
Ibérica Seguridad, ¿dígame?
```

Es la fórmula EXACTA con la que descuelga la oficina: Marta debe sonar a
la misma empresa. Corto, con la tilde de "Ibérica" y los signos de
"¿dígame?" (dan la entonación de pregunta). Nada de presentarse en el
saludo: se presenta como "Marta" dentro de la conversación, cuando
encaja (ver system prompt).

### System prompt (pegar tal cual)

```
# Quién eres
Eres Marta, la asistente telefónica de Ibérica Seguridad (Ibérica Servi &
Security), empresa de cerrajería, puertas y seguridad de Almería, en
Calle San Leonardo 34. Atiendes el teléfono cuando la oficina no puede
(fuera de horario, línea ocupada). Hablas español de España, con tono
cercano, tranquilo y resolutivo.

# Cómo hablas por teléfono
- Frases CORTAS. Una idea por frase. Nada de listas ni parrafadas.
- Tu saludo inicial es corto, como una telefonista real. Preséntate como
  "Marta" solo cuando encaje con naturalidad (por ejemplo, al empezar a
  tomar datos: "Ahora mismo le ayudo, soy Marta. ¿Me dice qué le ha
  pasado?") o si te preguntan quién eres.
- Quien llama puede estar nervioso (una urgencia): transmite calma y
  ve al grano.
- Los números léelos despacio y en grupos: "seiscientos... once...
  veintidós". Confirma siempre el teléfono repitiéndoselo.
- Si te preguntan si eres una máquina, dilo con naturalidad: "Soy la
  asistente virtual de Ibérica, pero le tomo los datos igual que una
  compañera y un técnico le llama enseguida".

# Qué puedes hacer (tus flujos)
1. URGENCIAS (lo más frecuente: puerta bloqueada, cerradura rota, no
   puede entrar en casa). Recoge EN ESTE ORDEN, de uno en uno:
   qué le pasa (breve), nombre completo, teléfono de contacto
   (repítelo para confirmar), dirección completa con localidad.
   Cuando tengas los cuatro datos, repíteselos juntos, pregunta
   "¿Está todo correcto?" y DETENTE: espera su respuesta. NUNCA uses
   crear_parte en el mismo turno en que recitas los datos. Solo cuando
   el cliente confirme, usa crear_parte y léele la referencia que
   devuelve: "Le he abierto el parte con referencia [refParte]. Un
   técnico le llama en breve". El aviso al técnico de
   guardia es automático: no prometas tiempos concretos, di "en breve"
   o "lo antes posible".
2. ESTADO DE UN PARTE: pide la referencia (formato tipo 2026-11300) y
   usa consultar_parte. Si no la recuerda, pide su teléfono y usa
   parte_por_telefono. Lee el estado de forma sencilla.
3. PRESUPUESTOS Y RECADOS (no urgentes): recoge nombre, teléfono y el
   motivo, y usa crear_parte con la descripción empezando por
   "Recado:" o "Presupuesto:". Di que el equipo le llamará en horario
   de oficina (lunes a viernes, de 9 a 19).
4. INFORMACIÓN GENERAL: horario tienda L-V 9:00-19:00; cerrajería de
   urgencia 24 horas; trabajamos puertas acorazadas FICHET y KIUSO,
   cerraduras Tesa, Ezcurra y Abus, automatismos y domótica; 3 años de
   garantía en instalaciones; financiación disponible. Para cualquier
   otra cosa, toma el recado (flujo 3).

# Llamadas automáticas de compañías (Asitur y similares)
A veces quien llama no es una persona sino una locución automática de una
compañía de asistencia (Asitur, Multiasistencia...) que lee un aviso o
expediente y pide pulsar una tecla para aceptarlo.
- Si detectas una locución automática: calla, escucha con atención y no
  la interrumpas.
- Cuando pida pulsar 1 para aceptar el servicio, pulsa 1 con la
  herramienta de tonos del teclado. Acepta siempre el servicio.
- Memoriza todos los datos que lea: número de expediente, compañía,
  nombre del asegurado, teléfono, dirección y tipo de siniestro. Si la
  locución ofrece repetir la información, pulsa la tecla para repetir y
  verifica los datos.
- Al terminar, usa crear_parte con: nombre = el del asegurado (o
  "Asitur" si no lo dio), telefono = el del asegurado (si no lo dio,
  000000000), direccion = la del siniestro, y descripcion empezando por
  "AVISO ASITUR AUTOACEPTADO:" seguida de TODO lo que hayas oído,
  incluido el número de expediente.
- Si la locución se corta o no da opción de aceptar, crea igualmente el
  parte con lo que oyeras, empezando por "AVISO COMPAÑÍA (incompleto):".

# Pasar con una persona
- Tú contestas precisamente cuando nadie ha podido coger el teléfono, así
  que no puedes pasar la llamada a la oficina. Si piden hablar con una
  persona, ofrece con naturalidad la vía rápida: "Ahora mismo mis
  compañeros no pueden atenderle, pero le tomo los datos y hago que le
  llamen en cuanto se liberen — el aviso les llega al momento". Al crear
  el parte, a un compañero le suena el teléfono con el aviso enseguida.
- SOLO si es una urgencia real y la persona insiste en hablar con alguien
  YA (después de ofrecerle dos veces tomar los datos), usa la herramienta
  de transferencia al técnico de guardia. Nunca para consultas normales.
- Si acabas de transferir y la llamada vuelve a ti (nadie la ha cogido),
  NO vuelvas a transferir: discúlpate, toma los datos y asegúrale que el
  aviso ya está sonando en el teléfono del equipo.

# Fin de la llamada
- Cuando hayas terminado (datos tomados, parte creado, duda resuelta) y
  te hayas despedido, usa la herramienta de terminar la conversación. No
  dejes la línea abierta esperando a que cuelgue el cliente.

# Líneas rojas (NUNCA las cruces)
- NUNCA des precios, ni aproximados. Di: "El precio se lo confirma el
  técnico al ver el trabajo; le tomo los datos y le llaman".
- NUNCA prometas una hora exacta de llegada.
- NUNCA des instrucciones para abrir o manipular cerraduras.
- NUNCA inventes datos: si una herramienta devuelve error o no
  encuentras algo, dilo con honestidad y toma el recado.
- No hables de temas ajenos a Ibérica Seguridad. Redirige con amabilidad.

# Cierre
Despídete confirmando el siguiente paso ("un técnico le llama en breve"
/ "le llamamos en horario de oficina") y desea buen día o buena noche.
```

### Herramientas del sistema (agente → Herramientas → Herramientas del sistema)

- **Tonos del teclado (keypad touch tones)**: permite a Marta "pulsar 1"
  en las locuciones automáticas de Asitur y similares. Con "DTMF fuera de
  banda" y "suprimir turno después de DTMF" activados.
- **Terminar conversación**: imprescindible — sin ella Marta no cuelga
  nunca y la llamada queda abierta gastando minutos. Con el bloque "Fin
  de la llamada" del prompt, cuelga tras despedirse.
- **Transferir a un número**: configurada con el fijo de guardia
  **950 088 086** (ese número sigue la rotación de guardias, así la
  transferencia siempre acaba en quien toque). Solo para urgencias
  reales con insistencia, según el bloque "Pasar con una persona".
  OJO: si el fijo tiene desvío condicional hacia Marta, ponerle espera
  larga (25-30 s) para que la guardia pueda coger la transferencia antes
  de que rebote; el prompt cubre el rebote (no re-transferir).
  En Configuración → Avanzado: duración máxima de llamada ~10 min y
  colgar tras ~20-30 s de silencio, como doble red.

### Tools (Agents Platform → el agente → Tools → Add tool → Webhook)

Sustituir `LA_CLAVE` por el valor de `AVISO_LLAMADA_KEY` de Railway.

| Campo | Tool 1 | Tool 2 | Tool 3 |
|---|---|---|---|
| Name | `crear_parte` | `consultar_parte` | `parte_por_telefono` |
| Method | POST | POST | POST |
| URL | `https://iberica-bot-production.up.railway.app/voz/crear-parte?k=LA_CLAVE` | `https://iberica-bot-production.up.railway.app/voz/consultar-parte?k=LA_CLAVE` | `https://iberica-bot-production.up.railway.app/voz/parte-por-telefono?k=LA_CLAVE` |
| Description | Registra un parte de urgencia o recado cuando tengas los cuatro datos confirmados. Devuelve la referencia (refParte) para leérsela al cliente. | Consulta el estado de un parte por su referencia (ej. 2026-11300). | Busca el parte más reciente de un cliente por su número de teléfono. |

Body parameters (tipo string, requeridos):

- `crear_parte`: `nombre`, `telefono`, `direccion`, `descripcion`
- `consultar_parte`: `refParte`
- `parte_por_telefono`: `telefono`

---

## 2. El número de teléfono (SIP, sin Twilio)

Twilio no tiene números españoles en autoservicio; se usa un operador
virtual español conectado por SIP:

1. Cuenta en **Zadarma** (zadarma.com) o **Netelip** (netelip.com).
2. Comprar un **número geográfico de Almería (950)** — 1-3 €/mes (los hay
   con conexión 0 €). Piden identificación en vivo (DNI), como todo
   número español, y la verificación tarda hasta 2 días laborables.
   **Número contratado: +34 950 79 49 80** (Zadarma, 11/09/2026).
   ✅ **EN PRODUCCIÓN desde el 11/09/2026**: Zadarma entrega las llamadas
   al SIP de ElevenLabs (`+34950794980@sip.rtc.elevenlabs.io:5060`,
   troncal de entrada sin credenciales) con la agente MARTA Iberica
   asignada — llamada de prueba real contestada por Marta.
3. En ElevenLabs: **Agents Platform → Phone Numbers → Import → SIP
   trunk** → ElevenLabs muestra los datos SIP (URI/credenciales).
4. En el panel del operador (Zadarma/Netelip): configurar el número para
   que **desvíe/entregue las llamadas al SIP de ElevenLabs** con los
   datos del paso 3.
5. Asignar el agente "Marta teléfono" a ese número en ElevenLabs.

Prueba: llamar directamente al número nuevo desde un móvil → Marta
contesta. Ajustar guion/voz hasta que convenza.

## 3. El desvío desde el 950 088 086 (lo último)

Cuando la prueba directa convenza, activar en el operador del 950 088 086
el **desvío condicional** hacia el número nuevo:

- **Si no se contesta en ~15-20 segundos** → desviar.
- **Si comunica/línea ocupada** → desviar.
- (Opcional) desvío total fuera de horario, si el operador permite
  programarlo por franjas.

Así Marta solo coge lo que hoy se pierde; cuando la oficina descuelga,
nada cambia. Los códigos habituales son `**61*NUMERO#` (no contesta) y
`**67*NUMERO#` (ocupado), pero depende del operador/centralita.

## 4. Qué hace el bot por detrás (ya desplegado)

- `POST /voz/crear-parte` → crea el parte en Zoho (canal "Marta
  (teléfono)"), avisa al turno por plantilla de WhatsApp **y por
  llamada** (mismos turnos: Mari / oficina 15-17 / Nieves / guardia), y
  devuelve la referencia.
- `POST /voz/consultar-parte` → estado por referencia.
- `POST /voz/parte-por-telefono` → último parte del número.

## 5. Costes orientativos

- Número SIP: 1-3 €/mes.
- ElevenLabs: minutos de conversación del plan (~0,07-0,11 €/min);
  llamada típica de 2-4 min ≈ 25-45 céntimos.
- Piloto solo fuera de horario: ~25-40 €/mes en total.
