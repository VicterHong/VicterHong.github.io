#!/bin/bash
# Deploy script untuk Cloudflare — otomatis setup R2, KV, Analytics

set -e

CF_TOKEN="${CLOUDFLARE_API_TOKEN}"
CF_ACCOUNT="${CLOUDFLARE_ACCOUNT_ID}"

if [ -z "$CF_TOKEN" ] || [ -z "$CF_ACCOUNT" ]; then
    echo "❌ Error: CLOUDFLARE_API_TOKEN dan CLOUDFLARE_ACCOUNT_ID harus di-set"
    echo "Contoh: CLOUDFLARE_API_TOKEN=xxx CLOUDFLARE_ACCOUNT_ID=yyy ./deploy-cloudflare.sh"
    exit 1
fi

echo "🚀 Deploy Portfolio ke Cloudflare Edge"
echo "===================================="

# 1. Cek R2 bucket
echo ""
echo "📦 1. Cek R2 Bucket..."
R2_STATUS=$(curl -s -X GET "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT/r2/buckets" \
    -H "Authorization: Bearer $CF_TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print('ok' if d.get('success') else 'fail')" 2>/dev/null || echo "fail")

if [ "$R2_STATUS" = "ok" ]; then
    echo "   ✅ R2 aktif"
    
    # Cek bucket exists
    BUCKET_EXISTS=$(curl -s -X GET "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT/r2/buckets/portfolio-assets" \
        -H "Authorization: Bearer $CF_TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d.get('success') else 'no')" 2>/dev/null || echo "no")
    
    if [ "$BUCKET_EXISTS" = "no" ]; then
        echo "   🔧 Membuat bucket 'portfolio-assets'..."
        curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT/r2/buckets" \
            -H "Authorization: Bearer $CF_TOKEN" \
            -H "Content-Type: application/json" \
            -d '{"name":"portfolio-assets"}' > /dev/null
        echo "   ✅ Bucket dibuat"
    else
        echo "   ✅ Bucket sudah ada"
    fi
    
    # Update wrangler.toml dengan R2
    if ! grep -q "r2_buckets" wrangler.toml; then
        cat >> wrangler.toml << 'R2EOF'

[[r2_buckets]]
binding = "ASSETS"
bucket_name = "portfolio-assets"
R2EOF
        echo "   ✅ R2 binding ditambahkan ke wrangler.toml"
    fi
else
    echo "   ⚠️  R2 belum diaktifkan. Lewati R2."
    echo "      Aktifkan di: https://dash.cloudflare.com/$CF_ACCOUNT/r2"
fi

# 2. Deploy Worker
echo ""
echo "🚀 2. Deploy Worker..."
wrangler deploy --env="" 2>&1 | tee /tmp/deploy.log

# 3. Cek hasil
if grep -q "Deployed portfolio-victer" /tmp/deploy.log; then
    echo ""
    echo "✅ DEPLOY BERHASIL!"
    echo ""
    echo "URL Worker: https://portfolio-victer.victerphanjaya.workers.dev"
    echo "Health:     https://portfolio-victer.victerphanjaya.workers.dev/health"
    echo ""
    echo "Untuk custom domain:"
    echo "  https://dash.cloudflare.com/$CF_ACCOUNT/workers/services/view/portfolio-victer/triggers"
else
    echo ""
    echo "❌ Deploy gagal. Cek log di /tmp/deploy.log"
    exit 1
fi
