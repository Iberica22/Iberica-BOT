# Auditoría y plan SEO — Ibérica Seguridad

**Ibérica Servi & Security S.L.** · Almería · 29 de agosto de 2026

> Versión con formato: https://claude.ai/code/artifact/77ad99d1-1f2f-4242-a880-4213d65c2d6b

## Veredicto

**Dos correcciones sobre la primera versión.** La cifra de ~60 reseñas salía de un directorio
externo y estaba desfasada: el volumen real supera al de las fichas que sí aparecen en el mapa.
Y con los dos datos aportados —la ficha sale entera al buscar el nombre exacto, y hay dos fichas,
una por exposición— el diagnóstico queda cerrado.

Si tenemos más reseñas que cualquiera de los que salen y aun así no aparecemos, no es
posicionamiento: el posicionamiento es un gradiente, más reseñas suben puestos, no hacen
invisible a nadie. Y no es suspensión, porque la ficha aparece con el nombre exacto.

**Lo que pasa: las reseñas están acumuladas en una sola de las dos fichas, y no es la que
Google enseña donde buscan los clientes.**

La causa está en el código: `index.js:429` fija un `RESENA_URL` único
(`https://g.page/r/CXgW_wAoTj0cEAE/review`) que el bot manda en todos los partes, venga de la
exposición que venga. El 100 % de las reseñas que genera Marta caen en esa ficha; la otra lleva
desde siempre casi a cero.

Y ahí encaja todo: ante dos fichas del mismo negocio Google **muestra solo una por búsqueda**,
elegida por cercanía a quien busca. Si la ficha con las reseñas es la del Sector 20 y la vacía
la del centro, en las búsquedas desde la ciudad Google escoge la del centro —sin reseñas, no
compite— y descarta la del polígono por lejana.

## Problema A: las fichas

| # | Punto | Estado |
|---|---|---|
| A1 | Suspensión o desverificación | **Descartado** — la ficha sale con el nombre exacto |
| A2 | Las dos fichas se estorban entre ellas | **Causa principal** |
| A3 | Categoría principal de cada ficha | Por comprobar en las dos |
| A4 | Competidores con la palabra clave en el nombre | Denunciable |

**A1 — Descartado.** La ficha está viva, verificada y sin sanción. Buena noticia: la suspensión
en cerrajería es larga de revertir y no nos afecta. El problema es de configuración.

**A2 — Causa principal.** Dos fichas para dos locales reales es legítimo. Lo que ocurre es que
Google nunca enseña las dos en la misma búsqueda: elige una, casi siempre la más cercana. Con el
reparto de reseñas desequilibrado, sale la débil y la fuerte se queda en el banquillo.
*Primer paso (1 min):* abrir `https://g.page/r/CXgW_wAoTj0cEAE/review` y ver qué dirección
muestra. Esa es la ficha que se ha quedado con todas las reseñas.

**A3 — Categoría.** No describe: decide en qué búsquedas entra cada ficha a competir. Si alguna
tiene «Empresa de sistemas de seguridad» o «Tienda de puertas» como principal, esa ficha no
aparece en «cerrajero Almería» ni con mil reseñas. Comprobar en **las dos**. Debe poner
**Cerrajero**; el resto, secundarias.

**A4 — Nombres con palabra clave.** Explica el resto de la diferencia. «Cerrajeros Almería 24h»
da una ventaja enorme y es infracción de políticas: el nombre debe ser el real. Se denuncian con
«Sugerir un cambio» y el formulario de reparación de perfiles.

### Qué hacer, por orden

1. Abrir el enlace de reseña y ver qué ficha se ha llevado todas.
2. Comprobar la categoría principal de **las dos** fichas.
3. Decidir la ficha principal para Almería capital —lo lógico es San Leonardo 34, donde buscan
   los clientes— y dejar la del Sector 20 como exposición, con categoría propia para que no
   compitan entre ellas.
4. Cambiar el bot para que cada parte mande el enlace de la ficha que hizo el trabajo.

**Importante:** las reseñas no se pueden mover entre fichas. Google solo las fusiona al unir
duplicados, y estas no son duplicados sino dos locales reales. Las que ya están se quedan donde
están; lo que se corrige es el caudal de aquí en adelante. Por eso el punto 4 corre prisa.

## Problema B: la web

