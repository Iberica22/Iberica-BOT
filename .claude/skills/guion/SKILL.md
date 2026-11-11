---
name: guion
description: Escribe el guion de un reel hablado a cámara sobre una base de seis partes (gancho, dolor, autoridad, rehook, cuerpo y cierre con CTA), con una variante para noticias de IA. Da tres ganchos sacados de un banco de formas que ya funcionaron, cada uno con su frase 2 para grabarlos los tres; un segundo cuerpo que dice lo mismo de otra forma; las cifras comprobadas y un comprobador que avisa de lo que falla. Úsala con «hazme el guion de X», «escríbeme el reel de X», «qué digo en el vídeo de X», «dame ganchos para X». No edita ni sube el vídeo.
---

# Guion: lo que dices y cómo lo cuentas

Lo que hace que un reel funcione no es la edición: es de qué hablas y cómo lo cuentas. Esta skill escribe lo que
se dice, siempre sobre la misma base, y lo deja listo para grabar.

En esta carpeta:
- `estructura.md`: la base de seis partes, la variante de noticias, las tres formas del cuerpo y las reglas de
  dentro de cada guion. **Léelo antes de escribir.**
- `ganchos.md`: el banco de ganchos (cada forma con su plantilla y su prueba real), cómo se rellenan y los cuatro
  fallos. **Léelo antes de escribir los ganchos.**
- `guion.py`: el comprobador. Avisa de lo que falla y deja una página para leerlo al grabar.
- `ejemplo/`: tres guiones completos: `lista.json` (con cuerpo 2), `pasos.json` y `noticia.json`.

Escribe en español, de tú, y lee antes «Tu voz», al final de este fichero. Sin raya larga ni raya media (los
trazos más largos que el guion «-») en nada de lo que escribas: delatan que lo ha escrito una IA.

## Lo que necesitas saber antes

1. **El tema**: una herramienta, una noticia o algo que ha hecho.
2. **Si lo ha probado y qué puede enseñar en pantalla.** Los reels que funcionan enseñan la cosa funcionando.
3. **Qué manda a quien comente**, si manda algo. Si no lo tiene pensado, propónselo.

Si falta algo de esto, una sola pregunta. Nada en primera persona («yo le dije», «a mí me tardó») sin saber si lo
ha probado: sin prueba, el ejemplo va como «Por ejemplo, dile…».

## Antes del guion: ¿puede funcionar el tema?

Un guion perfecto sobre un tema flojo no despega. Cinco preguntas; con dos «no», dile en una línea cómo darle la
vuelta antes de escribir:

| | Sí | No |
|---|---|---|
| ¿Tiene nombre? | Una herramienta, un modelo, una marca | Un consejo o una opinión genérica |
| ¿Lo que ganas cabe en la primera frase? | Dinero, clientes, tiempo o no parecer amateur | «Mejores resultados» |
| ¿Es nuevo o gratis? | Recién salido, de código abierto, lo regalan | Lo que ya ha visto todo el mundo |
| ¿Se ve funcionando? | La pantalla, el prompt y lo que devuelve | Alguien hablando 50 s sin enseñar nada |
| ¿Hay algo que mandar que ahorra trabajo? | «Un solo mensaje para pegar que lo instala todo» | «Más información» |

Poner «comenta X» por sí solo no mueve nada: lo que funciona es lo que se manda.

## La base

Todo guion va en este orden (`estructura.md`, con ejemplos). La única variante es `noticia`, solo para noticias
de IA de los últimos días. Elige tú el molde, sin preguntar, y dilo en una línea al dar el guion.

