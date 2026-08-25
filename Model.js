// Pure functions for desks. Loaded by Overlay.qml and by Node vm tests.
// No Node APIs. No QML types.
// Scratchpad (special:scratchpad) is global: never stage, park, restore, or store.
// Desk lots live on other named specials: special:omadesk-<slug>-N.
// Hyprland owns placement: a desk is the windows it is holding, live on 1-10 or
// parked in that desk's lots. desks.json only names desks and keeps their
// preferences, so stored state cannot drift away from the compositor.

var MAX_DESKS_FILE_BYTES_VALUE = 256 * 1024
var MAX_COMPOSITOR_OUTPUT_BYTES_VALUE = 1024 * 1024
var MAX_DESK_COUNT_VALUE = 64
var MAX_DESK_ID_CHARS_VALUE = 96
var MAX_DESK_NAME_CHARS_VALUE = 128
var MAX_COMPOSITOR_TEXT_CHARS_VALUE = 512
var MAX_MONITOR_NAME_CHARS_VALUE = 128
var MAX_WORKSPACE_NAME_CHARS_VALUE = 192
var MAX_ADDRESS_CHARS_VALUE = 128
var MAX_TIMESTAMP_CHARS_VALUE = 64
var MAX_STAGE_CLIENTS_VALUE = 512
var MAX_STAGE_WORKSPACES_VALUE = 1024
var MAX_STAGE_MONITORS_VALUE = 32
var MAX_RENDERED_PANES_PER_TILE_VALUE = 32
var MAX_THEME_NAMES_VALUE = 128
var MAX_LAYOUT_ROWS_VALUE = 10
var MAX_LEGACY_ARGV_VALUE = 64
var MAX_LEGACY_TEXT_CHARS_VALUE = 2048
var MAX_NUMERIC_MAGNITUDE_VALUE = 1000000000

function maxDesksFileBytes() {
  return MAX_DESKS_FILE_BYTES_VALUE
}

function maxCompositorOutputBytes() {
  return MAX_COMPOSITOR_OUTPUT_BYTES_VALUE
}

function maxDeskCount() {
  return MAX_DESK_COUNT_VALUE
}

function maxDeskIdChars() {
  return MAX_DESK_ID_CHARS_VALUE
}

function maxDeskNameChars() {
  return MAX_DESK_NAME_CHARS_VALUE
}

function maxCompositorTextChars() {
  return MAX_COMPOSITOR_TEXT_CHARS_VALUE
}

function maxStageClients() {
  return MAX_STAGE_CLIENTS_VALUE
}

function maxStageWorkspaces() {
  return MAX_STAGE_WORKSPACES_VALUE
}

function maxStageMonitors() {
  return MAX_STAGE_MONITORS_VALUE
}

function maxRenderedPanesPerTile() {
  return MAX_RENDERED_PANES_PER_TILE_VALUE
}

function maxThemeNames() {
  return MAX_THEME_NAMES_VALUE
}

function emptyState() {
  return { version: 2, currentId: null, desks: [] }
}

function defaultExtras() {
  return { dnd: "leave", theme: "leave" }
}

function desksPath(home) {
  return String(home || "") + "/.config/omarchy/omadesk/desks.json"
}

function isWithinUtf8ByteLimit(value, limit) {
  var text = typeof value === "string" ? value : String(value == null ? "" : value)
  var cap = Number(limit)
  if (!isFinite(cap) || cap < 0) return false
  var bytes = 0
  var i
  for (i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i)
    if (code <= 0x7f) bytes += 1
    else if (code <= 0x7ff) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      var next = text.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        i += 1
      } else {
        bytes += 3
      }
    } else {
      bytes += 3
    }
    if (bytes > cap) return false
  }
  return true
}

function boundedFileReadArgv(path) {
  var file = String(path || "")
  if (!file) return []
  // Pathname [ -f ]/stat then head follows symlinks and can swap desks.json after the check.
  return [
    "python3",
    "-I",
    "-c",
    "import errno, os, stat, sys\n" +
      "path = sys.argv[1]\n" +
      "limit = int(sys.argv[2])\n" +
      "flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC\n" +
      "try:\n" +
      "    fd = os.open(path, flags)\n" +
      "except OSError as err:\n" +
      "    sys.exit(3 if err.errno == errno.ENOENT else 4)\n" +
      "try:\n" +
      "    info = os.fstat(fd)\n" +
      "    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():\n" +
      "        sys.exit(4)\n" +
      "    if info.st_size > limit:\n" +
      "        sys.exit(5)\n" +
      "    left = min(info.st_size, limit)\n" +
      "    while left > 0:\n" +
      "        chunk = os.read(fd, left)\n" +
      "        if not chunk:\n" +
      "            break\n" +
      "        sys.stdout.buffer.write(chunk)\n" +
      "        left -= len(chunk)\n" +
      "except OSError:\n" +
      "    sys.exit(4)\n" +
      "finally:\n" +
      "    os.close(fd)\n",
    file,
    String(MAX_DESKS_FILE_BYTES_VALUE)
  ]
}

function boundedHyprctlArgv(query) {
  var name = String(query || "")
  if (name !== "clients" && name !== "workspaces" && name !== "monitors") return []
  return [
    "bash",
    "-o",
    "pipefail",
    "-c",
    "hyprctl -j \"$1\" 2>/dev/null | head -c \"$2\"",
    "omadesk-hyprctl",
    name,
    String(MAX_COMPOSITOR_OUTPUT_BYTES_VALUE + 1)
  ]
}

function boundedThemeListArgv() {
  return [
    "bash",
    "-o",
    "pipefail",
    "-c",
    "omarchy theme list 2>/dev/null | head -c \"$1\"",
    "omadesk-themes",
    String(MAX_COMPOSITOR_OUTPUT_BYTES_VALUE + 1)
  ]
}

function normalizeQuery(raw) {
  return boundedText(raw, MAX_DESK_NAME_CHARS_VALUE, "").replace(/\s+/g, " ").trim()
}

function scoreText(query, text) {
  var needle = boundedText(query, MAX_DESK_NAME_CHARS_VALUE, "").toLowerCase()
  var hay = boundedText(text, MAX_DESK_NAME_CHARS_VALUE, "").toLowerCase()
  if (needle === "") return 1
  if (hay === needle) return 100
  if (hay.indexOf(needle) === 0) return 80
  if (hay.indexOf(needle) >= 0) return 50
  return 0
}

function filterDesks(desks, query) {
  var q = normalizeQuery(query)
  var list = isArray(desks) ? desks : []
  var scored = []
  var i
  for (i = 0; i < list.length && i < MAX_DESK_COUNT_VALUE; i++) {
    var desk = list[i]
    var score = scoreText(q, desk && desk.name)
    if (q !== "" && score <= 0) continue
    scored.push({ desk: desk, score: score, name: boundedText(desk && desk.name, MAX_DESK_NAME_CHARS_VALUE, "") })
  }
  if (q !== "") {
    scored.sort(function(a, b) {
      if (b.score !== a.score) return b.score - a.score
      return a.name.localeCompare(b.name)
    })
  }
  var out = []
  for (i = 0; i < scored.length; i++) out.push(scored[i].desk)
  return out
}

function moveCursor(index, keyOrCount, countOrDx, columnsOrDy, maybeColumns) {
  var i = Number(index)
  if (!isFinite(i)) i = 0
  var total
  var cols
  var delta = 0
  if (typeof keyOrCount === "number") {
    total = Number(keyOrCount)
    var dx = Number(countOrDx)
    var dy = Number(columnsOrDy)
    cols = Number(maybeColumns)
    if (!isFinite(cols) || cols < 1) cols = 2
    if (!isFinite(total) || total < 1) return 0
    if (isFinite(dx)) delta += dx
    if (isFinite(dy)) delta += dy * cols
  } else {
    total = Number(countOrDx)
    cols = Number(columnsOrDy)
    if (!isFinite(cols) || cols < 1) cols = 2
    if (!isFinite(total) || total < 1) return 0
    var k = String(keyOrCount || "").toLowerCase()
    if (k === "h" || k === "left") delta = -1
    else if (k === "l" || k === "right") delta = 1
    else if (k === "k" || k === "up") delta = -cols
    else if (k === "j" || k === "down") delta = cols
  }
  i = i + delta
  if (i < 0) i = 0
  if (i > total - 1) i = total - 1
  return i
}

function jumpCursor(nOrIndex, count, maybeN) {
  var current = 0
  var total
  var num
  if (arguments.length >= 3) {
    current = Number(nOrIndex)
    if (!isFinite(current)) current = 0
    total = Number(count)
    num = Number(maybeN)
  } else {
    num = Number(nOrIndex)
    total = Number(count)
  }
  if (!isFinite(total) || total < 1) return 0
  if (num >= 1 && num <= 9 && num <= total) return num - 1
  return current
}

function emptyStage(valid) {
  return {
    valid: valid !== false,
    workspaces: [],
    windows: [],
    parked: [],
    layout: [],
    monitors: [],
    monitorSizes: {},
    lastWorkspace: null
  }
}

function parseStage(clientsJson, workspacesJson, monitorsJson) {
  if (typeof clientsJson === "string" &&
      !isWithinUtf8ByteLimit(clientsJson, MAX_COMPOSITOR_OUTPUT_BYTES_VALUE)) return emptyStage(false)
  if (typeof workspacesJson === "string" &&
      !isWithinUtf8ByteLimit(workspacesJson, MAX_COMPOSITOR_OUTPUT_BYTES_VALUE)) return emptyStage(false)
  if (typeof monitorsJson === "string" &&
      !isWithinUtf8ByteLimit(monitorsJson, MAX_COMPOSITOR_OUTPUT_BYTES_VALUE)) return emptyStage(false)
  var clientsResult = parseJsonList(clientsJson, MAX_STAGE_CLIENTS_VALUE)
  var workspacesResult = parseJsonList(workspacesJson, MAX_STAGE_WORKSPACES_VALUE)
  var monitorsResult = parseJsonList(monitorsJson, MAX_STAGE_MONITORS_VALUE)
  if (!clientsResult.ok || !workspacesResult.ok || !monitorsResult.ok) return emptyStage(false)
  var clients = clientsResult.list
  var workspaces = workspacesResult.list
  var monitorsInput = monitorsResult.list
  var layout = parseLayout(monitorsInput, workspaces)
  var layouts = workspaceLayoutIndex(workspaces)
  var monitors = connectedMonitorNames(monitorsInput, workspaces)
  var groups = {}
  var windows = []
  var parked = []
  var i
  for (i = 0; i < clients.length; i++) {
    var client = clients[i]
    var lot = parseParkedLot(client)
    if (lot) {
      var lotMeta = layouts.lots[String(lot.slug) + ":" + String(lot.n)] || {}
      parked.push(copyGeom({
        slug: lot.slug,
        n: lot.n,
        address: boundedToken(client.address, MAX_ADDRESS_CHARS_VALUE),
        class: boundedText(client.class, MAX_COMPOSITOR_TEXT_CHARS_VALUE, ""),
        initialClass: boundedText(client.initialClass, MAX_COMPOSITOR_TEXT_CHARS_VALUE, ""),
        title: boundedText(client.title, MAX_COMPOSITOR_TEXT_CHARS_VALUE, ""),
        floating: !!client.floating,
        monitor: monitorName(client, workspaces),
        hyprId: lotMeta.hyprId,
        tiledLayout: lotMeta.tiledLayout || "dwindle"
      }, client))
      continue
    }
    var n = clientWorkspaceN(client)
    if (n < 1 || n > 10) continue
    var win = copyGeom({
      address: boundedToken(client.address, MAX_ADDRESS_CHARS_VALUE),
      class: boundedText(client.class, MAX_COMPOSITOR_TEXT_CHARS_VALUE, ""),
      initialClass: boundedText(client.initialClass, MAX_COMPOSITOR_TEXT_CHARS_VALUE, ""),
      title: boundedText(client.title, MAX_COMPOSITOR_TEXT_CHARS_VALUE, ""),
      floating: !!client.floating,
      monitor: monitorName(client, workspaces),
      workspace: n
    }, client)
    windows.push(win)
    if (!groups[n]) groups[n] = []
    groups[n].push(win)
  }
  var wsOut = []
  for (n = 1; n <= 10; n++) {
    if (groups[n] && groups[n].length) {
      var numMeta = layouts.numbered[n] || {}
      wsOut.push({
        n: n,
        windows: groups[n],
        monitor: monitorForWorkspace(n, layout, groups[n], workspaces),
        hyprId: numMeta.hyprId != null ? numMeta.hyprId : n,
        tiledLayout: numMeta.tiledLayout || "dwindle"
      })
    }
  }
  return {
    valid: true,
    workspaces: wsOut,
    windows: windows,
    parked: parked,
    layout: layout,
    monitors: monitors,
    monitorSizes: parseMonitorSizes(monitorsInput),
    lastWorkspace: pickLastWorkspace(workspaces, wsOut, layout)
  }
}

