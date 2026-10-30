# Ayush Srivastava

A personal home page (projects, leadership, hobbies and contact) that also links to side projects, including four games:

- Ranked: the Countries Game (`Countries Game/`)
- Europe at War, 1939–1945 (`WW2 map/`)
- Test Your Pitch, an ear-training game (`Ear Trainer/`)
- Outlier, a trivia game where rarer answers score more (`Outlier/`)

Each game lives in its own folder. The first two were copied from their original repos (the Countries Game has
since gained 50 extra categories here); Test Your Pitch and Outlier were built here. `site/` holds the home page and the
pages that show each game under a Back bar. `sh build.sh` assembles everything into `_site/`, which the Pages
workflow deploys on every push to `main`.
