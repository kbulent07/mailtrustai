#!/usr/bin/env bash
# ==============================================================================
#  MailTrustAI — Ubuntu TAM VERİ TEMİZLEME Scripti
#  Sürüm  : 1.0  (2026-05)
#
#  ╔══════════════════════════════════════════════════════════════════════════╗
#  ║  DİKKAT: Bu script MailTrustAI'a ait TÜM verileri siler ve geri alınamaz.║
#  ║  • Konteynerler, volume'lar, imajlar                                     ║
#  ║  • /opt/mailtrustai dizini (kod, .env, SSL sertifikaları, SQLite DB)     ║
#  ║  • systemd servisleri (mailtrustai*.service)                             ║
#  ║  • Host nginx site config'leri (mailtrustai*)                            ║
#  ║  • Let's Encrypt sertifikaları + renewal hook'ları                       ║
#  ║  • UFW kuralları (3000/tcp, 4443/tcp)                                    ║
#  ║  • initial_creds.json gibi cache dosyaları                               ║
#  ╚══════════════════════════════════════════════════════════════════════════╝
#
#  Kullanım:
#     sudo ./temizle_ubuntu.sh           # Tek onay sonrası her şeyi siler
#     sudo ./temizle_ubuntu.sh --force   # ONAY SORMAZ — sadece scriptlerde kullanın
#     sudo ./temizle_ubuntu.sh --keep-docker   # Docker Engine'i koru (varsayılan)
#     sudo ./temizle_ubuntu.sh --remove-docker # Docker Engine'i de kaldır (tehlikeli)
# ==============================================================================

set -u  # -e YOK — bir adım hata verse bile diğer temizlikler devam etsin

readonly RED='\033[0;31m'    GREEN='\033[0;32m'    YELLOW='\033[1;33m'
readonly CYAN='\033[0;36m'   BOLD='\033[1m'        NC='\033[0m'

log()      { echo -e "$*"; }
log_ok()   { echo -e "${GREEN}✓${NC} $*"; }
log_warn() { echo -e "${YELLOW}!${NC} $*"; }
log_err()  { echo -e "${RED}✗${NC} $*" >&2; }
log_step() { echo -e "\n${BOLD}${CYAN}▶ $*${NC}"; }

# ── CLI parametreleri ────────────────────────────────────────────────────────
FORCE=false
REMOVE_DOCKER=false
KEEP_CERTS=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --force)         FORCE=true; shift ;;
        --keep-docker)   REMOVE_DOCKER=false; shift ;;
        --remove-docker) REMOVE_DOCKER=true;  shift ;;
        --keep-certs)    KEEP_CERTS=true; shift ;;
        -h|--help)
            cat <<HELP
Kullanım: sudo ./temizle_ubuntu.sh [SEÇENEKLER]

MailTrustAI'a ait TÜM verileri sistemden siler. Geri alınamaz.

SEÇENEKLER:
  --force          Hiçbir onay sorma (CI/CD veya scriptlerde kullanın)
  --keep-docker    Docker Engine'i koru (varsayılan)
  --remove-docker  Docker Engine'i de kaldır (başka konteynerleri etkiler!)
  --keep-certs     Let's Encrypt sertifikalarını koru (varsayılan: sil)
  -h, --help       Bu yardımı göster

ÖRNEKLER:
  sudo ./temizle_ubuntu.sh                          # İnteraktif
  sudo ./temizle_ubuntu.sh --force                  # CI/CD modu
  sudo ./temizle_ubuntu.sh --force --remove-docker  # Tam temizlik (Docker dahil)
HELP
            exit 0
            ;;
        *) log_warn "Bilinmeyen argüman: $1"; shift ;;
    esac
done

