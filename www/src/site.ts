/**
 * Public site copy and hosts. The homepage and verify-site script load this
 * module. Do not duplicate the lists in UI or fixtures.
 */

export const publicSiteOrigin = "https://omadesk.mdtrr.com";

export const githubRepo = "https://github.com/modoterra/omadesk";

export const displayName = "Desks";

export const pluginId = "com.mdtrr.omadesk";

export const pageTitle = "Desks · Omadesk";

export const pageDescription =
  "Named-desk overlay for Omarchy. A desk is the current 1–10 workspaces, given a name.";

export const asciiLogo = [
  "      +---------+",
  "      |  o   o  |",
  "      |    ~    |",
  "      +----+----+",
  "     /|         |\\",
  "     \\|_________|/",
  "       ||     ||",
  "      _||     ||_",
].join("\n");

export const lead =
  "A desk is the current 1–10 workspaces, given a name. Switching parks this room onto named special workspaces and brings the other room back onto 1–10. The bar still shows 1 2 3. The scratchpad stays global.";

export const installCommand =
  "omarchy plugin add https://github.com/modoterra/omadesk.git --enable";

export const summonCommand = "omarchy-shell shell toggle com.mdtrr.omadesk";

export const bindExample =
  'o.bind("SUPER + D", "Desks", "omarchy-shell shell toggle com.mdtrr.omadesk")';

export const previewAlt =
  "Desks overlay picker on Dazzle Dusk, with a named desk tile and a new-desk tile.";

export type KeyRow = {
  key: string;
  action: string;
};

export const keys: KeyRow[] = [
  { key: "Super+D", action: "toggle overlay" },
  { key: "/", action: "start filter (Esc leaves)" },
  { key: "j / k, arrows, h l", action: "move cursor" },
  { key: "1–9", action: "jump to card" },
  { key: "enter", action: "switch, return to Unsaved, or start empty on + New Desk" },
  { key: "n", action: "save current as a named desk" },
  { key: "s", action: "update desk you are on" },
  { key: "r", action: "rename" },
  { key: "e", action: "extras" },
  { key: "x", action: "close every window on the highlighted desk" },
  { key: "o", action: "open the recipe in the background" },
  { key: "del", action: "forget, with confirm" },
  { key: "esc", action: "close" },
];
