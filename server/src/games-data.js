// Starter games. All are single-player PC games that players commonly customise.
// Steam App IDs were checked against each game's Steam store address.
// Developer, publisher, release date and genres were entered by hand and are marked as such
// (metadata_source = 'manual'). The Steam store page is the reference if anything here is out of date.
// Descriptions are written for FileShelf.
export const STARTER_GAMES = [
  {
    slug: 'elden-ring', name: 'Elden Ring', code: 'ER', tint: 1, steam_app_id: 1245620,
    developer: 'FromSoftware', publisher: 'Bandai Namco Entertainment', release_date: '2022-02-25',
    genres: 'Action RPG',
    description: 'An open-world action role-playing game set in the Lands Between. It is played on its own or online, and most customisation tools target the single-player game.',
  },
  {
    slug: 'cyberpunk-2077', name: 'Cyberpunk 2077', code: 'CP', tint: 2, steam_app_id: 1091500,
    developer: 'CD PROJEKT RED', publisher: 'CD PROJEKT', release_date: '2020-12-10',
    genres: 'Action RPG, Open world',
    description: 'A single-player open-world role-playing game set in Night City, with a large and active modding community.',
  },
  {
    slug: 'the-witcher-3', name: 'The Witcher 3: Wild Hunt', code: 'W3', tint: 3, steam_app_id: 292030,
    developer: 'CD PROJEKT RED', publisher: 'CD PROJEKT', release_date: '2015-05-18',
    genres: 'RPG, Open world',
    description: 'A single-player open-world role-playing game. Mods, save tools and presets for it are widely shared.',
  },
  {
    slug: 'baldurs-gate-3', name: "Baldur's Gate 3", code: 'BG3', tint: 4, steam_app_id: 1086940,
    developer: 'Larian Studios', publisher: 'Larian Studios', release_date: '2023-08-03',
    genres: 'RPG, Turn-based',
    description: 'A turn-based role-playing game for one player or a small party. Utilities for the single-player game are the focus here.',
  },
  {
    slug: 'skyrim-special-edition', name: 'The Elder Scrolls V: Skyrim Special Edition', code: 'SSE', tint: 5, steam_app_id: 489830,
    developer: 'Bethesda Game Studios', publisher: 'Bethesda Softworks', release_date: '2016-10-28',
    genres: 'RPG, Open world',
    description: 'A single-player open-world role-playing game with one of the largest modding scenes on PC.',
  },
  {
    slug: 'stardew-valley', name: 'Stardew Valley', code: 'SDV', tint: 6, steam_app_id: 413150,
    developer: 'ConcernedApe', publisher: 'ConcernedApe', release_date: '2016-02-26',
    genres: 'Farming sim, RPG',
    description: 'A farming and life simulation game. It has a mod loader, save files that are easy to back up, and a large library of mods.',
  },
  {
    slug: 'fallout-4', name: 'Fallout 4', code: 'F4', tint: 7, steam_app_id: 377160,
    developer: 'Bethesda Game Studios', publisher: 'Bethesda Softworks', release_date: '2015-11-10',
    genres: 'RPG, Open world',
    description: 'A single-player post-apocalyptic role-playing game with built-in support for mods.',
  },
  {
    slug: 'hades', name: 'Hades', code: 'HAD', tint: 8, steam_app_id: 1145360,
    developer: 'Supergiant Games', publisher: 'Supergiant Games', release_date: '2020-09-17',
    genres: 'Roguelike, Action',
    description: 'A single-player action roguelike. Players share save files, accessibility settings and small content mods.',
  },
];
