#!/usr/bin/env bash
# actualizar.sh — trae la última versión, recompila y reinicia el backend.
# Uso: bash actualizar.sh [--forzar]   (--forzar recompila aunque no haya nada nuevo)
#
# El front (oficina/) no se compila: el backend lo sirve tal cual desde el repo,
# así que con el pull ya queda al día (a lo sumo hay que recargar el navegador).
set -euo pipefail
export GIT_PAGER=cat

# Todo va entre llaves: bash lee el bloque entero antes de ejecutarlo, así un
# git pull que cambie este archivo no rompe la corrida en curso.
{

cd "$(dirname "$0")"
RAIZ=$(pwd)
LOG="$RAIZ/backend.log"
SERVICIO=cherry-office.service
# Commit con el que se compiló dist/ por última vez (dist/ está en .gitignore).
MARCA="$RAIZ/backend/dist/.commit"

FORZAR=0
[ "${1:-}" = "--forzar" ] && FORZAR=1

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Hay cambios locales en archivos del repo. Guardalos o descartalos antes de actualizar:"
  git status --short --untracked-files=no
  exit 1
fi

antes=$(git rev-parse HEAD)
echo "Buscando cambios…"
git pull --ff-only
despues=$(git rev-parse HEAD)

if [ "$antes" != "$despues" ]; then
  echo "Cambios nuevos:"
  git --no-pager log --oneline "$antes..$despues"
fi

# --- HQ_HOSTS ---
# Si la máquina se publica con `tailscale serve`, el backend tiene que aceptar ese
# nombre (HQ_HOSTS). Se toma de `tailscale serve status` y, si el servicio no lo
# tiene, se agrega con un drop-in de systemd y se reinicia aunque no haya cambios.
TS_HOST=$(tailscale serve status 2>/dev/null | sed -n '1s|^https://\([^ /:]*\).*|\1|p' || true)
if [ -n "$TS_HOST" ] && systemctl --user cat "$SERVICIO" >/dev/null 2>&1; then
  hosts=$(systemctl --user show -p Environment --value "$SERVICIO" | tr ' ' '\n' | sed -n 's/^HQ_HOSTS=//p')
  if ! printf '%s\n' "${hosts//,/$'\n'}" | grep -qxF "$TS_HOST"; then
    nuevos=${hosts:+$hosts,}$TS_HOST
    echo "Agregando HQ_HOSTS=$nuevos a $SERVICIO (para entrar por https://$TS_HOST)…"
    dropin="$HOME/.config/systemd/user/$SERVICIO.d"
    mkdir -p "$dropin"
    printf '[Service]\nEnvironment=HQ_HOSTS=%s\n' "$nuevos" > "$dropin/hq-hosts.conf"
    systemctl --user daemon-reload
    FORZAR=1
  fi
fi

# Se compila si lo que hay en dist/ no corresponde al commit actual, aunque el
# pull no haya traído nada (por ejemplo, si se hizo el pull a mano antes).
compilado=$(cat "$MARCA" 2>/dev/null || true)
if [ "$compilado" = "$despues" ] && [ "$FORZAR" = 0 ]; then
  echo "Ya estás en la última versión ($(git describe --tags --always)) y está compilada."
  echo "Para recompilar y reiniciar igual: bash actualizar.sh --forzar"
  exit 0
fi

echo "Instalando dependencias del backend…"
npm ci --prefix backend

echo "Compilando…"
(cd backend && npx tsc)
echo "$despues" > "$MARCA"

# --- Reinicio ---
PUERTO=8765

if systemctl --user cat "$SERVICIO" >/dev/null 2>&1; then
  # Lo maneja systemd: reiniciarlo por ahí (si lo matáramos a mano, systemd lo
  # vuelve a levantar y queda peleando por el puerto con el nuestro).
  p=$(systemctl --user show -p Environment --value "$SERVICIO" | tr ' ' '\n' | sed -n 's/^PORT=//p')
  [ -n "$p" ] && PUERTO=$p
  echo "Reiniciando $SERVICIO…"
  systemctl --user restart "$SERVICIO"
  vivo() { systemctl --user is-active --quiet "$SERVICIO"; }
  donde="journalctl --user -u $SERVICIO"
  ultimas() { journalctl --user -u "$SERVICIO" -n 30 --no-pager; }
else
  PID=$(pgrep -f "node .*dist/src/dev.js" | head -n1 || true)
  VARS=()
  if [ -n "$PID" ]; then
    # copiar la configuración del proceso viejo (PORT, HQ_*, CLAUDE_BIN)
    if [ -r "/proc/$PID/environ" ]; then
      while IFS= read -r linea; do [ -n "$linea" ] && VARS+=("$linea"); done < <(
        tr '\0' '\n' < "/proc/$PID/environ" | grep -E '^(PORT|CLAUDE_BIN|HQ_[A-Z_]*)=' || true
      )
    fi
    echo "Apagando el backend (pid $PID)…"
    kill "$PID"
    for _ in $(seq 1 10); do kill -0 "$PID" 2>/dev/null || break; sleep 1; done
    kill -0 "$PID" 2>/dev/null && kill -9 "$PID"
  else
    echo "No había un backend corriendo; lo arranco."
  fi
  for v in ${VARS[@]+"${VARS[@]}"}; do case "$v" in PORT=*) PUERTO="${v#PORT=}";; esac; done
  # sin systemd: si el proceso viejo no traía HQ_HOSTS, usar el nombre de tailscale serve
  if [ -n "$TS_HOST" ] && ! printf '%s\n' ${VARS[@]+"${VARS[@]}"} | grep -q '^HQ_HOSTS='; then
    VARS+=("HQ_HOSTS=$TS_HOST")
  fi

  echo "Arrancando el backend…"
  (cd "$RAIZ/backend" && nohup env ${VARS[@]+"${VARS[@]}"} node dist/src/dev.js >> "$LOG" 2>&1 &)
  sleep 1
  NUEVO=$(pgrep -n -f "node dist/src/dev.js" || true)
  vivo() { [ -n "$NUEVO" ] && kill -0 "$NUEVO" 2>/dev/null; }
  donde="$LOG"
  ultimas() { tail -n 30 "$LOG"; }
fi

for _ in $(seq 1 30); do
  if ! vivo; then
    echo "El backend se cayó al arrancar. Últimas líneas ($donde):"
    ultimas
    exit 1
  fi
  codigo=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PUERTO/" || true)
  if [ "$codigo" != "000" ]; then
    echo
    echo "Listo: $(git describe --tags --always), corriendo en http://localhost:$PUERTO."
    echo "Logs: $donde"
    exit 0
  fi
  sleep 1
done

echo "El backend arrancó pero no responde en el puerto $PUERTO después de 30 s. Mirá $donde."
exit 1
}
