#!/usr/bin/env bash
# ==============================================================================
#  MailTrustAI — Ubuntu Sunucu TAM KURULUM Kaldırma Scripti (Docker)
#  Sürüm   : 1.0  (2026-05)
#
#  Bu script install_server_ubuntu.sh tarafından yapılan kurulumu kaldırır:
#    ✓ Docker konteynerleri durdur + sil
#    ✓ systemd servisini kaldır (mailtrustai.service)
#    ✓ UFW kurallarını sil  (3000/4443 veya 80/443)
#    ✓ Host nginx site config'i (varsa)
#    ✓ Let's Encrypt deploy hook (varsa)
#    ✓ Opsiyonel: /opt/mailtrustai dizini + Docker volume'ları + imajları
#    ✓ Opsiyonel: SSL sertifikaları (Let's Encrypt'ten de sil)
#
#  Kullanım:
#     sudo ./uninstall_server_ubuntu.sh                  # interaktif
#     sudo ./uninstall_server_ubuntu.sh --purge          # her şeyi sil (sormaz)
#     sudo ./uninstall_server_ubuntu.sh --keep           # konteyneri kaldır, veriyi sakla
#     sudo ./uninstall_server_ubuntu.sh --remove-certs   # SSL sertifikalarını da sil
#     sudo ./uninstall_server_ubuntu.sh --remove-docker  # Docker Engine'i de kaldır (DİKKAT)
# ==============================================================================

set -euo pipefail

# ── Renkler ──────────────────────────────────────────────────────────────────
readonly RED='\033[0;31m'    GREEN='\033[0;32m'    YELLOW='\033[1;33m'
readonly CYAN='\033[0;36m'   BOLD='\033[1m'        NC='\033[0m'

log_info()  { echo -e "[INFO]  $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()  { echo -e "${YELLOW}[UYARI]${NC} $*"; }
log_err()   { echo -e "${RED}[HATA]${NC}  $*" >&2; }
log_step()  { echo -e "\n${BOLD}${CYAN}▶ $*${NC}"; }

# ── CLI parametreleri ────────────────────────────────────────────────────────
MODE="ask"           # ask | purge | keep
REMOVE_CERTS=false
REMOVE_DOCKER=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --purge)         MODE="purge"; shift ;;
        --keep)          MODE="keep";  shift ;;
        --remove-certs)  REMOVE_CERTS=true; shift ;;
        --remove-docker) REMOVE_DOCKER=true; shift ;;
        -h|--help)
            cat <<HELP
Kullanım: sudo ./uninstall_server_ubuntu.sh [SEÇENEKLER]

SEÇENEKLER:
  --purge           Onay sormadan TÜM veriyi sil (dizin, volume, imajlar)
  --keep            Onay sormadan veriyi koru (sadece konteyner + servis kaldır)
  --remove-certs    Let's Encrypt sertifikalarını da sil (certbot delete)
  --remove-docker   Docker Engine'i de tamamen kaldır (başka konteynerleri etkiler!)
  -h, --help        Bu yardımı göster

ÖRNEKLER:
  sudo ./uninstall_server_ubuntu.sh
  sudo ./uninstall_server_ubuntu.sh --purge --remove-certs
HELP
            exit 0
            ;;
        *) log_warn "Bilinmeyen argüman: $1"; shift ;;
    esac
done

# ── Sabitler ─────────────────────────────────────────────────────────────────
readonly APP_DIR="/opt/mailtrustai"
readonly SERVICE_NAME="mailtrustai"
readonly NGINX_SITE_NAME="mailtrustai"
readonly HTTP_PORT=3000
readonly HTTPS_PORT=4443
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

# ── Banner ───────────────────────────────────────────────────────────────────
echo -e "${BOLD}${RED}"
cat <<'BANNER'
╔══════════════════════════════════════════════════════════════╗
║   MailTrustAI — Ubuntu TAM Kurulum Kaldırma  (Docker)        ║
╚══════════════════════════════════════════════════════════════╝
BANNER
echo -e "${NC}"

# ── Ön kontroller ────────────────────────────────────────────────────────────
[[ $EUID -eq 0 ]] || { log_err "Root yetkisi gerekli: sudo ./uninstall_server_ubuntu.sh"; exit 1; }

if [[ "$MODE" == "ask" ]]; then
    echo -e "${YELLOW}Bu işlem MailTrustAI kurulumunu durduracak ve sistemden kaldıracak.${NC}"
    read -rp "Devam edilsin mi? [e/H]: " confirm
    [[ "$confirm" =~ ^[Ee]$ ]] || { log_info "İptal edildi."; exit 0; }
fi

# ── 1) Docker konteynerleri ──────────────────────────────────────────────────
log_step "[1/6] Docker konteynerleri durduruluyor"

if [[ -d "$APP_DIR" ]] && command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    cd "$APP_DIR"
    for cf in "${COMPOSE_FILES[@]}"; do
        if [[ -f "$cf" ]]; then
            docker compose -f "$cf" down --remove-orphans 2>/dev/null \
                && log_ok "$cf → down" \
                || log_warn "$cf → down hata verdi"
        fi
    done
