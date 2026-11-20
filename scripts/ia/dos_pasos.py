#!/usr/bin/env python3
"""Prototipo: IA en dos pasos.
  1) La nota ordenada como hoy (ai_structure), pero sin confiar en su sección de Pendientes.
  2) Los pendientes como JSON con opciones cerradas (día de una lista, hora solo de las del texto,
     tipo: compromiso / plan_libre / deseo / ya_hecho). El código arma la sección "📌 Pendientes".

    python3 scripts/ia/dos_pasos.py [-c caso] [-v]
"""
import argparse, json, re, sys, time, urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import evaluar as ev  # noqa: E402

DIAS = ["jueves, 19 de noviembre", "viernes, 20 de noviembre", "sábado, 21 de noviembre",
        "domingo, 22 de noviembre", "lunes, 23 de noviembre", "martes, 24 de noviembre",
        "miércoles, 25 de noviembre", "jueves, 26 de noviembre"]

import subprocess


def llenar(src_txt, dias):
    dia = lambda d: d.split(",")[0]
    return (src_txt.replace("{HOY}", dias[0]).replace("{MANANA}", dias[1])
            .replace("{D4N}", dia(dias[4])).replace("{D4T}", dia(dias[4]).capitalize()).replace("{D4}", dias[4])
            .replace("{D7N}", dia(dias[7])).replace("{D7}", dias[7]))


def esquema(horas):
    return {"type": "object", "required": ["tipo_nota", "pendientes"], "properties": {
        "tipo_nota": {"type": "string", "enum": ["estudio", "trabajo", "personal"]},
        "pendientes": {"type": "array", "items": {
        "type": "object", "required": ["tarea", "tipo", "dia", "hora", "prioridad"], "properties": {
            "tarea": {"type": "string"},
            "tipo": {"type": "string", "enum": ["compromiso", "plan_libre", "deseo", "ya_hecho"]},
            "dia": {"type": "string", "enum": DIAS + ["sin fecha"]},
            "hora": {"type": "string", "enum": horas + ["sin hora"]},
            "prioridad": {"type": "string", "enum": ["alta", "normal"]},
        }}}}}


def extraer(modelo, texto, ordenada, src):
    """Igual que ai_tasks (lib.rs): mismas constantes, mismo esquema."""
    horas = list(dict.fromkeys(re.findall(r"\[(\d{1,2}:\d{2} [AP]M)\]", texto)))
    k = lambda n: ev.constante(src, n)
    msgs = [
        {"role": "system", "content": k("TASKS_PROMPT").replace("{HOY}", ev.HOY)},
        {"role": "user", "content": llenar(k("TASKS_EX1_IN"), DIAS)},
        {"role": "assistant", "content": llenar(re.search(r'const TASKS_EX1_OUT: &str = r#"(.*?)"#;', src, re.S).group(1), DIAS)},
        {"role": "user", "content": llenar(k("TASKS_EX2_IN"), DIAS)},
        {"role": "assistant", "content": llenar(re.search(r'const TASKS_EX2_OUT: &str = r#"(.*?)"#;', src, re.S).group(1), DIAS)},
        {"role": "user", "content": k("TASKS_EX3_IN")},
        {"role": "assistant", "content": re.search(r'const TASKS_EX3_OUT: &str = r#"(.*?)"#;', src, re.S).group(1)},
        {"role": "user", "content": f"Apuntes:\n{texto}\n\nVersión ordenada:\n{ordenada}"},
    ]
    body = json.dumps({"model": modelo, "stream": False, "messages": msgs, "keep_alive": "30m",
                       "format": esquema(horas + ([] if "8:00 AM" in horas else ["8:00 AM"])),
                       "options": {"temperature": 0, "seed": 42, "top_k": 1, "num_ctx": 8192}}).encode()
    req = urllib.request.Request("http://localhost:11434/api/chat", body, {"Content-Type": "application/json"})
    return json.loads(json.load(urllib.request.urlopen(req, timeout=600))["message"]["content"]), horas


def armar(nota, datos, horas, texto=""):
    """mergeTasks de la app (src/aiTasks.ts), corrido con Node."""
    r = subprocess.run(["node", "--experimental-strip-types", "--no-warnings", str(Path(__file__).with_name("merge.mts"))],
                       input=json.dumps({"md": nota, "data": datos, "hours": horas, "text": texto}), capture_output=True, text=True, check=True)
    return r.stdout


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-m", "--modelo", default="qwen2.5:7b")
    ap.add_argument("-c", "--caso", action="append")
    ap.add_argument("-v", "--ver", action="store_true")
    ap.add_argument("--hoy", action="store_true", help="anotar también 'hoy [fecha]'")
    ap.add_argument("--casos", default=str(ev.CASOS), help="otro archivo de casos (p. ej. notas reales que NO van al repo)")
    ap.add_argument("-r", "--respuestas", help="reusar las notas (paso 1) ya guardadas con evaluar.py -g")
    a = ap.parse_args()
    ev.ANOTAR_HOY = a.hoy
    src = ev.LIB.read_text(encoding="utf-8")
    casos = json.loads(Path(a.casos).read_text(encoding="utf-8"))["casos"]
    if a.caso:
        casos = [c for c in casos if c["id"] in a.caso]
    previas = json.loads(Path(a.respuestas).read_text()) if a.respuestas else {}
    ok, t0 = 0, time.time()
    for c in casos:
        texto = ev.preparar(c["texto"])
        nota = previas.get(c["id"]) or ev.ollama(a.modelo, ev.mensajes(src, texto))
        sin_pend = re.split(r"\n##\s*📌?\s*Pendientes.*", nota, flags=re.S)[0].rstrip()
        pend, horas = extraer(a.modelo, texto, sin_pend, src)
        md = armar(nota, pend, horas, texto)
        fallas = ev.revisar(c, md)
        ok += not fallas
        print(("✅ " if not fallas else "❌ ") + c["id"])
        for f in fallas:
            print("     · " + f)
        if a.ver:
            print(json.dumps(pend, ensure_ascii=False, indent=1))
            print("\n" + md + "\n" + "-" * 60)
    print(f"\n{a.modelo} (dos pasos): {ok}/{len(casos)} casos sin fallas · {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()