| s | Parte | Qué hace |
|---|---|---|
| 0 a 3 | Gancho | La cosa y una razón para pararse, de una forma de `ganchos.md` |
| 3 a 6 | Dolor | El problema de quien mira, el que abre el gancho (en una noticia, por qué le toca) |
| 6 a 9 | Autoridad | Una frase con una cifra que prueba que funciona (en una noticia, el dato) |
| 9 a 11 | Rehook | Una línea corta que reengancha y promete el cuerpo |
| 11 a 50 | Cuerpo | El valor, una toma por idea: pasos, lista o historia |
| últimos 8 | Cierre | La idea que se lleva, lo que mandas y «comenta X» (o «sígueme») |

- **El cuerpo empieza antes del segundo 12**, con cualquiera de los tres ganchos.
- **Todo vídeo cierra la idea.** La toma `conclusion` es una frase que se lleva quien mira: lo que tiene que hacer
  o la idea en limpio. Contesta al gancho con palabras parecidas, y nada va detrás del «comenta X».

## Los tres ganchos

Los tres salen de `ganchos.md`: **tres formas distintas, cada una con un `para` distinto**, y cada gancho dice de
cuál sale (`forma`). El `para` es por qué alguien se pararía a mirar:

| `para` | Por qué te paras |
|---|---|
| `imposible` | Algo que no sabías que ya se puede, o que inquieta |
| `dinero` | Dinero ganado, ahorrado o quemado, con su cifra |
| `gratis` | Regalan algo que cuesta |
| `identidad` | Una frase sobre quien habla que no te esperas |
| `perdida` | Te estás quedando atrás o lo haces mal |
| `drama` | Una pelea o un giro entre grandes |
| `secreto` | Algo que casi nadie cuenta |

- **La prueba: ¿se pararía alguien que no sabe nada del tema?** Un gancho no resume el reel ni cuenta la noticia:
  da una razón para quedarse.
- **Rotundo**: «nunca abro el chat», no «casi nunca»; «lo estás usando mal», no «te estás perdiendo cosas». Lo
  suyo (sus horas, sus costumbres, lo que piensa) se dice a lo grande. Lo que quien mira va a probar (qué hace la
  herramienta, un «gratis», un precio, dinero ganado) se comprueba.
- **Nunca es gancho**: un dato técnico (lo que cuesta, los tokens, «la versión nueva»), un deber («tienes que
  probar», «deberías») ni el resumen de lo que viene («te cuento qué es»). Eso va dentro, cuando ya se han quedado.
- **Cada gancho trae su frase 2** (`dolor`): sale de lo que dice ese gancho, no vale una para los tres. No da la
  respuesta: la guarda para el cuerpo.
- **Si te da su ángulo o su opinión**, los tres ganchos son tres formas de decir lo suyo, no tres ideas tuyas, y el
  guion sigue su orden. Una opinión va en primera persona y con lo que la respalda, no como eslogan.
- **Pásale a cada uno los cuatro fallos** de `ganchos.md` antes de darlo.

## Se graban los tres ganchos y un segundo cuerpo

De una sola grabación salen hasta seis vídeos distintos (3 ganchos × 2 cuerpos): el gancho 1 con el cuerpo 1 es el
reel, y los otros sirven para probar qué gancho funciona (por ejemplo, con los «reels de prueba» de Instagram, que
solo ve quien no te sigue). Por eso ninguno es de relleno.

- **Los tres ganchos se graban**, cada uno seguido de su frase 2.
- **El cuerpo 2 (`cuerpo2`)** cuenta lo mismo que el 1, **con otras palabras y en otro orden**. Lleva las mismas
  partes (`autoridad`, `rehook`, `cuerpo`), ninguna frase igual y dura parecido (±25 %). No lleva cierre: el
  cierre es uno para los dos y se graba una vez, así que tiene que contestar a los tres ganchos.
- **Los dos cuerpos se sostienen solos detrás de cualquiera de los tres ganchos**: empiezan por algo que no dice
  ningún gancho ni ninguna frase 2. Léelos detrás de cada gancho antes de darlos.
- Si el tema no da para dos formas (algo de 20 s, una historia que solo se cuenta en su orden), sin `cuerpo2`. Di
  por qué.
