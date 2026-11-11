"""Comprueba el guion de un reel (hablado.json) y deja al lado una página para leerlo y grabarlo.

Uso: python3 guion.py <carpeta>/hablado.json
Imprime los avisos y escribe hablado.html al lado: eliges el gancho, retocas las frases y «Copiar» te lo copia
como texto. Solo usa la biblioteca estándar de Python (3.9 o más). El formato del JSON está en SKILL.md; las
formas de gancho, en ganchos.md, en esta misma carpeta.
"""
import html
import json
import re
import sys
import unicodedata
from pathlib import Path

PPS = 4.4  # palabras por segundo de un reel hablado ya editado, sin silencios: 200 palabras son 45 s

# La base y la noticia llevan las mismas piezas (estructura.md).
# molde: (segundos mínimos, segundos máximos, palabras máximas del gancho dicho)
MOLDES = {
    "base": (30, 60, 17),
    "noticia": (25, 50, 17),
}
# Las tomas, en este orden (las seguidas de la misma parte cuentan como una). El imán, solo si se manda algo.
# El dolor no va aquí: es la frase 2 de cada gancho.
PARTES = ["autoridad", "rehook", "cuerpo", "conclusion", "iman", "cta"]
CUERPO = ("autoridad", "rehook", "cuerpo")   # lo que lleva cada cuerpo; el cierre es uno para los dos
# Las formas del banco de ganchos: cada gancho dice de cuál sale
FORMAS = re.findall(r"^\| `([a-z0-9-]+)` \|", Path(__file__).with_name("ganchos.md").read_text(encoding="utf-8"), re.M)
MAL_ARRANQUE = ("¿", "hola", "hoy ", "buenas", "en este v", "os ", "te voy a", "bueno", "vale", "hace tiempo")
# Por qué se para alguien a mirar. Cada gancho declara el suyo, y los tres de un guion, uno distinto.
MOTIVOS = {
    "imposible": "algo que no sabías que ya se puede",
    "dinero": "dinero ganado, ahorrado o quemado",
    "gratis": "regalan algo que cuesta",
    "identidad": "una frase sobre ti que no se espera",
    "perdida": "te estás quedando atrás o lo haces mal",
    "drama": "una pelea o un giro entre grandes",
    "secreto": "algo que casi nadie cuenta",
}
# Lo que no para a nadie: un dato técnico, una tarea para el que mira o el resumen de lo que viene.
SOSO = r"\bcuesta\b|\bprecio|\btokens?\b|\bíndice\b|\bbenchmark|\bversión\b|\bque probar\b|\btienes que\b|\bdeberías\b|\b(?:te|os) cuento\b|\bhablemos\b|\bvamos a ver\b"
# El gancho va rotundo aunque no sea exacto: «nunca», no «casi nunca»
TIBIO = r"\bcasi\b|\bun poco\b|\bpuede que\b|\bquizás?\b|\bbastante\b|\ba veces\b|\bmás o menos\b|\bsuele\b"
# Lo que delata que lo ha escrito una IA
DE_IA = (r"\bno es (?:solo |solamente )?[^.,;]{1,40}, (?:es|sino)\b|\by eso lo cambia todo\b|\bla clave (?:está|es)\b|"
         r"\ben definitiva\b|\bsin más dilación\b|\bseamos (?:sinceros|honestos)\b|\bdéjame (?:que te )?expli|"
         r"\bun antes y un después\b|\brevolucionari|\bliteralmente\b|\bimagina (?:que|por un momento)\b|"
         r"\by lo mejor de todo\b|\bpero aquí viene lo bueno\b|\bte lo explico\b")
FRASE_MAX = 20  # hablando sin guion salen de 26 a 42 palabras: se parten


def palabras(texto: str) -> int:
    return len(texto.split())


def frases(texto: str) -> list[str]:
    return [f for f in re.split(r"(?<=[.!?…:])\s+", texto.strip()) if f]


def segundos(n: int) -> float:
    return n / PPS