function sanitizeSlug(name) {
  var s = boundedText(name, MAX_DESK_NAME_CHARS_VALUE, "").toLowerCase()
  if (s.indexOf("omadesk-") === 0) s = s.slice(8)
  s = s.replace(/[^a-z0-9]+/g, "-")
  s = s.replace(/-+/g, "-")
  s = s.replace(/^-/, "")
  s = s.replace(/-$/, "")
  if (s === "") return "unnamed"
  if (s.length > MAX_DESK_ID_CHARS_VALUE) {
    s = s.slice(0, MAX_DESK_ID_CHARS_VALUE).replace(/-+$/, "")
  }
  if (s === "") return "unnamed"
  return s
}

function slugify(name) {
  return sanitizeSlug(name)
}

function parkLotName(slug, n) {
  return "omadesk-" + sanitizeSlug(slug) + "-" + String(n)
}

function parkSelector(slug, n) {
  return "special:" + parkLotName(slug, n)
}

function normalizeTiledLayout(value) {
  var s = String(value || "").toLowerCase()
  if (s === "scrolling" || s === "scroll") return "scrolling"
  return "dwindle"
}

function nextTiledLayout(value) {
  return normalizeTiledLayout(value) === "scrolling" ? "dwindle" : "scrolling"
}

function hasHyprWorkspaceId(hyprId) {
  if (hyprId == null || hyprId === "") return false
  var n = Number(hyprId)
  return isFinite(n) && n !== 0
}

function workspaceLayoutTarget(tile, slug, here) {
  var n = focusWorkspaceN(tile && tile.n != null ? tile.n : tile)
  if (!n) return ""
  var id = tile && tile.hyprId
  if (hasHyprWorkspaceId(id)) {
    var live = Number(id)
    if (live > 0) return String(live)
    // A negative id means the tile lives in a special workspace, which has to be
    // addressed by name: see workspaceLayoutSelector.
    return parkSelector(slug, n)
  }
  if (here) return String(n)
  return parkSelector(slug, n)
}

function workspaceLayoutPersistId(target) {
  var t = boundedToken(target, MAX_WORKSPACE_NAME_CHARS_VALUE)
  if (!t) return ""
  if (t.indexOf("special:") === 0) t = t.slice(8)
  if (/^[0-9]+$/.test(t)) return t
  if (/^-/.test(t)) return ""
  t = t.replace(/[^A-Za-z0-9._-]+/g, "-")
  t = t.replace(/^-+/, "").replace(/-+$/, "")
  return t
}

// Hyprland reads a leading "-" as a workspace offset relative to the focused
// workspace, so "-98" resolves to "98 workspaces back", clamped to workspace 1.
// A rule persisted under a bare negative id therefore retargets workspace 1 on
// every config reload instead of the special workspace it came from.
function workspaceLayoutSelector(target) {
  var ws = safeDispatchToken(target)
  if (!ws) return ""
  if (/^-/.test(ws)) return ""
  return ws
}

function workspaceLayoutRuleLua(target, layout) {
  var ws = workspaceLayoutSelector(target)
  if (!ws) return ""
  return "hl.workspace_rule({ workspace = \"" + ws + "\", layout = \"" + normalizeTiledLayout(layout) + "\" })\n"
}

function workspaceLayoutKeyword(target, layout) {
  var ws = workspaceLayoutSelector(target)
  if (!ws) return ""
  return ws + ", layout:" + normalizeTiledLayout(layout)
}

function workspaceLayoutsDir(home, stateHome) {
  var xdg = String(stateHome || "").trim()
  if (xdg) return xdg + "/omarchy/workspace-layouts"
  return String(home || "") + "/.local/state/omarchy/workspace-layouts"
}

function workspaceLayoutApplyArgv(dir, target, layout) {
  var folder = String(dir || "")
  var ws = workspaceLayoutPersistId(target)
  if (!folder || !ws) return []
  var lua = workspaceLayoutRuleLua(target, layout).replace(/\n+$/, "")
  if (!lua) return []
  // Files named after a bare negative id hold a relative selector that steals
  // workspace 1 every time Omarchy's loader re-runs the directory, so drop them
  // and reload once so the stale rules leave the running compositor too.
  return [
    "bash",
    "-c",
    "mkdir -p -- \"$1\" || exit 0; cleaned=0; for f in \"$1\"/-*.lua; do [ -f \"$f\" ] || continue; cleaned=1; rm -f -- \"$f\"; done; printf '%s\\n' \"$2\" > \"$3\" || exit 0; hyprctl eval \"$2\" >/dev/null 2>&1 || true; if [ \"$cleaned\" = 1 ]; then hyprctl reload config-only >/dev/null 2>&1 || true; fi; exit 0",
    "omadesk-layout",
    folder,
    lua,
    folder + "/" + ws + ".lua"
  ]
}

function workspaceLayoutIndex(workspacesJson) {
  var list = parseJsonArg(workspacesJson, MAX_STAGE_WORKSPACES_VALUE)
  var numbered = {}
  var lots = {}
  var i
  for (i = 0; i < list.length; i++) {
    var ws = list[i]
    if (!ws) continue
    var meta = {
      hyprId: ws.id,
      tiledLayout: normalizeTiledLayout(ws.tiledLayout)
    }
    var n = numberedWorkspaceId(ws)
    if (n) numbered[n] = meta
    var lot = parseParkedLot({ workspace: ws })
    if (lot) lots[String(lot.slug) + ":" + String(lot.n)] = meta
  }
  return { numbered: numbered, lots: lots }
}

function moveDispatch(workspaceSelector, address) {
  var ws = safeDispatchToken(workspaceSelector)
  var addr = windowSelector(address)
  if (!ws || !addr) return ""
  return "hl.dsp.window.move({ workspace = \"" + ws + "\", follow = false, window = \"" + addr + "\" })"
}

function sameDeskMoveDispatch(address, fromN, toN, slug, here) {
  var dest = focusWorkspaceN(toN)
  if (!dest || !windowSelector(address)) return ""
  var src = focusWorkspaceN(fromN)
  if (src && src === dest) return ""
  var ws = here ? String(dest) : parkSelector(slug || "unnamed", dest)
  return moveDispatch(ws, address)
}

function closeDispatch(address) {
  var addr = windowSelector(address)
  if (!addr) return ""
  return "hl.dsp.window.close({ window = \"" + addr + "\" })"
}

function focusDispatch(workspaceSelector) {
  var ws = safeDispatchToken(workspaceSelector)
  if (!ws) return ""
  return "hl.dsp.focus({ workspace = \"" + ws + "\" })"
}

function workspaceMoveDispatch(workspaceSelector, monitor) {
  var ws = safeDispatchToken(workspaceSelector)
  var mon = safeMonitor(monitor)
  if (!ws || !mon) return ""
  return "hl.dsp.workspace.move({ workspace = \"" + ws + "\", monitor = \"" + mon + "\" })"
}

function safeDispatchToken(value) {
  return boundedToken(value, MAX_WORKSPACE_NAME_CHARS_VALUE)
}

function safeMonitor(name) {
  return boundedToken(name, MAX_MONITOR_NAME_CHARS_VALUE)
}

function parkPlan(stage, slug, toSlug, desk) {
  var park = buildParkPlan(stage, slug)
  if (toSlug == null || toSlug === "") return park
  var restore = restorePlan(stage, toSlug, desk)
  var last = null
  if (desk && desk.lastWorkspace != null) last = desk.lastWorkspace
  else if (desk && desk.recipe && desk.recipe.lastWorkspace != null) last = desk.recipe.lastWorkspace
  last = focusWorkspaceN(last)
  if (!last) last = parkedToStage(parkedForSlug(stage, toSlug)).lastWorkspace
  last = focusWorkspaceN(last) || 1
  return {
    park: park,
    restore: restore,
    sequential: true,
    lastWorkspace: last
  }
}

function focusWorkspaceN(value) {
  var n = Number(value)
  if (isFinite(n) && n >= 1 && n <= 10) return n
  return null
}

function buildParkPlan(stage, slug) {
  var clean = sanitizeSlug(slug)
  var dispatches = []
  var seen = {}
  var list = stageWindows(stage)
  var i
  for (i = 0; i < list.length; i++) {
    var win = list[i]
    if (!win || !win.address) continue
    // Number("special:scratchpad") is NaN, and NaN < 1 / NaN > 10 are both false.
    if (isScratchpadish(win)) continue
    var n = clientWorkspaceN(win)
    if (n < 1 || n > 10) continue
    var lua = moveDispatch(parkSelector(clean, n), win.address)
    if (lua) {
      dispatches.push(lua)
      seen[stripAddress(win.address)] = true
    }
  }
  // Leftover lots of this slug can sit on a visible named workspace
  // (omadesk-<slug>-N without special:). Re-home them onto the hidden
  // special so a switch does not leave that desk's windows on screen.
  var parked = parkedForSlug(stage, clean)
  for (i = 0; i < parked.length; i++) {
    var p = parked[i]
    if (!p || !p.address) continue
    if (seen[stripAddress(p.address)]) continue
    var pn = Number(p.n)
    if (pn < 1 || pn > 10) continue
    var parkedLua = moveDispatch(parkSelector(clean, pn), p.address)
    if (parkedLua) dispatches.push(parkedLua)
  }
  return { slug: clean, dispatches: dispatches, batch: joinBatch(dispatches) }
}

function restoreFromPark(park) {
  var dispatches = []
  var list = (park && park.dispatches) || []
  var i
  for (i = 0; i < list.length && i < MAX_STAGE_CLIENTS_VALUE; i++) {
    var lua = String(list[i] || "")
    var ws = /workspace = "(?:special:)?(?:name:)?omadesk-[^"]+-([0-9]+)"/.exec(lua)
    var addr = /window = "(address:[^"]+|0x[^"]+)"/.exec(lua)
    if (!ws || !addr) continue
    var back = moveDispatch(ws[1], addr[1])
    if (back) dispatches.push(back)
  }
  return { slug: park && park.slug ? park.slug : "", dispatches: dispatches, batch: joinBatch(dispatches) }
}

function restorePlan(clientsJson, slug, desk) {
  var clean = sanitizeSlug(slug || (desk && (desk.id || desk.name)))
  var clients = clientsForRestore(clientsJson)
  var dispatches = []
  var i
  for (i = 0; i < clients.length; i++) {
    var client = clients[i]
    var n = parkedClientLot(client, clean)
    if (!n) continue
    if (!client.address) continue
    var lua = moveDispatch(String(n), client.address)
    if (lua) dispatches.push(lua)
  }
  var connected = []
  if (clientsJson && isArray(clientsJson.monitors)) connected = copyStrings(clientsJson.monitors)
  var layoutMoves = layoutDispatches(desk, connected)
  for (i = 0; i < layoutMoves.length; i++) {
    if (layoutMoves[i]) dispatches.push(layoutMoves[i])
  }
  return {
    slug: clean,
    dispatches: dispatches,
    layout: layoutMoves,
    batch: joinBatch(dispatches)
  }
}

function readDesks(text) {
  if (text == null) return packRead(true, emptyState(), "")
  var raw = String(text)
  if (!isWithinUtf8ByteLimit(raw, MAX_DESKS_FILE_BYTES_VALUE)) {
    return packRead(false, emptyState(), "state file exceeds " + MAX_DESKS_FILE_BYTES_VALUE + " bytes")
  }
  if (raw.replace(/\s+/g, "") === "") return packRead(true, emptyState(), "")
  var parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return packRead(false, emptyState(), "invalid JSON: " + errorMessage(err))
  }
  if (!parsed || typeof parsed !== "object" || isArray(parsed)) {
    return packRead(false, emptyState(), "invalid JSON: expected a desks object")
  }
  var version = parsed.version
  if (version !== 1 && version !== 2) {
    return packRead(false, emptyState(), "unsupported version (version 1 or 2 required)")
  }
  var schemaError = validatePersistedState(parsed, version)
  if (schemaError) return packRead(false, emptyState(), "invalid state: " + schemaError)
  // v1 stored a window recipe per workspace. Placement now comes from Hyprland,
  // so those are dropped on read; identity, extras and the monitor map carry over.
  return packRead(true, normalizeState(parsed), "", version)
}