- **Cómo se graba, en tres clips**: los tres ganchos seguidos, cada uno con su frase 2; el cuerpo 1 con el cierre;
  el cuerpo 2. Una pausa entre pieza y pieza.

## Los pasos

1. **Los datos, primero**: de 5 a 10 sobre el tema, el más sorprendente arriba. La estructura sigue al mejor.
2. **El molde, la forma del cuerpo y los tres ganchos**, sin preguntar. Al dar el guion, una línea con lo elegido:
   «Base, cuerpo en lista; ganchos `lo-usas-mal`, `opinion` y `sabias-que`».
3. **Comprueba cada dato antes de escribirlo.** Cada cifra, cada «gratis», cada «es de Google» y cada precio, en
   su fuente ese mismo día, apuntado en `fuentes`. Lo que no se puede comprobar, fuera. Un prompt que se dice en el
   vídeo se ha probado antes. Nunca una cifra de dinero que no ha ganado.
4. **Escribe `hablado.json`** en `guiones/<AAAA-MM-DD-tema>/` del proyecto en el que estás (el formato, abajo).
5. **Léelo entero como alguien que no sabe nada del tema.** Cada frase sale de la anterior. Cada palabra técnica,
   con lo que es en una frase normal, para qué sirve y cómo se hace («Pídeselo tal cual: …»). Si algo es abstracto,
   una comparación del día a día. Si dos pasos se parecen, una frase dice en qué se diferencian.
6. **Pasa el comprobador**, que está en esta carpeta, y arregla todo lo que diga:
   ```bash
   python3 <carpeta de esta skill>/guion.py guiones/<carpeta>/hablado.json
   ```
   Si dejas un aviso a propósito, di cuál y por qué.
7. **Dáselo para grabar**, en el chat: los tres ganchos, cada uno con su frase 2 y el recomendado marcado; luego las
   tomas numeradas, y «Cuerpo 2» al final. Con la ruta de `hablado.html`: ahí elige gancho, cambia cuerpo, retoca
   frases y «Copiar» se lo copia. Que lo grabe con sus palabras: el guion es una guía, no un texto para leer.
8. **Cuando lo haya grabado**, si te pasa lo que dijo, crúzalo con el guion. Si no dijo la conclusión, díselo con
   la frase para grabarla aparte («te falta el cierre: graba "…"»). Lo que añadió con una cifra o un «gratis» se
   comprueba antes de ponerlo en pantalla. Si cambió la palabra del «comenta X», manda la suya: cambia el pie.

## Las reglas

