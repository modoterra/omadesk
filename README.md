# Desks

Named-desk overlay for Omarchy Quattro. A desk is the current 1–10
workspaces, given a name. Switching parks this room onto hidden
`omadesk-<id>-N` workspaces and brings the other room back onto 1–10.
The bar still shows 1 2 3. The scratchpad stays global and is never
parked, restored, or stored.

![Desks picker](preview.png)

Live truth while the session is alive is parked window addresses. Two
Chromiums on two workspaces work during the day because we move those
addresses. After a reboot that case is best-effort (`chromium --new-window`
when we have to launch).

## Install

```sh
omarchy plugin add https://github.com/modoterra/omadesk.git --enable
```

From this checkout:

```sh
omarchy plugin add /home/hallas/Work/modoterra/omadesk --enable
```

There is no installer script. The plugin is QML + JavaScript only.

Put the chip next to the stock workspace numbers:

```sh
omarchy bar move modoterra.omadesk --section left
```

## Summon

```sh
omarchy-shell shell toggle modoterra.omadesk
```

Suggested bind: Super+Shift+D. Super+Space stays the Omarchy menu. This
plugin does not rebind keys; add the bind yourself if you want one, for
example in `~/.config/hypr/bindings.lua`:

```lua
o.bind("SUPER + SHIFT + D", "Desks", function()
  os.execute("omarchy-shell shell toggle modoterra.omadesk")
end)
```

## Keys

| Key | Action |
| --- | --- |
| Super+Shift+D (documented bind) | toggle overlay |
| type | filter |
| j / k, arrows, h l | move cursor |
| 1–9 | jump to card |
| enter | switch |
| n | save current as new |
| s | update desk you are on |
| r | rename (display name; parking id stays) |
| e | extras (DND leave/on/off, launch missing, theme leave) |
| del | forget, with confirm |
| esc | close (clear filter first if any) |

## Remove

```sh
omarchy plugin remove modoterra.omadesk
```

Recipes live in `~/.config/omarchy/omadesk/desks.json`. Forget deletes the
recipe only. Open windows stay; nothing is killed.

## Tests

```sh
node tests/test_model.js
omarchy plugin validate .
qmllint -I "$OMARCHY_PATH/shell" Overlay.qml BarWidget.qml
```

## Security

Plugins run unsandboxed inside the long-lived Omarchy shell process, with
your user permissions. Review the code before you enable it. Hyprctl is
the only command used to move windows; apps are launched with `uwsm-app`.
