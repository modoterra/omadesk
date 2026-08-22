// Pure functions for desks. Loaded by Overlay.qml and by Node vm tests.
// No Node APIs. No QML types.
// Scratchpad (special:scratchpad) is global: never stage, park, restore, or store.
// Desk lots live on other named specials: special:omadesk-<slug>-N.
// Two Chromiums after reboot are best-effort; guessExec uses --new-window.

function emptyState() {
  return { version: 1, currentId: null, desks: [] }
}

function defaultExtras() {
  return { dnd: "leave", theme: "leave", launchMissing: true }
}

function desksPath(home) {
  return String(home || "") + "/.config/omarchy/omadesk/desks.json"
}

function normalizeQuery(raw) {
  return String(raw || "").replace(/\s+/g, " ").trim()
}

function scoreText(query, text) {
  var needle = String(query || "").toLowerCase()
  var hay = String(text || "").toLowerCase()
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
  for (i = 0; i < list.length; i++) {
    var desk = list[i]
    var score = scoreText(q, desk && desk.name)
    if (q !== "" && score <= 0) continue
    scored.push({ desk: desk, score: score, name: desk && desk.name ? String(desk.name) : "" })
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

function parseStage(clientsJson, workspacesJson, monitorsJson) {
  var clients = parseJsonArg(clientsJson)
  var workspaces = parseJsonArg(workspacesJson)
  var layout = parseLayout(monitorsJson, workspaces)
  var monitors = connectedMonitorNames(monitorsJson, workspaces)
  var groups = {}
  var windows = []
  var parked = []
  var i
  for (i = 0; i < clients.length; i++) {
    var client = clients[i]
    var lot = parseParkedLot(client)
    if (lot) {
      parked.push(copyGeom({
        slug: lot.slug,
        n: lot.n,
        address: String(client.address || ""),
        class: String(client.class || ""),
        initialClass: String(client.initialClass || ""),
        title: String(client.title || ""),
        floating: !!client.floating,
        monitor: monitorName(client, workspaces)
      }, client))
      continue
    }
    var n = clientWorkspaceN(client)
    if (n < 1 || n > 10) continue
    var win = copyGeom({
      address: String(client.address || ""),
      class: String(client.class || ""),
      initialClass: String(client.initialClass || ""),
      title: String(client.title || ""),
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
      wsOut.push({
        n: n,
        windows: groups[n],
        monitor: monitorForWorkspace(n, layout, groups[n], workspaces)
      })
    }
  }
  return {
    workspaces: wsOut,
    windows: windows,
    parked: parked,
    layout: layout,
    monitors: monitors,
    monitorSizes: parseMonitorSizes(monitorsJson),
    lastWorkspace: pickLastWorkspace(workspaces, wsOut, layout)
  }
}

function sanitizeSlug(name) {
  var s = String(name || "").toLowerCase()
  if (s.indexOf("omadesk-") === 0) s = s.slice(8)
  s = s.replace(/[^a-z0-9]+/g, "-")
  s = s.replace(/-+/g, "-")
  s = s.replace(/^-/, "")
  s = s.replace(/-$/, "")
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

function moveDispatch(workspaceSelector, address) {
  var ws = safeDispatchToken(workspaceSelector)
  var addr = windowSelector(address)
  if (!ws || !addr) return ""
  return "hl.dsp.window.move({ workspace = \"" + ws + "\", follow = false, window = \"" + addr + "\" })"
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
  var s = String(value == null ? "" : value)
  if (!s) return ""
  if (/["\\\n\r]/.test(s)) return ""
  return s
}

function safeMonitor(name) {
  return safeDispatchToken(name)
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
    if (lua) dispatches.push(lua)
  }
  return { slug: clean, dispatches: dispatches, batch: joinBatch(dispatches) }
}

function restoreFromPark(park) {
  var dispatches = []
  var list = (park && park.dispatches) || []
  var i
  for (i = 0; i < list.length; i++) {
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
  if (parsed.version !== 1 && parsed.version !== "1") {
    return packRead(false, emptyState(), "unsupported version (version 1 required)")
  }
  return packRead(true, normalizeState(parsed), "")
}

function writeDesks(state) {
  return JSON.stringify(normalizeState(state), null, 2) + "\n"
}

function guessExec(win) {
  var cls = String((win && (win.class || win.initialClass)) || "")
  var lower = cls.toLowerCase()
  var last = lastClassSegment(lower)
  if (lower === "dev.zed.zed" || last === "zed") return ["zed"]
  if (lower.indexOf("ghostty") >= 0 || last === "ghostty") return ["ghostty"]
  if (lower.indexOf("geforce") >= 0) return ["gtk-launch", "com.nvidia.geforcenow.desktop"]
  var pwa = chromePwaExec(cls)
  if (pwa && pwa.length) return pwa
  // Two Chromiums after reboot are best-effort; --new-window is the hint we can give.
  if (lower.indexOf("chromium") >= 0 || last === "chromium" || last === "chrome" || last === "google-chrome") {
    return ["chromium", "--new-window"]
  }
  var known = knownDesktopExec(lower, last)
  if (known && known.length) return known
  if (isDesktopIdClass(cls)) return ["gtk-launch", cls + ".desktop"]
  return []
}

function isDesktopIdClass(cls) {
  return /^(com|org|io|net|dev|app|eu|de|me)(\.[A-Za-z0-9-]+)+$/.test(String(cls || ""))
}

function knownDesktopExec(lower, last) {
  var key = String(lower || "")
  var tail = String(last || "")
  var map = {
    "firefox": ["firefox"],
    "firefox-esr": ["firefox"],
    "org.mozilla.firefox": ["gtk-launch", "org.mozilla.firefox.desktop"],
    "slack": ["gtk-launch", "slack.desktop"],
    "discord": ["gtk-launch", "discord.desktop"],
    "steam": ["steam"],
    "spotify": ["spotify"],
    "code": ["code"],
    "code - oss": ["code"],
    "cursor": ["cursor"],
    "nautilus": ["gtk-launch", "org.gnome.Nautilus.desktop"],
    "org.gnome.nautilus": ["gtk-launch", "org.gnome.Nautilus.desktop"],
    "foot": ["foot"],
    "alacritty": ["alacritty"],
    "kitty": ["kitty"],
    "mpv": ["mpv"],
    "obs": ["gtk-launch", "com.obsproject.Studio.desktop"],
    "com.obsproject.studio": ["gtk-launch", "com.obsproject.Studio.desktop"],
    "telegram": ["telegram-desktop"],
    "org.telegram.desktop": ["gtk-launch", "org.telegram.desktop.desktop"],
    "signal": ["signal-desktop"],
    "signal-desktop": ["signal-desktop"],
    "obsidian": ["obsidian"]
  }
  if (map[key]) return map[key]
  if (map[tail]) return map[tail]
  return null
}

function chromePwaExec(cls) {
  var raw = String(cls || "")
  if (raw.toLowerCase().indexOf("chrome-") !== 0) return null
  var rest = raw.slice(7)
  var parts = rest.split("__")
  var host = String(parts[0] || "").replace(/\/$/, "")
  if (!host || host.indexOf(".") === -1) return null
  var argv = ["chromium"]
  var profile = parts.length > 1 ? String(parts[parts.length - 1] || "") : ""
  profile = profile.replace(/^-+/, "")
  var pm = /^(profile_\d+)$/i.exec(profile) || /profile_(\d+)/i.exec(profile)
  if (pm) {
    var label = /^profile_\d+$/i.test(profile) ? profile.replace(/_/g, " ") : "Profile " + pm[1]
    argv.push("--profile-directory=" + label)
  }
  argv.push("--app=https://" + host)
  return argv
}

function isUsableExec(argv, win) {
  if (!isArray(argv) || !argv.length) return false
  var cmd = String(argv[0] || "")
  if (!cmd) return false
  if (cmd.indexOf("__") >= 0) return false
  if (/profile_\d/i.test(cmd)) return false
  if (cmd.charAt(0) === "/") return true
  if (cmd === "gtk-launch" || cmd === "uwsm-app" || cmd === "chromium" || cmd === "zed" || cmd === "ghostty") return true
  var cls = String((win && (win.class || win.initialClass)) || "").toLowerCase()
  var last = lastClassSegment(cls)
  if (cls.indexOf("chrome-") === 0) return false
  if (cls.indexOf("geforce") >= 0) return false
  if (last && cmd.toLowerCase() === last) {
    if (cls !== last) return false
    var guessed = guessExec(win)
    if (!guessed || !guessed.length || String(guessed[0]).toLowerCase() !== cmd.toLowerCase()) return false
  }
  return /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(cmd)
}

function resolveExec(win) {
  var stored = win && isArray(win.exec) ? copyStrings(win.exec) : []
  if (isUsableExec(stored, win) && execHasCommand(stored)) return stored
  if (isTerminalClass(win) && (win.cwd || (isArray(win.cmd) && win.cmd.length) || (typeof win.cmd === "string" && win.cmd))) {
    var built = terminalExec(win)
    if (built && built.length) return built
  }
  if (isUsableExec(stored, win)) return stored
  return guessExec(win)
}

function isTerminalClass(win) {
  var cls = String((win && (win.class || win.initialClass)) || (typeof win === "string" ? win : "") || "").toLowerCase()
  var last = lastClassSegment(cls)
  return cls.indexOf("ghostty") >= 0 || last === "ghostty" || last === "foot" || last === "alacritty" || last === "kitty" || last === "wezterm" || last === "com.mitchellh.ghostty"
}

function isShellBin(cmd0) {
  var b = String(cmd0 || "").split("/")
  b = String(b[b.length - 1] || "").toLowerCase()
  return b === "bash" || b === "zsh" || b === "fish" || b === "sh" || b === "nu" || b === "dash"
}

function execHasCommand(argv) {
  if (!isArray(argv)) return false
  var i
  for (i = 0; i < argv.length; i++) {
    var a = String(argv[i] || "")
    if (a === "-e" || a.indexOf("--command") === 0) return true
  }
  return false
}

function safeArgv(list) {
  var src = list
  if (typeof list === "string" && list) src = [list]
  if (!isArray(src)) return []
  var out = []
  var i
  for (i = 0; i < src.length; i++) {
    var s = String(src[i] == null ? "" : src[i])
    if (!s || /[\n\r]/.test(s)) continue
    out.push(s)
  }
  return out
}

function terminalExec(win) {
  var base = guessExec(win)
  if (!isArray(base) || !base.length) return []
  var out = copyStrings(base)
  var bin = String(out[0] || "")
  var cwd = String((win && win.cwd) || "")
  if (cwd && !/[\n\r]/.test(cwd)) {
    if (bin === "ghostty") out.push("--working-directory=" + cwd)
    else if (bin === "foot") { out.push("-D"); out.push(cwd) }
    else if (bin === "alacritty") { out.push("--working-directory"); out.push(cwd) }
    else if (bin === "kitty") { out.push("--directory"); out.push(cwd) }
  }
  var cmd = safeArgv(win && win.cmd)
  if (cmd.length && isShellBin(cmd[0])) cmd = []
  if (cmd.length) {
    if (bin === "kitty") out = out.concat(cmd)
    else {
      out.push("-e")
      out = out.concat(cmd)
    }
  }
  return out
}

function iconName(win) {
  var names = iconNames(win)
  return names.length ? names[0] : ""
}

function iconNames(win) {
  var cls = String((win && (win.class || win.initialClass)) || "")
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

function snapshotRecipe(stage, name, extras, lastWorkspace, nowIso) {
  var workspaces = snapshotWorkspaces(stage)
  var last = lastWorkspace
  if (last == null && stage) last = stage.lastWorkspace
  if (last == null || last === "") last = null
  else last = Number(last)
  if (name == null || String(name).replace(/^\s+|\s+$/g, "") === "") {
    return { workspaces: workspaces, lastWorkspace: last }
  }
  var display = String(name).replace(/^\s+|\s+$/g, "")
  var recipe = {
    id: uniqueId(slugify(display)),
    name: display,
    lastWorkspace: last,
    updatedAt: nowIso ? String(nowIso) : "",
    extras: mergeExtras(defaultExtras(), extras),
    workspaces: workspaces
  }
  var layout = snapshotLayout(stage, workspaces)
  if (layout.length) recipe.layout = layout
  var sizes = normalizeMonitorSizes(stage && stage.monitorSizes)
  if (sizes) recipe.monitorSizes = sizes
  return recipe
}

function uniqueId(base, existingIds) {
  var id = sanitizeSlug(base)
  var taken = idSet(existingIds)
  // Unsaved rooms park on omadesk-unnamed-N; a saved desk must not reuse that id.
  taken.unnamed = true
  if (!taken[id]) return id
  var n = 2
  while (taken[id + "-" + n]) n++
  return id + "-" + n
}

function saveDesk(state, recipe) {
  var next = normalizeState(state)
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
  var writing = {
    id: "writing",
    name: "Writing",
    lastWorkspace: 3,
    updatedAt: "2026-08-19T16:40:00Z",
    extras: defaultExtras(),
    workspaces: [
      {
        n: 1,
        windows: [
          recipeWindow("dev.zed.Zed", "charcana", ["zed", "/home/hallas/Work/charcana"])
        ]
      },
      { n: 2, windows: [recipeWindow("com.mitchellh.ghostty", "", ["ghostty"])] },
      { n: 3, windows: [recipeWindow("chromium", "draft", ["chromium", "--new-window"])] }
    ]
  }
  var call = {
    id: "call",
    name: "Call",
    lastWorkspace: 1,
    updatedAt: "2026-08-19T13:40:00Z",
    extras: mergeExtras(defaultExtras(), { dnd: "on" }),
    workspaces: [
      { n: 1, windows: [recipeWindow("chromium", "Meet", ["chromium", "--new-window"])] },
      { n: 2, windows: [recipeWindow("com.mitchellh.ghostty", "notes", ["ghostty"])] }
    ]
  }
  var review = {
    id: "review",
    name: "Review",
    lastWorkspace: 1,
    updatedAt: "2026-08-18T16:40:00Z",
    extras: defaultExtras(),
    workspaces: [
      { n: 1, windows: [recipeWindow("chromium", "PRs", ["chromium", "--new-window"])] },
      { n: 2, windows: [recipeWindow("com.mitchellh.ghostty", "diff", ["ghostty"])] }
    ]
  }
  return {
    version: 1,
    currentId: "writing",
    desks: [writing, call, review]
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
  var to = deskId == null || deskId === "" ? null : String(deskId)
  if (next.currentId && to && String(next.currentId) !== to) {
    stampLastUsed(next, next.currentId, now)
  }
  if (to) stampLastUsed(next, to, now)
  next.currentId = to
  return next
}

function currentSlug(state) {
  if (!state || state.currentId == null || state.currentId === "") return "unnamed"
  return String(state.currentId)
}

function matchWindow(recipeWin, clients, usedAddresses, workspaceN) {
  var list = isArray(clients) ? clients : parseJsonArg(clients)
  var used = addressSet(usedAddresses)
  var i
  var wantAddr = recipeWin && recipeWin.address ? stripAddress(recipeWin.address) : ""
  if (wantAddr) {
    for (i = 0; i < list.length; i++) {
      var byAddr = list[i]
      var addr = stripAddress(byAddr && byAddr.address)
      if (!addr || used[addr]) continue
      if (addr === wantAddr) return byAddr
    }
  }
  var wantClass = String((recipeWin && (recipeWin.class || recipeWin.initialClass)) || "").toLowerCase()
  var wantInitial = String((recipeWin && recipeWin.initialClass) || "").toLowerCase()
  if (!wantClass) return null
  var wantN = workspaceN == null || workspaceN === "" ? null : Number(workspaceN)
  for (i = 0; i < list.length; i++) {
    var client = list[i]
    var clientAddr = stripAddress(client && client.address)
    if (clientAddr && used[clientAddr]) continue
    if (wantN != null && isFinite(wantN) && clientWorkspaceN(client) !== wantN) continue
    var cc = String(client.class || "").toLowerCase()
    var ic = String(client.initialClass || "").toLowerCase()
    if (cc === wantClass || ic === wantClass || (wantInitial && (cc === wantInitial || ic === wantInitial))) {
      return client
    }
  }
  return null
}

function monitorAllowSet(connected) {
  if (!isArray(connected)) return null
  var allow = {}
  var i
  for (i = 0; i < connected.length; i++) {
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

function launchMissingPlan(desk, clientsJson) {
  var extras = (desk && desk.extras) || defaultExtras()
  var empty = []
  empty.launches = []
  if (extras.launchMissing === false) return empty
  var clients = clientsForMatch(clientsJson, desk)
  var allow = null
  if (clientsJson && typeof clientsJson === "object" && !isArray(clientsJson) && isArray(clientsJson.monitors)) {
    allow = monitorAllowSet(clientsJson.monitors)
  }
  var used = []
  var launches = []
  var workspaces = deskWorkspaces(desk)
  var i
  var j
  for (i = 0; i < workspaces.length; i++) {
    var ws = workspaces[i]
    var n = Number(ws && ws.n)
    if (n < 1 || n > 10) continue
    var wins = (ws && ws.windows) || []
    for (j = 0; j < wins.length; j++) {
      var rw = wins[j]
      if (isScratchpadish(rw)) continue
      var matched = matchWindow(rw, clients, used, n)
      if (matched) {
        if (matched.address) used.push(String(matched.address))
        continue
      }
      var exec = resolveExec(rw)
      if (!exec || !exec.length) continue
      var mon = pickConnectedMonitor((ws && ws.monitor) || (rw && rw.monitor), allow)
      var item = {
        n: n,
        workspace: String(n),
        exec: exec,
        argv: exec,
        class: String((rw && rw.class) || ""),
        title: String((rw && rw.title) || "")
      }
      if (mon) item.monitor = mon
      launches.push(item)
    }
  }
  launches.launches = launches.slice()
  return launches
}

function updateDesk(state, deskId, stage, nowIso) {
  var next = normalizeState(state)
  var i
  var source = stage
  if (stage && stage.recipe) source = stage.recipe
  var workspaces = snapshotWorkspaces(source)
  var last = prevLastWorkspace(source)
  var stamp = nowIso ? String(nowIso) : isoNow()
  for (i = 0; i < next.desks.length; i++) {
    if (next.desks[i].id !== deskId) continue
    var prev = next.desks[i]
    var updated = {
      id: prev.id,
      name: prev.name,
      lastWorkspace: last != null ? last : prev.lastWorkspace,
      updatedAt: stamp,
      lastUsed: Date.parse(stamp) || Date.now(),
      extras: prev.extras,
      workspaces: workspaces
    }
    var layout = snapshotLayout(source, workspaces)
    if (layout.length) updated.layout = layout
    next.desks[i] = updated
    break
  }
  return next
}

function renameDesk(state, deskId, newName) {
  var next = normalizeState(state)
  var i
  for (i = 0; i < next.desks.length; i++) {
    if (next.desks[i].id !== deskId) continue
    if (newName != null && String(newName) !== "") next.desks[i].name = String(newName)
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

function forgetRestorePlan(clientsJson, desk) {
  var slug = desk && typeof desk === "object" ? (desk.id || desk.name) : desk
  // Forgetting unparks onto 1-10 only. Layout moves belong to switching in.
  return restorePlan(clientsJson, slug, null)
}

function targetedNamedDesk(card, state) {
  if (!card || card.kind !== "desk") return null
  var id = card.id
  if (id == null || id === "") return null
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
  if (theme == null || theme === "") return null
  theme = String(theme)
  if (theme === "leave" || theme === "set" || theme === "set…") return null
  return theme
}

function parseThemeList(text) {
  var raw = String(text || "").split(/\r?\n/)
  var out = []
  var seen = {}
  var i
  for (i = 0; i < raw.length; i++) {
    var name = String(raw[i] || "").replace(/^\s+|\s+$/g, "")
    if (!name) continue
    if (name.indexOf("Usage:") === 0) continue
    if (seen[name]) continue
    seen[name] = true
    out.push(name)
  }
  return out
}

function pickerCards(state, query, stage, nowMs) {
  var st = state || emptyState()
  var q = normalizeQuery(query)
  var desks = filterDesks(st.desks || [], q)
  var cards = []
  var i
  var unsaved = q === "" ? unsavedCard(st, stage) : null
  if (unsaved) cards.push(unsaved)
  for (i = 0; i < desks.length; i++) {
    var desk = desks[i]
    var here = st.currentId != null && desk.id === st.currentId
    var life = deskLife(desk, stage, st.currentId)
    cards.push({
      kind: "desk",
      id: desk.id,
      name: desk.name,
      here: here,
      life: life,
      dnd: !!(desk.extras && desk.extras.dnd === "on"),
      tiles: deskTiles(deskPreviewSource(desk, stage, st.currentId)),
      meta: deskSpaceMeta(desk) + formatDeskMeta(desk, nowMs, here),
      desk: desk
    })
  }
  if (q === "") cards.push({ kind: "new", name: "+ New Desk", meta: "Enter Starts Empty", tiles: [] })
  return cards
}

function unnamedParkedWindows(stage) {
  var parked = stage && isArray(stage.parked) ? stage.parked : []
  var out = []
  var i
  for (i = 0; i < parked.length; i++) {
    if (parked[i] && parked[i].slug === "unnamed") out.push(parked[i])
  }
  return out
}

function parkedToStage(parked) {
  var groups = {}
  var windows = []
  var i
  var n
  for (i = 0; i < parked.length; i++) {
    var p = parked[i] || {}
    n = Number(p.n)
    var win = copyGeom({
      address: p.address,
      class: p.class,
      initialClass: p.initialClass,
      title: p.title,
      floating: !!p.floating,
      monitor: p.monitor,
      workspace: n
    }, p)
    windows.push(win)
    if (n >= 1 && n <= 10) {
      if (!groups[n]) groups[n] = []
      groups[n].push(win)
    }
  }
  var wss = []
  for (n = 1; n <= 10; n++) {
    if (groups[n]) wss.push({ n: n, windows: groups[n] })
  }
  return { workspaces: wss, windows: windows, parked: [], lastWorkspace: wss.length ? wss[0].n : 1 }
}

function unsavedCard(state, stage) {
  var here = !state || state.currentId == null || state.currentId === ""
  var parked = unnamedParkedWindows(stage)
  if (!here && !parked.length) return null
  // +new parks the untitled room then leaves currentId null; 1-10 is empty
  // and the windows sit on unnamed lots, so this is a parked unsaved room.
  if (here && parked.length && !stageWindows(stage).length) here = false
  var parkedStage = parkedToStage(parked)
  if (stage && stage.monitorSizes && parkedStage) parkedStage.monitorSizes = stage.monitorSizes
  var tiles = here ? previewTiles(stage) : previewTiles(parkedStage)
  return {
    kind: "unsaved",
    name: "Unsaved",
    here: !!here,
    dnd: false,
    tiles: tiles,
    meta: here ? "This Room Is Not Saved" : "Parked Untitled Room"
  }
}

function deskSpaceMeta(desk) {
  var used = 0
  var list = deskWorkspaces(desk)
  var i
  for (i = 0; i < list.length; i++) {
    if (list[i] && list[i].windows && list[i].windows.length) used += 1
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

function parseJsonArg(value) {
  if (value == null || value === "") return []
  var parsed = value
  if (typeof value === "string") {
    var trimmed = value.replace(/^\s+|\s+$/g, "")
    if (trimmed === "") return []
    try {
      parsed = JSON.parse(trimmed)
    } catch (err) {
      return []
    }
  }
  if (isArray(parsed)) return parsed
  if (parsed && typeof parsed === "object") {
    if (isArray(parsed.workspaces)) return parsed.workspaces
    if (isArray(parsed.clients)) return parsed.clients
    if (parsed.id != null || parsed.address != null) return [parsed]
  }
  return []
}

function workspaceBareName(name) {
  var nm = String(name || "")
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
  if (client && client.monitorName) return String(client.monitorName)
  if (client && typeof client.monitor === "string" && client.monitor !== "") return client.monitor
  var n = clientWorkspaceN(client)
  var list = workspaces || []
  var i
  for (i = 0; i < list.length; i++) {
    if (numberedWorkspaceId(list[i]) === n && list[i].monitor) return String(list[i].monitor)
  }
  if (!client || client.monitor == null || client.monitor === "") return ""
  return String(client.monitor)
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
  var mons = parseJsonArg(monitorsJson)
  var out = []
  var i
  if (mons.length) {
    for (i = 0; i < mons.length; i++) {
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
  var mons = parseJsonArg(monitorsJson)
  var out = {}
  var i
  for (i = 0; i < mons.length; i++) {
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
  if (!(w > 0 && h > 0)) return null
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
  var mons = parseJsonArg(monitorsJson)
  var out = []
  var seen = {}
  var i
  if (mons.length) {
    for (i = 0; i < mons.length; i++) {
      if (!mons[i] || mons[i].disabled) continue
      var name = safeMonitor(mons[i].name)
      if (!name || seen[name]) continue
      seen[name] = true
      out.push(name)
    }
    return out
  }
  var list = isArray(workspaces) ? workspaces : parseJsonArg(workspaces)
  for (i = 0; i < list.length; i++) {
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
      if (layout[i] && Number(layout[i].n) === Number(n) && layout[i].monitor) return String(layout[i].monitor)
    }
  }
  if (windows && windows[0] && windows[0].monitor) return String(windows[0].monitor)
  var list = isArray(workspaces) ? workspaces : []
  for (i = 0; i < list.length; i++) {
    if (numberedWorkspaceId(list[i]) === Number(n) && list[i].monitor) return String(list[i].monitor)
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
  for (i = 0; i < list.length; i++) {
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
  for (i = 0; i < names.length; i++) {
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
  var a = String(address || "")
  if (a.indexOf("address:") === 0) a = a.slice(8)
  a = safeDispatchToken(a)
  if (!a) return ""
  return "address:" + a
}

function stripAddress(address) {
  var a = String(address || "")
  if (a.indexOf("address:") === 0) return a.slice(8)
  return a
}

function joinBatch(dispatches) {
  if (!dispatches || !dispatches.length) return ""
  var parts = []
  var i
  for (i = 0; i < dispatches.length; i++) parts.push("dispatch " + dispatches[i])
  return parts.join("; ")
}

function stageWindows(stage) {
  if (!stage) return []
  if (isArray(stage.windows) && stage.windows.length) return stage.windows
  var out = []
  var wss = stage.workspaces || []
  var i
  var j
  for (i = 0; i < wss.length; i++) {
    var n = Number(wss[i] && wss[i].n)
    var wins = (wss[i] && wss[i].windows) || []
    for (j = 0; j < wins.length; j++) {
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
  var src = state && typeof state === "object" ? state : {}
  var desks = []
  var raw = isArray(src.desks) ? src.desks : []
  var i
  for (i = 0; i < raw.length; i++) {
    var desk = normalizeDesk(raw[i])
    if (desk) desks.push(desk)
  }
  var currentId = src.currentId == null || src.currentId === "" ? null : String(src.currentId)
  return { version: 1, currentId: currentId, desks: desks }
}

function normalizeDesk(desk) {
  if (!desk || typeof desk !== "object") return null
  var workspaces = []
  var raw = deskWorkspaces(desk)
  var i
  var j
  for (i = 0; i < raw.length; i++) {
    var ws = raw[i]
    var n = Number(ws && ws.n)
    if (n < 1 || n > 10) continue
    var windows = []
    var wins = (ws && ws.windows) || []
    for (j = 0; j < wins.length; j++) {
      if (isScratchpadish(wins[j])) continue
      windows.push(normalizeRecipeWindow(wins[j]))
    }
    var rec = { n: n, windows: windows }
    var mon = safeMonitor(ws && ws.monitor)
    if (!mon && windows[0]) mon = safeMonitor(windows[0].monitor)
    if (mon) rec.monitor = mon
    workspaces.push(rec)
  }
  workspaces.sort(function(a, b) { return a.n - b.n })
  var last = desk.lastWorkspace
  if ((last == null || last === "") && desk.recipe && desk.recipe.lastWorkspace != null) {
    last = desk.recipe.lastWorkspace
  }
  if (last == null || last === "") last = null
  else last = Number(last)
  var updatedAt = desk.updatedAt ? String(desk.updatedAt) : ""
  var lastUsed = desk.lastUsed
  if (lastUsed == null || lastUsed === "") lastUsed = null
  else lastUsed = Number(lastUsed)
  if (!isFinite(lastUsed)) lastUsed = null
  if (lastUsed == null && updatedAt) {
    var fromUpdated = Date.parse(updatedAt)
    if (isFinite(fromUpdated)) lastUsed = fromUpdated
  }
  if (!updatedAt && lastUsed != null) {
    updatedAt = new Date(lastUsed).toISOString()
  }
  var out = {
    id: String(desk.id || slugify(desk.name || "unnamed")),
    name: String(desk.name || desk.id || "Unnamed"),
    lastWorkspace: last,
    updatedAt: updatedAt,
    extras: mergeExtras(defaultExtras(), desk.extras),
    workspaces: workspaces
  }
  if (lastUsed != null && isFinite(Number(lastUsed))) out.lastUsed = Number(lastUsed)
  var layout = normalizeLayout(desk.layout)
  if (!layout.length) layout = deskLayout({ workspaces: workspaces })
  if (layout.length) out.layout = layout
  var sizes = normalizeMonitorSizes(desk.monitorSizes)
  if (sizes) out.monitorSizes = sizes
  return out
}

function normalizeRecipeWindow(w) {
  var src = w || {}
  var exec = resolveExec(src)
  var rec = {
    class: String(src.class || ""),
    initialClass: String(src.initialClass || src.class || ""),
    title: String(src.title || ""),
    exec: exec,
    floating: !!src.floating,
    monitor: String(src.monitor || "")
  }
  if (src.address) rec.address = String(src.address)
  copyGeom(rec, src)
  delete rec.pid
  if (rec.fullscreen) rec.fullscreen = Number(rec.fullscreen)
  var cwd = String(src.cwd || "")
  if (cwd && !/[\n\r]/.test(cwd)) rec.cwd = cwd
  var cmd = safeArgv(src.cmd)
  if (cmd.length && !isShellBin(cmd[0])) rec.cmd = cmd
  var icon = iconName(src)
  if (icon) rec.icon = icon
  return rec
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
    theme: "leave",
    launchMissing: true
  }
  if (base && (base.dnd === "on" || base.dnd === "off" || base.dnd === "leave")) out.dnd = base.dnd
  if (base && typeof base.theme === "string" && base.theme !== "") out.theme = base.theme
  if (base && base.launchMissing === false) out.launchMissing = false
  if (extra && (extra.dnd === "on" || extra.dnd === "off" || extra.dnd === "leave")) out.dnd = extra.dnd
  if (extra && typeof extra.theme === "string" && extra.theme !== "") out.theme = extra.theme
  if (extra && extra.launchMissing === false) out.launchMissing = false
  if (extra && extra.launchMissing === true) out.launchMissing = true
  return out
}

function lastClassSegment(cls) {
  var parts = String(cls || "").split(".")
  return parts[parts.length - 1] || ""
}

function prettyApp(win) {
  var cls = String((win && (win.class || win.initialClass)) || "")
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
  if (win && typeof win === "object" && win.letters) return String(win.letters)
  var raw = String(name || "").replace(/^\s+|\s+$/g, "")
  if (!raw || raw === "app") {
    var cls = String((win && (win.class || win.initialClass)) || (typeof win === "string" ? win : "") || "")
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
  var title = String((win && win.title) || "").replace(/^\s+|\s+$/g, "")
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
  for (i = 0; i < ws.windows.length; i++) {
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
  return label
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

function deskTiles(desk, limit) {
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
    for (i = 0; i < desk.windows.length; i++) {
      var wn = Number(desk.windows[i] && desk.windows[i].workspace)
      if (wn < 1 || wn > cap) continue
      if (!byN[wn] || !isArray(byN[wn].windows)) {
        byN[wn] = { n: wn, windows: [], monitor: byN[wn] && byN[wn].monitor }
      }
      byN[wn].windows.push(desk.windows[i])
    }
  }
  var sizes = (desk && desk.monitorSizes) || {}
  var tiles = []
  for (n = 1; n <= cap; n++) {
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
      aspect: aspectForMonitor(byN[n] && byN[n].monitor, sizes)
    })
  }
  return tiles
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
  return { x: x, y: y, w: w, h: h }
}

function windowPanes(windows) {
  return paneLayout(windows).panes
}

function windowsUnder(windows) {
  return paneLayout(windows).under
}

function paneLayout(windows) {
  var list = isArray(windows) ? windows : []
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
  var top = coveringWindow(list, geoms, bw, bh)
  if (!top) top = coveringWindow(list, [])
  if (top) {
    return { panes: [paneRecord(top, 0, 0, 1, 1)], under: underRecords(list, top) }
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
  for (i = 0; i < list.length; i++) {
    var win = list[i]
    if (!win || win === top) continue
    if (topAddr && win.address && stripAddress(win.address) === topAddr) continue
    out.push({
      icon: iconName(win),
      class: String((win.class || win.initialClass) || ""),
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
    class: String((win && (win.class || win.initialClass)) || ""),
    letters: iconLetters(win),
    floating: !!(win && win.floating)
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
  if (src.cwd) dst.cwd = String(src.cwd)
  var cmd = safeArgv(src.cmd)
  if (cmd.length) dst.cmd = cmd
  return dst
}

function parseTerminalProbe(text) {
  var lines = String(text || "").split(/\r?\n/)
  var out = []
  var i
  for (i = 0; i < lines.length; i++) {
    var line = lines[i]
    if (!line) continue
    var parts = line.split("\t")
    if (parts.length < 2) continue
    var pid = Number(parts[0])
    if (!isFinite(pid) || pid < 1) continue
    var cwd = String(parts[1] || "")
    var cmd = []
    if (parts.length > 2 && parts[2]) cmd = safeArgv(parts.slice(2))
    if (cmd.length && isShellBin(cmd[0])) cmd = []
    var row = { pid: pid }
    if (cwd && cwd.charAt(0) === "/") row.cwd = cwd
    if (cmd.length) row.cmd = cmd
    out.push(row)
  }
  return out
}

function applyTerminalHints(stage, hints) {
  if (!stage) return stage
  var byPid = {}
  var list = isArray(hints) ? hints : []
  var i
  for (i = 0; i < list.length; i++) {
    if (list[i] && list[i].pid) byPid[Number(list[i].pid)] = list[i]
  }
  function stamp(win) {
    if (!win || win.pid == null) return
    var hint = byPid[Number(win.pid)]
    if (!hint) return
    if (hint.cwd) win.cwd = String(hint.cwd)
    if (isArray(hint.cmd) && hint.cmd.length) win.cmd = copyStrings(hint.cmd)
  }
  var wins = stage.windows || []
  for (i = 0; i < wins.length; i++) stamp(wins[i])
  var parked = stage.parked || []
  for (i = 0; i < parked.length; i++) stamp(parked[i])
  var wss = stage.workspaces || []
  var j
  for (i = 0; i < wss.length; i++) {
    var ww = (wss[i] && wss[i].windows) || []
    for (j = 0; j < ww.length; j++) stamp(ww[j])
  }
  return stage
}

function parkedForSlug(stage, slug) {
  var parked = stage && isArray(stage.parked) ? stage.parked : []
  var clean = sanitizeSlug(slug)
  var out = []
  var i
  for (i = 0; i < parked.length; i++) {
    if (parked[i] && parked[i].slug === clean) out.push(parked[i])
  }
  return out
}

function isCurrentDesk(desk, currentId) {
  return !!(desk && currentId != null && currentId !== "" && String(desk.id) === String(currentId))
}

function liveWindows(desk, stage, currentId) {
  if (isCurrentDesk(desk, currentId)) return stageWindows(stage)
  if ((currentId == null || currentId === "") && (!desk || sanitizeSlug(desk.id) === "unnamed")) {
    var here = stageWindows(stage)
    var parked = parkedForSlug(stage, "unnamed")
    if (!parked.length) return here
    if (!here.length) return parked
    return here.concat(parked)
  }
  return parkedForSlug(stage, desk && desk.id)
}

function deskLife(desk, stage, currentId) {
  return liveWindows(desk, stage, currentId).length ? "live" : "dead"
}

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
  return desk
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

function wakePlan(desk, stage, currentId) {
  var here = isCurrentDesk(desk, currentId)
  var source = here ? stage : { windows: [], parked: parkedForSlug(stage, desk && desk.id) }
  var forced = {
    id: desk && desk.id,
    name: desk && desk.name,
    extras: mergeExtras(defaultExtras(), { launchMissing: true }),
    workspaces: deskWorkspaces(desk)
  }
  var launches = launchMissingPlan(forced, source)
  var list = launches && launches.launches ? launches.launches : (isArray(launches) ? launches : [])
  var layout = deskLayout(desk)
  var byN = {}
  var li
  for (li = 0; li < layout.length; li++) byN[layout[li].n] = layout[li].monitor
  var allow = monitorAllowSet(stage && stage.monitors)
  var i
  for (i = 0; i < list.length; i++) {
    if (!here) list[i].workspace = parkSelector(sanitizeSlug(desk && desk.id), list[i].n)
    var mon = pickConnectedMonitor(list[i].monitor || byN[list[i].n], allow)
    if (mon) list[i].monitor = mon
    else if (list[i].monitor) list[i].monitor = ""
  }
  list.launches = list.slice()
  return list
}

function previewTiles(source, limit) {
  return deskTiles(source, limit)
}

function snapshotWorkspaces(stage) {
  var out = []
  if (!stage) return out
  var wss = stage.workspaces
  if ((!isArray(wss) || !wss.length) && stage.recipe && isArray(stage.recipe.workspaces)) {
    wss = stage.recipe.workspaces
  }
  if (!isArray(wss) || !wss.length) {
    var grouped = {}
    var wins = stageWindows(stage)
    var i
    for (i = 0; i < wins.length; i++) {
      var n = Number(wins[i].workspace)
      if (n < 1 || n > 10) continue
      if (!grouped[n]) grouped[n] = []
      grouped[n].push(wins[i])
    }
    wss = []
    for (n = 1; n <= 10; n++) {
      if (grouped[n]) wss.push({ n: n, windows: grouped[n] })
    }
  }
  var w
  var j
  for (w = 0; w < wss.length; w++) {
    var n = Number(wss[w] && wss[w].n)
    if (n < 1 || n > 10) continue
    var windows = []
    var list = (wss[w] && wss[w].windows) || []
    for (j = 0; j < list.length; j++) {
      if (isScratchpadish(list[j])) continue
      windows.push(normalizeRecipeWindow(recipeFromStageWindow(list[j])))
    }
    var rec = { n: n, windows: windows }
    var mon = safeMonitor(wss[w] && wss[w].monitor)
    if (!mon && windows[0]) mon = safeMonitor(windows[0].monitor)
    if (!mon && stage && isArray(stage.layout)) {
      var li
      for (li = 0; li < stage.layout.length; li++) {
        if (stage.layout[li] && Number(stage.layout[li].n) === n) {
          mon = safeMonitor(stage.layout[li].monitor)
          break
        }
      }
    }
    if (mon) rec.monitor = mon
    out.push(rec)
  }
  out.sort(function(a, b) { return a.n - b.n })
  return out
}

function recipeFromStageWindow(w) {
  var src = w || {}
  return copyGeom({
    address: src.address ? String(src.address) : "",
    class: String(src.class || ""),
    initialClass: String(src.initialClass || src.class || ""),
    title: String(src.title || ""),
    exec: isArray(src.exec) && src.exec.length ? copyStrings(src.exec) : guessExec(src),
    floating: !!src.floating,
    monitor: String(src.monitor || "")
  }, src)
}

function recipeWindow(cls, title, exec) {
  return {
    class: cls,
    initialClass: cls,
    title: title,
    exec: exec,
    floating: false,
    monitor: "DP-1"
  }
}

function copyStrings(list) {
  var out = []
  var i
  for (i = 0; i < list.length; i++) out.push(String(list[i]))
  return out
}

function idSet(existingIds) {
  var taken = {}
  if (!existingIds) return taken
  var i
  if (isArray(existingIds)) {
    for (i = 0; i < existingIds.length; i++) taken[String(existingIds[i])] = true
    return taken
  }
  if (typeof existingIds === "object") {
    for (var k in existingIds) {
      if (Object.prototype.hasOwnProperty.call(existingIds, k) && existingIds[k]) taken[k] = true
    }
  }
  return taken
}

function packRead(ok, state, error) {
  var src = state || emptyState()
  var out = {
    ok: !!ok,
    state: src,
    version: src.version,
    currentId: src.currentId,
    desks: src.desks
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
  return { slug: match[1], n: n }
}

function parkedAsClients(parked) {
  var out = []
  if (!isArray(parked)) return out
  var i
  for (i = 0; i < parked.length; i++) {
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
  if (isArray(value)) return value
  if (value && typeof value === "object") {
    if (isArray(value.parked) && value.parked.length) return parkedAsClients(value.parked)
    if (isArray(value.clients)) return value.clients
  }
  return parseJsonArg(value)
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

function asMatchClient(win, n) {
  var id = Number(n)
  if (!isFinite(id) && win && win.workspace != null) id = Number(win.workspace)
  return {
    address: win && win.address,
    class: win && win.class,
    initialClass: win && win.initialClass,
    title: win && win.title,
    workspace: { id: id, name: String(id) }
  }
}

function clientsForMatch(value, desk) {
  if (typeof value === "string") return parseJsonArg(value)
  if (isArray(value)) return value
  if (value && typeof value === "object") {
    var out = []
    var i
    if (isArray(value.windows)) {
      for (i = 0; i < value.windows.length; i++) {
        out.push(asMatchClient(value.windows[i], value.windows[i].workspace))
      }
    }
    if (isArray(value.parked)) {
      var slug = sanitizeSlug(desk && (desk.id || desk.name) || "")
      for (i = 0; i < value.parked.length; i++) {
        var p = value.parked[i]
        if (slug && p.slug && p.slug !== slug) continue
        out.push(asMatchClient(p, p.n))
      }
    }
    if (out.length) return out
  }
  return parseJsonArg(value)
}

function deskWorkspaces(desk) {
  if (!desk) return []
  if (isArray(desk.workspaces) && desk.workspaces.length) return desk.workspaces
  if (desk.recipe && isArray(desk.recipe.workspaces)) return desk.recipe.workspaces
  return isArray(desk.workspaces) ? desk.workspaces : []
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
  for (i = 0; i < state.desks.length; i++) {
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
    for (i = 0; i < usedAddresses.length; i++) {
      var addr = stripAddress(usedAddresses[i])
      if (addr) set[addr] = true
    }
    return set
  }
  if (typeof usedAddresses === "object") {
    for (var k in usedAddresses) {
      if (Object.prototype.hasOwnProperty.call(usedAddresses, k) && usedAddresses[k]) set[stripAddress(k)] = true
    }
  }
  return set
}