| # | Hallazgo | Impacto | Esfuerzo |
|---|---|---|---|
| 1 | La portada compite por la palabra «Inicio» | Alto | 15 min |
| 2 | Decimos «cerrajería»; la gente escribe «cerrajero» | Alto | 1 tarde |
| 3 | El hueco de «puertas acorazadas Almería» está vacío | Mayor oportunidad | 2 semanas |
| 4 | Dos dominios compitiendo entre ellos (.com y .online) | Alto | 1 hora |
| 5 | La dirección está mal/mezclada en los directorios | Alto | 2 horas |
| 6 | 60 reseñas es poco para el mapa de Almería | Medio | Ya casi hecho |
| 7 | Ausentes de los directorios que sí rankean | Medio | 3 horas |
| 8 | Ninguna señal de precio; la competencia sí la da | Medio | A decidir |

### 1. La portada compite por la palabra «Inicio»
Google muestra la página principal titulada «Inicio - Ibericaseguridad». El título es
la señal más fuerte de una página y la portada es la de más fuerza del dominio; hoy
apunta a una palabra que nadie busca.

- Ahora: `Inicio - Ibericaseguridad`
- Debería ser: `Cerrajeros en Almería 24 h · Puertas acorazadas y cerraduras de seguridad | Ibérica Seguridad`

### 2. «Cerrajería» vs «cerrajero»
La página de urgencias se titula «Cerrajería 24 Horas en Almería». La búsqueda real es
`cerrajeros almería` y `cerrajero almería 24 horas`. Con diez competidores que sí llevan
la palabra exacta en el título, esa diferencia decide.

**Prueba:** en «cerrajero Almería 24 horas urgente» no aparecemos. Los 8 primeros son
cerralmeria.es, cerrajeroenalmeria.com, cerrajerialmeria.com, cerrajerosenalmeria.net,
misterkey24h.com — todos con la palabra exacta en dominio y título.

### 3. Puertas acorazadas: el hueco vacío
Somos instaladores oficiales FICHET y KIUSO, con 20 años, fabricación propia, retirada de
la puerta antigua, 3 años de garantía por escrito y financiación a 12 meses sin intereses.
En Almería no hay ningún resultado local fuerte para esa búsqueda: los primeros puestos son
Leroy Merlin y webs de Alicante, Valencia o Extremadura. Es el término más rentable y menos
disputado que tenemos.

**Prueba:** «puertas acorazadas Almería instalador oficial Fichet precio» — cero empresas
almerienses en la primera página.

### 4. Dos dominios
`ibericaseguridad.com` e `ibericaseguridad.online` están los dos vivos con contenido parecido.
Para Google son dos sitios distintos diciendo lo mismo: reparte la confianza y a menudo no
muestra ninguno. Hay que quedarse con el `.com` y redirigir el otro con 301, página por página.

### 5. NAP inconsistente
En los directorios aparecemos con las dos direcciones fundidas: «Calle Estaño, 101 C. San
Leonardo, 34, 04004, 04009 Almería». Tener dos exposiciones (capital y polígono Sector 20)
está bien, pero la ficha de cada una debe ser idéntica —mismo nombre, dirección, teléfono y
grafía— en Google, Bing, Páginas Amarillas y cada directorio.

### 6. Reseñas: ya están hechas, pero mal repartidas
Descartado como causa de ranking. El volumen supera al de las fichas que sí aparecen — y eso es
justamente lo que destapó el Problema A. Ver arriba: `index.js:429` usa un `RESENA_URL` único
(`https://g.page/r/CXgW_wAoTj0cEAE/review`) para todos los partes. Si cada exposición tiene
ficha propia, el enlace debería ser el de la que atendió el trabajo.

### 7. Directorios
En «mejores cerrajeros en Almería» Google no enseña empresas: enseña listas (Habitissimo,
Portal Cerrajeros, Seprelo, Taskia, Multiguía, cerrajero.io). Estamos en dos directorios
menores (comga.es, henartel.es) y en ninguno de los que ocupan la primera página.

### 8. Señales de precio
Los que nos ganan llevan el precio en el título («Urgentes desde 20 €»). No hace falta cerrar
precio en la web: basta una horquilla honesta («apertura de puerta desde 60 €, presupuesto
cerrado antes de empezar y sin compromiso»). Es además el mejor argumento contra quien
anuncia 20 € y factura 150.

## Búsquedas objetivo

Una página por búsqueda; nunca dos páginas peleando por el mismo término.

