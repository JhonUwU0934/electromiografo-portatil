#!/usr/bin/env bash
# Despliega EMG Web al servidor EC2.
# Uso:  ./deploy.sh
# Requiere: la clave PEM y el host configurados abajo.
set -euo pipefail

KEY="${EMG_PEM:-/c/Users/PC/Desktop/Universidad/proytesis2211/PemElectro.pem}"
HOST="${EMG_HOST:-ubuntu@3.134.100.242}"
REMOTE_DIR="/home/ubuntu/emgweb"

SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "==> Copiando código a $HOST:$REMOTE_DIR"
$SSH "$HOST" "mkdir -p $REMOTE_DIR/static"
scp -i "$KEY" "$HERE/server.py" "$HERE/dsp.py" "$HERE/requirements.txt" "$HOST:$REMOTE_DIR/"
scp -i "$KEY" "$HERE/static/index.html" "$HERE/static/app.js" "$HERE/static/style.css" "$HOST:$REMOTE_DIR/static/"
scp -i "$KEY" "$HERE/emgweb.service" "$HOST:$REMOTE_DIR/"

echo "==> Creando venv e instalando dependencias"
$SSH "$HOST" "cd $REMOTE_DIR && python3 -m venv .venv && ./.venv/bin/pip install --quiet --upgrade pip && ./.venv/bin/pip install --quiet -r requirements.txt"

echo "==> Instalando servicio systemd"
$SSH "$HOST" "sudo cp $REMOTE_DIR/emgweb.service /etc/systemd/system/emgweb.service && sudo systemctl daemon-reload && sudo systemctl enable --now emgweb"

echo "==> Estado:"
$SSH "$HOST" "sudo systemctl --no-pager status emgweb | head -12"
echo "==> Listo. Web: http://${HOST#ubuntu@}:8000"
echo "    (recordá abrir TCP 8000 y UDP 5005 en el Security Group de AWS)"
