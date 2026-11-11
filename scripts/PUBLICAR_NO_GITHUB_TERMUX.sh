#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
# Execute a partir da pasta descompactada do projeto, no Termux.
# Nunca envia tokens, bancos locais nem credenciais ao repositório.
cd "$(dirname "$0")/.."
echo 'NEXO Históricos — publicação em repositório NOVO, sem tocar no NEXO Social.'
command -v git >/dev/null || { echo 'Instale: pkg install git'; exit 1; }
command -v gh >/dev/null || { echo 'Instale: pkg install gh'; exit 1; }
if ! gh auth status >/dev/null 2>&1; then
  echo 'Autorize sua própria conta no GitHub pelo navegador:'
  gh auth login --hostname github.com --git-protocol https --web
fi
owner=$(gh api user --jq .login)
repo="$owner/nexo-historicos-hub"
if gh repo view "$repo" >/dev/null 2>&1; then
  echo "O repositório $repo já existe. Nenhum push automático foi feito para evitar sobrescritas."
  exit 0
fi
if [ -d .git ]; then
  echo 'A pasta já tem .git. Evitando sobrescrever configurações existentes.'
  exit 1
fi
git init -b main
git add .
git -c user.name='NEXO Históricos' -c user.email='nexo-historicos@users.noreply.github.com' commit -m 'NEXO Históricos v5: dashboard, D1 e coleta pública'
gh repo create nexo-historicos-hub --public --source=. --remote=origin --push
echo 'CÓDIGO PUBLICADO. Ainda precisa configurar D1 e credenciais do Cloudflare para colocar o SITE no ar.'
