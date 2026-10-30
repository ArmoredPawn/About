#!/bin/sh
# Assembles the website into _site/: the home page and Back-bar pages from site/,
# plus an untouched copy of each game under games/.
set -e
cd "$(dirname "$0")"

rm -rf _site
mkdir -p _site/games/countries-game _site/games/ww2-map _site/games/ear-trainer _site/games/outlier

cp -R site/. _site/

# Countries Game: only its static front end (public/), as on its own Pages site
cp -R "Countries Game/public/." _site/games/countries-game/

# WW2 map: the whole repo is the site, minus git and build leftovers
(cd "WW2 map" && tar cf - --exclude=.git --exclude=.github --exclude=dist --exclude=README.md --exclude=.gitignore .) \
  | (cd _site/games/ww2-map && tar xf -)

# Ear Trainer: static files only, no build step
(cd "Ear Trainer" && tar cf - --exclude=README.md .) | (cd _site/games/ear-trainer && tar xf -)

# Outlier: only its front end (public/). The answer lists and the server stay out of the site.
cp -R "Outlier/public/." _site/games/outlier/

echo "Built _site/"
