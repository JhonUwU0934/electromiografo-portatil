# Cómo apuntar el ESP32 al servidor

El servidor escucha paquetes UDP en el **puerto 5005** con este formato (little-endian):

```
<I  I  H  25h>
 │  │  │   └── 25 muestras int16 (la señal)
 │  │  └────── count  (uint16) = 25
 │  └───────── timestamp_ms (uint32)
 └──────────── seq (uint32, incremental — sirve para detectar paquetes perdidos)
```

Es **el mismo formato** que ya usa tu código Python. En el firmware solo hay que
cambiar la IP de destino a la **IP pública del servidor** (la del EC2) y dejar el
puerto en 5005.

## En el firmware (Arduino / ESP-IDF)
```cpp
const char* SERVER_IP = "3.134.100.242";  // IP pública del EC2
const uint16_t SERVER_PORT = 5005;

// ejemplo con WiFiUDP (Arduino)
WiFiUDP udp;
udp.beginPacket(SERVER_IP, SERVER_PORT);
udp.write((uint8_t*)&packet, sizeof(packet));  // packet = {seq, ts, count, 25 muestras}
udp.endPacket();
```

## Pasos de validación
1. En el servidor, correr en modo UDP:  `EMG_SOURCE=udp`
2. Asegurar que el **Security Group** de AWS tenga abierto **UDP 5005** (entrante).
3. Encender el ESP32 (conectado al músculo) — debe estar en una red con salida a internet.
4. Abrir la web del server: el badge debe pasar a **EN VIVO (ESP32)** y el estado a **OK**.
5. Contraer el bíceps: la envolvente (amarilla) debe subir; en reposo, plana.

> Nota: si el ESP32 está detrás de un router doméstico, el envío UDP saliente
> normalmente funciona sin configurar nada. No requiere abrir puertos en TU router
> (solo en el Security Group del servidor, que es el que recibe).