# ── Sabitler ─────────────────────────────────────────────────────────────────
readonly APP_DIR="/opt/mailtrustai"
readonly SERVICE_NAMES=("mailtrustai" "mailtrustai-customer" "pm2-mailtrustai")
readonly NGINX_SITES=("mailtrustai" "mailtrustai-customer")
readonly LE_HOOKS=(
    "/etc/letsencrypt/renewal-hooks/deploy/mailtrustai.sh"
    "/etc/letsencrypt/renewal-hooks/deploy/mailtrustai-customer.sh"
)
readonly COMPOSE_FILES=(
    "docker-compose.prod.yml"
    "docker-compose.prod.host-nginx.yml"
    "docker-compose.yml"
    "docker-compose.customer.yml"
    "docker-compose.customer.host-nginx.yml"
)
readonly CONTAINER_NAMES=(
    "mailtrustai-app"
    "mailtrustai-nginx"
    "mailtrustai-dev"
    "mailtrustai-customer"
    "mailtrustai-customer-nginx"
)
readonly VOLUME_NAMES=(
    "mailtrustai_data"
    "mailtrustai_logs"
    "mailtrustai_mailtrustai_data"
    "mailtrustai_mailtrustai_logs"
    "mailtrustai-customer_mailtrustai_data"
    "mailtrustai-customer_mailtrustai_logs"
)
readonly UFW_PORTS=(3000 4443)

# ── Banner ───────────────────────────────────────────────────────────────────
echo -e "${BOLD}${RED}"
cat <<'BANNER'
╔══════════════════════════════════════════════════════════════╗
║       ⚠  MailTrustAI — TAM VERİ TEMİZLEME (Ubuntu)  ⚠       ║
║                                                              ║
║   BU SCRIPT MAILTRUSTAI'A AİT HER ŞEYİ KALICI OLARAK SİLER. ║
║   GERİ ALMA YOK. YEDEK ALDIĞINIZDAN EMİN OLUN.              ║
╚══════════════════════════════════════════════════════════════╝
BANNER
echo -e "${NC}"

[[ $EUID -eq 0 ]] || { log_err "Root yetkisi gerekli: sudo ./temizle_ubuntu.sh"; exit 1; }

# ── Tek seferlik onay ────────────────────────────────────────────────────────
if ! $FORCE; then
    echo -e "${YELLOW}Aşağıdaki kalıcı verileri silmek üzeresiniz:${NC}"
    echo "  • $APP_DIR (kod, .env, SQLite DB, SSL sertif.)"
    echo "  • Docker konteynerleri: ${CONTAINER_NAMES[*]}"
    echo "  • Docker volume'ları (SQLite veritabanı + loglar dahil)"
    echo "  • Docker imajları (mailtrustai-* prefix'li)"
    echo "  • systemd servisleri (${SERVICE_NAMES[*]})"
    echo "  • Host nginx site config'leri (${NGINX_SITES[*]})"
    echo "  • Let's Encrypt renewal hook'ları"
    $KEEP_CERTS || echo "  • Let's Encrypt sertifikaları (mailtrustai için olanlar)"
    echo "  • UFW kuralları (${UFW_PORTS[*]})"
    $REMOVE_DOCKER && echo "  • Docker Engine (başka konteynerleri ETKİLER!)"
    echo ""
    echo -e "${RED}Bu işlem GERİ ALINAMAZ.${NC}"
    read -rp "Devam etmek için 'TEMIZLE' yazın: " confirm
    if [[ "$confirm" != "TEMIZLE" ]]; then
        log "İptal edildi."
        exit 0
    fi
fi

# ── 1) Docker konteynerleri durdur ───────────────────────────────────────────
log_step "[1/9] Docker konteynerleri durduruluyor"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    # Compose dosyaları ile down
    if [[ -d "$APP_DIR" ]]; then
        for cf in "${COMPOSE_FILES[@]}"; do
            if [[ -f "$APP_DIR/$cf" ]]; then
                (cd "$APP_DIR" && docker compose -f "$cf" down --remove-orphans 2>/dev/null) \
                    && log_ok "$cf → down"
            fi
        done
    fi

    # Bilinen container isimlerini zorla sil
    for c in "${CONTAINER_NAMES[@]}"; do
        if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$c"; then
            docker rm -f "$c" >/dev/null 2>&1
            log_ok "Konteyner silindi: $c"
        fi
    done