function validatePersistedState(state, version) {
  var topError = unexpectedKey(state, { version: true, currentId: true, desks: true })
  if (topError) return "unexpected top-level field " + topError
  if (!isArray(state.desks)) return "desks must be an array"
  if (state.desks.length > MAX_DESK_COUNT_VALUE) {
    return "desk count exceeds " + MAX_DESK_COUNT_VALUE
  }
  if (state.currentId != null) {
    var currentError = validateIdentifier(state.currentId, true, true)
    if (currentError) return "currentId " + currentError
  }

  var seen = {}
  var i
  for (i = 0; i < state.desks.length; i++) {
    var desk = state.desks[i]
    if (!desk || typeof desk !== "object" || isArray(desk)) return "desk " + i + " must be an object"
    var allowed = version === 1
      ? { id: true, name: true, lastWorkspace: true, updatedAt: true, lastUsed: true, extras: true, layout: true, recipe: true, workspaces: true, monitorSizes: true }
      : { id: true, name: true, lastWorkspace: true, updatedAt: true, lastUsed: true, extras: true, layout: true }
    var deskKeyError = unexpectedKey(desk, allowed)
    if (deskKeyError) return "desk " + i + " has unexpected field " + deskKeyError

    var idError = validateIdentifier(desk.id, false, version === 1)
    if (idError) return "desk " + i + " id " + idError
    var seenId = "$" + desk.id
    if (seen[seenId]) return "desk " + i + " duplicates id " + desk.id
    seen[seenId] = true

    var nameError = validatePersistedString(desk.name, MAX_DESK_NAME_CHARS_VALUE, false)
    if (nameError) return "desk " + i + " name " + nameError
    if (desk.lastWorkspace != null && !validWorkspaceNumber(desk.lastWorkspace)) {
      return "desk " + i + " lastWorkspace must be an integer from 1 to 10 or null"
    }
    if (desk.updatedAt != null && desk.updatedAt !== "") {
      var updatedError = validatePersistedString(desk.updatedAt, MAX_TIMESTAMP_CHARS_VALUE, false)
      if (updatedError) return "desk " + i + " updatedAt " + updatedError
      if (!isFinite(Date.parse(desk.updatedAt))) return "desk " + i + " updatedAt must be a timestamp"
    }
    if (desk.lastUsed != null) {
      if (typeof desk.lastUsed !== "number" || !isFinite(desk.lastUsed) || desk.lastUsed < 0 || desk.lastUsed > 8640000000000000) {
        return "desk " + i + " lastUsed must be a finite timestamp"
      }
    }

    var extrasError = validatePersistedExtras(desk.extras, version)
    if (extrasError) return "desk " + i + " extras " + extrasError
    var layoutError = validatePersistedLayout(desk.layout, "layout")
    if (layoutError) return "desk " + i + " " + layoutError
    if (version === 1) {
      var legacyError = validateLegacyPlacement(desk, i)
      if (legacyError) return legacyError
      var sizesError = validateLegacyMonitorSizes(desk.monitorSizes)
      if (sizesError) return "desk " + i + " monitorSizes " + sizesError
    }
  }
  return ""
}

function unexpectedKey(value, allowed) {
  var key
  for (key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue
    if (!Object.prototype.hasOwnProperty.call(allowed, key) || !allowed[key]) {
      return boundedText(key, 64, "field")
    }
  }
  return ""
}

function validatePersistedString(value, maxChars, allowEmpty) {
  if (typeof value !== "string") return "must be a string"
  if (!allowEmpty && value.length === 0) return "must not be empty"
  if (value.length > maxChars) return "exceeds " + maxChars + " characters"
  if (/[\u0000-\u001f\u007f]/.test(value)) return "contains control characters"
  return ""
}

function validateIdentifier(value, allowNull, allowUnsaved) {
  if (allowNull && value == null) return ""
  var error = validatePersistedString(value, MAX_DESK_ID_CHARS_VALUE, false)
  if (error) return error
  if (allowUnsaved && value === "unnamed") return ""
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) return "must be a canonical lowercase desk identifier"
  if (value === "unnamed" || value.indexOf("omadesk-") === 0 || sanitizeSlug(value) !== value) {
    return "uses a reserved or non-round-tripping desk identifier"
  }
  return ""
}

function validWorkspaceNumber(value) {
  return typeof value === "number" && isFinite(value) && Math.floor(value) === value && value >= 1 && value <= 10
}

function validatePersistedExtras(extras, version) {
  if (extras == null) return ""
  if (typeof extras !== "object" || isArray(extras)) return "must be an object"
  var allowed = version === 1
    ? { dnd: true, theme: true, launchMissing: true }
    : { dnd: true, theme: true }
  var keyError = unexpectedKey(extras, allowed)
  if (keyError) return "has unexpected field " + keyError
  if (extras.dnd != null && extras.dnd !== "leave" && extras.dnd !== "on" && extras.dnd !== "off") {
    return "dnd must be leave, on, or off"
  }
  if (extras.theme != null) {
    var themeError = validatePersistedString(extras.theme, MAX_DESK_NAME_CHARS_VALUE, false)
    if (themeError) return "theme " + themeError
  }
  if (version === 1 && extras.launchMissing != null && typeof extras.launchMissing !== "boolean") {
    return "launchMissing must be boolean"
  }
  return ""
}

function validatePersistedLayout(layout, label) {
  if (layout == null) return ""
  if (!isArray(layout)) return label + " must be an array"
  if (layout.length > MAX_LAYOUT_ROWS_VALUE) return label + " exceeds " + MAX_LAYOUT_ROWS_VALUE + " rows"
  var seen = {}
  var i
  for (i = 0; i < layout.length; i++) {
    var row = layout[i]
    if (!row || typeof row !== "object" || isArray(row)) return label + " row " + i + " must be an object"
    var keyError = unexpectedKey(row, { n: true, monitor: true, focused: true })
    if (keyError) return label + " row " + i + " has unexpected field " + keyError
    if (!validWorkspaceNumber(row.n)) return label + " row " + i + " n must be an integer from 1 to 10"
    if (seen[row.n]) return label + " duplicates workspace " + row.n
    seen[row.n] = true
    var monitorError = validatePersistedString(row.monitor, MAX_MONITOR_NAME_CHARS_VALUE, false)
    if (monitorError) return label + " row " + i + " monitor " + monitorError
    if (!safeMonitor(row.monitor)) return label + " row " + i + " monitor is not safe"
    if (row.focused != null && typeof row.focused !== "boolean") {
      return label + " row " + i + " focused must be boolean"
    }
  }
  return ""
}

function validateLegacyPlacement(desk, deskIndex) {
  var sources = []
  if (desk.workspaces != null) sources.push({ label: "workspaces", value: desk.workspaces })
  if (desk.recipe != null) {
    if (typeof desk.recipe !== "object" || isArray(desk.recipe)) {
      return "desk " + deskIndex + " recipe must be an object"
    }
    var recipeKeyError = unexpectedKey(desk.recipe, { lastWorkspace: true, workspaces: true })
    if (recipeKeyError) return "desk " + deskIndex + " recipe has unexpected field " + recipeKeyError
    if (desk.recipe.lastWorkspace != null && !validWorkspaceNumber(desk.recipe.lastWorkspace)) {
      return "desk " + deskIndex + " recipe lastWorkspace must be an integer from 1 to 10"
    }
    if (desk.recipe.workspaces != null) sources.push({ label: "recipe.workspaces", value: desk.recipe.workspaces })
  }
  var i
  var j
  var windowCount = 0
  for (i = 0; i < sources.length; i++) {
    var source = sources[i]
    if (!isArray(source.value)) return "desk " + deskIndex + " " + source.label + " must be an array"
    if (source.value.length > MAX_LAYOUT_ROWS_VALUE) {
      return "desk " + deskIndex + " " + source.label + " exceeds " + MAX_LAYOUT_ROWS_VALUE + " rows"
    }
    for (j = 0; j < source.value.length; j++) {
      var row = source.value[j]
      if (!row || typeof row !== "object" || isArray(row)) {
        return "desk " + deskIndex + " " + source.label + " row " + j + " must be an object"
      }
      var rowKeyError = unexpectedKey(row, { n: true, monitor: true, focused: true, windows: true })
      if (rowKeyError) {
        return "desk " + deskIndex + " " + source.label + " row " + j + " has unexpected field " + rowKeyError
      }
      if (!validWorkspaceNumber(row.n)) {
        return "desk " + deskIndex + " " + source.label + " row " + j + " has invalid n"
      }
      if (row.monitor != null) {
        var monitorError = validatePersistedString(row.monitor, MAX_MONITOR_NAME_CHARS_VALUE, false)
        if (monitorError || !safeMonitor(row.monitor)) {
          return "desk " + deskIndex + " " + source.label + " row " + j + " has invalid monitor"
        }
      }
      if (row.focused != null && typeof row.focused !== "boolean") {
        return "desk " + deskIndex + " " + source.label + " row " + j + " has invalid focused"
      }
      if (!isArray(row.windows)) {
        return "desk " + deskIndex + " " + source.label + " row " + j + " has invalid windows"
      }
      windowCount += row.windows.length
      if (windowCount > MAX_STAGE_CLIENTS_VALUE) {
        return "desk " + deskIndex + " legacy window count exceeds " + MAX_STAGE_CLIENTS_VALUE
      }
      var k
      for (k = 0; k < row.windows.length; k++) {
        var windowError = validateLegacyWindow(row.windows[k])
        if (windowError) {
          return "desk " + deskIndex + " " + source.label + " row " + j + " window " + k + " " + windowError
        }
      }
    }
  }
  return ""
}

function validateLegacyWindow(win) {
  if (!win || typeof win !== "object" || isArray(win)) return "must be an object"
  var keyError = unexpectedKey(win, {
    class: true,
    initialClass: true,
    title: true,
    exec: true,
    floating: true,
    monitor: true,
    address: true,
    x: true,
    y: true,
    w: true,
    h: true,
    fullscreen: true,
    cwd: true,
    cmd: true,
    profile: true,
    icon: true
  })
  if (keyError) return "has unexpected field " + keyError

  var stringFields = ["class", "initialClass", "title", "icon"]
  var i
  for (i = 0; i < stringFields.length; i++) {
    var field = stringFields[i]
    if (win[field] == null) continue
    var stringError = validatePersistedString(win[field], MAX_COMPOSITOR_TEXT_CHARS_VALUE, true)
    if (stringError) return field + " " + stringError
  }
  var longStringFields = ["cwd", "profile"]
  for (i = 0; i < longStringFields.length; i++) {
    field = longStringFields[i]
    if (win[field] == null) continue
    stringError = validatePersistedString(win[field], MAX_LEGACY_TEXT_CHARS_VALUE, true)
    if (stringError) return field + " " + stringError
  }
  if (win.monitor != null) {
    var monitorError = validatePersistedString(win.monitor, MAX_MONITOR_NAME_CHARS_VALUE, true)
    if (monitorError || (win.monitor !== "" && !safeMonitor(win.monitor))) return "monitor is invalid"
  }
  if (win.address != null) {
    var addressError = validatePersistedString(win.address, MAX_ADDRESS_CHARS_VALUE, true)
    if (addressError || (win.address !== "" && !boundedToken(win.address, MAX_ADDRESS_CHARS_VALUE))) {
      return "address is invalid"
    }
  }
  if (win.floating != null && typeof win.floating !== "boolean") return "floating must be boolean"

  var numericFields = ["x", "y", "w", "h"]
  for (i = 0; i < numericFields.length; i++) {
    field = numericFields[i]
    if (win[field] == null) continue
    if (typeof win[field] !== "number" || !isFinite(win[field]) ||
        Math.abs(win[field]) > MAX_NUMERIC_MAGNITUDE_VALUE) {
      return field + " must be a bounded finite number"
    }
    if ((field === "w" || field === "h") && win[field] <= 0) return field + " must be positive"
  }
  if (win.fullscreen != null &&
      (typeof win.fullscreen !== "number" || !isFinite(win.fullscreen) ||
       Math.floor(win.fullscreen) !== win.fullscreen || win.fullscreen < 0 || win.fullscreen > 3)) {
    return "fullscreen must be an integer from 0 to 3"
  }

  var execError = validateLegacyArgv(win.exec, "exec")
  if (execError) return execError
  var cmdError = validateLegacyArgv(win.cmd, "cmd")
  if (cmdError) return cmdError
  return ""
}

function validateLegacyArgv(argv, label) {
  if (argv == null) return ""
  if (!isArray(argv)) return label + " must be an array"
  if (argv.length > MAX_LEGACY_ARGV_VALUE) return label + " exceeds " + MAX_LEGACY_ARGV_VALUE + " arguments"
  var i
  for (i = 0; i < argv.length; i++) {
    var error = validatePersistedString(argv[i], MAX_LEGACY_TEXT_CHARS_VALUE, true)
    if (error) return label + " argument " + i + " " + error
  }
  return ""
}

function validateLegacyMonitorSizes(sizes) {
  if (sizes == null) return ""
  if (typeof sizes !== "object" || isArray(sizes)) return "must be an object"
  var count = 0
  var name
  for (name in sizes) {
    if (!Object.prototype.hasOwnProperty.call(sizes, name)) continue
    count += 1
    if (count > MAX_STAGE_MONITORS_VALUE) return "exceeds " + MAX_STAGE_MONITORS_VALUE + " monitors"
    var nameError = validatePersistedString(name, MAX_MONITOR_NAME_CHARS_VALUE, false)
    if (nameError || !safeMonitor(name)) return "has invalid monitor name"
    var row = sizes[name]
    if (!row || typeof row !== "object" || isArray(row)) return name + " must be an object"
    var keyError = unexpectedKey(row, { w: true, h: true, width: true, height: true })
    if (keyError) return name + " has unexpected field " + keyError
    var width = row.w != null ? row.w : row.width
    var height = row.h != null ? row.h : row.height
    if (typeof width !== "number" || !isFinite(width) || width <= 0 ||
        width > MAX_NUMERIC_MAGNITUDE_VALUE) return name + " has invalid width"
    if (typeof height !== "number" || !isFinite(height) || height <= 0 ||
        height > MAX_NUMERIC_MAGNITUDE_VALUE) return name + " has invalid height"
  }
  return ""
}

