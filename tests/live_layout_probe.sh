#!/usr/bin/env bash
# Drives the real workspaceLayoutApplyArgv from Model.js against the running
# Hyprland and checks tiledLayout, not file contents.
#
#   tests/live_layout_probe.sh
#
# Read-write: it writes the same $XDG_STATE_HOME/omarchy/workspace-layouts files
# the overlay writes, and removes bare-negative-id files the way the overlay now
# does. Back that directory up first if you care about its current contents.

set -uo pipefail

repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
dir="${XDG_STATE_HOME:-$HOME/.local/state}/omarchy/workspace-layouts"

if [[ -z "${HYPRLAND_INSTANCE_SIGNATURE:-}" ]]; then
  HYPRLAND_INSTANCE_SIGNATURE="$(ls -t "${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/hypr" 2>/dev/null | head -1)"
  export HYPRLAND_INSTANCE_SIGNATURE
fi
[[ -n "${HYPRLAND_INSTANCE_SIGNATURE:-}" ]] || { echo "no Hyprland instance"; exit 1; }

fails=0

tiled() { hyprctl workspaces -j | jq -r --argjson i "$1" '.[]|select(.id==$i)|.tiledLayout'; }

# Ask the shipped Model.js for the argv, then run exactly that.
apply() { # $1=target $2=layout
  mapfile -d '' -t argv < <(node -e '
    const fs = require("fs"), vm = require("vm")
    const m = {}
    vm.createContext(m)
    vm.runInContext(fs.readFileSync(process.argv[1] + "/Model.js", "utf8"), m)
    const argv = m.workspaceLayoutApplyArgv(process.argv[2], process.argv[3], process.argv[4]) || []
    process.stdout.write(argv.join("\0") + "\0")
  ' "$repo" "$dir" "$1" "$2")
  (( ${#argv[@]} )) || { echo "    no argv for target=$1"; return 1; }
  "${argv[@]}"
}

check() { # $1=label $2=workspace id $3=want
  local got
  got="$(tiled "$2")"
  if [[ "$got" == "$3" ]]; then
    printf '    PASS %-34s ws%s=%s\n' "$1" "$2" "$got"
  else
    printf '    FAIL %-34s ws%s=%s want=%s\n' "$1" "$2" "$got" "$3"
    fails=$((fails + 1))
  fi
}

echo "layouts dir: $dir"
echo "negative-id files present: $(ls "$dir"/-*.lua 2>/dev/null | wc -l)"
echo

echo "1. workspace 1 toggles both ways"
for want in dwindle scrolling dwindle scrolling; do
  apply 1 "$want" >/dev/null 2>&1
  sleep 1.2
  check "apply ws1 -> $want" 1 "$want"
done
echo

echo "2. toggling another workspace leaves workspace 1 alone"
apply 1 dwindle >/dev/null 2>&1; sleep 1.2
check "ws1 pinned dwindle" 1 dwindle
for want in scrolling dwindle scrolling; do
  apply 2 "$want" >/dev/null 2>&1
  sleep 1.2
  check "apply ws2 -> $want" 2 "$want"
  check "ws1 still dwindle" 1 dwindle
done
echo

echo "3. layout survives a config reload"
hyprctl reload config-only >/dev/null 2>&1; sleep 1.5
check "ws1 dwindle after reload" 1 dwindle
check "ws2 scrolling after reload" 2 scrolling
echo

echo "negative-id files remaining: $(ls "$dir"/-*.lua 2>/dev/null | wc -l)"
if (( fails )); then echo "FAILURES: $fails"; exit 1; fi
echo "all live checks passed"