| | Regla |
|---|---|
| Gancho dicho | 17 palabras como mucho, con lo que importa delante: un nombre que conoce todo el mundo, la cifra, «Uso…», «Ayer dejé que…» |
| Lo que nunca abre | Un saludo, «hoy os traigo», «en este vídeo» o una pregunta que resume el reel. Una pregunta corta (12 palabras como mucho) con una pérdida o una cifra sí para: «¿Para qué pagas Claude si usas el 10 % de su cerebro?» |
| Gancho en pantalla | Dos líneas, de 3 a 6 palabras, en mayúsculas y sin emoji. Promete; no repite lo que dice la voz |
| Frase 2 | Una o dos frases, 22 palabras como mucho |
| Frases | Una idea cada una y 20 palabras como mucho |
| Ritmo | Unas 4,4 palabras por segundo ya editado: 200 palabras son 45 s |
| Prompts | Dichos enteros y como una orden: «dile: sácame todas las…» |
| Resultados | Cada uno con su cifra o su tiempo, reales |
| Rehook | 12 palabras como mucho: una cuenta («Son tres reglas»), lo que espera al final («Al final te enseño si funciona») o la pregunta que contesta el cuerpo. Un enlace también se promete a mitad: «te lo mando al final» |
| Titulares | Cada toma lleva el suyo (lo que va escrito arriba), de 2 a 5 palabras. Resume, no transcribe |
| Del lado de quien mira | Ninguna frase le llama vago, le culpa ni le asusta con «tu competencia ya lo usa» sin decir cómo salir |
| Lo que mandas | Qué es, qué lleva y que ahorra trabajo, justo antes del «comenta X» |
| CTA | «Sígueme, comenta X y te lo envío por privado», 14 palabras como mucho. X es una sola palabra, del tema, fácil de teclear en el móvil y que nadie escriba por su cuenta («top», «genial»). Nunca una ya usada ni una parecida: los reels viejos siguen recibiendo comentarios (el comprobador mira los otros guiones de `guiones/`) |
| Pie | Una frase de qué va el reel y, debajo, la línea del «comenta X» |
| Intriga | Tras el gancho no se adivina el resto; lo que se abre se cierra antes del «comenta X» |
| Suena a quien habla | Tapa su nombre: si cualquiera podría decirlo, busca la frase que solo diría él o ella y ponla delante |
| Frases de IA | Fuera «No es X, es Y», «y eso lo cambia todo», «la clave está en», «en definitiva»… (el comprobador avisa) |
| Cifras | Cada cifra dicha, en `fuentes` (las suyas también: «tuyo: 3 años»); «gratis» solo si eso mismo funciona sin plan de pago ni clave; con una sola fuente de fuera, «según X» |

**Lo que más hay que vigilar: las frases largas.** Hablando sin guion salen de 20 a 42 palabras, unidas con «ya
sea», «por lo que», «y como es lógico». Pártelas: sujeto, verbo, punto.

| Antes (38 palabras) | Después |
|---|---|
| «Sonnet ya aumenta un poco el nivel pero sin aumentar demasiado el precio, por lo que será tu mejor aliado para las acciones del día a día, ya sea utilizándolo de chatbot, redactando mensajes o creando documentos pequeños.» | «El segundo es Sonnet. Sube el nivel sin subir mucho el precio. Es el del día a día: tu chatbot, redactar mensajes o documentos pequeños.» |

## Lo que mandas

En `cta.manda`, qué es. Escríbelo entero cuando el vídeo esté grabado, sobre lo que dijo de verdad: **un solo
problema, resuelto entero**.

- El título y debajo una frase que le dice a quien comenta que está en el sitio correcto.
- «Qué hay dentro»: cuatro puntos, cada uno algo que va a poder hacer.
- Lo que necesita y los pasos numerados, con lo que se copia en bloques para copiar.
- Al final, el siguiente problema con el que se va a encontrar y un paso honesto («sígueme, que el siguiente es…»).

## El fichero

`hablado.json`. El gancho 1 es el del reel; las `tomas` van detrás de su frase 2, en orden.

```json
{
  "nombre": "2026-11-03-tema",
  "tema": "Lo que cuenta, en una línea",
  "molde": "base | noticia",
  "cta": { "palabra": "UNA", "manda": "Qué le mandas a quien comenta y qué lleva dentro" },
  "ganchos": [
    { "forma": "una de ganchos.md", "para": "imposible | dinero | gratis | identidad | perdida | drama | secreto",
      "dicho": "La frase que dice", "pantalla": "DOS LÍNEAS|EN MAYÚSCULAS", "dolor": "Su frase 2, que sale de esta" }
  ],
  "tomas": [ { "parte": "autoridad", "texto": "Lo que dice", "titular": "De 2 a 5 palabras", "pantalla": "Qué se ve" } ],
  "cuerpo2": [ { "parte": "cuerpo", "texto": "Lo mismo que el cuerpo 1, con otras palabras y en otro orden", "titular": "…", "pantalla": "…" } ],
  "fuentes": [ "De dónde sale cada cifra y cada «gratis», con su fecha" ],
  "pie": "Una frase.\n\nSígueme y comenta UNA y te lo envío por privado."
}
```

