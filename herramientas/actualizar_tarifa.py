"""Actualiza los precios del buscador de tarifas (docs/tarifas.html) con el
«Listado de tarifas» exportado de FactuSOL (.XLS, columnas Código, Ref.,
Descripción, IVA y P.V.P.+IVA).

Uso:  python3 herramientas/actualizar_tarifa.py Listado_de_tarifas.XLS
Requiere: pip install xlrd

- Solo entran los artículos con precio (los de 0 € se dejan fuera, como hasta ahora).
- Los precios van con IVA (la página calcula la base al hacer el presupuesto).
"""
import json, re, sys
import xlrd

PAGINA = "docs/tarifas.html"


def leer_listado(ruta):
    wb = xlrd.open_workbook(ruta, logfile=open("/dev/null", "w"))
    hoja = wb.sheet_by_index(0)
    cabecera, productos, fecha = None, [], None
    for i in range(hoja.nrows):
        fila = hoja.row_values(i)
        celda = str(fila[0]).strip()
        m = re.match(r"Fecha:\s*(\d{2}/\d{2}/\d{4})", celda)
        if m:
            fecha = m.group(1)
        if celda == "Código":
            cabecera = i
            continue
        if cabecera is None or not celda:
            continue
        try:
            precio = round(float(fila[4] or 0), 2)
        except ValueError:
            continue
        if precio <= 0:
            continue
        productos.append({
            "codigo": celda,
            "ref": str(fila[1]).strip(),
            "descripcion": re.sub(r"\s+", " ", str(fila[2])).strip(),
            "iva": str(fila[3]).strip() or "21%",
            "precio": precio,
        })
    return productos, fecha


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    productos, fecha = leer_listado(sys.argv[1])
    if len(productos) < 1000:
        sys.exit(f"Solo {len(productos)} artículos con precio: ¿es el listado completo?")
    html = open(PAGINA, encoding="utf-8").read()
    ini = html.index("const PRODUCTOS = [")
    fin = html.index("];", ini) + 2
    antes = json.loads(html[ini + len("const PRODUCTOS = "):fin - 1])
    viejos = {p["codigo"]: p["precio"] for p in antes}
    cambian = sum(1 for p in productos if p["codigo"] in viejos and abs(viejos[p["codigo"]] - p["precio"]) > 0.004)
    nuevos = sum(1 for p in productos if p["codigo"] not in viejos)
    quitados = len(set(viejos) - {p["codigo"] for p in productos})
    nuevo = "const PRODUCTOS = " + json.dumps(productos, ensure_ascii=False, separators=(",", ":")) + ";"
    html = html[:ini] + nuevo + html[fin:]
    open(PAGINA, "w", encoding="utf-8").write(html)
    print(f"Tarifa {fecha or '(sin fecha)'}: {len(productos)} artículos · {cambian} cambian de precio · {nuevos} nuevos · {quitados} quitados")


if __name__ == "__main__":
    main()
