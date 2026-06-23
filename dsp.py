"""
Núcleo de procesamiento de señal EMG.

Reusa EXACTAMENTE la cadena de filtros del prototipo de escritorio (PyQtGraph):
    1. Notch 50 Hz   -> elimina interferencia de red eléctrica
    2. Pasa-banda 20-450 Hz (Butterworth orden 4) -> banda útil del EMG
    3. Rectificación (valor absoluto)
    4. Pasa-bajas 10 Hz (Butterworth orden 4) -> envolvente lineal

Se mantiene el estado (zi) entre bloques para que el filtrado en streaming sea
idéntico a procesar la señal completa de corrido. No se cambia ningún coeficiente
respecto al código original de la tesis: la señal sale numéricamente igual.
"""

import numpy as np
from scipy.signal import butter, lfilter, iirnotch

FS = 2000  # Hz, frecuencia de muestreo del ESP32


def design_filters(fs=FS):
    b_notch, a_notch = iirnotch(50, 30, fs)
    b_band, a_band = butter(4, [20 / (fs / 2), 450 / (fs / 2)], btype="band")
    b_low, a_low = butter(4, 10 / (fs / 2), btype="low")
    return (b_notch, a_notch), (b_band, a_band), (b_low, a_low)


class EmgFilter:
    """Filtro EMG con estado, para aplicar bloque a bloque sobre el stream."""

    def __init__(self, fs=FS):
        self.notch, self.band, self.low = design_filters(fs)
        self.zi_notch = np.zeros(max(len(self.notch[0]), len(self.notch[1])) - 1)
        self.zi_band = np.zeros(max(len(self.band[0]), len(self.band[1])) - 1)
        self.zi_low = np.zeros(max(len(self.low[0]), len(self.low[1])) - 1)

    def apply(self, data):
        data = np.asarray(data, dtype=np.float64)
        y, self.zi_notch = lfilter(self.notch[0], self.notch[1], data, zi=self.zi_notch)
        y, self.zi_band = lfilter(self.band[0], self.band[1], y, zi=self.zi_band)
        y = np.abs(y)
        y, self.zi_low = lfilter(self.low[0], self.low[1], y, zi=self.zi_low)
        return y

    def reset(self):
        self.zi_notch[:] = 0
        self.zi_band[:] = 0
        self.zi_low[:] = 0
