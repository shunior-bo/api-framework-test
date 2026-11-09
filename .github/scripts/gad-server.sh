#!/usr/bin/env bash
# Starts, stops and resets the GAD server used by CI jobs and by the agents.
#
#   bash .github/scripts/gad-server.sh start      # start GAD in the background, wait for /api/health
#   bash .github/scripts/gad-server.sh stop       # stop it (no-op if not running)
#   bash .github/scripts/gad-server.sh restart    # stop + start (after changing GAD code)
#   bash .github/scripts/gad-server.sh health     # print /api/health (exit 1 if down)
#   bash .github/scripts/gad-server.sh reset-db   # stop, then restore GAD's tracked db/ files from git
#
# Environment: GAD_DIR (default: gad), GAD_PORT (default: 3000),
#              GAD_LOG (default: .agent-work/gad.log), GAD_PID (default: .agent-work/gad.pid).
#
# Agents may run this script but not `node`/`kill` directly: the allow rule is
# `Bash(bash .github/scripts/gad-server.sh *)`. It never calls restoreDB/debug endpoints.
set -euo pipefail

GAD_DIR="${GAD_DIR:-gad}"
GAD_PORT="${GAD_PORT:-3000}"
GAD_LOG="${GAD_LOG:-.agent-work/gad.log}"
GAD_PID="${GAD_PID:-.agent-work/gad.pid}"
HEALTH_URL="http://localhost:${GAD_PORT}/api/health"

mkdir -p "$(dirname "$GAD_LOG")" "$(dirname "$GAD_PID")"
GAD_LOG="$(realpath -m "$GAD_LOG")"
GAD_PID="$(realpath -m "$GAD_PID")"

health() {
  curl -sf "$HEALTH_URL"
}

stop() {
  if [ -f "$GAD_PID" ]; then
    pid="$(cat "$GAD_PID")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 20); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.5
      done
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$GAD_PID"
  fi
  echo "GAD stopped"
}

start() {
  if health > /dev/null 2>&1; then
    echo "GAD already answers on ${HEALTH_URL}"
    return 0
  fi
  if [ ! -f "${GAD_DIR}/server.js" ]; then
    echo "No GAD checkout at ${GAD_DIR}" >&2
    exit 1
  fi
  # A single backgrounded command with all std streams redirected, so no
  # background shell keeps the caller's stdout open (a CI step would hang).
  (cd "$GAD_DIR" && PORT="$GAD_PORT" nohup node server.js > "$GAD_LOG" 2>&1 < /dev/null & echo $! > "$GAD_PID")
  for i in $(seq 1 60); do
    if health > /dev/null 2>&1; then
      echo "GAD is healthy after ${i}s (pid $(cat "$GAD_PID"), log ${GAD_LOG})"
      return 0
    fi
    sleep 1
  done
  echo "GAD did not answer ${HEALTH_URL} within 60s; last log lines:" >&2
  tail -n 40 "$GAD_LOG" >&2 || true
  exit 1
}

reset_db() {
  stop
  # GAD persists data into tracked files under db/. Put them back so they are
  # never committed and every run starts from the seed data.
  git -C "$GAD_DIR" checkout -- db
  git -C "$GAD_DIR" clean -fdq -- db
  echo "GAD db/ restored from git"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  health) health; echo ;;
  reset-db) reset_db ;;
  *)
    echo "usage: $0 start|stop|restart|health|reset-db" >&2
    exit 2
    ;;
esac