else
    log_info "Docker erişilemiyor veya $APP_DIR yok; konteyner adımı atlanıyor."
fi

# Bilinen container'ları zorla temizle
if command -v docker >/dev/null 2>&1; then
    for c in "${CONTAINER_NAMES[@]}"; do
        if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$c"; then
            docker rm -f "$c" >/dev/null 2>&1 || true
            log_info "Konteyner zorla silindi: $c"
        fi
    done
fi

# ── 2) systemd servisi ───────────────────────────────────────────────────────
log_step "[2/6] systemd servisi"

# install_server_ubuntu.sh: mailtrustai.service
# install_customer_ubuntu.sh: mailtrustai-customer.service
# install_ubuntu.sh: mailtrustai.service
for svc in "$SERVICE_NAME" "mailtrustai-customer"; do
    unit="/etc/systemd/system/${svc}.service"
    if [[ -f "$unit" ]]; then
        systemctl stop "${svc}.service"    2>/dev/null || true
        systemctl disable "${svc}.service" 2>/dev/null || true
        rm -f "$unit"
        log_ok "${svc}.service kaldırıldı."
    fi
done
systemctl daemon-reload

# ── 3) UFW kuralları ─────────────────────────────────────────────────────────
log_step "[3/6] UFW kuralları"

if command -v ufw >/dev/null 2>&1; then
    ufw delete allow "${HTTP_PORT}/tcp"  2>/dev/null || true
    ufw delete allow "${HTTPS_PORT}/tcp" 2>/dev/null || true
    log_ok "UFW: ${HTTP_PORT}/tcp ve ${HTTPS_PORT}/tcp kuralları silindi."
    log_info "SSH, 80, 443 KORUNDU (başka servisler kullanıyor olabilir)."
else
    log_info "UFW kurulu değil; atlanıyor."
fi

# ── 4) Host nginx site + Let's Encrypt deploy hook ───────────────────────────
log_step "[4/6] Host nginx site config ve Let's Encrypt hook"

sites_removed=0
for site in "$NGINX_SITE_NAME" "mailtrustai-customer"; do
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
    log_ok "Host nginx site config'leri kaldırıldı."
    if command -v nginx >/dev/null 2>&1 && systemctl is-active --quiet nginx 2>/dev/null; then
        nginx -t >/dev/null 2>&1 && systemctl reload nginx && log_info "Host nginx reload edildi."
    fi
else
    log_info "Host nginx site config bulunamadı (Docker nginx modu kullanılmış olabilir)."
fi

# Let's Encrypt deploy hook'ları
for hook in /etc/letsencrypt/renewal-hooks/deploy/mailtrustai.sh \
            /etc/letsencrypt/renewal-hooks/deploy/mailtrustai-customer.sh; do
    if [[ -f "$hook" ]]; then
        rm -f "$hook"
        log_ok "LE deploy hook kaldırıldı: $(basename "$hook")"
    fi
done