function writeDesks(state) {
  return JSON.stringify(normalizeState(state), null, 2) + "\n"
}

function iconName(win) {
  var names = iconNames(win)
  return names.length ? names[0] : ""
}

function iconNames(win) {
  var cls = boundedText((win && (win.class || win.initialClass)), MAX_COMPOSITOR_TEXT_CHARS_VALUE, "")
  var lower = cls.toLowerCase()
  var last = lastClassSegment(lower)
  var out = []
  var mapped = mappedIcon(lower, last)
  if (mapped) out.push(mapped)
  if (cls && out.indexOf(cls) === -1) out.push(cls)
  if (last && out.indexOf(last) === -1) out.push(last)
  return out
}

function mappedIcon(lower, last) {
  var s = String(lower || "")
  var tail = String(last || "")
  if (s.indexOf("geforce") >= 0) return "com.nvidia.geforcenow"
  if (s.indexOf("chrome-") === 0) return "chromium"
  if (s.indexOf("ghostty") >= 0 || tail === "ghostty") return "com.mitchellh.ghostty"
  if (tail === "zed") return "zed"
  if (tail === "chromium" || tail === "chrome" || tail === "google-chrome") return "chromium"
  if (tail === "firefox" || tail === "firefox-esr") return "firefox"
  if (tail === "nautilus") return "org.gnome.Nautilus"
  if (tail === "code" || s === "code - oss") return "code"
  if (s.indexOf("obsproject") >= 0) return "com.obsproject.Studio"
  return ""
}

// Saving a desk records who it is, not what is in it: the windows stay where
// Hyprland already has them and are found again by lot name.
function newDeskRow(stage, name, extras, lastWorkspace, nowIso) {
  var last = lastWorkspace
  if (last == null && stage) last = stage.lastWorkspace
  if (last == null || last === "") last = null
  else last = Number(last)
  if (name == null || boundedDisplayName(name, "").replace(/^\s+|\s+$/g, "") === "") {
    return { lastWorkspace: last }
  }
  var display = boundedDisplayName(name, "")
  var desk = {
    id: uniqueId(slugify(display)),
    name: display,
    lastWorkspace: last,
    updatedAt: nowIso ? boundedText(nowIso, MAX_TIMESTAMP_CHARS_VALUE, "") : "",
    extras: mergeExtras(defaultExtras(), extras)
  }
  var layout = liveLayoutMap(stage)
  if (layout.length) desk.layout = layout
  return desk
}

// Parking lots do not remember which monitor a workspace was on, so the desk
// row keeps that map. It is re-read from the compositor on every park, so it
// tracks reality instead of aging like the old window recipes did.
function liveLayoutMap(stage) {
  if (stage && isArray(stage.layout) && stage.layout.length) return normalizeLayout(stage.layout)
  return deskLayout({ workspaces: (stage && stage.workspaces) || [] })
}

function uniqueId(base, existingIds) {
  var id = sanitizeSlug(base)
  var taken = idSet(existingIds)
  // Unsaved rooms park on omadesk-unnamed-N; a saved desk must not reuse that id.
  taken.$unnamed = true
  if (!taken["$" + id]) return id
  var n = 2
  while (true) {
    var suffix = "-" + n
    var stem = id.slice(0, Math.max(1, MAX_DESK_ID_CHARS_VALUE - suffix.length)).replace(/-+$/, "")
    var candidate = stem + suffix
    if (!taken["$" + candidate]) return candidate
    n++
  }
}

function saveDesk(state, recipe) {
  var next = normalizeState(state)
  if (next.desks.length >= MAX_DESK_COUNT_VALUE) return null
  var desk = normalizeDesk(recipe)
  if (!desk) return next
  var ids = []
  var i
  for (i = 0; i < next.desks.length; i++) ids.push(next.desks[i].id)
  desk.id = uniqueId(desk.id || desk.name, ids)
  next.desks.push(desk)
  next.currentId = desk.id
  return next
}

function demoDesks() {
  return {
    version: 2,
    currentId: "writing",
    desks: [
      {
        id: "writing",
        name: "Writing",
        lastWorkspace: 3,
        updatedAt: "2026-08-19T16:40:00Z",
        extras: defaultExtras(),
        layout: [{ n: 1, monitor: "DP-1" }]
      },
      {
        id: "call",
        name: "Call",
        lastWorkspace: 1,
        updatedAt: "2026-08-19T13:40:00Z",
        extras: mergeExtras(defaultExtras(), { dnd: "on" })
      },
      {
        id: "review",
        name: "Review",
        lastWorkspace: 1,
        updatedAt: "2026-08-18T16:40:00Z",
        extras: defaultExtras()
      }
    ]
  }
}

function switchPlan(stage, clientsJson, fromSlug, toSlug, desk) {
  return parkPlan(stage, fromSlug == null || fromSlug === "" ? "unnamed" : fromSlug, toSlug, desk)
}

function freshPlan(stage, fromSlug) {
  return {
    park: parkPlan(stage, fromSlug == null || fromSlug === "" ? "unnamed" : fromSlug),
    restore: { slug: "", dispatches: [], batch: "" },
    sequential: true,
    lastWorkspace: 1,
    fresh: true
  }
}

function leaveDesk(state, nowMs) {
  var next = normalizeState(state)
  if (next.currentId) stampLastUsed(next, next.currentId, parseNow(nowMs))
  next.currentId = null
  return next
}

function useDesk(state, deskId, nowMs) {
  var next = normalizeState(state)
  var now = parseNow(nowMs)
  var to = deskId == null || deskId === "" ? null : boundedToken(deskId, MAX_DESK_ID_CHARS_VALUE)
  if (to && sanitizeSlug(to) === "unnamed") to = null
  if (to && !deskById(next, to)) to = null
  if (next.currentId && to && String(next.currentId) !== to) {
    stampLastUsed(next, next.currentId, now)
  }
  if (to) stampLastUsed(next, to, now)
  next.currentId = to
  return next
}

function currentSlug(state) {
  if (!state || state.currentId == null || state.currentId === "") return "unnamed"
  return sanitizeSlug(state.currentId)
}

function monitorAllowSet(connected) {
  if (!isArray(connected)) return null
  var allow = {}
  var i
  for (i = 0; i < connected.length && i < MAX_STAGE_MONITORS_VALUE; i++) {
    var nm = safeMonitor(connected[i])
    if (nm) allow[nm] = true
  }
  return allow
}

function pickConnectedMonitor(mon, allow) {
  mon = safeMonitor(mon)
  if (!mon) return ""
  if (allow && !allow[mon]) return ""
  return mon
}

// Refresh the workspace-to-monitor map for a desk from the live compositor.
// Called when a desk parks, so its lots can be put back on the right displays.
function refreshDeskLayout(state, deskId, stage, nowIso) {
  var next = normalizeState(state)
  var layout = liveLayoutMap(stage)
  var stamp = nowIso ? boundedText(nowIso, MAX_TIMESTAMP_CHARS_VALUE, "") : isoNow()
  var i
  for (i = 0; i < next.desks.length; i++) {
    if (next.desks[i].id !== deskId) continue
    next.desks[i].updatedAt = stamp
    next.desks[i].lastUsed = Date.parse(stamp) || Date.now()
    if (layout.length) next.desks[i].layout = layout
    break
  }
  return next
}

function renameDesk(state, deskId, newName) {
  var next = normalizeState(state)
  var display = boundedDisplayName(newName, "")
  if (!display) return next
  var i
  for (i = 0; i < next.desks.length; i++) {
    if (next.desks[i].id !== deskId) continue
    next.desks[i].name = display
    break
  }
  return next
}

function forgetDesk(state, deskId) {
  var next = normalizeState(state)
  var desks = []
  var i
  for (i = 0; i < next.desks.length; i++) {
    if (next.desks[i].id !== deskId) desks.push(next.desks[i])
  }
  next.desks = desks
  if (next.currentId === deskId) next.currentId = null
  return next
}

function cloneJson(value) {
  if (value == null) return value
  return JSON.parse(JSON.stringify(value))
}

function clampIndex(index, length) {
  if (index == null || index === "" || !isFinite(Number(index))) return length
  var n = Number(index)
  if (n < 0) return 0
  if (n > length) return length
  return n
}

function workspaceIndexByN(list, n) {
  var want = Number(n)
  if (!(want >= 1 && want <= 10) || !isArray(list)) return -1
  var i
  for (i = 0; i < list.length && i < 10; i++) {
    if (Number(list[i] && list[i].n) === want) return i
  }
  return -1
}

function freeWorkspaceN(list) {
  var taken = {}
  var i
  var n
  if (isArray(list)) {
    for (i = 0; i < list.length && i < 10; i++) {
      n = Number(list[i] && list[i].n)
      if (n >= 1 && n <= 10) taken[n] = true
    }
  }
  for (n = 1; n <= 10; n++) {
    if (!taken[n]) return n
  }
  return 0
}

function deskById(state, deskId) {
  if (!state || !isArray(state.desks) || deskId == null || deskId === "") return null
  var i
  for (i = 0; i < state.desks.length && i < MAX_DESK_COUNT_VALUE; i++) {
    if (String(state.desks[i].id) === String(deskId)) return state.desks[i]
  }
  return null
}

// Placement lives in Hyprland, so a workspace move is a batch of window
// dispatches rather than an edit to stored state. Both planners read addresses
// from the pre-move stage: every dispatch names one window, so the compositor
// can apply them in any order without the sets bleeding into each other.

function deskWorkspaceSelector(slug, n, here) {
  if (here) {
    var bare = focusWorkspaceN(n)
    return bare ? String(bare) : ""
  }
  return parkSelector(slug, n)
}

function deskWorkspaceAddresses(stage, slug, here, n) {
  var want = focusWorkspaceN(n)
  var out = []
  if (!want) return out
  var i
  if (here) {
    var live = stageWindows(stage)
    for (i = 0; i < live.length && out.length < MAX_STAGE_CLIENTS_VALUE; i++) {
      if (!live[i] || !live[i].address) continue
      if (clientWorkspaceN(live[i]) !== want) continue
      out.push(boundedToken(live[i].address, MAX_ADDRESS_CHARS_VALUE))
    }
    return out
  }
  var parked = parkedForSlug(stage, slug)
  for (i = 0; i < parked.length && i < MAX_STAGE_CLIENTS_VALUE; i++) {
    if (!parked[i] || !parked[i].address) continue
    if (Number(parked[i].n) !== want) continue
    out.push(boundedToken(parked[i].address, MAX_ADDRESS_CHARS_VALUE))
  }
  return out
}

function deskOccupiedWorkspaces(stage, slug, here) {
  var out = []
  var seen = {}
  var i
  var n
  if (here) {
    var live = stageWindows(stage)
    for (i = 0; i < live.length; i++) {
      n = clientWorkspaceN(live[i])
      if (!n || seen[n]) continue
      seen[n] = true
      out.push({ n: n })
    }
    return out
  }
  var parked = parkedForSlug(stage, slug)
  for (i = 0; i < parked.length; i++) {
    n = Number(parked[i] && parked[i].n)
    if (!(n >= 1 && n <= 10) || seen[n]) continue
    seen[n] = true
    out.push({ n: n })
  }
  return out
}

function packMovePlan(dispatches) {
  return { dispatches: dispatches, batch: joinBatch(dispatches) }
}

function swapWorkspacePlan(stage, slug, here, aN, bN) {
  var a = focusWorkspaceN(aN)
  var b = focusWorkspaceN(bN)
  if (!a || !b || a === b) return packMovePlan([])
  var aSel = deskWorkspaceSelector(slug, a, here)
  var bSel = deskWorkspaceSelector(slug, b, here)
  if (!aSel || !bSel) return packMovePlan([])
  var aWins = deskWorkspaceAddresses(stage, slug, here, a)
  var bWins = deskWorkspaceAddresses(stage, slug, here, b)
  var dispatches = []
  var i
  var lua
  for (i = 0; i < aWins.length; i++) {
    lua = moveDispatch(bSel, aWins[i])
    if (lua) dispatches.push(lua)
  }
  for (i = 0; i < bWins.length; i++) {
    lua = moveDispatch(aSel, bWins[i])
    if (lua) dispatches.push(lua)
  }
  return packMovePlan(dispatches)
}