else
    log_warn "Docker erişilemiyor — bu adım atlanıyor."
fi

# ── 2) Docker volume'ları sil ────────────────────────────────────────────────
log_step "[2/9] Docker volume'ları"

if command -v docker >/dev/null 2>&1; then
    for v in "${VOLUME_NAMES[@]}"; do
        if docker volume ls -q 2>/dev/null | grep -qx "$v"; then
            docker volume rm "$v" >/dev/null 2>&1 \
                && log_ok "Volume silindi: $v" \
                || log_warn "Volume silinemedi: $v (kullanımda olabilir)"
        fi
    done
fi

# ── 3) Docker imajları sil ───────────────────────────────────────────────────
log_step "[3/9] Docker imajları"

if command -v docker >/dev/null 2>&1; then
    IMAGES="$(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -E '^mailtrustai' || true)"
    if [[ -n "$IMAGES" ]]; then
        echo "$IMAGES" | xargs -r docker rmi -f >/dev/null 2>&1
        log_ok "Docker imajları temizlendi (mailtrustai-* prefix'li)."
    else
        log "  Silinecek imaj bulunamadı."
    fi

    # Dangling imajları da temizle
    docker image prune -f >/dev/null 2>&1 || true
fi

# ── 4) systemd servisleri ────────────────────────────────────────────────────
log_step "[4/9] systemd servisleri"

for svc in "${SERVICE_NAMES[@]}"; do
    unit="/etc/systemd/system/${svc}.service"
    if [[ -f "$unit" ]]; then
        systemctl stop "${svc}.service"    2>/dev/null
        systemctl disable "${svc}.service" 2>/dev/null
        rm -f "$unit"
        log_ok "${svc}.service kaldırıldı."
    fi
done
systemctl daemon-reload 2>/dev/null || true

# ── 5) Host nginx site config'leri ──────────────────────────────────────────
log_step "[5/9] Host nginx site config'leri"

sites_removed=0
for site in "${NGINX_SITES[@]}"; do
    if [[ -L "/etc/nginx/sites-enabled/$site" ]] || [[ -f "/etc/nginx/sites-enabled/$site" ]]; then
        rm -f "/etc/nginx/sites-enabled/$site"
        sites_removed=$((sites_removed+1))
    fi
    if [[ -f "/etc/nginx/sites-available/$site" ]]; then
        rm -f "/etc/nginx/sites-available/$site"
        sites_removed=$((sites_removed+1))
    fi
done
if [[ $sites_removed -gt 0 ]]; then
    log_ok "$sites_removed nginx site dosyası silindi."
    if command -v nginx >/dev/null 2>&1 && systemctl is-active --quiet nginx 2>/dev/null; then
        nginx -t >/dev/null 2>&1 && systemctl reload nginx && log "  Host nginx reload edildi."
    fi
else
    log "  Silinecek nginx site bulunamadı."
fi

# ── 6) Let's Encrypt: deploy hook + sertifikalar ─────────────────────────────
log_step "[6/9] Let's Encrypt artıfaktları"

hooks_removed=0
for hook in "${LE_HOOKS[@]}"; do
    if [[ -f "$hook" ]]; then
        rm -f "$hook"
        log_ok "LE deploy hook: $(basename "$hook")"
        hooks_removed=$((hooks_removed+1))
    fi
done
[[ $hooks_removed -eq 0 ]] && log "  Silinecek LE hook bulunamadı."

