#!/bin/bash
# Fetch candidate script fonts as real static TTFs from the google/fonts repo
# (the CSS API serves a compressed subset that fontkit cannot read).
# All of these are SIL Open Font License.
cd "$(dirname "$0")/.."
rm -rf /tmp/fontcandidates && mkdir -p /tmp/fontcandidates
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

get "dancingscript/DancingScript%5Bwght%5D.ttf"  DancingScript.ttf
get "kaushanscript/KaushanScript-Regular.ttf"    KaushanScript.ttf
get "yellowtail/Yellowtail-Regular.ttf"          Yellowtail.ttf
get "grandhotel/GrandHotel-Regular.ttf"          GrandHotel.ttf
get "pacifico/Pacifico-Regular.ttf"              Pacifico.ttf
get "satisfy/Satisfy-Regular.ttf"                Satisfy.ttf
get "norican/Norican-Regular.ttf"                Norican.ttf
get "courgette/Courgette-Regular.ttf"            Courgette.ttf
get "lobster/Lobster-Regular.ttf"                Lobster.ttf
get "parisienne/Parisienne-Regular.ttf"          Parisienne.ttf
get "cookie/Cookie-Regular.ttf"                  Cookie.ttf
get "marckscript/MarckScript-Regular.ttf"        MarckScript.ttf
get "allura/Allura-Regular.ttf"                  Allura.ttf
get "berkshireswash/BerkshireSwash-Regular.ttf"  BerkshireSwash.ttf
get "kalam/Kalam-Bold.ttf"                       Kalam-Bold.ttf
get "greatvibes/GreatVibes-Regular.ttf"          GreatVibes.ttf
