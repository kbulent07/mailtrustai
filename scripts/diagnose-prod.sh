#!/usr/bin/env bash
# ============================================================
# PRODUCTION TANILAMA — Docker container icinde IMAP monitor durumu
#   Kullanim:  sudo bash scripts/diagnose-prod.sh
# ============================================================
set -u

# Renkler
B='\033[1m'; G='\033[32m'; R='\033[31m'; Y='\033[33m'; C='\033[36m'; N='\033[0m'

# Otomatik sudo
if [ "$EUID" -ne 0 ]; then
    echo -e "${Y}>>>${N} sudo ile yeniden calistiriliyor..."
    exec sudo bash "$0" "$@"
fi

# Compose dosyasini otomatik tespit et
COMPOSE_FILE=""
for f in docker-compose.prod.yml docker-compose.prod.host-nginx.yml docker-compose.customer.yml docker-compose.yml; do
    if [ -f "$f" ]; then COMPOSE_FILE="$f"; break; fi
done
if [ -z "$COMPOSE_FILE" ]; then
    echo -e "${R}HATA:${N} compose dosyasi bulunamadi. Bu scripti /opt/mailtrustai/app icinden calistirin."
    exit 1
fi

# Servis adi tespiti (mailtrustai veya ilk service)
SERVICE=$(docker compose -f "$COMPOSE_FILE" config --services 2>/dev/null | grep -E '^mailtrustai' | head -1)
[ -z "$SERVICE" ] && SERVICE=$(docker compose -f "$COMPOSE_FILE" config --services 2>/dev/null | head -1)
[ -z "$SERVICE" ] && SERVICE="mailtrustai"

echo -e "${B}MailTrustAI Production Tanilama${N}"
echo "compose: $COMPOSE_FILE   |   service: $SERVICE"
echo "------------------------------------------------------------"

# ─── 1) Container durumu ────────────────────────────────────────────────
echo -e "\n${C}[1] Container durumu${N}"
docker compose -f "$COMPOSE_FILE" ps

# ─── 2) Image guncel mi? (son commit hash) ──────────────────────────────
echo -e "\n${C}[2] Container icindeki kod versiyonu vs HEAD${N}"
HOST_HEAD=$(git rev-parse --short HEAD 2>/dev/null || echo "?")
CTR_HAS_SCRIPT=$(docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE" sh -c "test -f scripts/diagnose-imap-monitors.js && echo YES || echo NO" 2>/dev/null | tr -d '\r' | tail -1)
echo "  host HEAD          : $HOST_HEAD"
echo "  container'da yeni script var mi? : $CTR_HAS_SCRIPT"
if [ "$CTR_HAS_SCRIPT" = "NO" ]; then
    echo -e "  ${Y}>>>${N} Container ESKI kodu calistiriyor. Build gerekli:"
    echo "      sudo docker compose -f $COMPOSE_FILE build --no-cache"
    echo "      sudo docker compose -f $COMPOSE_FILE up -d"
fi

# ─── 3) Son loglar — IMAP / Monitor / Error ─────────────────────────────
echo -e "\n${C}[3] Son loglar — IMAP / Monitor / Quarantine / Error${N}"
docker compose -f "$COMPOSE_FILE" logs --tail=500 "$SERVICE" 2>&1 \
    | grep -iE "ScanMailbox|AutoMonitor|Quarantine|IMAP|monitor|error" \
    | tail -40 || echo "  (eslesen log yok)"

# ─── 4) Container icinde tanilama scripti ───────────────────────────────
if [ "$CTR_HAS_SCRIPT" = "YES" ]; then
    echo -e "\n${C}[4] Container ici tanilama (diagnose-imap-monitors.js)${N}"
    docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE" node scripts/diagnose-imap-monitors.js
else
    echo -e "\n${C}[4] (Atlandi — container'da script yok, once build yapin)${N}"
fi

# ─── 5) Son tarama kayitlari (sqlite uzerinden) ─────────────────────────
echo -e "\n${C}[5] Son taramalarin yasi${N}"
docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE" sh -c '
    if [ -f /app/data/msa.db ]; then
        sqlite3 /app/data/msa.db "SELECT
            COALESCE(imap_email, user_key) AS k,
            datetime(MAX(timestamp)) AS son,
            COUNT(*) AS n
            FROM scan_history
            WHERE timestamp >= datetime(\"now\",\"-7 days\")
            GROUP BY k ORDER BY son DESC LIMIT 15;" 2>/dev/null || echo "  sqlite3 yok / DB yok"
    else
        echo "  /app/data/msa.db bulunamadi"
    fi
' 2>/dev/null || echo "  exec hata"

# ─── 6) Container uptime ────────────────────────────────────────────────
echo -e "\n${C}[6] Container uptime${N}"
docker inspect -f '  Restart sayisi: {{.RestartCount}}{{println}}  Started:      {{.State.StartedAt}}{{println}}  Status:       {{.State.Status}}' \
    "$(docker compose -f "$COMPOSE_FILE" ps -q "$SERVICE")" 2>/dev/null

echo -e "\n------------------------------------------------------------"
echo -e "${G}Tanilama tamam.${N} Cikti uzun ise: scripts/diagnose-prod.sh > /tmp/diag.txt 2>&1"
