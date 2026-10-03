# Estrategia: plan de 90 días para entrar en 2027 con mejores márgenes

Basada en el reel de @kimfermisson (Kimbe, centro de estética, 2 min 57 s),
transcrito completo. Aquí está adaptado a una empresa de cerrajería y
seguridad.

## 0. Lo que dice el vídeo, en 8 ideas

1. **En 2027 los costes van a subir**: nóminas, y en unos 3 meses llegan las
   tarifas nuevas de los proveedores. *"Si sigo cobrando lo mismo, ofreciendo
   y trabajando exactamente igual, lo único que va a bajar es mi beneficio."*
2. **Los próximos 90 días (octubre–diciembre) son el trimestre más
   importante del año.** No por Halloween, Black Friday o Navidad, sino por lo
   que hay que hacer dentro del negocio.
3. **"Destripar" el año** con el programa de gestión (para Ibérica, FACTUSOL),
   usando las dos listas de los comentarios fijados.
4. **Tomar 4 decisiones sobre cada servicio:** cuáles **desaparecen**, cuáles
   **suben de precio**, cuáles **se transforman** y cuáles dejan de ser un
   servicio suelto para **convertirse en programa**.
5. **No siempre hacen falta más clientes.** El cliente que hoy paga una sesión
   de 70 € puede comprar un programa de 350 € que le resuelva el problema de
   verdad.
6. **No hacen falta más horas: cada hora tiene que producir más** (margen
   por hora de técnico).
7. **Las campañas de Halloween, Black Friday y Navidad no deben ser "tres
   promociones desesperadas para llenar la agenda".** Tienen que servir
   para **captar** clientes nuevos, **reactivar** antiguos, **vender
   programas**, **generar recurrencia** y empezar ya a construir la
   facturación de 2027.
8. **Subir precios lo mismo que suben los costes (5, 8, 10 %) solo es
   sobrevivir.** El objetivo es entrar en enero con una **lista de precios
   nueva**, **programas nuevos**, **márgenes nuevos**, una **estrategia de
   venta**, el **equipo preparado** y un **cliente que entienda** todo lo que
   podemos hacer por él. *"No está decorando el negocio, está rediseñando su
   rentabilidad."*

### Traducción a Ibérica

| Kimbe (estética) | Ibérica Seguridad |
|---|---|
| Sesión de 70 € | Apertura o cambio de bombín suelto |
| Programa de 350 € | Pack que resuelve la seguridad de la puerta, o mantenimiento anual |
| Ritual / experiencia | Instalación "llave en mano", con revisión incluida |
| Recepción | Oficina, teléfono y Marta (WhatsApp/voz) |
| Cabina | La visita del técnico en casa del cliente |
| La clienta antes de salir por la puerta | **Antes de que el técnico se vaya** |

## 1. Las dos listas del reel, traducidas a Ibérica

| Estética (reel) | Ibérica Seguridad |
|---|---|
| Tratamiento | Servicio: apertura, cambio de bombín, instalación de cerradura, puerta acorazada, automatismo… |
| Producto que se vende | Material: bombines, escudos, cerraduras, motores, mandos… |
| Recepción | Oficina, teléfono y Marta (WhatsApp/voz): lo que se ofrece y presupuesta |
| Cabina | La visita: lo que el técnico recomienda en casa del cliente |
| "Antes de que la clienta salga por la puerta" | **Antes de que el técnico se vaya** de la vivienda o del local |
| Ritual / programa | Pack: el servicio completo que resuelve el problema, no solo la urgencia |

### Lista A — qué hacen nuestros servicios
1. ¿Qué servicios hemos vendido más?
2. ¿Cuáles casi nadie ha comprado?
3. ¿Cuáles facturan mucho pero dejan poco beneficio?
4. ¿Cuáles ocupan demasiado tiempo de agenda?
5. ¿Cuáles tienen potencial para convertirse en algo mucho más grande?

### Lista B — qué hace nuestro cliente
1. Cuánto compra cada cliente.
2. Cada cuánto vuelve.
3. Qué servicios combina.
4. Cuánto material vendemos.
5. Qué ofrecemos desde la oficina.
6. Qué recomienda el técnico en la visita.
7. Qué podría venderse antes de que el técnico se vaya.

---

## 2. El informe automático (FACTUSOL)

El Worker de FACTUSOL (`factusol-worker/worker.js`) tiene ahora una ruta que
responde a las dos listas con los datos reales de facturación:

```
https://factusol-iberica.<tu-subdominio>.workers.dev/analisis?k=TU_DIAG_KEY
```