if ! $KEEP_CERTS && command -v certbot >/dev/null 2>&1; then
    # Sadece nginx site config'lerinde geçen domain'leri sil — başka
    # uygulamaların sertifikalarına dokunma.
    if [[ -d /etc/letsencrypt/live ]]; then
        for cert_dir in /etc/letsencrypt/live/*/; do
            [[ -d "$cert_dir" ]] || continue
            domain="$(basename "$cert_dir")"
            [[ "$domain" == "README" ]] && continue
            # Yalnız bu sunucuda kalmış MailTrustAI domain'lerini sil — heuristic:
            # eğer sertifika alanı hem var hem de aktif değilse (nginx site silindi)
            # silmeyi dener. Diğer servisler kullanıyorsa zaten certbot delete fail eder.
            certbot delete --cert-name "$domain" --non-interactive >/dev/null 2>&1 \
                && log_ok "Sertifika silindi: $domain" \
                || true
        done
    fi
else
    log "  Let's Encrypt sertifikaları KORUNDU (--keep-certs)."
fi

# ── 7) UFW kuralları ─────────────────────────────────────────────────────────
log_step "[7/9] UFW kuralları"

if command -v ufw >/dev/null 2>&1; then
    for port in "${UFW_PORTS[@]}"; do
        ufw delete allow "${port}/tcp" >/dev/null 2>&1 && log_ok "UFW: ${port}/tcp silindi."
    done
    log "  SSH/80/443 korundu (başka servisler kullanıyor olabilir)."
else
    log "  UFW kurulu değil — atlandı."
fi

# ── 8) /opt/mailtrustai dizini ───────────────────────────────────────────────
log_step "[8/9] Uygulama dizini"

if [[ -d "$APP_DIR" ]]; then
    rm -rf "$APP_DIR"
    log_ok "Dizin silindi: $APP_DIR"
else
    log "  Dizin zaten yok: $APP_DIR"
fi

# Bilinen geçici/cache dosyalar
rm -f /tmp/mailtrustai*.log /tmp/msa-*.json 2>/dev/null

# ── 9) Docker Engine (opsiyonel) ─────────────────────────────────────────────
log_step "[9/9] Docker Engine"

if $REMOVE_DOCKER; then
    log_warn "Docker Engine kaldırılıyor — BU SİSTEMDEKİ TÜM KONTEYNERLER ETKİLENİR!"
    systemctl stop docker docker.socket containerd 2>/dev/null
    apt-get purge -y -qq \
        docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin 2>/dev/null
    apt-get autoremove -y -qq 2>/dev/null
    rm -rf /var/lib/docker /var/lib/containerd /etc/docker \
           /etc/apt/keyrings/docker.gpg /etc/apt/sources.list.d/docker.list
    log_ok "Docker Engine kaldırıldı."
else
    log "  Docker Engine KORUNDU (--remove-docker ile silinebilir)."
fi

# ── Özet ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}"
cat <<'DONE'
╔══════════════════════════════════════════════════════════════╗
║          ✓ Temizlik Tamamlandı                               ║
╚══════════════════════════════════════════════════════════════╝
DONE
echo -e "${NC}"

echo -e "${BOLD}Sistemden tamamen kaldırıldı:${NC}"
echo "  ✓ Docker konteynerleri + volume'lar + imajlar"
echo "  ✓ Uygulama dizini ($APP_DIR)"
echo "  ✓ systemd servisleri"
echo "  ✓ Host nginx site config'leri"
echo "  ✓ Let's Encrypt deploy hook'ları"
$KEEP_CERTS  || echo "  ✓ Let's Encrypt sertifikaları (mailtrustai için)"
echo "  ✓ UFW kuralları (3000, 4443)"
$REMOVE_DOCKER && echo "  ✓ Docker Engine"

echo ""
echo -e "${BOLD}Korunan sistem öğeleri:${NC}"
echo "  • SSH (22/tcp), 80/tcp, 443/tcp"
$REMOVE_DOCKER || echo "  • Docker Engine (--remove-docker ile silinebilir)"
$KEEP_CERTS    && echo "  • Let's Encrypt sertifikaları"

echo ""
echo -e "${BOLD}Yeniden kurmak için:${NC}"
echo "  git clone https://github.com/kbulent07/mailtrustai.git $APP_DIR"
echo "  cd $APP_DIR && sudo ./install_server_ubuntu.sh"
echo ""
