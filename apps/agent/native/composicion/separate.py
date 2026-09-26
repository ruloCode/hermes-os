"""
Separación de voz por PASAJE + afinación y chroma del instrumento.

Lo corre el agente (apps/agent/src/composicion/separator.ts) con el python del
venv de audio-separator por ruta absoluta y un entorno SIN API keys. Carga el
modelo UNA vez y separa la lista de cortes en secuencia: la memoria queda
acotada al corte más largo (la sesión completa de 20 min pedía 8,6 GB).

Entrada (JSON en la PRIMERA LÍNEA de stdin; el agente deja stdin abierto como
latido y este proceso sale solo al recibir EOF, o sea si el agente murió):
  {"modelDir": str, "model": str,
   "items": [{"id": str, "input": str, "outDir": str,
              "trimStart": float, "trimDur": float}]}
  `input` es el corte CON relleno; `trimStart/trimDur` dicen qué tramo de ese
  corte es el pasaje real. Los stems finales (voz.wav, instrumento.wav) salen
  recortados al pasaje exacto: sus tiempos coinciden con los de mezcla.wav.

Salida: NDJSON por stdout, una línea por evento:
  {"event":"loading"} · {"event":"loaded","sec":..}
  {"event":"start","id":..}
  {"event":"done","id":..,"voice":path,"instrument":path,
   "tuningCents":int|null,"voiceTuningCents":int|null,"chroma":[12]|null,"sec":..}
  {"event":"error","id":..,"error":str}
  {"event":"end"}

Afinación: librosa.estimate_tuning devuelve FRACCIONES DE BIN. Con
bins_per_octave=12 es fracción de semitono (±0,5 = ±50 c, sin ambigüedad); el
chroma_cqt usa 36 bins por octava, así que recibe la afinación ×3. (Se midió
mal una vez con 36 bins y salió un cuarto de tono falso.)
"""
import json
import logging
import os
import sys
import threading
import time
import traceback


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def tuning_and_chroma(y, sr):
    """Afinación (cents) y perfil de 12 clases (suma 1) de un stem instrumental."""
    import numpy as np
    import librosa

    if y.size < sr // 2 or not np.isfinite(y).all() or float(np.abs(y).max()) < 1e-4:
        return None, None
    tun = float(librosa.estimate_tuning(y=y, sr=sr, bins_per_octave=12))
    C = librosa.feature.chroma_cqt(y=y, sr=sr, tuning=3 * tun, bins_per_octave=36, hop_length=512)
    # Solo cuadros con energía: la guitarra calla a ratos y el residuo de voz no debe votar.
    rms = librosa.feature.rms(y=y, hop_length=512)[0][: C.shape[1]]
    mask = rms > np.percentile(rms, 40)
    h = (C[:, mask] if mask.any() else C).mean(axis=1)
    total = float(h.sum())
    if not np.isfinite(total) or total <= 0:
        return round(100 * tun), None
    return round(100 * tun), [round(float(x) / total, 5) for x in h]


def voice_tuning(y, sr):
    import numpy as np
    import librosa

    if y.size < sr // 2 or float(np.abs(y).max()) < 1e-4:
        return None
    return round(100 * float(librosa.estimate_tuning(y=y, sr=sr, bins_per_octave=12)))


def load_mono(path):
    import soundfile as sf

    y, sr = sf.read(path, dtype="float32", always_2d=True)
    return y.mean(axis=1), sr


def watch_parent():
    """Bloquea en stdin hasta EOF: el agente murió o nos soltó. Salir sin más."""
    try:
        sys.stdin.read()
    except Exception:
        pass
    os._exit(3)


def main():
    job = json.loads(sys.stdin.readline())
    threading.Thread(target=watch_parent, daemon=True).start()
    emit({"event": "loading"})
    t0 = time.time()
    # Logs del paquete a stderr (el agente guarda solo la cola para los errores).
    from audio_separator.separator import Separator
    import soundfile as sf
    import librosa

    tmp_out = job["items"][0]["outDir"] if job["items"] else os.getcwd()
    sep = Separator(
        log_level=logging.WARNING,
        model_file_dir=job["modelDir"],
        output_dir=tmp_out,
        output_format="WAV",
        sample_rate=44100,
    )
    sep.load_model(model_filename=job["model"])
    emit({"event": "loaded", "sec": round(time.time() - t0, 1)})

    for item in job["items"]:
        pid = item["id"]
        t = time.time()
        emit({"event": "start", "id": pid})
        try:
            out_dir = item["outDir"]
            os.makedirs(out_dir, exist_ok=True)
            # El directorio de salida vive en el separador Y en la instancia del modelo.
            sep.output_dir = out_dir
            if getattr(sep, "model_instance", None) is not None:
                sep.model_instance.output_dir = out_dir
            # Sin "_" inicial: el paquete sanea los nombres y se lo come.
            names = {"vocals": "sep-voz-pad", "other": "sep-inst-pad", "instrumental": "sep-inst-pad"}
            sep.separate(item["input"], custom_output_names=names)
            voz_pad = os.path.join(out_dir, "sep-voz-pad.wav")
            inst_pad = os.path.join(out_dir, "sep-inst-pad.wav")
            if not os.path.exists(voz_pad):
                raise RuntimeError("el separador no escribió el stem de voz")

            start, dur = float(item["trimStart"]), float(item["trimDur"])
            result = {"event": "done", "id": pid}
            for src, dst, key in ((voz_pad, "voz.wav", "voice"), (inst_pad, "instrumento.wav", "instrument")):
                if not os.path.exists(src):
                    continue
                y, sr = load_mono(src)
                a = max(0, int(round(start * sr)))
                b = min(len(y), a + int(round(dur * sr)))
                seg = y[a:b]
                final = os.path.join(out_dir, dst)
                part = os.path.join(out_dir, "." + dst + ".part.wav")
                sf.write(part, seg, sr, subtype="PCM_16")
                os.replace(part, final)
                os.remove(src)
                result[key] = final
                y22 = librosa.resample(seg, orig_sr=sr, target_sr=22050) if sr != 22050 else seg
                if key == "instrument":
                    tun, chroma = tuning_and_chroma(y22, 22050)
                    result["tuningCents"] = tun
                    result["chroma"] = chroma
                else:
                    result["voiceTuningCents"] = voice_tuning(y22, 22050)
            result["sec"] = round(time.time() - t, 2)
            emit(result)
        except Exception as err:  # un pasaje que falla no tumba la lista
            traceback.print_exc(file=sys.stderr)
            emit({"event": "error", "id": pid, "error": str(err)[:300]})
    emit({"event": "end"})


if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        traceback.print_exc(file=sys.stderr)
        emit({"event": "fatal", "error": str(err)[:300]})
        sys.exit(1)
