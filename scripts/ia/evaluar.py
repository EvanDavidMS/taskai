#!/usr/bin/env python3
"""Banco de pruebas de la IA de TaskAI.

Manda cada nota de casos.json a Ollama igual que ai_structure (lib.rs): mismo prompt, mismos
ejemplos y mismas opciones; luego revisa lo que DEBE salir y da una calificación.

    python3 scripts/ia/evaluar.py                      # todos los casos con qwen2.5:7b
    python3 scripts/ia/evaluar.py -m llama3.1:8b       # otro modelo
    python3 scripts/ia/evaluar.py -c planes_noche -v   # un caso, mostrando la respuesta
    python3 scripts/ia/evaluar.py -g salida.json       # guarda las respuestas

Regla: antes de tocar el prompt corre esto, y después también. Solo se queda un cambio si
sube la calificación sin romper casos que ya pasaban.
"""
import argparse, json, re, sys, time, urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
LIB = RAIZ / "src-tauri/src/lib.rs"
CASOS = Path(__file__).with_name("casos.json")

HOY = "jueves, 19 de noviembre de 2026"
HOY_CORTO = "jueves, 19 de noviembre"
MANANA = "viernes, 20 de noviembre"
CAL = ("mañana es viernes, 20 de noviembre, sábado, 21 de noviembre, domingo, 22 de noviembre, "
       "lunes, 23 de noviembre, martes, 24 de noviembre, miércoles, 25 de noviembre, jueves, 26 de noviembre")


def constante(src, nombre):
    m = re.search(r"const " + nombre + r': &str = r###"(.*?)"###;', src, re.S)
    if m:
        return m.group(1)
    m = re.search(r"const " + nombre + r': &str = "((?:[^"\\]|\\.)*)";', src, re.S)
    return json.loads('"' + m.group(1) + '"') if m else None


def mensajes(src, texto):
    llenar = lambda s: s.replace("{MANANA}", MANANA).replace("{HOY}", HOY_CORTO)
    msgs = [{"role": "system", "content": constante(src, "SYSTEM_PROMPT").replace("{HOY}", HOY).replace("{CALENDARIO}", CAL)}]
    # Mismo orden que ai_structure (lib.rs): 1, 2, [4 solo si la nota es larga], 3
    largo = int(re.search(r"const LONG_NOTE_WORDS: usize = (\d+);", src).group(1))
    orden = ["", "2"] + (["4"] if len(texto.split()) > largo else []) + ["3"]
    for i in orden:
        ein, eout = constante(src, f"EXAMPLE{i}_IN"), constante(src, f"EXAMPLE{i}_OUT")
        if ein and eout:
            msgs += [{"role": "user", "content": llenar(ein)}, {"role": "assistant", "content": llenar(eout)}]
    msgs.append({"role": "user", "content": texto})
    return msgs


ANOTAR_HOY = False  # prueba: anotar "hoy [jueves, 19 de noviembre]" como hace annotateDates con mañana


def preparar(texto):
    if ANOTAR_HOY:
        texto = re.sub(r"\b([Hh]oy)\b(?! \[)", r"\1 [" + HOY_CORTO + "]", texto)
    return texto