# Opsiyonel: SSL sertifikalarını da sil
if $REMOVE_CERTS; then
    if command -v certbot >/dev/null 2>&1; then
        # Aktif sertifikaları listele
        CERTS_TO_REMOVE=()
        if [[ -d /etc/letsencrypt/live ]]; then
            for cert_dir in /etc/letsencrypt/live/*/; do
                [[ -d "$cert_dir" ]] || continue
                domain="$(basename "$cert_dir")"
                # README ve diğer non-domain dosyalarını atla
                [[ "$domain" == "README" ]] && continue
                CERTS_TO_REMOVE+=("$domain")
            done
        fi
        if [[ ${#CERTS_TO_REMOVE[@]} -gt 0 ]]; then
            log_warn "Aşağıdaki SSL sertifikaları silinecek:"
            for d in "${CERTS_TO_REMOVE[@]}"; do echo "    - $d"; done
            if [[ "$MODE" == "ask" ]]; then
                read -rp "Onaylıyor musunuz? [e/H]: " cert_confirm
                if [[ "$cert_confirm" =~ ^[Ee]$ ]]; then
                    for d in "${CERTS_TO_REMOVE[@]}"; do
                        certbot delete --cert-name "$d" --non-interactive 2>/dev/null \
                            && log_ok "Sertifika silindi: $d" \
                            || log_warn "Sertifika silinemedi: $d"
                    done
                fi
            else
                for d in "${CERTS_TO_REMOVE[@]}"; do
                    certbot delete --cert-name "$d" --non-interactive 2>/dev/null \
                        && log_ok "Sertifika silindi: $d" \
                        || log_warn "Sertifika silinemedi: $d"
                done
            fi
        else
            log_info "Silinecek SSL sertifikası bulunamadı."
        fi
    else
        log_info "certbot kurulu değil; sertifika temizliği atlanıyor."
    fi
fi

# ── 5) Veri / dizin / volume / imaj ──────────────────────────────────────────
log_step "[5/6] Veri ve Docker artıfaktları"

if [[ "$MODE" == "ask" ]]; then
    echo ""
    echo -e "${YELLOW}Aşağıdaki kalıcı veriler silinsin mi? (GERİ ALINAMAZ)${NC}"
    echo "  - $APP_DIR  (uygulama dizini, .env, nginx config)"
    echo "  - Docker volume'lar: mailtrustai_data, mailtrustai_logs (uygulama verisi + log)"
    echo "  - Docker imajları (mailtrustai-* prefix'li)"
    echo ""
    read -rp "Silinsin mi? [e/H]: " purge_choice
    if [[ "$purge_choice" =~ ^[Ee]$ ]]; then
        MODE="purge"
    else
        MODE="keep"
    fi
fi

if [[ "$MODE" == "purge" ]]; then
    if [[ -d "$APP_DIR" ]]; then
        rm -rf "$APP_DIR"
        log_ok "Uygulama dizini silindi: $APP_DIR"
    fi

    if command -v docker >/dev/null 2>&1; then
        for v in "${VOLUME_NAMES[@]}"; do
            if docker volume ls -q 2>/dev/null | grep -qx "$v"; then
                docker volume rm "$v" >/dev/null 2>&1 || true
                log_info "Volume silindi: $v"
            fi
        done

        IMAGES="$(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -E '^mailtrustai' || true)"
        if [[ -n "$IMAGES" ]]; then
            echo "$IMAGES" | xargs -r docker rmi -f >/dev/null 2>&1 || true
            log_info "Docker imajları temizlendi (mailtrustai-* prefix'li)."
        fi
    fi

    log_ok "Tüm veriler kaldırıldı."
else
    log_info "Veriler KORUNDU."
    log_info "  - $APP_DIR/ ve veritabanı yerinde."
    log_info "  - Yeniden kurmak için: sudo ./install_server_ubuntu.sh"
fi

# ── 6) Docker Engine (opsiyonel) ─────────────────────────────────────────────
log_step "[6/6] Docker Engine"

if $REMOVE_DOCKER; then
    log_warn "Docker Engine kaldırılıyor — BAŞKA KONTEYNERLER ETKİLENECEK!"
    if [[ "$MODE" == "ask" ]]; then
        read -rp "ONAYLIYOR MUSUNUZ? Bu sistemdeki TÜM Docker konteynerleri silinecek [e/H]: " dconf
        [[ "$dconf" =~ ^[Ee]$ ]] || { log_info "Docker Engine korundu."; }
    fi
    if [[ "$MODE" != "ask" ]] || [[ "${dconf:-}" =~ ^[Ee]$ ]]; then
        systemctl stop docker docker.socket containerd 2>/dev/null || true
        apt-get purge -y -qq docker-ce docker-ce-cli containerd.io \
            docker-buildx-plugin docker-compose-plugin 2>/dev/null || true
        apt-get autoremove -y -qq 2>/dev/null || true
        rm -rf /var/lib/docker /var/lib/containerd /etc/docker /etc/apt/keyrings/docker.gpg \
               /etc/apt/sources.list.d/docker.list
        log_ok "Docker Engine kaldırıldı."
    fi
else
    log_info "Docker Engine korundu (başka konteynerleri etkileyebileceğinden)."
    log_info "Tamamen kaldırmak için bu scripti --remove-docker ile çalıştırın."
fi

# ── Özet ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}"
cat <<'DONE'
╔══════════════════════════════════════════════════════════════╗
║          ✓ Kaldırma İşlemi Tamamlandı                        ║
╚══════════════════════════════════════════════════════════════╝
DONE
echo -e "${NC}"

echo -e "${BOLD}Yapılanlar:${NC}"
echo "  ✓ Docker konteynerleri durduruldu/silindi"
echo "  ✓ systemd servisi kaldırıldı"
echo "  ✓ UFW kuralları (3000, 4443) silindi"
echo "  ✓ Host nginx site config'leri ve LE deploy hook'ları silindi"
$REMOVE_CERTS  && echo "  ✓ Let's Encrypt sertifikaları silindi"
[[ "$MODE" == "purge" ]] && echo "  ✓ Uygulama dizini ve Docker volume'lar silindi"
$REMOVE_DOCKER && echo "  ✓ Docker Engine kaldırıldı"

echo ""
echo -e "${BOLD}KORUNANLAR:${NC}"
echo "  - SSH (22/tcp), 80/tcp, 443/tcp UFW kuralları"
$REMOVE_DOCKER || echo "  - Docker Engine (--remove-docker ile silinebilir)"
$REMOVE_CERTS  || echo "  - Let's Encrypt sertifikaları (--remove-certs ile silinebilir)"
[[ "$MODE" == "purge" ]] || echo "  - Uygulama verileri ($APP_DIR) ve merkezi MariaDB volume'u"

echo ""
