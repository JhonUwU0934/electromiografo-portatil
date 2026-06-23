"""
Servidor web del electromiógrafo (puente UDP -> WebSocket).

Hace exactamente lo que hacía la app de escritorio en PyQtGraph, pero headless:
  - Recibe los paquetes UDP del ESP32 (mismo formato "<I I H 25h").
  - Aplica los MISMOS filtros scipy (ver dsp.py).
  - Sirve la página web y transmite raw + envolvente por WebSocket.

Modos (variable de entorno EMG_SOURCE):
  - fake : emulador integrado (mock). Genera la misma señal sintética del código
           original. Sirve para probar todo SIN el ESP32 físico.
  - udp  : escucha al ESP32 real en EMG_UDP_PORT (default 5005).

Config por entorno:
  EMG_SOURCE   = fake | udp        (default: fake)
  EMG_UDP_PORT = 5005
  EMG_WEB_HOST = 0.0.0.0
  EMG_WEB_PORT = 8000
"""

import asyncio
import json
import os
import struct
import time
from collections import deque
from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from dsp import FS, EmgFilter

# ---------------- CONFIG ----------------
SOURCE = os.environ.get("EMG_SOURCE", "fake").lower()
UDP_PORT = int(os.environ.get("EMG_UDP_PORT", 5005))

WINDOW_SEC = 20
BUFFER_SIZE = FS * WINDOW_SEC

SNAPSHOT_SEC = 5                  # histórico que se envía al cliente nuevo (acotado: el snapshot de 20 s pasa 1 MB y rompe el WS por el túnel)
SNAPSHOT_N = FS * SNAPSHOT_SEC

SAMPLES_PER_PACKET = 25
PACKET_FMT = "<I I H {}h".format(SAMPLES_PER_PACKET)
PACKET_SIZE = struct.calcsize(PACKET_FMT)

FLUSH_MS = 30          # cadencia de envío al navegador (igual al timer de 30 ms del original)
SIGNAL_TIMEOUT = 1.0   # s sin paquetes -> "SIN SEÑAL"
HERE = os.path.dirname(os.path.abspath(__file__))


# ---------------- ESTADO COMPARTIDO ----------------
class State:
    def __init__(self):
        self.filter = EmgFilter()
        self.raw = deque(maxlen=BUFFER_SIZE)   # histórico para snapshot a clientes nuevos
        self.filt = deque(maxlen=BUFFER_SIZE)
        self.pending_raw = []                  # acumulado desde el último flush
        self.pending_filt = []
        self.last_seq = None
        self.lost = 0
        self.last_packet_time = 0.0
        self.clients = set()

    def process(self, samples_int16):
        """Filtra un bloque y lo encola para el histórico y el próximo flush."""
        samples = np.asarray(samples_int16, dtype=np.float64)
        filtered = self.filter.apply(samples)
        r = samples.tolist()
        f = filtered.tolist()
        self.raw.extend(r)
        self.filt.extend(f)
        self.pending_raw.extend(r)
        self.pending_filt.extend(f)
        self.last_packet_time = time.time()

    def track_seq(self, seq):
        if self.last_seq is not None and seq != self.last_seq + 1:
            diff = seq - self.last_seq - 1
            if diff > 0:
                self.lost += diff
        self.last_seq = seq

    def status(self):
        return "OK" if (time.time() - self.last_packet_time) < SIGNAL_TIMEOUT else "SIN SEÑAL"


state = State()


# ---------------- RECEPTOR UDP (ESP32 real) ----------------
class UdpProtocol(asyncio.DatagramProtocol):
    def datagram_received(self, data, addr):
        if len(data) < PACKET_SIZE:
            return
        unpacked = struct.unpack(PACKET_FMT, data[:PACKET_SIZE])
        seq = unpacked[0]
        count = unpacked[2]
        samples = unpacked[3:3 + count]
        state.track_seq(seq)
        state.process(samples)


# ---------------- EMULADOR (mock, misma señal del código original) ----------------
async def emulator():
    seq = 0
    dt = SAMPLES_PER_PACKET / FS
    while True:
        t = np.arange(SAMPLES_PER_PACKET) / FS
        samples = (
            1000 * np.random.randn(SAMPLES_PER_PACKET)
            + 300 * np.sin(2 * np.pi * 50 * t)
            + 200 * np.sin(2 * np.pi * 120 * t)
        ).astype(np.int16)
        state.track_seq(seq)
        state.process(samples)
        seq += 1
        await asyncio.sleep(dt)


# ---------------- BROADCASTER (flush periódico a los navegadores) ----------------
async def broadcaster():
    while True:
        await asyncio.sleep(FLUSH_MS / 1000.0)
        raw, state.pending_raw = state.pending_raw, []
        filt, state.pending_filt = state.pending_filt, []
        payload = json.dumps({
            "type": "chunk",
            "raw": [int(v) for v in raw],
            "filt": [round(v, 3) for v in filt],
            "lost": state.lost,
            "status": state.status(),
            "mode": SOURCE,
        })
        if not state.clients:
            continue
        dead = []
        for ws in state.clients:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            state.clients.discard(ws)


# ---------------- APP ----------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    loop = asyncio.get_running_loop()
    transport = None
    tasks = [asyncio.create_task(broadcaster())]
    if SOURCE == "udp":
        transport, _ = await loop.create_datagram_endpoint(
            UdpProtocol, local_addr=("0.0.0.0", UDP_PORT)
        )
        print(f"[EMG] Modo UDP: escuchando al ESP32 en 0.0.0.0:{UDP_PORT}")
    else:
        tasks.append(asyncio.create_task(emulator()))
        print("[EMG] Modo EMULADOR (mock): generando señal sintética")
    try:
        yield
    finally:
        for tsk in tasks:
            tsk.cancel()
        if transport is not None:
            transport.close()


# docs/openapi deshabilitados: superficie pública read-only de demo, sin necesidad de Swagger
app = FastAPI(title="EMG Web", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/")
async def index():
    return FileResponse(os.path.join(HERE, "static", "index.html"))


@app.get("/health")
async def health():
    return {"mode": SOURCE, "status": state.status(), "lost": state.lost, "fs": FS}


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    # snapshot inicial para que el cliente nuevo arranque con la ventana llena
    snap_raw = list(state.raw)[-SNAPSHOT_N:]
    snap_filt = list(state.filt)[-SNAPSHOT_N:]
    await ws.send_text(json.dumps({
        "type": "init",
        "fs": FS,
        "window_max": WINDOW_SEC,
        "samples_per_packet": SAMPLES_PER_PACKET,
        "mode": SOURCE,
        "raw": [int(v) for v in snap_raw],
        "filt": [round(v, 3) for v in snap_filt],
    }))
    state.clients.add(ws)
    try:
        while True:
            await ws.receive_text()  # mantiene viva la conexión; ignoramos el contenido
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        state.clients.discard(ws)


app.mount("/static", StaticFiles(directory=os.path.join(HERE, "static")), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "server:app",
        host=os.environ.get("EMG_WEB_HOST", "0.0.0.0"),
        port=int(os.environ.get("EMG_WEB_PORT", 8000)),
        log_level="info",
    )
