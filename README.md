# Ayush Srivastava

A personal home page (projects, leadership, hobbies and contact) that also links to side projects, including three games:

- Ranked: the Countries Game (`Countries Game/`)
- Europe at War, 1939–1945 (`WW2 map/`)
- By Ear, an ear-training game (`Ear Trainer/`)

Each game lives in its own folder. The first two were copied from their original repos (the Countries Game has
since gained 50 extra categories here); By Ear was built here. `site/` holds the home page and the
pages that show each game under a Back bar. `sh build.sh` assembles everything into `_site/`, which the Pages
workflow deploys on every push to `main`.
