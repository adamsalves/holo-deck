# The canvas

The canvas is the visual specification of the game. Each screen was drawn as a board and approved
before it was built. A screen, panel or state with no board does not start: it gets a board first,
and the project owner approves it. Where the code departs from a board,
[`canvas-divergences.md`](canvas-divergences.md) records it and says why.

## Boards and screens

Boards are named the way the documentation and the code comments name them: in italics, in the
language they were drawn in. A board that is not a page of its own has no route.

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
| *Offline* | The download-for-offline row of *Preferências*, and the card without its thumbnail | `/settings` | [`app/pages/settings.vue`](../app/pages/settings.vue), [`app/plugins/missing-sprite.client.ts`](../app/plugins/missing-sprite.client.ts) |
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