| Parámetro | Para qué |
|---|---|
| `ejercicios=2025,2026` | Analiza varios años. Recomendado para medir cada cuánto vuelve el cliente. |
| `coste_hora=25` | Coste real por hora de técnico. Sin él, la mano de obra sale con un 100 % de margen y la pregunta 3 queda incompleta. También vale la variable `COSTE_HORA_TECNICO` del Worker. |
| `subida_costes=8` | Simula cuánto margen se pierde si los costes suben ese % y los precios no cambian. Por defecto, 8. |
| `formato=json` | Datos en bruto, por ejemplo para pasárselos a Claude. |

Usa la misma clave que `/diag` (`DIAG_KEY`). Sin ella, la ruta devuelve 403.
Para activarlo, vuelve a pegar `worker.js` en Cloudflare (Paso 2 de
`factusol-worker/GUIA-INSTALACION.md`).

**Qué responde cada bloque**

| Pregunta | Cómo se calcula |
|---|---|
| Más vendidos | Nº de facturas en las que aparece cada artículo o servicio, con facturación, margen y con qué suele ir |
| Casi nadie compra | Artículos con 1–2 facturas en el periodo, más el nº de artículos del catálogo sin ninguna venta |
| Mucha facturación, poco beneficio | Entre el 30 % que más factura, los que tienen margen bajo (precio de coste `PCOART` del artículo) |
| Ocupan agenda | Horas de "mano de obra" de las facturas donde aparece, y margen por hora de técnico |
| Potencial de programa | Se venden a menudo, tienen buen margen y casi siempre van acompañados: es el **pack natural** que el cliente ya está comprando por piezas |
| Cuánto compra / cada cuánto vuelve | Total y ticket medio por cliente, días medios entre facturas, % de clientes que solo vinieron una vez |
| Qué combina | Familias que aparecen juntas en la misma factura |
| Cuánto material | % de la facturación que es material y % de facturas sin ningún material |
| Qué ofrece la oficina | Presupuestos por serie (5 Carpintería, 7 Particular) y su estado |
| Si los costes suben… | Margen bruto actual, margen con los costes nuevos, beneficio perdido y subida media de precios necesaria solo para quedarse igual |
| Decisión por servicio | Para los 30 que más facturan, una propuesta: **eliminar**, **subir precio**, **transformar**, **convertir en programa** o **mantener**, con el motivo. Es una propuesta: la decisión es vuestra |
| A quién reactivar | Clientes que llevan más de 6 meses sin volver, con su teléfono, ordenados por lo que han facturado. Es la base de las campañas |
| Antes de que el técnico se vaya | En cada servicio frecuente, el producto que mejor encaja, cuántas veces el cliente se quedó sin él y cuánto supondría que lo aceptara 1 de cada 5 |

**Límites que conviene conocer**
- Una línea cuenta como servicio o como material según su descripción: *mano de
  obra, apertura, instalación, desplazamiento, urgencia…* es servicio. Si una
  línea de servicio no lleva esas palabras, saldrá como material.
- Las horas solo se detectan si se facturan como "mano de obra" u "hora". Si las
  aperturas se cobran a precio cerrado, apunta la duración real en el parte de
  Zoho para poder medir la agenda.
- Si las compañías de seguros facturan muchos partes, aparecerán como "grandes
  clientes". Lee la lista de clientes pensando en el particular.
- **Lo que el técnico recomienda en la visita no queda en FACTUSOL.** Ver el
  punto 4.

---

## 3. De servicio a programa: packs para validar con el informe

Estas son propuestas de partida. **Confírmalas con el bloque "Potencial de
programa"** del informe antes de lanzarlas. Lo ideal es que el pack sea lo que
el cliente ya compra junto, ofrecido de golpe y con nombre propio.

| Servicio de entrada | Pack / programa | Por qué encaja |
|---|---|---|
| Apertura de puerta (urgencia) | **"Vuelve a estar seguro"**: apertura + bombín antibumping + juego de llaves + revisión de la puerta | Tras una apertura (y más si fue un robo o se perdieron las llaves), el cliente tiene la necesidad en ese momento. Es la mayor fuga de "antes de que se vaya" |
| Cambio de bombín | **"Puerta protegida"**: bombín de seguridad + escudo protector + ajuste de la puerta | Un bombín sin escudo protege a medias. Es la combinación más lógica |
| Puerta acorazada (FICHET/KIUSO) | **"Puerta llave en mano"**: puerta + retirada de la antigua + cerradura de seguridad + revisión gratis al año + financiación Cetelem | Ya se ofrecen 3 años de garantía y la retirada. Vendido como programa sube el valor percibido y da una visita futura |
| Automatismo de portón/garaje | **"Mantenimiento anual"**: revisión, engrase y ajuste de finales de carrera, con prioridad ante averías | Convierte una venta única en ingreso recurrente. Es la respuesta a "cada cuánto vuelve" |
| Comunidades y empresas | **"Plan comunidad"**: revisión periódica de portales, cierrapuertas, cerraduras y amaestramiento, con un precio por visita acordado | Cliente de varios servicios al año. Hoy probablemente llama solo cuando algo se rompe |
| Domótica / control de accesos | **"Casa conectada"**: cerradura inteligente + configuración + formación al cliente | Es un servicio sin cuotas: el programa es la puesta en marcha completa, no solo el aparato |

