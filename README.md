# Desks

Named-desk overlay for Omarchy Quattro. A desk is the current 1–10
workspaces, given a name. Switching parks this room and brings the other
one back. The scratchpad stays global.

## Install

```sh
omarchy plugin add /home/hallas/Work/modoterra/omadesk --enable
```

Summon:

```sh
omarchy-shell shell toggle modoterra.omadesk
```

Suggested bind: Super+Shift+D. Super+Space stays the Omarchy menu. Do not
rebind existing keys from this plugin.

## Remove

```sh
omarchy plugin remove modoterra.omadesk
```

Plugins run unsandboxed inside the long-lived Omarchy shell process.