Las `parte`, en este orden: `autoridad`, `rehook`, `cuerpo` (una toma por idea), `conclusion`, `iman` (solo si se
manda algo) y `cta`. Sin nada que mandar, `"palabra": ""` y la última toma es un «Sígueme…». `cuerpo2` es opcional.
El comprobador avisa de todo lo de la tabla de reglas, de un largo fuera del molde, de una parte que falta o va
fuera de sitio, de una cifra o un «gratis» sin fuente y de una raya larga.

## Tu voz

Cada vez que corrija un guion («ese gancho no», «esto no se entiende», «yo eso no lo digo»), apúntalo aquí con su
fecha y qué haces desde entonces. Lo mismo con sus expresiones, lo que nunca diría y sus reels que funcionaron (con
su gancho y sus vistas). Es lo que hace que el siguiente guion salga a la primera.

Cuenta: @ibericaseguridad (cerrajería y seguridad, Almería capital y Poniente). Español de España. Límites de
marca: nunca enseñar a abrir cerraduras ni técnicas de robo, sin precios, sin plazos de llegada, sin «imposible
de abrir»; afirmaciones de seguridad de una marca, siempre «según [marca]». Datos propios comprobados: taller
desde 1996; urgencias 24 h 950 088 086; tienda en C/ San Leonardo 34, Almería. Lo que funciona en la cuenta:
`MATRIZ-VIRALIDAD-IBERICA.md` en la raíz del repo.

- 2026-11-10. Guion del aviso de viento «muy flojo» y repetía el carrusel. Desde entonces: un reel nunca repite
  la lista de otra pieza; busca una prueba o un test que quien mira haga en su casa.
- 2026-11-11. Guion del ICS «muy básico y no diferenciador». Desde entonces: el gancho y el cuerpo salen de lo
  que SOLO tiene ese producto. La tarjeta de propiedad no diferencia: la tiene toda la gama alta.
- 2026-11-11. Chiste «¿Y si quiero las dos? Pues compra otra puerta»: no tenía sentido. Sin chistes forzados.
- 2026-11-11. Cierre «¿Quieres saber qué bombín tienes?»: no tenía sentido. El cierre sigue el tema del reel.
- 2026-11-11. «Los cortes van escondidos en la llave» no se entendía. Lo técnico, con una imagen del día a día.
- 2026-11-11. Rehook «Lo que suena al sacarla te lo explico al final» no se entendía ni enganchaba.
- 2026-11-11. Gancho del MCS flojo; el suyo: «la llave que no has visto nunca».
- 2026-11-11. La impresora 3D: la gente ni sabe ni cree que se pueda copiar así. Va en un reel aparte.
- 2026-11-11. No decir que el MCS se usa en hospitales o negocios: el cliente piensa que no es para su casa.
- 2026-11-11. Rechazó TODOS los guiones de la estructura de seis partes: «no se entienden ni tienen sentido».
  Lo que funcionó: habla ella, natural, como en el mostrador; una sola idea por reel; frases de cliente
  (nada de «código», «rotores», «bombín» sin necesidad: «lo que hace que abra», «cerradura»); el producto en
  la mano en cada plano; un cierre que invita a preguntar el precio («¿cuánto costaría en tu puerta?
  escríbeme»), sin darlo. Antes de entregar, pasar el guion por un lector que no sabe nada del tema.
  Formato de entrega: tabla de dos columnas, «qué se ve» y «qué dices», sin etiquetas técnicas.

**Correcciones EVVA (12-nov-2026):**
- Nunca vender como diferencia el control de copias ni la tarjeta: lo tienen todos los bombines de alta seguridad.
- El formato «tres llaves de menos a más» ya está grabado dos veces: no repetirlo.
- Para la MCS, la brújula es la app del móvil, no una brújula de verdad.
- Primera frase de cinco palabras o menos, sobre algo que se ve.