def ollama(modelo, msgs):
    body = json.dumps({"model": modelo, "stream": False, "messages": msgs, "keep_alive": "30m",
                       "options": {"temperature": 0, "seed": 42, "top_k": 1, "num_ctx": 8192}}).encode()
    req = urllib.request.Request("http://localhost:11434/api/chat", body, {"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=600))["message"]["content"].strip()


# ---------- revisión ----------
def secciones(md):
    """{"Hoy en la noche": "texto…", …} (sin emojis en el nombre)."""
    out, actual = {}, None
    for l in md.splitlines():
        if l.startswith("## "):
            actual = re.sub(r"^[^\wÁÉÍÓÚÑáéíóúñ]+", "", l[3:]).strip()
            out[actual] = ""
        elif actual:
            out[actual] += l + "\n"
    return out


def pendientes(md):
    return [l for l in md.splitlines() if re.match(r"\s*[-*] \[[ xX]\]", l)]


def revisar(caso, md):
    fallas = []
    sec = secciones(md)
    pend = pendientes(md)
    pend_txt = "\n".join(pend)
    bajo = md.lower()

    # Formato general (todas las notas)
    lineas = md.splitlines()
    if not lineas or not lineas[0].startswith("# "):
        fallas.append("formato: no empieza con '# Título'")
    elif len(lineas[0][2:].split()) > 8:
        fallas.append(f"título largo: {lineas[0][2:]!r}")
    if not any(l.startswith("> ") for l in lineas[:4]):
        fallas.append("formato: falta el resumen '> …'")
    if "```" in md:
        fallas.append("formato: trae ```")
    for p in pend:
        if not re.search(r" — \*\*[^*]+\*\*\s*$", p) and re.search(r"\d{1,2} de \w+", p):
            fallas.append(f"formato de pendiente: {p.strip()!r}")
    if re.search(r"\[(lunes|martes|miércoles|jueves|viernes|sábado|domingo|\d{1,2}:\d{2})", md):
        fallas.append("copió una anotación [..]")
    for t in caso.get("titulo_no", []):
        if lineas and re.fullmatch(r"#\s*" + t + r"\b.*", lineas[0], re.I) and len(lineas[0].split()) <= 4:
            fallas.append(f"título genérico: {lineas[0]!r}")

    # Pendientes esperados
    for e in caso.get("pendientes", []):
        hallado = [p for p in pend if all(re.search(w, p, re.I) for w in e["con"])]
        if not hallado:
            fallas.append(f"falta pendiente {'+'.join(e['con'])}")
            continue
        p = hallado[0]
        if e.get("fecha") and e["fecha"] not in p:
            fallas.append(f"pendiente {'+'.join(e['con'])} con fecha mal: {p.strip()!r}")
        if e.get("hora") and e["hora"] not in p:
            fallas.append(f"pendiente {'+'.join(e['con'])} sin la hora {e['hora']}: {p.strip()!r}")
        if len(hallado) > 1:
            fallas.append(f"pendiente {'+'.join(e['con'])} repetido")
    for w in caso.get("no_pendientes", []):
        if re.search(r"\b" + w + r"\b", pend_txt, re.I):
            fallas.append(f"'{w}' no debería ser pendiente")
    if "max_pendientes" in caso and len(pend) > caso["max_pendientes"]:
        fallas.append(f"sobran pendientes ({len(pend)}): {[p.strip() for p in pend]}")
    if caso.get("sin_pendientes") and pend:
        fallas.append(f"no debería tener pendientes ({len(pend)})")

    # Contenido
    for w in caso.get("debe_decir", []):
        if not re.search(w, md, re.I):
            fallas.append(f"no dice {w!r}")
    for w in caso.get("prohibido", []):
        m = re.search(w, md)
        if m:
            fallas.append(f"dice {m.group(0)!r}")
    for nombre in caso.get("con_seccion", []):
        if not any(nombre.lower() in s.lower() for s in sec):
            fallas.append(f"falta la sección {nombre!r}")
    for nombre in caso.get("sin_seccion", []):
        if any(nombre.lower() in s.lower() for s in sec):
            fallas.append(f"sobra la sección {nombre!r}")
    for nombre, palabras in caso.get("prohibido_en_seccion", {}).items():
        for s, cuerpo in sec.items():
            if s.lower().startswith(nombre.lower()):
                for w in palabras:
                    if re.search(w, cuerpo, re.I):
                        fallas.append(f"'{w}' no va en la sección {s!r}")
    for w, n in caso.get("max_menciones", {}).items():
        # Solo dentro de las secciones (el título y el resumen pueden nombrarlo)
        cuerpo = "\n".join(v for k, v in sec.items() if "pendientes" not in k.lower())
        k = len(re.findall(w, cuerpo, re.I))
        if k > n:
            fallas.append(f"'{w}' repetido {k} veces fuera de pendientes")

    # Prioridad: 🔴 solo en lo que el usuario dijo que es urgente/importante
    altas = caso.get("prioridad_alta", [])
    for w in altas:
        if not any(re.search(w, p, re.I) and "🔴" in p for p in pend):
            fallas.append(f"'{w}' debería tener prioridad alta 🔴")
    for p in pend:
        if "🔴" in p and not any(re.search(w, p, re.I) for w in altas):
            fallas.append(f"prioridad inventada: {p.strip()!r}")

    # Negritas: frases completas (más de 4 palabras) cuentan como falla de estilo
    largas = [b for b in re.findall(r"\*\*([^*]+)\*\*", md) if len(b.split()) > 4 and not re.search(r"\d{1,2} de \w+", b)]
    if largas:
        fallas.append(f"negritas largas: {largas[0]!r}")
    return fallas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-m", "--modelo", default="qwen2.5:7b")
    ap.add_argument("-c", "--caso", action="append", help="solo estos casos")
    ap.add_argument("-v", "--ver", action="store_true", help="mostrar cada respuesta")
    ap.add_argument("-g", "--guardar", help="guardar respuestas en este .json")
    ap.add_argument("--lib", default=str(LIB), help="lib.rs a usar (para comparar versiones)")
    ap.add_argument("--hoy", action="store_true", help="anotar también 'hoy [fecha]'")
    ap.add_argument("--casos", default=str(CASOS), help="otro archivo de casos (p. ej. notas reales que NO van al repo)")
    a = ap.parse_args()

    global ANOTAR_HOY
    ANOTAR_HOY = a.hoy
    src = Path(a.lib).read_text(encoding="utf-8")
    casos = json.loads(Path(a.casos).read_text(encoding="utf-8"))["casos"]
    if a.caso:
        casos = [c for c in casos if c["id"] in a.caso]

    total_ok, guardado, t0 = 0, {}, time.time()
    for c in casos:
        md = ollama(a.modelo, mensajes(src, preparar(c["texto"])))
        guardado[c["id"]] = md
        fallas = revisar(c, md)
        total_ok += not fallas
        print(("✅ " if not fallas else "❌ ") + c["id"])
        for f in fallas:
            print("     · " + f)
        if a.ver:
            print("\n" + md + "\n" + "-" * 60)
    print(f"\n{a.modelo}: {total_ok}/{len(casos)} casos sin fallas · {time.time() - t0:.0f} s")
    if a.guardar:
        Path(a.guardar).write_text(json.dumps(guardado, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