| Búsqueda | Página | Situación |
|---|---|---|
| puertas acorazadas almería | Nueva `/puertas-acorazadas-almeria/` | Hueco libre. Prioridad máxima. |
| cerrajeros almería | Portada | Título sin usar. Arreglo inmediato. |
| cerrajero almería 24 horas | `/cerrajeria-horas/` | Existe; reescribir título y H1. |
| puertas blindadas almería | `/puertas-de-vivienda/` | Falta «blindada» y la ciudad. |
| cambiar cerradura almería | Nueva | Mucho volumen, compra directa. |
| bombín de seguridad almería | Nueva | Tesa, Ezcurra, Abus: sección por marca. |
| cerrajero comunidades almería | `/trabajo-para-comunidades/` | Existe. Cliente recurrente. |
| automatismos puerta garaje almería | Nueva | Servicio que damos y no está en la web. |
| cerrajero forense almería | `/cerrajeros-forenses/` | Nicho propio (APFC). Ya posiciona. |

## Plan

### Semana 1 — enderezar las fichas y arreglos de coste cero
1. **Abrir el enlace de reseña del bot** y anotar a qué exposición pertenece esa ficha.
2. **Revisar la categoría principal de las dos fichas.** «Cerrajero» en la que deba competir en
   la ciudad. Treinta segundos que pueden valer más que todo lo demás junto.
3. **Cambiar el bot** para que cada parte mande el enlace de su ficha.
4. Reescribir título y meta descripción de cada página. Fórmula `Servicio + en Almería + marca`, máx. 60 caracteres. Empezar por la portada.
5. Elegir dominio y redirigir el otro con 301 hacia la página equivalente (no apagarlo sin más).
6. Unificar NAP: escribir nombre, dirección y teléfono de cada exposición en un documento y copiarlos literalmente en Google, Bing Places, Apple Maps y todos los directorios.
7. Revisar el resto de categorías y servicios: principal «Cerrajero»; secundarias «Tienda de puertas», «Servicio de instalación de puertas», «Empresa de sistemas de seguridad».
8. Dar de alta Google Search Console y enviar el sitemap.

### Mes 1 — contenido y presencia
1. Página de puertas acorazadas: fotos de instalaciones propias (no de catálogo), sellos FICHET y KIUSO, garantía de 3 años, retirada de la puerta antigua, financiación Cetelem, horquilla de precios por gama.
2. Alta en Habitissimo, Portal Cerrajeros, Seprelo, Taskia, Multiguía y cerrajero.io con el NAP unificado.
3. Datos estructurados `LocalBusiness`/`Locksmith` en todas las páginas: dirección, teléfono, horario y zona de servicio.
4. Subir el caudal de reseñas: de 60 a 150 en seis meses, con entrada constante (Google valora el goteo estable sobre el pico).
5. Una página por zona real: El Ejido, Roquetas de Mar, Vícar, Níjar, Huércal — con contenido propio de cada una, no plantilla con el nombre cambiado.

### Trimestre — autoridad
- Enlaces locales: Cámara de Comercio de Almería, asociaciones de vecinos y administradores de fincas con los que ya trabajamos, APFC, prensa local a cuenta de los 30 años en 2026.
- Contenido que resuelve las dudas que ya contestamos por WhatsApp: blindada vs acorazada, llave rota dentro, cuánto tarda un cambio de bombín, cerradura para comunidad.
- Fotos y vídeos propios en la ficha de Google con regularidad.
- Responder todas las reseñas, también las malas y las viejas: Google mide la tasa de respuesta.

## Alcance de esta auditoría

El entorno de trabajo tiene bloqueado el acceso directo a `ibericaseguridad.com`, así que
no se ha podido rastrear la web por dentro. Lo afirmado sobre títulos, páginas y contenido
sale de lo que Google muestra públicamente en sus resultados —que es lo que ve el cliente—
más los datos de empresa del propio bot (`index.js:1289`). Los hallazgos 1, 2, 3, 4, 5 y 7
son verificables repitiendo las búsquedas indicadas.

Tampoco puedo ver las fichas de Google ni el panel del Perfil de Empresa. El Problema A se
apoya en dos datos aportados —la ficha sale con el nombre exacto, y hay dos fichas— más una
certeza del código: el enlace de reseña es único y está fijo en `index.js:429`. Queda por
confirmar a cuál de las dos apunta y qué categoría principal tiene cada una.

Pendiente de revisar, no visible desde aquí: velocidad y experiencia móvil, `robots.txt` y
sitemap, enlazado interno, contenido duplicado dentro del dominio, y datos de Search Console.
Con acceso de lectura a Search Console y al WordPress se cierra esa parte.
