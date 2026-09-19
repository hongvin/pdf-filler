#!/bin/bash
# Second batch: heavier brush/script faces, plus static Bold cuts where the
# family ships as a variable font (pdf-lib cannot instance a variable font).
cd "$(dirname "$0")/.."
mkdir -p /tmp/fontcandidates
cd /tmp/fontcandidates

BASE="https://raw.githubusercontent.com/google/fonts/main/ofl"

get() {
  local path="$1" out="$2"
  if curl -fsS --max-time 40 -o "$out" "$BASE/$path"; then
    echo "OK    $out  ($(wc -c < "$out" | tr -d ' ') bytes)"
  else
    rm -f "$out"; echo "MISS  $path"
  fi
}

get "leckerlione/LeckerliOne-Regular.ttf"      LeckerliOne.ttf
get "mrdafoe/MrDafoe-Regular.ttf"              MrDafoe.ttf
get "damion/Damion-Regular.ttf"                Damion.ttf
get "yesteryear/Yesteryear-Regular.ttf"        Yesteryear.ttf
get "rochester/Rochester-Regular.ttf"          Rochester.ttf
get "charm/Charm-Bold.ttf"                     Charm-Bold.ttf
get "pattaya/Pattaya-Regular.ttf"              Pattaya.ttf
get "lobstertwo/LobsterTwo-BoldItalic.ttf"     LobsterTwo-BoldItalic.ttf
get "dancingscript/static/DancingScript-Bold.ttf" DancingScript-Bold.ttf
get "alexbrush/AlexBrush-Regular.ttf"          AlexBrush.ttf
get "kaushanscript/KaushanScript-Regular.ttf"  KaushanScript.ttf
