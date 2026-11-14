#!/bin/zsh
cd -- "${0:A:h}"
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
node scripts/build.mjs || exit 1
echo ""
echo "Откройте http://localhost:4173 в браузере."
echo "Чтобы остановить сервер, нажмите Control+C."
echo ""
node scripts/serve.mjs
