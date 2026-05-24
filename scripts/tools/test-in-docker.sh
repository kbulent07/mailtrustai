#!/usr/bin/env bash
# ============================================================
# MailTrustAI — DETAYLI DOCKER TEST KOŞUMU
#
# 6 aşamalı test:
#   1) Test image build (Dockerfile.test)
#   2) Tüm test suite Docker içinde (unit + integration + security)
#   3) Host'ta check-customer-package (repo scope)
#   4) Customer image build — image build gate'i kontrol eder
#   5) Dealer image build
#   6) License-server image build
#
# Kullanım:
#   sudo bash scripts/test-in-docker.sh           # tüm aşamalar
#   sudo bash scripts/test-in-docker.sh --quick   # 1+2 (sadece testler)
#   sudo bash scripts/test-in-docker.sh --images  # 4+5+6 (sadece image build)
#
# Sonuçlar:
#   logs/test-in-docker-YYYYMMDD-HHMMSS.log
# ============================================================
set -u

# Renkler
G='\033[32m'; R='\033[31m'; Y='\033[33m'; C='\033[36m'; B='\033[1m'; N='\033[0m'

# Otomatik sudo (docker daemon erişimi için)
if [ "$EUID" -ne 0 ]; then
    echo -e "${Y}>>>${N} sudo ile yeniden çalıştırılıyor..."
    exec sudo bash "$0" "$@"
fi

MODE="${1:-all}"
TS=$(date +%Y%m%d-%H%M%S)
LOG_DIR="logs"
mkdir -p "$LOG_DIR"
LOG_FILE="${LOG_DIR}/test-in-docker-${TS}.log"

# Hata sayacı
FAIL_COUNT=0
RESULTS=()

run_stage() {
    local name="$1"; shift
    local cmd="$*"
    echo -e "\n${B}${C}═══ $name ═══${N}"
    echo "[$(date +%H:%M:%S)] STAGE: $name" >> "$LOG_FILE"
    echo "CMD: $cmd" >> "$LOG_FILE"
    local t0=$(date +%s)
    if eval "$cmd" 2>&1 | tee -a "$LOG_FILE"; then
        local dt=$(( $(date +%s) - t0 ))
        echo -e "${G}✓ $name başarılı (${dt}s)${N}"
        RESULTS+=("PASS  $name  (${dt}s)")
        return 0
    else
        local dt=$(( $(date +%s) - t0 ))
        echo -e "${R}✗ $name başarısız (${dt}s)${N}"
        RESULTS+=("FAIL  $name  (${dt}s)")
        FAIL_COUNT=$((FAIL_COUNT + 1))
        return 1
    fi
}

# Banner
echo -e "${B}MailTrustAI — Detaylı Docker Test Koşumu${N}"
echo -e "Mod: ${MODE}   |   Log: ${LOG_FILE}"
echo "============================================================"
echo "[$(date)] BAŞLANGIÇ — mode=${MODE}" >> "$LOG_FILE"

# ─── Hangi aşamalar koşacak? ─────────────────────────────────────────────────
WANT_TESTS=1
WANT_HOST_CHECK=1
WANT_IMAGES=1
case "$MODE" in
    --quick|quick)   WANT_IMAGES=0 ;;
    --images|images) WANT_TESTS=0; WANT_HOST_CHECK=0 ;;
    all|--all|"")    ;;
    *) echo -e "${R}Bilinmeyen mod: $MODE${N}"; exit 2 ;;
esac

# ─── 1) Test image build ─────────────────────────────────────────────────────
if [ $WANT_TESTS -eq 1 ]; then
    run_stage "1) Test runner image build" \
        "docker compose -f docker-compose.test.yml build test"

    # ─── 2) Tüm test suite Docker içinde ─────────────────────────────────────
    run_stage "2) Tüm test suite (unit + integration + security)" \
        "docker compose -f docker-compose.test.yml run --rm test"
fi

# ─── 3) Host'ta check-customer-package (repo scope) ──────────────────────────
if [ $WANT_HOST_CHECK -eq 1 ]; then
    run_stage "3) check-customer-package (repo scope)" \
        "node scripts/check-customer-package.js"
fi

# ─── 4) Customer image build ─────────────────────────────────────────────────
if [ $WANT_IMAGES -eq 1 ]; then
    run_stage "4) Customer image build (--scope=image gate dahil)" \
        "docker build -f apps/customer/Dockerfile -t mailtrustai-customer:test ."

    # ─── 5) Dealer image build ────────────────────────────────────────────────
    run_stage "5) Dealer image build" \
        "docker build -f apps/dealer/Dockerfile -t mailtrustai-dealer:test ."

    # ─── 6) License-server image build ────────────────────────────────────────
    run_stage "6) License-server image build" \
        "docker build -f apps/license-server/Dockerfile -t mailtrustai-license-server:test ."

    # ─── 7) Customer image security audit ─────────────────────────────────────
    # Image içinde fiziksel olarak dealer/license-server/keygen dosyaları yok mu?
    echo -e "\n${B}${C}═══ 7) Customer image içerik denetimi ═══${N}"
    {
        echo "Customer image içinde olmaması gereken yolların kontrolü:"
        FORBIDDEN=(
            "/app/apps/dealer"
            "/app/apps/license-server"
            "/app/packages/license-core"
            "/app/src/license/license-generator.js"
            "/app/src/license/keygenTool.js"
            "/app/src/routes/dealerApi.js"
            "/app/public/bayi.html"
            "/app/public/keygen.html"
        )
        LEAK_COUNT=0
        for p in "${FORBIDDEN[@]}"; do
            if docker run --rm --entrypoint sh mailtrustai-customer:test -c "test -e $p && echo SIZAN || echo TEMIZ" 2>/dev/null | grep -q SIZAN; then
                echo -e "  ${R}✗ SIZINTI:${N} $p customer image'da bulundu"
                LEAK_COUNT=$((LEAK_COUNT + 1))
            else
                echo -e "  ${G}✓${N} $p — yok"
            fi
        done
        if [ $LEAK_COUNT -eq 0 ]; then
            echo -e "\n${G}✓ Customer image temiz — sızıntı yok${N}"
            RESULTS+=("PASS  7) Customer image içerik denetimi")
        else
            echo -e "\n${R}✗ Customer image'da ${LEAK_COUNT} sızıntı bulundu${N}"
            RESULTS+=("FAIL  7) Customer image içerik denetimi  (${LEAK_COUNT} sızıntı)")
            FAIL_COUNT=$((FAIL_COUNT + 1))
        fi
    } | tee -a "$LOG_FILE"
fi

# ─── Özet ────────────────────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo -e "${B}ÖZET${N}"
echo "============================================================"
for r in "${RESULTS[@]}"; do
    if [[ "$r" == PASS* ]]; then
        echo -e "  ${G}$r${N}"
    else
        echo -e "  ${R}$r${N}"
    fi
done
echo ""
echo -e "Log: ${LOG_FILE}"

if [ $FAIL_COUNT -eq 0 ]; then
    echo -e "${G}${B}TÜM AŞAMALAR BAŞARILI ✓${N}"
    exit 0
else
    echo -e "${R}${B}${FAIL_COUNT} AŞAMA BAŞARISIZ ✗${N}"
    exit 1
fi