Reglas de marca que se mantienen: Marta **no da precios** por WhatsApp ni por
teléfono. Los packs se ofrecen como *"tenemos una solución completa para esto,
te la preparamos en el presupuesto"*, y los importes los pone la oficina en
FACTUSOL. Mientras los packs no estén cerrados, no se añaden a la base de
conocimiento de Marta.

---

## 4. "Antes de que salga por la puerta": protocolo del técnico

Lo que se recomienda en la visita (la "cabina") es justo lo que no queda
registrado. Propuesta mínima:

**Checklist de 1 minuto al terminar cualquier trabajo**
1. ¿El bombín es antibumping o antiganzúa? Si no lo es, se recomienda.
2. ¿Tiene escudo protector? Si no lo tiene, se recomienda.
3. ¿La puerta cierra bien (bisagras, ajuste, burlete)?
4. ¿Tiene copias de llave suficientes? ¿Necesita llave de seguridad con tarjeta?
5. ¿Tiene garaje, portón o comunidad con automatismo? Se menciona el mantenimiento.

**Frase tipo** (sin presionar, en tono de asesor): *"Ya está abierta. Te
comento una cosa: este bombín se abre en un minuto con la técnica del bumping.
Si quieres, te dejo puesto ahora uno de seguridad y así no tengo que volver."*

**Que quede registrado:** el técnico anota en el parte de Zoho qué recomendó y si
el cliente lo aceptó, lo dejó para más adelante o no lo quiso. Lo que "deja para
más adelante" entra en el seguimiento de presupuestos que ya hace Marta
(`GUIA-SEGUIMIENTO-PRESUPUESTOS.md`).

**Oficina / Marta ("recepción"):** cuando el cliente pide presupuesto de un
servicio suelto que forma parte de un pack, la oficina presupuesta las dos
opciones: el servicio suelto y el pack completo.

---

## 5. Calendario de 90 días (octubre–diciembre 2026)

| Semanas | Qué hacer | Con qué |
|---|---|---|
| **Oct, sem. 1–2: destripar 2026** | Sacar el informe con `ejercicios=2025,2026`, `coste_hora` real y `subida_costes` según lo que anuncien los proveedores. Pedir ya a los proveedores principales (FICHET, KIUSO, Tesa, Ezcurra…) sus tarifas de 2027 | `/analisis` |
| **Oct, sem. 3–4: decidir** | Repasar la tabla "Decisión por servicio" y cerrar, uno a uno, qué se elimina, qué sube, qué se transforma y qué se convierte en programa. Elegir **2 o 3 packs** del punto 3 | Reunión de oficina y técnicos |
| **Halloween (31 oct)** | Campaña de **reactivación**: WhatsApp a los clientes de "A quién reactivar", ofreciendo una revisión de seguridad de la puerta antes del invierno (días más cortos). Captar, no regalar | Lista de reactivar y Marta |
| **Nov, sem. 1–3: preparar** | Montar en FACTUSOL los presupuestos tipo de cada pack. Formar a los técnicos en el protocolo del punto 4. Preparar la explicación para el cliente: por qué un pack y no una pieza suelta | FACTUSOL y técnicos |
| **Black Friday (27 nov)** | **Vender programas**, no descontar servicios sueltos: por ejemplo, el pack "Puerta protegida" o la puerta acorazada con financiación Cetelem, con un extra incluido (escudo, revisión) en vez de rebajar el precio | Packs del punto 3 |
| **Navidad (dic)** | **Recurrencia y 2027**: mantenimientos anuales de automatismos y planes para comunidades y administradores de fincas, firmados en diciembre y con arranque en enero. También tarjetas regalo o "regala seguridad" | Plan comunidad y mantenimiento |
| **Dic, última semana** | Lista de precios 2027 cerrada y cargada en FACTUSOL y en la web de tarifas. Equipo informado | `docs/tarifas.html` y FACTUSOL |
| **1 de enero** | Entrar con precios, packs, márgenes y estrategia de venta nuevos. **No empezar a construirlo ese día** | — |

**Regla del vídeo:** no basta con subir un 8 % si los costes suben un 8 %. Hay
que comparar en el informe el **margen bruto** y el **margen por hora** de enero
con los de octubre.