function moveWorkspaceToDeskPlan(stage, fromSlug, fromHere, workspaceN, toSlug, toHere) {
  var n = focusWorkspaceN(workspaceN)
  if (!n) return packMovePlan([])
  if (sanitizeSlug(fromSlug) === sanitizeSlug(toSlug)) return packMovePlan([])
  var wins = deskWorkspaceAddresses(stage, fromSlug, fromHere, n)
  if (!wins.length) return packMovePlan([])
  var occupied = deskOccupiedWorkspaces(stage, toSlug, toHere)
  var dest = n
  if (workspaceIndexByN(occupied, n) >= 0) {
    dest = freeWorkspaceN(occupied)
    if (!dest) return packMovePlan([])
  }
  var sel = deskWorkspaceSelector(toSlug, dest, toHere)
  if (!sel) return packMovePlan([])
  var dispatches = []
  var i
  for (i = 0; i < wins.length; i++) {
    var lua = moveDispatch(sel, wins[i])
    if (lua) dispatches.push(lua)
  }
  return packMovePlan(dispatches)
}

function forgetRestorePlan(clientsJson, desk) {
  var slug = desk && typeof desk === "object" ? (desk.id || desk.name) : desk
  // Forgetting unparks onto 1-10 only. Layout moves belong to switching in.
  return restorePlan(clientsJson, slug, null)
}

function targetedNamedDesk(card, state) {
  if (!card || card.kind !== "desk") return null
  var id = card.id
  if (id == null || id === "") return null
  if (sanitizeSlug(id) === "unnamed") return null
  if (state && isArray(state.desks)) {
    var i
    for (i = 0; i < state.desks.length; i++) {
      if (String(state.desks[i].id) === String(id)) return state.desks[i]
    }
  }
  if (card.desk && String(card.desk.id) === String(id)) return card.desk
  return null
}

function shouldPersistSwitch(restoreOk, focusOk) {
  return !!restoreOk
}

function setExtras(state, deskId, extras) {
  var next = normalizeState(state)
  var i
  for (i = 0; i < next.desks.length; i++) {
    if (next.desks[i].id !== deskId) continue
    next.desks[i].extras = mergeExtras(next.desks[i].extras, extras)
    break
  }
  return next
}

function dndAction(extras) {
  var dnd = extras && extras.dnd
  if (dnd === "on") return "on"
  if (dnd === "off") return "off"
  return null
}

function themeAction(extras) {
  var theme = extras && extras.theme
  if (typeof theme !== "string" || theme === "" || theme.length > MAX_DESK_NAME_CHARS_VALUE) return null
  if (!theme || /[\u0000-\u001f\u007f]/.test(theme)) return null
  if (theme === "leave" || theme === "set" || theme === "set…") return null
  return theme
}

function extrasThemeNow(desk, extras, currentId) {
  if (!isCurrentDesk(desk, currentId)) return null
  return themeAction(extras)
}

function parseThemeList(text) {
  if (typeof text === "string" &&
      !isWithinUtf8ByteLimit(text, MAX_COMPOSITOR_OUTPUT_BYTES_VALUE)) return []
  var rawText = boundedText(text, MAX_COMPOSITOR_OUTPUT_BYTES_VALUE, "")
  var raw = rawText.split(/\r?\n/)
  var out = []
  var seen = {}
  var i
  for (i = 0; i < raw.length && out.length < MAX_THEME_NAMES_VALUE; i++) {
    if (raw[i].length > MAX_DESK_NAME_CHARS_VALUE) continue
    var name = raw[i].replace(/^\s+|\s+$/g, "")
    if (!name) continue
    if (/[\u0000-\u001f\u007f]/.test(name)) continue
    if (name.indexOf("Usage:") === 0) continue
    if (seen[name]) continue
    seen[name] = true
    out.push(name)
  }
  return out
}

function pickerCards(state, query, stage, nowMs) {
  var st = normalizeState(state || emptyState())
  var q = normalizeQuery(query)
  var desks = filterDesks(st.desks || [], q)
  var cards = []
  var i
  var unsaved = q === "" ? unsavedCard(st, stage) : null
  if (unsaved) cards.push(unsaved)
  for (i = 0; i < desks.length && cards.length < MAX_DESK_COUNT_VALUE + 1; i++) {
    var desk = desks[i]
    if (isUnsavedDesk(desk)) continue
    var here = isCurrentDesk(desk, st.currentId)
    var life = deskLife(desk, stage, st.currentId)
    cards.push({
      kind: "desk",
      id: desk.id,
      name: desk.name,
      here: here,
      life: life,
      dnd: !!(desk.extras && desk.extras.dnd === "on"),
      tiles: deskTiles(deskPreviewSource(desk, stage, st.currentId), 10, life === "live" || here),
      meta: deskSpaceMeta(desk, stage, st.currentId) + formatDeskMeta(desk, nowMs, here),
      desk: desk
    })
  }
  return cards
}

function unnamedParkedWindows(stage) {
  var parked = stage && isArray(stage.parked) ? stage.parked : []
  var out = []
  var i
  for (i = 0; i < parked.length && i < MAX_STAGE_CLIENTS_VALUE; i++) {
    if (parked[i] && parked[i].slug === "unnamed") out.push(parked[i])
  }
  return out
}

function parkedToStage(parked) {
  var groups = {}
  var windows = []
  var i
  var n
  for (i = 0; i < parked.length && windows.length < MAX_STAGE_CLIENTS_VALUE; i++) {
    var p = parked[i] || {}
    n = Number(p.n)
    var win = copyGeom({
      address: boundedToken(p.address, MAX_ADDRESS_CHARS_VALUE),
      class: boundedText(p.class, MAX_COMPOSITOR_TEXT_CHARS_VALUE, ""),
      initialClass: boundedText(p.initialClass, MAX_COMPOSITOR_TEXT_CHARS_VALUE, ""),
      title: boundedText(p.title, MAX_COMPOSITOR_TEXT_CHARS_VALUE, ""),
      floating: !!p.floating,
      monitor: safeMonitor(p.monitor),
      workspace: n,
      hyprId: p.hyprId,
      tiledLayout: normalizeTiledLayout(p.tiledLayout)
    }, p)
    windows.push(win)
    if (n >= 1 && n <= 10) {
      if (!groups[n]) groups[n] = []
      groups[n].push(win)
    }
  }
  var wss = []
  for (n = 1; n <= 10; n++) {
    if (groups[n]) {
      var first = groups[n][0] || {}
      wss.push({
        n: n,
        windows: groups[n],
        monitor: first.monitor,
        hyprId: first.hyprId,
        tiledLayout: normalizeTiledLayout(first.tiledLayout)
      })
    }
  }
  return { workspaces: wss, windows: windows, parked: [], lastWorkspace: wss.length ? wss[0].n : 1 }
}

function unsavedCard(state, stage) {
  var here = !state || isUnsavedCurrent(state.currentId)
  var parked = unnamedParkedWindows(stage)
  if (!here && !parked.length) return null
  // +new parks the untitled room then leaves currentId null; 1-10 is empty
  // and the windows sit on unnamed lots, so this is a parked unsaved room.
  if (here && parked.length && !stageWindows(stage).length) here = false
  var parkedStage = parkedToStage(parked)
  if (stage && stage.monitorSizes && parkedStage) parkedStage.monitorSizes = stage.monitorSizes
  var tiles = here ? deskTiles(stage, 10, true) : deskTiles(parkedStage, 10, true)
  return {
    kind: "unsaved",
    name: "Unsaved",
    here: !!here,
    dnd: false,
    tiles: tiles,
    meta: here ? "This Room Is Not Saved" : "Parked Untitled Room"
  }
}

function deskSpaceMeta(desk, stage, currentId) {
  var tiles = deskTiles(deskPreviewSource(desk, stage, currentId), 10, false)
  var used = 0
  var i
  for (i = 0; i < tiles.length; i++) {
    if (tiles[i] && !tiles[i].vacant) used += 1
  }
  var screens = deskScreenCount(desk)
  var extra = screens > 1 ? screens + " Screens · Last Used " : "Last Used "
  return used + " Space" + (used === 1 ? "" : "s") + " · " + extra
}

function deskScreenCount(desk) {
  var layout = deskLayout(desk)
  var seen = {}
  var n = 0
  var i
  for (i = 0; i < layout.length; i++) {
    var mon = safeMonitor(layout[i] && layout[i].monitor)
    if (!mon || seen[mon]) continue
    seen[mon] = true
    n += 1
  }
  return n
}

function deskLastUsedMs(desk) {
  var used = desk && desk.lastUsed != null && desk.lastUsed !== "" ? Number(desk.lastUsed) : NaN
  var updated = desk && desk.updatedAt ? Date.parse(desk.updatedAt) : NaN
  if (isFinite(used) && isFinite(updated)) return used >= updated ? used : updated
  if (isFinite(used)) return used
  if (isFinite(updated)) return updated
  return NaN
}

function formatDeskMeta(desk, nowMs, here) {
  if (here) return "Now"
  var then = deskLastUsedMs(desk)
  if (!isFinite(then)) return ""
  var now = parseNow(nowMs)
  var delta = now - then
  if (delta < 0) delta = 0
  if (delta < 60000) return "Now"
  if (delta < 3600000) {
    var mins = Math.floor(delta / 60000)
    return mins + (mins === 1 ? " Minute Ago" : " Minutes Ago")
  }
  if (delta < 86400000) {
    var hours = Math.floor(delta / 3600000)
    return hours + (hours === 1 ? " Hour Ago" : " Hours Ago")
  }
  var nowDate = new Date(now)
  var thenDate = new Date(then)
  var startToday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime()
  var startThen = new Date(thenDate.getFullYear(), thenDate.getMonth(), thenDate.getDate()).getTime()
  var dayDiff = Math.round((startToday - startThen) / 86400000)
  if (dayDiff === 1) return "Yesterday"
  if (dayDiff > 1) return dayDiff + " Days Ago"
  var hours2 = Math.floor(delta / 3600000)
  return hours2 + (hours2 === 1 ? " Hour Ago" : " Hours Ago")
}

function boundedText(value, maxChars, fallback) {
  if (value == null) return fallback == null ? "" : String(fallback)
  var type = typeof value
  if (type !== "string" && type !== "number" && type !== "boolean") {
    return fallback == null ? "" : String(fallback)
  }
  var text = String(value)
  var cap = Number(maxChars)
  if (!isFinite(cap) || cap < 0) return fallback == null ? "" : String(fallback)
  if (text.length <= cap) return text
  text = text.slice(0, cap)
  if (text.length && /[\ud800-\udbff]/.test(text.charAt(text.length - 1))) {
    text = text.slice(0, -1)
  }
  return text
}

