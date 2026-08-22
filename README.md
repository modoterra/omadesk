# Desks

```
      +---------+
      |  o   o  |
      |    ~    |
      +----+----+
     /|         |\
     \|_________|/
       ||     ||
      _||     ||_
```

Named-desk overlay for Omarchy Quattro. A desk is the current 1–10
workspaces, given a name. Switching parks this room onto named special
workspaces `special:omadesk-<id>-N` (the same kind of hidden space as
the scratchpad, so Super+Tab never lands there) and brings the other
room back onto 1–10. Each workspace is put back on the monitor it was
on; a missing display is skipped. The bar still shows 1 2 3. The
scratchpad itself (`special:scratchpad`) stays global and is never
parked, restored, or stored.

![Desks picker](preview.png)

Live truth while the session is alive is parked window addresses. Two
Chromiums on two workspaces work during the day because we move those
addresses. After a reboot that case is best-effort (`chromium --new-window`
when we have to launch). Workspace tiles show the tiled layout from window
geometry, with app icons, two per row at the monitor's aspect ratio.
A terminal that was running a command (not just a shell) is relaunched
with that command and working directory.

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
omarchy bar move com.mdtrr.omadesk --section left
```

## Summon

```sh
omarchy-shell shell toggle com.mdtrr.omadesk
```

Suggested bind: Super+D. Super+Space stays the Omarchy menu. Super+Shift+D
is Omarchy’s Docker TUI, so this plugin does not take that key.

```lua
o.bind("SUPER + D", "Desks", "omarchy-shell shell toggle com.mdtrr.omadesk")
```

## Keys

| Key | Action |
| --- | --- |
| Super+D | toggle overlay |
| / | start filter (Esc leaves) |
| j / k, arrows, h l | move cursor |
| 1–9 | jump to card |
| click a workspace tile | switch onto that workspace |
| enter | switch, return to **Unsaved**, or start an empty unsaved desk on **+ New Desk** |
| n | save current as a named desk |
| s | update desk you are on |
| r | rename (display name; parking id stays) |
| e | extras (DND Leave/On/Off, launch missing, theme Leave or Set) |
| x | close every window on the highlighted desk (recipe stays) |
| o | open the recipe in the background (parked lots if you are on another desk) |
| del | forget, with confirm (parked windows return to 1–10) |
| esc | close (clear filter first if any) |

## Remove

```sh
omarchy plugin remove com.mdtrr.omadesk
```

Recipes live in `~/.config/omarchy/omadesk/desks.json`. Forget deletes the
recipe and brings that desk's parked windows back onto 1–10. A **live** desk
still has windows (on 1–10 or parked). A **dead** desk is recipe only: `x`
closes its windows, `o` launches them in the background without switching.
Theme extras can leave the current theme or run `omarchy theme set` when you
switch into that desk.

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
