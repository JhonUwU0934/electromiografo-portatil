# EMG Web — Electromiógrafo portátil (interfaz web)

Versión web del visualizador EMG de la tesis. Reemplaza la app de escritorio
(PyQtGraph) por una página web, manteniendo **exactamente** la misma cadena de
filtros (scipy) del prototipo. El ESP32 transmite por Wi-Fi (UDP) y la página
muestra la señal cruda y la envolvente en tiempo real.

```
ESP32 ──UDP:5005 (Wi-Fi)──►  Servidor (FastAPI):
                              recibe UDP → filtra (scipy) → WebSocket
                                                        │
                                                        ▼
                                          Navegador (uPlot): raw + envolvente,
                                          controles, cursores Δt/ΔV, estado
```

## Procesamiento (idéntico al código original)
1. Notch 50 Hz (interferencia de red)
2. Pasa-banda 20–450 Hz (Butterworth orden 4)
3. Rectificación (valor absoluto)
4. Pasa-bajas 10 Hz (envolvente lineal)

## Modos
- `EMG_SOURCE=fake` (default): emulador integrado, señal sintética. Funciona **sin** el ESP32.
- `EMG_SOURCE=udp`: escucha al ESP32 real en el puerto 5005.

## Correr local
```bash
python -m venv .venv
. .venv/bin/activate           # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python server.py               # abre http://localhost:8000
```

## Variables de entorno
| Variable | Default | Descripción |
|---|---|---|
| `EMG_SOURCE` | `fake` | `fake` (emulador) o `udp` (ESP32 real) |
| `EMG_UDP_PORT` | `5005` | puerto UDP de escucha |
| `EMG_WEB_HOST` | `0.0.0.0` | host del servidor web |
| `EMG_WEB_PORT` | `8000` | puerto del servidor web |

## Deploy en EC2
Ver `deploy.sh` y `emgweb.service`. Resumen:
1. Subir el código al server.
2. Crear venv + instalar requirements.
3. Abrir en el **Security Group** de AWS: TCP `8000` (web) y UDP `5005` (ESP32).
4. Instalar el servicio systemd y arrancar.
5. Apuntar el ESP32 a la IP pública del server (ver `ESP32.md`).
