# The canvas

The canvas is the visual specification of the game. A screen is drawn as a board and approved
before it is built, and a screen, panel or state with no board does not start: it gets a board
first, and the project owner approves it. What went the other way is on record. The Pokédex index
shipped in Phase 3 with no board, and *Pokédex — as 9 regiões* was drawn from the component
afterwards; the states written with no board are listed in
[`canvas-divergences.md`](canvas-divergences.md), under *Estados sem prancha, escritos neste PR*.
Where the code departs from a board, the same file records it and says why.

## Boards and screens

Boards are named in italics, in the language they were drawn in, and the documentation and the
code comments use the names below. Three boards go by a second name in the code comments:
*Estados de sync* is *Sync*, *Convite de conta* is *Convite*, and *Abertura* is *Abertura de pack*.
A board that is not a page of its own has no route.

| Board | What it draws | Route | Files |
| --- | --- | --- | --- |
| *Hub* | The home: resume a battle, the daily pack, the next gym | `/` | [`app/pages/index.vue`](../app/pages/index.vue) |
| *Loja* | The shop | `/packs` | [`app/pages/packs.vue`](../app/pages/packs.vue) |
| *Abertura de pack* | The pack opening, the other state of the same page | `/packs` | [`app/pages/packs.vue`](../app/pages/packs.vue), [`app/components/pack/Opener.vue`](../app/components/pack/Opener.vue) |
| *Coleção e forja* | The binder, the dust and the forge | `/collection` | [`app/pages/collection.vue`](../app/pages/collection.vue) |
| *Deck* | The deck builder | `/deck` | [`app/pages/deck.vue`](../app/pages/deck.vue) |
| *Liga* | The nine gyms, one leader each | `/league` | [`app/pages/league.vue`](../app/pages/league.vue) |
| *Batalha* | A battle | `/battle/[gymId]` | [`app/pages/battle/[gymId].vue`](../app/pages/battle/[gymId].vue) |
| *Pokédex — as 9 regiões* | The nine regions | `/pokedex` | [`app/pages/pokedex/index.vue`](../app/pages/pokedex/index.vue) |
| *Pokédex* | The grid of one region | `/pokedex/[gen]` | [`app/pages/pokedex/[gen].vue`](../app/pages/pokedex/[gen].vue) |
| *Detalhe* | One species | `/pokemon/[name]` | [`app/pages/pokemon/[name].vue`](../app/pages/pokemon/[name].vue) |
| *Regras* | The rules, read from `shared/game/` | `/rules` | [`app/pages/rules.vue`](../app/pages/rules.vue) |
| *Ajustes* | Account, save and preferences | `/settings` | [`app/pages/settings.vue`](../app/pages/settings.vue) |
| *Offline* | The download-for-offline row of *Preferências*, the card without its thumbnail, and what the species hero falls back to when the artwork does not load | `/settings`, `/pokemon/[name]` | [`app/pages/settings.vue`](../app/pages/settings.vue), [`app/plugins/missing-sprite.client.ts`](../app/plugins/missing-sprite.client.ts), [`app/pages/pokemon/[name].vue`](../app/pages/pokemon/[name].vue) |
| *Entrar* | Signing in | `/login` | [`app/pages/login.vue`](../app/pages/login.vue) |
| *Convite* | The invitation to create an account | none, drawn over any screen | [`app/components/AccountInvite.vue`](../app/components/AccountInvite.vue) |
| *Duas coleções* | The choice between the collection on this device and the account's | none, drawn over any screen | [`app/components/SaveChoice.vue`](../app/components/SaveChoice.vue) |
| *Sync* | The sync indicator in the bar and its states | none | [`app/components/SyncIndicator.vue`](../app/components/SyncIndicator.vue), [`app/components/SyncConflictNotice.vue`](../app/components/SyncConflictNotice.vue) |
| *A carta* | The card and its foil | none | [`app/components/dex/PokeCard.vue`](../app/components/dex/PokeCard.vue) |
| *Tokens* | The visual system | `/styleguide`, only in `yarn dev` | [`app/pages/styleguide.vue`](../app/pages/styleguide.vue), [`app/assets/css/main.css`](../app/assets/css/main.css) |
| *O ícone do app* | The app icon: browser tab, bar and home screen | none | [`app/app.vue`](../app/app.vue), [`app/components/AppNav.vue`](../app/components/AppNav.vue) |

## Reading the canvas

The published canvas weighs about 3.4 MB. Do not pull it whole into an editor or a conversation:
extract the one board you need to a small local file and read that.