function boundedToken(value, maxChars) {
  if (value == null) return ""
  var type = typeof value
  if (type !== "string" && type !== "number") return ""
  var text = String(value)
  if (text.length > Number(maxChars)) return ""
  if (/["\\\u0000-\u001f\u007f]/.test(text)) return ""
  return text
}

function boundedDisplayName(value, fallback) {
  var name = boundedText(value, MAX_DESK_NAME_CHARS_VALUE, "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\s+|\s+$/g, "")
  if (name) return name
  if (fallback != null) return boundedText(fallback, MAX_DESK_NAME_CHARS_VALUE, "")
  return "Unnamed"
}

function isArray(value) {
  if (typeof Array !== "undefined" && typeof Array.isArray === "function") {
    return Array.isArray(value)
  }
  return Object.prototype.toString.call(value) === "[object Array]"
}

function errorMessage(err) {
  if (!err) return "unknown error"
  if (err.message) return String(err.message)
  return String(err)
}

function parseJsonList(value, maxCount) {
  if (value == null || value === "") return { ok: true, list: [] }
  var parsed = value
  if (typeof value === "string") {
    var trimmed = value.replace(/^\s+|\s+$/g, "")
    if (trimmed === "") return { ok: true, list: [] }
    try {
      parsed = JSON.parse(trimmed)
    } catch (err) {
      return { ok: false, list: [] }
    }
  }
  var list = null
  if (isArray(parsed)) list = parsed
  if (parsed && typeof parsed === "object") {
    if (isArray(parsed.workspaces)) list = parsed.workspaces
    else if (isArray(parsed.clients)) list = parsed.clients
    else if (parsed.id != null || parsed.address != null) list = [parsed]
  }
  if (!list) return { ok: false, list: [] }
  var cap = Number(maxCount)
  if (isFinite(cap) && cap >= 0 && list.length > cap) return { ok: false, list: [] }
  return { ok: true, list: list }
}

function parseJsonArg(value, maxCount) {
  return parseJsonList(value, maxCount).list
}

function workspaceBareName(name) {
  var nm = boundedToken(name, MAX_WORKSPACE_NAME_CHARS_VALUE)
  if (nm.indexOf("name:") === 0) nm = nm.slice(5)
  return nm
}

function parkingLotBareName(name) {
  var nm = workspaceBareName(name)
  if (nm.indexOf("special:") === 0) nm = nm.slice(8)
  return nm
}

function isScratchpadName(name) {
  var nm = parkingLotBareName(name)
  return nm === "scratchpad" || nm === "special"
}

function isDroppedName(name) {
  var nm = workspaceBareName(name)
  if (nm.indexOf("special:") === 0) return true
  if (nm === "special") return true
  if (nm.indexOf("omadesk-") === 0) return true
  return false
}

function numberedWorkspaceId(ws) {
  if (ws == null || ws === "") return 0
  if (typeof ws === "number" || (typeof ws === "string" && /^[0-9]+$/.test(ws))) {
    var direct = Number(ws)
    if (direct >= 1 && direct <= 10) return direct
    return 0
  }
  var name = workspaceBareName(ws.name)
  if (isDroppedName(name)) return 0
  var id = Number(ws.id)
  if (id >= 1 && id <= 10) return id
  if (/^[1-9]$|^10$/.test(name)) return parseInt(name, 10)
  return 0
}

function clientWorkspaceN(client) {
  if (!client) return 0
  return numberedWorkspaceId(client.workspace)
}

function monitorName(client, workspaces) {
  if (client && client.monitorName) return safeMonitor(client.monitorName)
  if (client && typeof client.monitor === "string" && client.monitor !== "") return safeMonitor(client.monitor)
  var n = clientWorkspaceN(client)
  var list = workspaces || []
  var i
  for (i = 0; i < list.length && i < MAX_STAGE_WORKSPACES_VALUE; i++) {
    if (numberedWorkspaceId(list[i]) === n && list[i].monitor) return safeMonitor(list[i].monitor)
  }
  if (!client || client.monitor == null || client.monitor === "") return ""
  return safeMonitor(client.monitor)
}

function switchFocusWorkspace(desk, clickedN) {
  var n = focusWorkspaceN(clickedN)
  if (n) return n
  n = focusWorkspaceN(desk && desk.lastWorkspace)
  if (n) return n
  n = focusWorkspaceN(desk && desk.recipe && desk.recipe.lastWorkspace)
  if (n) return n
  return 1
}

function pickLastWorkspace(workspaces, occupied, layout) {
  var i
  if (isArray(layout)) {
    for (i = 0; i < layout.length; i++) {
      if (layout[i] && layout[i].focused && layout[i].n >= 1 && layout[i].n <= 10) return layout[i].n
    }
  }
  for (i = 0; i < workspaces.length; i++) {
    var ws = workspaces[i]
    if (!(ws && (ws.focused || ws.active || ws.currentlyActive))) continue
    var focused = numberedWorkspaceId(ws)
    if (focused) return focused
  }
  if (occupied && occupied.length) return occupied[0].n
  for (i = 0; i < workspaces.length; i++) {
    if (numberedWorkspaceId(workspaces[i])) return 1
  }
  return null
}

function parseLayout(monitorsJson, workspaces) {
  var mons = parseJsonArg(monitorsJson, MAX_STAGE_MONITORS_VALUE)
  var out = []
  var i
  if (mons.length) {
    for (i = 0; i < mons.length && out.length < MAX_LAYOUT_ROWS_VALUE; i++) {
      var m = mons[i]
      if (!m || m.disabled) continue
      var name = safeMonitor(m.name)
      if (!name) continue
      var n = numberedWorkspaceId(m.activeWorkspace)
      if (!n && m.activeWorkspace && m.activeWorkspace.id >= 1 && m.activeWorkspace.id <= 10) {
        n = Number(m.activeWorkspace.id)
      }
      if (!n) continue
      out.push({ n: n, monitor: name, focused: !!m.focused })
    }
    return out
  }
  return out
}

function parseMonitorSizes(monitorsJson) {
  var mons = parseJsonArg(monitorsJson, MAX_STAGE_MONITORS_VALUE)
  var out = {}
  var i
  for (i = 0; i < mons.length && i < MAX_STAGE_MONITORS_VALUE; i++) {
    var m = mons[i]
    if (!m || m.disabled) continue
    var name = safeMonitor(m.name)
    if (!name) continue
    var size = monitorPixelSize(m)
    if (!size) continue
    out[name] = size
  }
  return out
}

function monitorPixelSize(m) {
  if (!m) return null
  var w = Number(m.width)
  var h = Number(m.height)
  if (!(w > 0 && h > 0) && isArray(m.size) && m.size.length >= 2) {
    w = Number(m.size[0])
    h = Number(m.size[1])
  }
  if (!(w > 0 && h > 0) || !isFinite(w) || !isFinite(h) ||
      w > MAX_NUMERIC_MAGNITUDE_VALUE || h > MAX_NUMERIC_MAGNITUDE_VALUE) return null
  var t = Number(m.transform)
  if (t === 1 || t === 3 || t === 90 || t === 270) {
    var tmp = w
    w = h
    h = tmp
  }
  return { w: w, h: h }
}

function normalizeMonitorSizes(sizes) {
  if (!sizes || typeof sizes !== "object" || isArray(sizes)) return null
  var out = {}
  var n = 0
  var k
  for (k in sizes) {
    if (n >= MAX_STAGE_MONITORS_VALUE) break
    if (!Object.prototype.hasOwnProperty.call(sizes, k)) continue
    var name = safeMonitor(k)
    var row = sizes[k] || {}
    var parsed = monitorPixelSize({
      width: row.w != null ? row.w : row.width,
      height: row.h != null ? row.h : row.height
    })
    if (!name || !parsed) continue
    out[name] = parsed
    n += 1
  }
  return n ? out : null
}

function aspectForMonitor(name, sizes) {
  var row = null
  if (sizes && name && sizes[name]) row = sizes[name]
  if (!row && sizes) {
    var k
    for (k in sizes) {
      if (Object.prototype.hasOwnProperty.call(sizes, k) && sizes[k] && sizes[k].w > 0 && sizes[k].h > 0) {
        row = sizes[k]
        break
      }
    }
  }
  if (row && row.w > 0 && row.h > 0) return row.w / row.h
  return 16 / 9
}

function connectedMonitorNames(monitorsJson, workspaces) {
  var mons = parseJsonArg(monitorsJson, MAX_STAGE_MONITORS_VALUE)
  var out = []
  var seen = {}
  var i
  if (mons.length) {
    for (i = 0; i < mons.length && out.length < MAX_STAGE_MONITORS_VALUE; i++) {
      if (!mons[i] || mons[i].disabled) continue
      var name = safeMonitor(mons[i].name)
      if (!name || seen[name]) continue
      seen[name] = true
      out.push(name)
    }
    return out
  }
  var list = isArray(workspaces) ? workspaces : parseJsonArg(workspaces, MAX_STAGE_WORKSPACES_VALUE)
  for (i = 0; i < list.length && i < MAX_STAGE_WORKSPACES_VALUE && out.length < MAX_STAGE_MONITORS_VALUE; i++) {
    var mon = safeMonitor(list[i] && list[i].monitor)
    if (!mon || seen[mon]) continue
    seen[mon] = true
    out.push(mon)
  }
  return out
}

function monitorForWorkspace(n, layout, windows, workspaces) {
  var i
  if (isArray(layout)) {
    for (i = 0; i < layout.length; i++) {
      if (layout[i] && Number(layout[i].n) === Number(n) && layout[i].monitor) return safeMonitor(layout[i].monitor)
    }
  }
  if (windows && windows[0] && windows[0].monitor) return safeMonitor(windows[0].monitor)
  var list = isArray(workspaces) ? workspaces : []
  for (i = 0; i < list.length && i < MAX_STAGE_WORKSPACES_VALUE; i++) {
    if (numberedWorkspaceId(list[i]) === Number(n) && list[i].monitor) return safeMonitor(list[i].monitor)
  }
  return ""
}

function deskLayout(desk) {
  if (desk && isArray(desk.layout) && desk.layout.length) return normalizeLayout(desk.layout)
  var raw = []
  var list = deskWorkspaces(desk)
  var i
  for (i = 0; i < list.length; i++) {
    var n = Number(list[i] && list[i].n)
    var mon = safeMonitor(list[i] && list[i].monitor)
    if (!mon && list[i] && list[i].windows && list[i].windows[0]) mon = safeMonitor(list[i].windows[0].monitor)
    if (!n || n < 1 || n > 10 || !mon) continue
    raw.push({ n: n, monitor: mon })
  }
  return normalizeLayout(raw)
}

function normalizeLayout(layout) {
  var out = []
  var seenN = {}
  var seenMon = {}
  var i
  var list = isArray(layout) ? layout : []
  for (i = 0; i < list.length && i < MAX_STAGE_WORKSPACES_VALUE && out.length < MAX_LAYOUT_ROWS_VALUE; i++) {
    var n = Number(list[i] && list[i].n)
    var mon = safeMonitor(list[i] && list[i].monitor)
    if (!n || n < 1 || n > 10 || !mon) continue
    if (seenN[n] || seenMon[mon]) continue
    seenN[n] = true
    seenMon[mon] = true
    var row = { n: n, monitor: mon }
    if (list[i].focused) row.focused = true
    out.push(row)
  }
  return out
}

function snapshotLayout(stage, workspaces) {
  if (stage && isArray(stage.layout) && stage.layout.length) return normalizeLayout(stage.layout)
  return deskLayout({ workspaces: workspaces || (stage && stage.workspaces) })
}

function layoutDispatches(desk, connected) {
  var allow = {}
  var i
  var names = isArray(connected) ? connected : []
  for (i = 0; i < names.length && i < MAX_STAGE_MONITORS_VALUE; i++) {
    var nm = safeMonitor(names[i])
    if (nm) allow[nm] = true
  }
  var out = []
  var seenN = {}
  function add(n, mon) {
    n = Number(n)
    mon = safeMonitor(mon)
    if (!n || n < 1 || n > 10 || !mon) return
    if (!allow[mon]) return
    if (seenN[n]) return
    seenN[n] = true
    var lua = workspaceMoveDispatch(String(n), mon)
    if (lua) out.push(lua)
  }
  var layout = deskLayout(desk)
  for (i = 0; i < layout.length; i++) add(layout[i].n, layout[i].monitor)
  var list = deskWorkspaces(desk)
  for (i = 0; i < list.length; i++) {
    var ws = list[i]
    var mon = ws && ws.monitor
    if (!mon && ws && ws.windows && ws.windows[0]) mon = ws.windows[0].monitor
    add(ws && ws.n, mon)
  }
  return out
}

function windowSelector(address) {
  var a = boundedToken(address, MAX_ADDRESS_CHARS_VALUE)
  if (a.indexOf("address:") === 0) a = a.slice(8)
  a = boundedToken(a, MAX_ADDRESS_CHARS_VALUE)
  if (!a) return ""
  return "address:" + a
}

function stripAddress(address) {
  var a = boundedToken(address, MAX_ADDRESS_CHARS_VALUE)
  if (a.indexOf("address:") === 0) return a.slice(8)
  return a
}

function joinBatch(dispatches) {
  if (!dispatches || !dispatches.length) return ""
  var parts = []
  var i
  for (i = 0; i < dispatches.length && parts.length < MAX_STAGE_CLIENTS_VALUE + MAX_LAYOUT_ROWS_VALUE; i++) {
    parts.push("dispatch " + dispatches[i])
  }
  return parts.join("; ")
}

function stageWindows(stage) {
  if (!stage) return []
  if (isArray(stage.windows) && stage.windows.length) return stage.windows.slice(0, MAX_STAGE_CLIENTS_VALUE)
  var out = []
  var wss = stage.workspaces || []
  var i
  var j
  for (i = 0; i < wss.length && i < MAX_STAGE_WORKSPACES_VALUE && out.length < MAX_STAGE_CLIENTS_VALUE; i++) {
    var n = Number(wss[i] && wss[i].n)
    var wins = (wss[i] && wss[i].windows) || []
    for (j = 0; j < wins.length && out.length < MAX_STAGE_CLIENTS_VALUE; j++) {
      var w = wins[j] || {}
      out.push(copyGeom({
        address: w.address,
        class: w.class,
        initialClass: w.initialClass,
        title: w.title,
        floating: w.floating,
        monitor: w.monitor,
        workspace: w.workspace != null ? w.workspace : n
      }, w))
    }
  }
  return out
}

function lotNumberFromName(name, slug) {
  var nm = parkingLotBareName(name)
  var prefix = "omadesk-" + slug + "-"
  if (nm.indexOf(prefix) !== 0) return 0
  var rest = nm.slice(prefix.length)
  if (!/^[0-9]+$/.test(rest)) return 0
  var n = parseInt(rest, 10)
  if (n < 1 || n > 10) return 0
  return n
}

function normalizeState(state) {
  var src = state && typeof state === "object" && !isArray(state) ? state : {}
  var desks = []
  var raw = isArray(src.desks) ? src.desks : []
  var seen = {}
  var i
  for (i = 0; i < raw.length && i < MAX_DESK_COUNT_VALUE; i++) {
    var desk = normalizeDesk(raw[i])
    if (desk && desk.id === "unnamed") continue
    var seenId = desk ? "$" + desk.id : ""
    if (!desk || seen[seenId]) continue
    seen[seenId] = true
    desks.push(desk)
  }
  var currentId = src.currentId == null || src.currentId === ""
    ? null
    : boundedToken(src.currentId, MAX_DESK_ID_CHARS_VALUE)
  if (currentId && sanitizeSlug(currentId) === "unnamed") currentId = null
  if (currentId && !seen["$" + currentId]) currentId = null
  return { version: 2, currentId: currentId, desks: desks }
}

// A desk row is identity plus preferences. Where its windows sit is Hyprland's
// business, so nothing here describes windows or workspaces. The only placement
// hint kept is layout (workspace to monitor), which parking lots cannot carry.
function normalizeDesk(desk) {
  if (!desk || typeof desk !== "object" || isArray(desk)) return null
  var last = desk.lastWorkspace
  if ((last == null || last === "") && desk.recipe && desk.recipe.lastWorkspace != null) {
    last = desk.recipe.lastWorkspace
  }
  last = focusWorkspaceN(last)
  var updatedAt = desk.updatedAt ? boundedText(desk.updatedAt, MAX_TIMESTAMP_CHARS_VALUE, "") : ""
  if (updatedAt && !isFinite(Date.parse(updatedAt))) updatedAt = ""
  var lastUsed = desk.lastUsed
  if (lastUsed == null || lastUsed === "") lastUsed = null
  else lastUsed = Number(lastUsed)
  if (!isFinite(lastUsed) || lastUsed < 0 || lastUsed > 8640000000000000) lastUsed = null
  if (lastUsed == null && updatedAt) {
    var fromUpdated = Date.parse(updatedAt)
    if (isFinite(fromUpdated)) lastUsed = fromUpdated
  }
  if (!updatedAt && lastUsed != null) {
    updatedAt = new Date(lastUsed).toISOString()
  }
  var name = boundedDisplayName(desk.name, boundedText(desk.id, MAX_DESK_NAME_CHARS_VALUE, "Unnamed"))
  var id = sanitizeSlug(desk.id || name || "unnamed")
  var out = {
    id: id,
    name: name,
    lastWorkspace: last,
    updatedAt: updatedAt,
    extras: mergeExtras(defaultExtras(), desk.extras)
  }
  if (lastUsed != null && isFinite(Number(lastUsed))) out.lastUsed = Number(lastUsed)
  // v1 files carry no layout array but do have per-workspace monitors on the
  // recipe we are discarding, so recover the map from it once on upgrade.
  var layout = normalizeLayout(desk.layout)
  if (!layout.length) layout = deskLayout({ workspaces: deskWorkspaces(desk) })
  if (layout.length) out.layout = layout
  return out
}

function isScratchpadish(w) {
  if (!w) return true
  if (w.workspace == null || w.workspace === "") return false
  if (typeof w.workspace === "number") return w.workspace < 1 || w.workspace > 10
  if (typeof w.workspace === "string") {
    if (isDroppedName(w.workspace)) return true
    return numberedWorkspaceId(w.workspace) === 0 && !/^[1-9]$|^10$/.test(String(w.workspace))
  }
  if (isDroppedName(w.workspace.name)) return true
  return numberedWorkspaceId(w.workspace) === 0
}

function mergeExtras(base, extra) {
  var out = {
    dnd: "leave",
    theme: "leave"
  }
  if (base && (base.dnd === "on" || base.dnd === "off" || base.dnd === "leave")) out.dnd = base.dnd
  if (base && typeof base.theme === "string" && base.theme !== "" &&
      base.theme.length <= MAX_DESK_NAME_CHARS_VALUE &&
      !/[\u0000-\u001f\u007f]/.test(base.theme)) {
    out.theme = base.theme
  }
  if (extra && (extra.dnd === "on" || extra.dnd === "off" || extra.dnd === "leave")) out.dnd = extra.dnd
  if (extra && typeof extra.theme === "string" && extra.theme !== "" &&
      extra.theme.length <= MAX_DESK_NAME_CHARS_VALUE &&
      !/[\u0000-\u001f\u007f]/.test(extra.theme)) {
    out.theme = extra.theme
  }
  return out
}

function lastClassSegment(cls) {
  var parts = boundedText(cls, MAX_COMPOSITOR_TEXT_CHARS_VALUE, "").split(".")
  return parts[parts.length - 1] || ""
}

function prettyApp(win) {
  var cls = boundedText((win && (win.class || win.initialClass)), MAX_COMPOSITOR_TEXT_CHARS_VALUE, "")
  var full = cls.toLowerCase()
  if (full.indexOf("geforce") >= 0) return "GeForce NOW"
  if (full.indexOf("chrome-") === 0) {
    var host = String(cls.slice(7).split("__")[0] || "").replace(/\/$/, "")
    if (host) return host
  }
  var last = lastClassSegment(cls)
  var lower = last.toLowerCase()
  if (lower === "zed") return "Zed"
  if (lower === "ghostty") return "Ghostty"
  if (lower === "chromium" || lower === "chrome" || lower === "google-chrome") return "Chromium"
  if (lower === "nautilus") return "Files"
  if (last === "") return "app"
  return last
}

function iconLetters(win) {
  var name = prettyApp(win)
  if (win && typeof win === "object" && win.letters) {
    return boundedText(win.letters, 4, "?")
  }
  var raw = boundedText(name, MAX_COMPOSITOR_TEXT_CHARS_VALUE, "").replace(/^\s+|\s+$/g, "")
  if (!raw || raw === "app") {
    var cls = boundedText((win && (win.class || win.initialClass)) || (typeof win === "string" ? win : ""), MAX_COMPOSITOR_TEXT_CHARS_VALUE, "")
    raw = lastClassSegment(cls) || cls
  }
  raw = String(raw || "").replace(/^\s+|\s+$/g, "")
  if (!raw) return "?"
  var parts = raw.split(/[\s._-]+/)
  var words = []
  var skip = { www: 1, com: 1, org: 1, net: 1, io: 1, app: 1, dev: 1, edu: 1, gov: 1, co: 1, uk: 1, us: 1 }
  var i
  for (i = 0; i < parts.length; i++) {
    var token = String(parts[i] || "")
    if (!token) continue
    if (skip[token.toLowerCase()] && parts.length > 1) continue
    words.push(token)
  }
  if (!words.length) words = [raw]
  if (words.length >= 2) {
    return words[0].charAt(0).toUpperCase() + words[1].charAt(0).toUpperCase()
  }
  var word = words[0]
  var first = word.charAt(0).toUpperCase()
  if (word.length === 1) return first
  return first + word.charAt(word.length - 1).toLowerCase()
}

function shortTitle(win) {
  var title = boundedText((win && win.title), MAX_COMPOSITOR_TEXT_CHARS_VALUE, "").replace(/^\s+|\s+$/g, "")
  if (!title) return ""
  var cut = title.indexOf(" - ")
  if (cut > 0 && cut <= 24) title = title.slice(0, cut)
  if (title.length > 28) title = title.slice(0, 27) + "…"
  return title
}

function tileLabel(ws) {
  if (!ws || !ws.windows || !ws.windows.length) return "empty"
  var names = []
  var seen = {}
  var i
  for (i = 0; i < ws.windows.length && i < MAX_RENDERED_PANES_PER_TILE_VALUE; i++) {
    var app = prettyApp(ws.windows[i])
    if (!app || seen[app]) continue
    seen[app] = true
    names.push(app)
  }
  if (!names.length) return "app"
  if (names.length === 1) {
    var title = shortTitle(ws.windows[0])
    if (title && title.toLowerCase().indexOf(names[0].toLowerCase()) !== 0)
      return names[0] + " · " + title
    if (title) return title
    return names[0]
  }
  var extra = ws.windows.length - names.length
  var label = names.slice(0, 3).join(" · ")
  if (names.length > 3) label += " · +" + (names.length - 3)
  else if (extra > 0) label += " · +" + extra
  return boundedText(label, MAX_COMPOSITOR_TEXT_CHARS_VALUE, "")
}

function workspaceTileN(ws, cap) {
  var n = Number(ws && ws.n)
  if (n >= 1 && n <= cap) return n
  n = Number(ws && ws.workspace)
  if (n >= 1 && n <= cap) return n
  n = numberedWorkspaceId(ws)
  if (n >= 1 && n <= cap) return n
  return 0
}

function deskTiles(desk, limit, includeNextEmpty) {
  var cap = Number(limit)
  if (!isFinite(cap) || cap < 1) cap = 10
  if (cap > 10) cap = 10
  var byN = {}
  var list = deskWorkspaces(desk)
  var i
  var n
  for (i = 0; i < list.length; i++) {
    n = workspaceTileN(list[i], cap)
    if (n) byN[n] = list[i]
  }
  var listed = false
  for (n = 1; n <= cap; n++) {
    if (byN[n] && isArray(byN[n].windows)) {
      listed = true
      break
    }
  }
  if (!listed && desk && isArray(desk.windows)) {
    for (i = 0; i < desk.windows.length && i < MAX_STAGE_CLIENTS_VALUE; i++) {
      var wn = Number(desk.windows[i] && desk.windows[i].workspace)
      if (wn < 1 || wn > cap) continue
      if (!byN[wn] || !isArray(byN[wn].windows)) {
        byN[wn] = {
          n: wn,
          windows: [],
          monitor: byN[wn] && byN[wn].monitor,
          hyprId: desk.windows[i] && desk.windows[i].hyprId,
          tiledLayout: desk.windows[i] && desk.windows[i].tiledLayout
        }
      }
      byN[wn].windows.push(desk.windows[i])
    }
  }
  var sizes = (desk && desk.monitorSizes) || {}
  var tiles = []
  var order = []
  if (list.length) {
    for (i = 0; i < list.length; i++) {
      n = workspaceTileN(list[i], cap)
      if (n) order.push(n)
    }
  } else {
    for (n = 1; n <= cap; n++) order.push(n)
  }
  var seen = {}
  for (i = 0; i < order.length; i++) {
    n = order[i]
    if (seen[n]) continue
    seen[n] = true
    var wins = byN[n] && isArray(byN[n].windows) ? byN[n].windows : []
    if (!wins.length) continue
    var label = tileLabel(byN[n])
    var layout = paneLayout(wins)
    tiles.push({
      n: n,
      label: label,
      vacant: false,
      panes: layout.panes,
      under: layout.under,
      aspect: aspectForMonitor(byN[n] && byN[n].monitor, sizes),
      hyprId: (byN[n] && byN[n].hyprId) || (wins[0] && wins[0].hyprId),
      tiledLayout: normalizeTiledLayout((byN[n] && byN[n].tiledLayout) || (wins[0] && wins[0].tiledLayout))
    })
  }
  if (includeNextEmpty && tiles.length) {
    var emptyN = nextEmptyWorkspaceN(desk, cap)
    if (emptyN) {
      tiles.push({
        n: emptyN,
        label: "Empty",
        vacant: true,
        panes: [],
        under: [],
        aspect: tiles[0].aspect,
        hyprId: null,
        tiledLayout: "dwindle"
      })
    }
  }
  return tiles
}

function nextEmptyWorkspaceN(desk, limit) {
  var cap = Number(limit)
  if (!isFinite(cap) || cap < 1) cap = 10
  if (cap > 10) cap = 10
  var occupied = {}
  var tiles = deskTiles(desk, cap)
  var i
  var n
  for (i = 0; i < tiles.length; i++) {
    n = Number(tiles[i] && tiles[i].n)
    if (n >= 1 && n <= cap) occupied[n] = true
  }
  if (!tiles.length) return 0
  for (n = 1; n <= cap; n++) {
    if (!occupied[n]) return n
  }
  return 0
}

function windowGeom(win) {
  if (!win) return null
  var x = win.x
  var y = win.y
  var w = win.w
  var h = win.h
  if ((x == null || !isFinite(Number(x))) && isArray(win.at) && win.at.length >= 2) {
    x = win.at[0]
    y = win.at[1]
  }
  if ((w == null || !isFinite(Number(w))) && isArray(win.size) && win.size.length >= 2) {
    w = win.size[0]
    h = win.size[1]
  }
  x = Number(x)
  y = Number(y)
  w = Number(w)
  h = Number(h)
  if (!isFinite(x) || !isFinite(y) || !isFinite(w) || !isFinite(h) || w < 1 || h < 1) return null
  if (Math.abs(x) > MAX_NUMERIC_MAGNITUDE_VALUE || Math.abs(y) > MAX_NUMERIC_MAGNITUDE_VALUE ||
      w > MAX_NUMERIC_MAGNITUDE_VALUE || h > MAX_NUMERIC_MAGNITUDE_VALUE) return null
  return { x: x, y: y, w: w, h: h }
}

function windowPanes(windows) {
  return paneLayout(windows).panes
}

function windowsUnder(windows) {
  return paneLayout(windows).under
}

function paneLayout(windows) {
  var all = isArray(windows) ? windows.slice(0, MAX_STAGE_CLIENTS_VALUE) : []
  var list = all.slice(0, MAX_RENDERED_PANES_PER_TILE_VALUE)
  var empty = { panes: [], under: [] }
  var geoms = []
  var i
  var minX = Infinity
  var minY = Infinity
  var maxX = -Infinity
  var maxY = -Infinity
  for (i = 0; i < list.length; i++) {
    var g = windowGeom(list[i])
    if (!g) continue
    geoms.push({ win: list[i], x: g.x, y: g.y, w: g.w, h: g.h })
    if (g.x < minX) minX = g.x
    if (g.y < minY) minY = g.y
    if (g.x + g.w > maxX) maxX = g.x + g.w
    if (g.y + g.h > maxY) maxY = g.y + g.h
  }
  var bw = maxX - minX
  var bh = maxY - minY
  var panes = []
  var top = coveringWindow(all, geoms, bw, bh)
  if (!top) top = coveringWindow(all, [])
  if (top) {
    return { panes: [paneRecord(top, 0, 0, 1, 1)], under: underRecords(all, top) }
  }
  if (!geoms.length || !(bw > 0) || !(bh > 0)) {
    var n = list.length
    if (!n) return empty
    for (i = 0; i < n; i++) {
      panes.push(paneRecord(list[i], i / n, 0, 1 / n, 1))
    }
    return { panes: panes, under: [] }
  }
  for (i = 0; i < geoms.length; i++) {
    panes.push(paneRecord(
      geoms[i].win,
      (geoms[i].x - minX) / bw,
      (geoms[i].y - minY) / bh,
      geoms[i].w / bw,
      geoms[i].h / bh
    ))
  }
  return { panes: panes, under: [] }
}

function underRecords(list, top) {
  var out = []
  if (!isArray(list) || !top) return out
  var topAddr = top.address ? stripAddress(top.address) : ""
  var i
  for (i = 0; i < list.length && out.length < MAX_RENDERED_PANES_PER_TILE_VALUE; i++) {
    var win = list[i]
    if (!win || win === top) continue
    if (topAddr && win.address && stripAddress(win.address) === topAddr) continue
    out.push({
      icon: iconName(win),
      class: boundedText((win.class || win.initialClass), MAX_COMPOSITOR_TEXT_CHARS_VALUE, ""),
      letters: iconLetters(win)
    })
  }
  return out
}

function isFullscreenWin(win) {
  if (!win) return false
  if (win.fullscreen === true) return true
  var n = Number(win.fullscreen)
  return isFinite(n) && n > 0
}

function coveringWindow(list, geoms, bw, bh) {
  var i
  var flagged = null
  if (isArray(list)) {
    for (i = 0; i < list.length; i++) {
      if (isFullscreenWin(list[i])) flagged = list[i]
    }
  }
  if (flagged) return flagged
  if (!isArray(geoms) || geoms.length < 2 || !(bw > 0) || !(bh > 0)) return null
  var best = null
  var bestArea = 0
  for (i = 0; i < geoms.length; i++) {
    if (geoms[i].w / bw < 0.92 || geoms[i].h / bh < 0.92) continue
    var area = geoms[i].w * geoms[i].h
    if (area > bestArea) {
      best = geoms[i].win
      bestArea = area
    }
  }
  return best
}

function paneRecord(win, x, y, w, h) {
  return {
    x: x,
    y: y,
    w: w,
    h: h,
    icon: iconName(win),
    class: boundedText((win && (win.class || win.initialClass)), MAX_COMPOSITOR_TEXT_CHARS_VALUE, ""),
    letters: iconLetters(win),
    floating: !!(win && win.floating),
    address: win && win.address ? boundedToken(stripAddress(win.address), MAX_ADDRESS_CHARS_VALUE) : ""
  }
}

function copyGeom(dst, src) {
  if (!dst) dst = {}
  if (!src) return dst
  var g = windowGeom(src)
  if (g) {
    dst.x = g.x
    dst.y = g.y
    dst.w = g.w
    dst.h = g.h
  }
  var pid = src.pid != null ? Number(src.pid) : NaN
  if (isFinite(pid) && pid > 0) dst.pid = pid
  if (src.fullscreen === true) dst.fullscreen = 2
  else {
    var fs = Number(src.fullscreen)
    if (isFinite(fs) && fs > 0) dst.fullscreen = fs
  }
  return dst
}

function parkedForSlug(stage, slug) {
  var parked = stage && isArray(stage.parked) ? stage.parked : []
  var clean = sanitizeSlug(slug)
  var out = []
  var i
  for (i = 0; i < parked.length && i < MAX_STAGE_CLIENTS_VALUE; i++) {
    if (parked[i] && parked[i].slug === clean) out.push(parked[i])
  }
  return out
}

function isUnsavedCurrent(currentId) {
  return currentId == null || currentId === "" || sanitizeSlug(currentId) === "unnamed"
}

function isUnsavedDesk(desk) {
  return !desk || sanitizeSlug(desk.id) === "unnamed"
}

function isCurrentDesk(desk, currentId) {
  if (isUnsavedCurrent(currentId) || isUnsavedDesk(desk)) return false
  return !!(desk && String(desk.id) === String(currentId))
}

function liveWindows(desk, stage, currentId) {
  if (isCurrentDesk(desk, currentId)) {
    var hereNamed = stageWindows(stage)
    var leaked = parkedForSlug(stage, desk && desk.id)
    if (!leaked.length) return hereNamed
    if (!hereNamed.length) return leaked
    return hereNamed.concat(leaked).slice(0, MAX_STAGE_CLIENTS_VALUE)
  }
  if (isUnsavedCurrent(currentId) && isUnsavedDesk(desk)) {
    var here = stageWindows(stage)
    var parked = parkedForSlug(stage, "unnamed")
    if (!parked.length) return here
    if (!here.length) return parked
    return here.concat(parked).slice(0, MAX_STAGE_CLIENTS_VALUE)
  }
  return parkedForSlug(stage, desk && desk.id)
}

function deskLife(desk, stage, currentId) {
  return liveWindows(desk, stage, currentId).length ? "live" : "dead"
}

// A desk is exactly the windows Hyprland is holding for it: the live numbered
// workspaces when it is current, its parking lots otherwise. A desk with
// neither still exists as a named row, it just has nothing to show.
function deskPreviewSource(desk, stage, currentId) {
  var sizes = (stage && stage.monitorSizes) || (desk && desk.monitorSizes)
  if (isCurrentDesk(desk, currentId) && stage) {
    if (sizes && !stage.monitorSizes) stage.monitorSizes = sizes
    return stage
  }
  var parked = parkedForSlug(stage, desk && desk.id)
  if (parked.length) {
    var src = parkedToStage(parked)
    if (sizes) src.monitorSizes = sizes
    if (desk && desk.extras) src.extras = desk.extras
    return src
  }
  return emptyPreviewSource(desk, sizes)
}

function emptyPreviewSource(desk, sizes) {
  var src = { workspaces: [], windows: [], parked: [], lastWorkspace: null }
  if (sizes) src.monitorSizes = sizes
  if (desk && desk.extras) src.extras = desk.extras
  if (desk && isArray(desk.layout)) src.layout = normalizeLayout(desk.layout)
  return src
}

function closePlan(desk, stage, currentId) {
  var wins = liveWindows(desk, stage, currentId)
  var dispatches = []
  var i
  for (i = 0; i < wins.length; i++) {
    if (!wins[i] || !wins[i].address) continue
    if (isScratchpadish(wins[i])) continue
    var lua = closeDispatch(wins[i].address)
    if (lua) dispatches.push(lua)
  }
  return { slug: desk && desk.id ? String(desk.id) : "", dispatches: dispatches, batch: joinBatch(dispatches) }
}

function previewTiles(source, limit) {
  return deskTiles(source, limit)
}

function copyStrings(list) {
  var out = []
  var i
  for (i = 0; i < list.length && i < MAX_STAGE_MONITORS_VALUE; i++) {
    var value = safeMonitor(list[i])
    if (value) out.push(value)
  }
  return out
}

function idSet(existingIds) {
  var taken = {}
  if (!existingIds) return taken
  var i
  if (isArray(existingIds)) {
    for (i = 0; i < existingIds.length && i < MAX_DESK_COUNT_VALUE; i++) {
      var id = boundedToken(existingIds[i], MAX_DESK_ID_CHARS_VALUE)
      if (id) taken["$" + id] = true
    }
    return taken
  }
  if (typeof existingIds === "object") {
    var count = 0
    for (var k in existingIds) {
      if (count >= MAX_DESK_COUNT_VALUE) break
      if (!Object.prototype.hasOwnProperty.call(existingIds, k) || !existingIds[k]) continue
      var key = boundedToken(k, MAX_DESK_ID_CHARS_VALUE)
      if (!key) continue
      taken["$" + key] = true
      count += 1
    }
  }
  return taken
}

function packRead(ok, state, error, sourceVersion) {
  var src = state || emptyState()
  var out = {
    ok: !!ok,
    state: src,
    version: src.version,
    currentId: src.currentId,
    desks: src.desks
  }
  if (sourceVersion === 1 || sourceVersion === 2) {
    out.sourceVersion = sourceVersion
    out.migrated = sourceVersion < src.version
  }
  if (error) out.error = error
  return out
}

function clientWorkspaceName(client) {
  if (!client) return ""
  var ws = client.workspace
  if (ws == null || ws === "") return ""
  if (typeof ws === "object") return workspaceBareName(ws.name)
  return workspaceBareName(ws)
}

function parseParkedLot(client) {
  var name = clientWorkspaceName(client)
  if (isScratchpadName(name)) return null
  var match = /^omadesk-(.+)-([0-9]+)$/.exec(parkingLotBareName(name))
  if (!match) return null
  var n = parseInt(match[2], 10)
  if (n < 1 || n > 10) return null
  var slug = sanitizeSlug(match[1])
  if (parkLotName(slug, n) !== parkingLotBareName(name)) return null
  return { slug: slug, n: n }
}

function parkedAsClients(parked) {
  var out = []
  if (!isArray(parked)) return out
  var i
  for (i = 0; i < parked.length && i < MAX_STAGE_CLIENTS_VALUE; i++) {
    var p = parked[i] || {}
    out.push({
      address: p.address,
      class: p.class,
      initialClass: p.initialClass,
      title: p.title,
      floating: p.floating,
      monitor: p.monitor,
      slug: p.slug,
      n: p.n,
      workspace: {
        id: p.n,
        name: "special:omadesk-" + String(p.slug || "") + "-" + String(p.n)
      }
    })
  }
  return out
}

function clientsForRestore(value) {
  if (isArray(value)) return value.slice(0, MAX_STAGE_CLIENTS_VALUE)
  if (value && typeof value === "object") {
    if (isArray(value.parked) && value.parked.length) return parkedAsClients(value.parked)
    if (isArray(value.clients)) return value.clients.slice(0, MAX_STAGE_CLIENTS_VALUE)
  }
  return parseJsonArg(value, MAX_STAGE_CLIENTS_VALUE)
}

function parkedClientLot(client, slug) {
  if (client && client.slug && String(client.slug) === String(slug)) {
    var n = Number(client.n)
    if (n >= 1 && n <= 10) return n
  }
  var name = clientWorkspaceName(client)
  if (isScratchpadName(name)) return 0
  return lotNumberFromName(name, slug)
}

function deskWorkspaces(desk) {
  if (!desk) return []
  if (isArray(desk.workspaces) && desk.workspaces.length) return desk.workspaces.slice(0, MAX_STAGE_WORKSPACES_VALUE)
  if (desk.recipe && isArray(desk.recipe.workspaces)) return desk.recipe.workspaces.slice(0, MAX_STAGE_WORKSPACES_VALUE)
  return isArray(desk.workspaces) ? desk.workspaces.slice(0, MAX_STAGE_WORKSPACES_VALUE) : []
}

function prevLastWorkspace(source) {
  if (!source) return null
  if (source.lastWorkspace != null && source.lastWorkspace !== "") return source.lastWorkspace
  if (source.recipe && source.recipe.lastWorkspace != null) return source.recipe.lastWorkspace
  return null
}

function isoNow() {
  try {
    return new Date().toISOString()
  } catch (err) {
    return ""
  }
}

function parseNow(nowMs) {
  if (nowMs == null || nowMs === "") return Date.now()
  var n = Number(nowMs)
  if (isFinite(n)) return n
  return Date.now()
}

function stampLastUsed(state, deskId, nowMs) {
  if (!state || !isArray(state.desks) || deskId == null || deskId === "") return
  var now = parseNow(nowMs)
  var i
  for (i = 0; i < state.desks.length && i < MAX_DESK_COUNT_VALUE; i++) {
    if (String(state.desks[i].id) !== String(deskId)) continue
    state.desks[i].lastUsed = now
    return
  }
}

function addressSet(usedAddresses) {
  var set = {}
  if (!usedAddresses) return set
  var i
  if (isArray(usedAddresses)) {
    for (i = 0; i < usedAddresses.length && i < MAX_STAGE_CLIENTS_VALUE; i++) {
      var addr = stripAddress(usedAddresses[i])
      if (addr) set[addr] = true
    }
    return set
  }
  if (typeof usedAddresses === "object") {
    var count = 0
    for (var k in usedAddresses) {
      if (count >= MAX_STAGE_CLIENTS_VALUE) break
      if (!Object.prototype.hasOwnProperty.call(usedAddresses, k) || !usedAddresses[k]) continue
      var key = stripAddress(k)
      if (!key) continue
      set[key] = true
      count += 1
    }
  }
  return set
}
