#!/bin/zsh
# Builds the public site and pushes it to the jlpt-words repository, next to the deck files.
set -e
cd "${0:A:h}/.."
npm run build:public
work=$(mktemp -d)
git clone -q --depth 1 --filter=blob:none --sparse https://github.com/logitlong/jlpt-words.git "$work"
git -C "$work" sparse-checkout set --no-cone '/*' '!/deck/'
rm -rf "$work/assets"
cp -R dist-public/ "$work/"
git -C "$work" add --sparse -A
git -C "$work" commit -qm "Deploy public site" || exit 0
git -C "$work" push -q origin HEAD:main
rm -rf "$work"
