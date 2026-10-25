# Fun Projects

A home page linking to two projects, each shown exactly as it is in its own repo:

- [Ranked: the Countries Game](https://github.com/Armoredpawn/Countries-Game) (`Countries Game/`)
- [Europe at War, 1939–1945](https://github.com/ArmoredPawn/WW2-Map) (`WW2 map/`)

Both are git submodules. `site/` holds the home page and the two pages that show each game under a Back bar.
`sh build.sh` assembles everything into `_site/`, which the Pages workflow deploys. The workflow always
pulls the latest version of each game, so re-run it (Actions → Deploy site to Pages) after updating a game.