def sin_tildes(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn")


def avisos_tomas(tomas: list[dict], nombre: str) -> list[str]:
    a = []
    for i, t in enumerate(tomas, 1):
        if t.get("parte") == "dolor":
            a.append(f"{nombre} {i}: el dolor no va en las tomas, va en cada gancho («dolor»)")
        elif t.get("parte") not in PARTES:
            a.append(f"{nombre} {i}: parte «{t.get('parte')}»; vale {', '.join(PARTES)}")
        for f in frases(t.get("texto", "")):
            if palabras(f) > FRASE_MAX:
                a.append(f"{nombre} {i}: una frase de {palabras(f)} palabras («{' '.join(f.split()[:6])}…»). Pártela: una idea, {FRASE_MAX} como mucho")
        titular = t.get("titular", "")
        if not titular:
            a.append(f"{nombre} {i}: sin titular (de 2 a 5 palabras, lo que va escrito arriba)")
        elif palabras(titular) > 5:
            a.append(f"{nombre} {i}: el titular «{titular}» tiene {palabras(titular)} palabras; son de 2 a 5")
        elif titular.lower().rstrip(".") in t.get("texto", "").lower():
            a.append(f"{nombre} {i}: el titular «{titular}» repite lo que dices; resume, no transcribe")
    return a


def avisos_cuerpo2(tomas: list[dict], cuerpo2: list[dict]) -> list[str]:
    """El cuerpo 2: lo mismo que el 1, con otras palabras y en otro orden. Con los tres ganchos salen seis vídeos
    distintos de una sola grabación."""
    a = []
    uno = [t for t in tomas if t.get("parte") in CUERPO]
    for i, t in enumerate(cuerpo2, 1):
        if t.get("parte") not in CUERPO:
            a.append(f"cuerpo 2, toma {i}: «{t.get('parte')}» no va aquí; lleva autoridad, rehook y cuerpo "
                     "(el cierre es uno para los dos cuerpos)")
    falta = {t.get("parte") for t in uno} - {t.get("parte") for t in cuerpo2}
    if falta:
        a.append(f"el cuerpo 2 no cuenta {', '.join(sorted(falta))}: lleva lo mismo que el 1")
    # Una frase igual en los dos sería la misma toma grabada dos veces
    limpia = lambda f: re.sub(r"[^\wáéíóúñü ]", "", f.lower()).strip()
    dichas = {limpia(f) for t in uno for f in frases(t.get("texto", ""))}
    for i, t in enumerate(cuerpo2, 1):
        for f in frases(t.get("texto", "")):
            if limpia(f) in dichas:
                a.append(f"cuerpo 2, toma {i}: «{' '.join(f.split()[:6])}…» está igual en el cuerpo 1: dilo de otra forma")
    p1, p2 = (sum(palabras(t.get("texto", "")) for t in lista) for lista in (uno, cuerpo2))
    if p1 and not 0.75 <= p2 / p1 <= 1.25:
        a.append(f"el cuerpo 2 dura {segundos(p2):.0f} s y el 1, {segundos(p1):.0f} s: que se parezcan")
    return a


def avisos_palabra(palabra: str, manda: str, ruta: Path) -> list[str]:
    """La palabra del «comenta X» no se repite: los reels viejos siguen recibiendo comentarios, y quien comenta
    la de antes recibiría lo que no es. Mira los otros guiones de la misma carpeta y de las carpetas hermanas."""
    aqui = ruta.resolve()
    otros = set(aqui.parent.glob("*.json")) | set(aqui.parent.parent.glob("*/hablado.json"))
    a = []
    for otro in sorted(otros - {aqui}):
        try:
            suyo = json.loads(otro.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        cta = (suyo.get("cta") or {}) if isinstance(suyo, dict) else {}
        usada = cta.get("palabra") or ""
        if not usada or (manda and cta.get("manda") == manda):
            continue   # manda lo mismo: la palabra puede repetirse
        # Sin tildes y una dentro de otra: EDICIÓN y edicion, o MODELO y MODELOS, se confunden igual
        if sin_tildes(usada) in sin_tildes(palabra) or sin_tildes(palabra) in sin_tildes(usada):
            a.append(f"«comenta {palabra}» choca con «{usada}», de {otro.relative_to(aqui.parent.parent)}: otra palabra")
    return a


def avisos(g: dict, ruta: Path) -> list[str]:
    a: list[str] = []
    molde = g.get("molde")
    if molde not in MOLDES:
        return [f"molde «{molde}»: tiene que ser {' o '.join(MOLDES)}"]
    minimo, maximo, gancho_max = MOLDES[molde]

    ganchos = g.get("ganchos", [])
    if len(ganchos) < 3:
        a.append(f"hay {len(ganchos)} ganchos: van tres, y se graban los tres")
    for i, h in enumerate(ganchos, 1):
        dicho, pantalla, dolor = h.get("dicho", ""), h.get("pantalla", ""), h.get("dolor", "")
        if palabras(dicho) > gancho_max:
            a.append(f"gancho {i}: {palabras(dicho)} palabras dichas; caben {gancho_max} ({segundos(gancho_max):.1f} s)")
        if h.get("para") not in MOTIVOS:
            a.append(f"gancho {i}: falta su motivo para pararse («para»): {', '.join(MOTIVOS)}")
        if h.get("forma") not in FORMAS:
            a.append(f"gancho {i}: falta de qué forma del banco sale («forma»): una de ganchos.md")
        soso = re.search(SOSO, dicho.lower())
        if soso:
            a.append(f"gancho {i}: «{soso.group(0).strip()}» es un dato técnico o un deber. El gancho da una razón para pararse; eso va dentro")
        tibio = re.search(TIBIO, dicho.lower())
        if tibio:
            a.append(f"gancho {i}: «{tibio.group(0)}» lo deja tibio. Va rotundo, aunque no sea exacto: «nunca», no «casi nunca»")
        # La frase 2 sale de lo que dice la 1: cada gancho trae la suya
        if not dolor:
            a.append(f"gancho {i}: sin su «dolor». La frase 2 sale de lo que dice este gancho: cada uno trae la suya")
        elif palabras(dolor) > 22:
            a.append(f"gancho {i}: su dolor tiene {palabras(dolor)} palabras; una o dos frases, 22 como mucho")
        # Una pregunta corta y cargada sí para («¿Para qué pagas Claude si usas el 10 % de su cerebro?»);
        # la que resume el vídeo, no
        pregunta_ok = dicho.startswith("¿") and palabras(dicho) <= 12
        if dicho.lower().startswith(MAL_ARRANQUE) and not pregunta_ok:
            a.append(f"gancho {i}: empieza por «{dicho.split()[0]}». Arranca con lo que importa: la marca, la cifra, «Uso…»")
        if pantalla.count("|") != 1:
            a.append(f"gancho {i}: lo de pantalla va en dos líneas separadas por «|»")
        if palabras(pantalla.replace("|", " ")) > 8:
            a.append(f"gancho {i}: {palabras(pantalla.replace('|', ' '))} palabras en pantalla; son de 3 a 6, sin emoji")
        if pantalla.replace("|", " ").strip().lower().rstrip(" .") == dicho.strip().lower().rstrip(" ."):
            a.append(f"gancho {i}: la pantalla repite lo que dices. La pantalla promete y la voz cuenta el hecho")

    motivos = [h.get("para") for h in ganchos if h.get("para") in MOTIVOS]
    if len(set(motivos)) < len(motivos):
        a.append("dos ganchos con el mismo motivo: cada uno engancha por algo distinto")
    formas = [h.get("forma") for h in ganchos if h.get("forma") in FORMAS]
    if len(set(formas)) < len(formas):
        a.append("dos ganchos de la misma forma: salen de tres distintas del banco (salvo si calcas el formato de un reel)")

    tomas = g.get("tomas", [])
    cuerpo2 = g.get("cuerpo2", [])
    partes = [t.get("parte") for t in tomas]
    a += avisos_tomas(tomas, "toma")
    if cuerpo2:
        a += avisos_tomas(cuerpo2, "cuerpo 2, toma") + avisos_cuerpo2(tomas, cuerpo2)
    # Todo vídeo cierra la idea: la conclusión no falta nunca
    seguidas = [p for i, p in enumerate(partes) if i == 0 or p != partes[i - 1]]
    orden = [p for p in PARTES if p != "iman" or "iman" in partes]
    if seguidas != orden:
        a.append(f"las tomas van así: {', '.join(orden)}. Ahora: {', '.join(str(p) for p in seguidas)}")
    if partes.count("rehook") > 1:
        a.append("el rehook es una sola toma")
    autoridad = " ".join(t.get("texto", "") for t in tomas if t.get("parte") == "autoridad")
    if autoridad and molde == "base" and not re.search(r"\d", autoridad):   # en una noticia, la autoridad es el dato
        a.append("la autoridad lleva una cifra: la tuya («llevo 3 años», «200 clientes») o la de la herramienta")
    for t in tomas:
        if t.get("parte") == "rehook" and palabras(t.get("texto", "")) > 12:
            a.append(f"el rehook tiene {palabras(t['texto'])} palabras; una frase corta, 12 como mucho («Son tres reglas.»)")
    # El cómo empieza antes del segundo 12, con cualquiera de los tres ganchos
    if ganchos and "cuerpo" in partes:
        previo = sum(palabras(t.get("texto", "")) for t in tomas[: partes.index("cuerpo")])
        antes = max(palabras(h.get("dicho", "")) + palabras(h.get("dolor", "")) for h in ganchos) + previo
        if antes > 12 * PPS:
            a.append(f"el cuerpo empieza a los {segundos(antes):.0f} s: tiene que ser antes del 12. "
                     "Dolor y autoridad, una o dos frases cada uno")

    cta = g.get("cta") or {}
    palabra = cta.get("palabra") or ""
    ultima = tomas[-1].get("texto", "").lower() if partes[-1:] == ["cta"] else ""
    if ultima and not palabra and "sígueme" not in ultima:
        a.append("la última toma es el «sígueme»: este vídeo no manda nada")
    elif ultima and palabra and (palabra.lower() not in ultima or "comenta" not in ultima):
        a.append(f"la última toma tiene que decir «comenta {palabra}»")
    elif ultima and palabra and palabras(ultima) > 14:
        a.append(f"el «comenta X» tiene {palabras(ultima)} palabras; son los últimos 2 s, 14 como mucho")
    if palabra and len(palabra.split()) > 1:
        a.append(f"«{palabra}»: la palabra del «comenta X» es una sola")
    if palabra and not cta.get("manda"):
        a.append("falta cta.manda: qué le mandas a quien comenta")
    if palabra and "iman" not in partes:
        a.append("falta la toma «iman»: qué mandas y qué lleva, justo antes del «comenta»")
    pie = g.get("pie", "")
    if palabra and palabra.lower() not in pie.lower():
        a.append(f"el pie no dice «comenta {palabra}»")
    if palabra:
        a += avisos_palabra(palabra, cta.get("manda", ""), ruta)

    todo = " ".join([h.get("dicho", "") + " " + h.get("dolor", "") + " " + h.get("pantalla", "") for h in ganchos]
                    + [t.get("texto", "") + " " + t.get("titular", "") + " " + t.get("pantalla", "") for t in tomas + cuerpo2] + [pie])
    if "\u2014" in todo or "\u2013" in todo:   # la raya larga y la media
        a.append("hay una raya larga o media: fuera, delata que lo ha escrito una IA")
    dicho = " ".join(t.get("texto", "") for t in tomas + cuerpo2) + " " + " ".join(h.get("dicho", "") + " " + h.get("dolor", "") for h in ganchos)
    fuentes = " ".join(g.get("fuentes", [])).lower()
    if re.search(r"\d|gratis|gratuit", dicho) and not g.get("fuentes"):
        a.append("hay cifras o un «gratis» y ninguna fuente apuntada: se comprueba antes de escribirlo")
    # Cada cifra dicha, en una fuente; y «gratis» solo si eso mismo funciona sin pagar
    if g.get("fuentes"):
        for n in sorted(set(re.findall(r"\d+(?:[.,]\d+)*", dicho))):
            if n not in fuentes and n.replace(".", "") not in fuentes.replace(".", ""):
                a.append(f"la cifra «{n}» no está en ninguna fuente: se comprueba y se apunta, o fuera")
        if re.search(r"gratis|gratuit", dicho.lower()) and not re.search(r"gratis|gratuit|free|0 ?€|0 ?\$", fuentes):
            a.append("dice «gratis» y ninguna fuente lo dice: solo si eso mismo funciona sin plan de pago ni clave")
    for i, h in enumerate(ganchos, 1):
        if m := re.search(DE_IA, (h.get("dicho", "") + " " + h.get("dolor", "")).lower()):
            a.append(f"gancho {i}: «{m.group(0)}» suena a IA. Dilo directo")
    for nombre, lista in (("toma", tomas), ("cuerpo 2, toma", cuerpo2)):
        for i, t in enumerate(lista, 1):
            if m := re.search(DE_IA, t.get("texto", "").lower()):
                a.append(f"{nombre} {i}: «{m.group(0)}» suena a IA. Dilo directo")

    total = duracion(g)
    s = segundos(total)
    if s > maximo:
        a.append(f"dura {s:.0f} s ({total} palabras); un «{molde}» no pasa de {maximo}")
    if s < minimo:
        a.append(f"dura {s:.0f} s ({total} palabras); a un «{molde}» le faltan cosas por debajo de {minimo}")
    return a


def duracion(g: dict) -> int:
    """Las palabras del reel normal: el gancho 1 con su frase 2, el cuerpo 1 y el cierre."""
    ganchos = g.get("ganchos") or [{}]
    return (palabras(ganchos[0].get("dicho", "")) + palabras(ganchos[0].get("dolor", ""))
            + sum(palabras(t.get("texto", "")) for t in g.get("tomas", [])))


NOMBRE_PARTE = {
    "autoridad": "Autoridad", "rehook": "Rehook", "cuerpo": "Cuerpo",
    "conclusion": "La idea que se lleva", "iman": "Lo que mandas", "cta": "CTA",
}

PAGINA = """<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Guion · __TEMA__</title>
<style>
  :root { --fondo:#f6f5f2; --panel:#fff; --linea:#e7e4dd; --texto:#1d1b18; --gris:#8a857c; --acento:#d6336c; }
  * { box-sizing:border-box; }
  body { margin:0; padding:20px 24px 40px; background:var(--fondo); color:var(--texto);
    font:15px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif; }
  .ancho { max-width:900px; margin:0 auto; }
  header { display:flex; align-items:center; gap:14px; margin-bottom:14px; flex-wrap:wrap; }
  h1 { font-size:20px; margin:0; }
  .chip { font-size:12px; color:var(--gris); border:1px solid var(--linea); border-radius:99px; padding:3px 10px; background:var(--panel); white-space:nowrap; }
  .chip b { color:var(--texto); }
  .chip.mal b { color:#c92a2a; }
  .hueco { flex:1; }
  button { font:inherit; font-weight:600; white-space:nowrap; border-radius:8px; padding:8px 14px; cursor:pointer; border:1px solid var(--texto); background:var(--texto); color:#fff; }
  h2 { font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:var(--gris); margin:22px 0 8px; }
  .ganchos { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:10px; }
  .gancho { background:var(--panel); border:2px solid var(--linea); border-radius:12px; padding:12px; cursor:pointer; }
  .gancho.elegido { border-color:var(--acento); }
  .pantalla { background:#22201c; color:#fff; border-radius:8px; padding:16px 8px; text-align:center;
    font:800 19px/1.15 "Arial Narrow","Helvetica Neue",sans-serif; text-transform:uppercase; letter-spacing:.01em; }
  .dicho, .frase2 { margin-top:10px; font-size:16px; }
  .frase2 { margin-top:6px; }
  .motivo { font-size:11px; color:var(--gris); margin-bottom:8px; }
  .motivo b { color:var(--acento); text-transform:uppercase; letter-spacing:.06em; }
  .toma { background:var(--panel); border:1px solid var(--linea); border-radius:12px; padding:12px 14px; margin-bottom:8px;
    display:grid; grid-template-columns:130px 1fr; gap:4px 14px; }
  .parte { font-size:12px; color:var(--gris); padding-top:5px; }
  .parte b { display:block; color:var(--texto); font-size:13px; }
  .texto { font-size:20px; line-height:1.35; outline:none; border-radius:6px; padding:2px 4px; margin:-2px -4px; }
  .texto:focus { background:#fff7fa; box-shadow:0 0 0 2px #f3c1d2; }
  .gancho [contenteditable]:focus { outline:2px solid #f3c1d2; border-radius:6px; }
  .edit { grid-column:2; display:flex; gap:8px; flex-wrap:wrap; font-size:12px; color:var(--gris); }
  .edit span { border:1px dashed var(--linea); border-radius:6px; padding:2px 8px; }
  .edit i { font-style:normal; color:var(--texto); outline:none; }
  .edit i:focus { background:#fff7fa; }
  .larga { color:#c92a2a; }
  .pie { background:var(--panel); border:1px solid var(--linea); border-radius:12px; padding:12px 14px; white-space:pre-wrap; outline:none; }
  #guion { display:flex; flex-direction:column; }
  #tomas, #cuerpo2 { display:contents; }   /* los dos cuerpos van en una columna, con el cierre debajo */
  .toma[hidden] { display:none; }
  .cuerpos { display:flex; align-items:center; gap:6px; margin-bottom:10px; flex-wrap:wrap; }
  .cuerpos button { background:var(--panel); color:var(--texto); border-color:var(--linea); }
  .cuerpos button.activo { background:var(--texto); color:#fff; border-color:var(--texto); }
  textarea { display:none; width:100%; height:160px; margin-top:12px; font:12px/1.4 ui-monospace,Menlo,monospace; }
  @media (max-width:600px) { .toma { grid-template-columns:1fr; } .edit { grid-column:1; } }
</style></head><body><div class="ancho">
<header>
  <h1>__TEMA__</h1><span class="chip">molde <b>__MOLDE__</b></span>
  <span class="chip" id="dur"></span><span class="hueco"></span>
  <button id="copiar">Copiar</button>
</header>
<h2>Graba cada gancho seguido de su frase 2 · el marcado va en el reel · arriba lo que se ve, abajo lo que dices</h2>
<div class="ganchos" id="ganchos"></div>
<h2>El guion · toca cualquier frase y cámbiala · una frase que vacías se quita</h2>
<div class="cuerpos" id="cuerpos"><button data-cuerpo="1" class="activo">Cuerpo 1</button><button data-cuerpo="2">Cuerpo 2</button>
  <span class="chip">el 2: lo mismo, con otras palabras y en otro orden · se graba al final, sin el cierre</span></div>
<div id="guion"><div id="tomas"></div><div id="cuerpo2"></div></div>
<h2>El pie del reel</h2>
<div class="pie" id="pie" contenteditable="true"></div>
<textarea id="copia" readonly></textarea>
</div>
<script>
const G = __JSON__, PPS = __PPS__, FRASE_MAX = __FRASE_MAX__, RANGO = __RANGO__, PARTE = __PARTES__, MOTIVO = __MOTIVOS__;
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x !== undefined) n.textContent = x; return n; };
const cuenta = (t) => t.trim().split(/\\s+/).filter(Boolean).length;
const plano = (n) => n.innerText.replace(/\\s+/g, " ").trim();
let elegido = 0;

// Cada gancho, con lo que se ve arriba, lo que dices y su frase 2 pegada: se graban seguidos
const ganchos = document.getElementById("ganchos");
G.ganchos.forEach((h, i) => {
  const caja = el("div", "gancho" + (i === 0 ? " elegido" : ""));
  const motivo = el("div", "motivo");
  motivo.append(el("b", "", h.para ?? ""), document.createTextNode((MOTIVO[h.para] ? " · " + MOTIVO[h.para] : "") + (h.forma ? " · " + h.forma : "")));
  const pantalla = el("div", "pantalla");
  (h.pantalla ?? "").split("|").forEach((linea) => pantalla.append(el("div", "", linea.trim())));
  const dicho = el("div", "dicho", h.dicho ?? "");
  const frase2 = el("div", "frase2", h.dolor ?? "");
  for (const n of [pantalla, dicho, frase2]) { n.contentEditable = "true"; n.addEventListener("input", medir); }
  caja.append(motivo, pantalla, dicho, frase2);
  caja.addEventListener("click", () => {
    if (i === elegido) return;
    elegido = i;
    [...ganchos.children].forEach((c, j) => c.classList.toggle("elegido", j === i));
    medir();
  });
  ganchos.append(caja);
});

const tomas = document.getElementById("tomas"), cuerpo2 = document.getElementById("cuerpo2");
if (!G.cuerpo2?.length) document.getElementById("cuerpos").remove();
// Con dos cuerpos se ve el reel entero con uno u otro, y el cierre siempre abajo
const CIERRE = ["conclusion", "iman", "cta"];
const pintar = (t, donde) => {
  const caja = el("div", "toma");
  const parte = el("div", "parte");
  parte.append(el("b", "", PARTE[t.parte] ?? t.parte), el("span"));
  const texto = el("div", "texto", t.texto);
  texto.contentEditable = "true";
  texto.addEventListener("input", medir);
  const edit = el("div", "edit");
  const campo = (etiqueta, valor) => {
    const v = el("i", "", valor);
    v.contentEditable = "true";
    const chip = el("span", "", etiqueta + ": ");
    chip.append(v);
    return chip;
  };
  if (t.titular) edit.append(campo("arriba", t.titular));
  if (t.pantalla) edit.append(campo("se ve", t.pantalla));
  caja.append(parte, texto, edit);
  const cierre = CIERRE.includes(t.parte);
  caja.style.order = cierre ? 2 : 1;
  if (G.cuerpo2?.length && !cierre) caja.dataset.cuerpo = donde === cuerpo2 ? "2" : "1";
  donde.append(caja);
};
G.tomas.forEach((t) => pintar(t, tomas));
(G.cuerpo2 ?? []).forEach((t) => pintar(t, cuerpo2));
document.getElementById("pie").textContent = G.pie ?? "";

function medir() {
  const tarjeta = ganchos.children[elegido];
  let total = cuenta(tarjeta.querySelector(".dicho").textContent) + cuenta(tarjeta.querySelector(".frase2").textContent);
  for (const caja of [...tomas.children, ...cuerpo2.children]) {
    const texto = caja.querySelector(".texto").textContent;
    const n = cuenta(texto);
    if (!caja.hidden) total += n;   // lo que dura el reel con el cuerpo que se ve
    const larga = texto.split(/(?<=[.!?…:])\\s+/).some((f) => cuenta(f) > FRASE_MAX);
    const nota = caja.querySelector(".parte span");
    nota.textContent = (n / PPS).toFixed(1) + " s" + (larga ? " · frase larga" : "");
    nota.className = larga ? "larga" : "";
  }
  const s = total / PPS, dur = document.getElementById("dur");
  dur.innerHTML = "<b>" + Math.round(s) + " s</b> · " + total + " palabras · lo suyo, de " + RANGO[0] + " a " + RANGO[1];
  dur.className = "chip" + (s > RANGO[1] || s < RANGO[0] ? " mal" : "");
}
medir();
const verCuerpo = (n) => {
  document.querySelectorAll(".toma[data-cuerpo]").forEach((c) => (c.hidden = c.dataset.cuerpo !== n));
  document.querySelectorAll("#cuerpos button").forEach((b) => b.classList.toggle("activo", b.dataset.cuerpo === n));
  medir();
};
document.querySelectorAll("#cuerpos button").forEach((b) => b.addEventListener("click", () => verCuerpo(b.dataset.cuerpo)));
if (G.cuerpo2?.length) verCuerpo("1");

// «Copiar»: el guion como lo has dejado, para pegárselo a Claude o tenerlo en el móvil al grabar
const boton = document.getElementById("copiar");
boton.addEventListener("click", async () => {
  const orden = [elegido, ...G.ganchos.map((_, i) => i).filter((i) => i !== elegido)];
  const lineaGancho = (i) => {
    const caja = ganchos.children[i];
    const p = caja.querySelector(".pantalla");   // una línea por cada div que hay dentro
    const pantalla = (p.children.length ? [...p.children].map((n) => n.textContent.trim()) : [p.textContent.trim()]).filter(Boolean).join(" / ");
    return "Gancho " + (i + 1) + (i === elegido ? " (el del reel)" : "") + ": " + plano(caja.querySelector(".dicho"))
      + " " + plano(caja.querySelector(".frase2")) + " [pantalla: " + pantalla + "]";
  };
  const dichas = (lista) => [...lista.children].map((c) => plano(c.querySelector(".texto"))).filter(Boolean);
  const lineas = [
    "Guion de «" + (G.tema ?? G.nombre) + "», como lo dejo:",
    ...orden.map(lineaGancho),
    ...dichas(tomas).map((t, i) => (i + 1) + ". " + t),
    ...dichas(cuerpo2).map((t, i) => "Cuerpo 2, " + (i + 1) + ". " + t),
    "Pie: " + document.getElementById("pie").innerText.trim(),
  ];
  const texto = lineas.join("\\n");
  try {
    await navigator.clipboard.writeText(texto);
    boton.textContent = "Copiado";
    setTimeout(() => (boton.textContent = "Copiar"), 1500);
  } catch {
    const copia = document.getElementById("copia");
    copia.value = texto; copia.style.display = "block"; copia.select();
  }
});
</script></body></html>
"""


def pagina(g: dict) -> str:
    minimo, maximo, _ = MOLDES[g["molde"]]
    return (
        PAGINA.replace("__TEMA__", html.escape(g.get("tema", g.get("nombre", ""))))
        .replace("__MOLDE__", html.escape(g["molde"]))
        .replace("__JSON__", json.dumps(g, ensure_ascii=False).replace("</", "<\\/"))
        .replace("__PPS__", str(PPS))
        .replace("__FRASE_MAX__", str(FRASE_MAX))
        .replace("__RANGO__", json.dumps([minimo, maximo]))
        .replace("__PARTES__", json.dumps(NOMBRE_PARTE, ensure_ascii=False))
        .replace("__MOTIVOS__", json.dumps(MOTIVOS, ensure_ascii=False))
    )


def comprobar(ruta: Path) -> list[str]:
    g = json.loads(ruta.read_text(encoding="utf-8"))
    lista = avisos(g, ruta)
    if g.get("molde") in MOLDES and g.get("ganchos"):
        total = duracion(g)
        print(f"{g.get('nombre')} · {g['molde']} · {total} palabras · {segundos(total):.0f} s con el gancho 1")
        salida = ruta.with_suffix(".html")
        salida.write_text(pagina(g), encoding="utf-8")
        print(f"Página: {salida}")
    print("Sin avisos." if not lista else f"{len(lista)} avisos:")
    for x in lista:
        print("  ·", x)
    return lista


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    sys.exit(1 if comprobar(Path(sys.argv[1]).expanduser()) else 0)


if __name__ == "__main__":
    main()
