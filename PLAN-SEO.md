# Auditoría y plan SEO — Ibérica Seguridad

**Ibérica Servi & Security S.L.** · Almería · 29 de agosto de 2026

> Versión con formato: https://claude.ai/code/artifact/77ad99d1-1f2f-4242-a880-4213d65c2d6b

## Veredicto (corregido)

**Corrección sobre la primera versión:** la cifra de ~60 reseñas salía de un directorio
externo y estaba desfasada. El volumen real supera al de las fichas que sí aparecen en el
mapa. Eso descarta las reseñas como causa y cambia el diagnóstico de raíz.

Si tenemos más reseñas que cualquiera de los que salen en Maps y aun así no aparecemos,
**no es un problema de posicionamiento**. El posicionamiento es un gradiente: más reseñas
suben puestos, no hacen invisible a nadie. La ausencia total es una señal binaria: Google
no nos está ordenando peor, nos está **dejando fuera de la lista**.

Contexto que explica por qué nos toca: **la cerrajería es el gremio más vigilado de Google
en España**. Tras las denuncias de estafas, Google suspendió la publicidad de cerrajeros en
España y endureció los algoritmos de confianza de todo el sector. Los negocios legítimos
caen en esas redadas con una facilidad que no tiene ningún otro oficio.

Son dos problemas distintos:

- **Problema A — la ficha de Maps está excluida.** Urgente. Se diagnostica en 10 minutos.
- **Problema B — la web.** Explica la ausencia en los resultados azules. Los ocho hallazgos
  de abajo siguen vigentes, pero son el problema lento.

## Problema A: por qué se excluye una ficha

Seis causas producen ausencia total, no mal puesto. Ordenadas por encaje con nuestro caso
(gremio de cerrajería, dos exposiciones, datos descuadrados en directorios):

| # | Causa | Encaje |
|---|---|---|
| A1 | Ficha suspendida o desverificada | Causa más probable |
| A2 | Fichas duplicadas que se anulan entre sí | Encaja con las dos exposiciones |
| A3 | Categoría principal equivocada | Produce ausencia total |
| A4 | Google no puede triangular quiénes somos | Agravante |
| A5 | Competidores con la palabra clave en el nombre | Denunciable |
| A6 | Distancia desde donde busca el cliente | Explicación parcial |

**A1 — Suspensión.** No siempre avisa y muchas veces es «blanda»: la ficha se sigue viendo
desde nuestra cuenta y desde el enlace directo, pero desaparece de las búsquedas. Por eso se
puede llevar meses suspendido sin enterarse. Google barre el gremio por lotes y arrastra a
los legítimos. *Comprobar:* estado en el Perfil de Empresa.

**A2 — Duplicados.** Dos exposiciones (capital y Sector 20). Si se creó una ficha sin
comprobar que ya existía otra, o una verificación se quedó a medias, puede haber dos fichas
del mismo negocio: es infracción directa y el desenlace habitual es que Google *deje de
mostrar las dos*. Variante que encaja aún mejor: las reseñas acumuladas en una ficha
suprimida mientras la viva está casi vacía. *Comprobar:* buscar «Ibérica» en Maps dentro de
Almería, y repetir con cada dirección y con el 950 088 086.

**A3 — Categoría principal.** No es una etiqueta descriptiva: es el interruptor que decide
en qué búsquedas entra la ficha. Si es «Empresa de sistemas de seguridad» o «Tienda de
puertas», no aparecemos en «cerrajero Almería» jamás, con mil reseñas o con ninguna. Encaja:
somos una empresa de seguridad que además hace cerrajería. *Comprobar:* debe poner
**Cerrajero**; el resto, secundarias.

**A4 — Triangulación.** Google contrasta nuestros datos con los de terceros. Las dos
direcciones fundidas en los directorios y los dos dominios vivos diciendo lo mismo restan
justo donde más duele.

**A5 — Nombres con palabra clave.** Explica que nos ganen fichas con menos reseñas.
Llamarse «Cerrajeros Almería 24h» da una ventaja enorme y es infracción de políticas.
Se denuncian con «Sugerir un cambio» y el formulario de reparación de perfiles.

**A6 — Distancia.** Pesa mucho en el mapa: si la dirección verificada es la del Sector 20,
en búsquedas desde el centro salimos lejos. Baja puestos, no borra: explica parte, nunca todo.

### La prueba que lo decide (2 minutos)

Buscar en Google el nombre exacto `Ibérica Servi & Security Almería`, desde el móvil, sin
sesión y en incógnito.

- **No sale ni con el nombre exacto** → suspendida, desverificada o conflicto por duplicado
  (A1/A2). Problema de cuenta, se resuelve con apelación. No es SEO.
- **Sale con el nombre exacto pero nunca con «cerrajero almería»** → ficha viva, problema de
  relevancia: categoría principal (A3) o servicios sin declarar. Se arregla en una tarde.

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

### 6. Reseñas: ya están hechas
Descartado como causa (ver corrección arriba). El volumen supera al de las fichas que sí
aparecen, que es justamente lo que apunta al Problema A.

Detalle a revisar cuando la ficha esté desbloqueada: `index.js:429` usa un `RESENA_URL` único
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

### Semana 1 — desbloquear la ficha y arreglos de coste cero
1. **Hacer la prueba del nombre exacto** y abrir el Perfil de Empresa para ver el estado.
   Todo lo demás va detrás: con la ficha excluida, el trabajo sobre la web tarda meses en
   notarse y el mapa sigue en cero. Si está suspendida, apelar el mismo día con CIF, fotos
   del local con rótulo y factura reciente a nombre de la sociedad.
2. **Comprobar duplicados** en Maps por las dos direcciones y por el teléfono. Si hay dos,
   reclamar la fusión: nunca borrar la que tiene las reseñas.
3. **Categoría principal «Cerrajero»**, el resto secundarias. Treinta segundos que pueden
   valer más que todo lo demás junto.
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

Tampoco puedo ver la ficha de Google ni el panel del Perfil de Empresa: el Problema A son
las seis causas conocidas de exclusión ordenadas por encaje con nuestro perfil, no una
lectura de la ficha. Las dos comprobaciones del recuadro lo cierran en diez minutos.

Pendiente de revisar, no visible desde aquí: velocidad y experiencia móvil, `robots.txt` y
sitemap, enlazado interno, contenido duplicado dentro del dominio, y datos de Search Console.
Con acceso de lectura a Search Console y al WordPress se cierra esa parte.
