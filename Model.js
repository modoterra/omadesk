// Pure functions for desks. Loaded by Overlay.qml and by Node vm tests.
// No Node APIs. No QML types.
// Scratchpad (special:*) is global: never stage, park/restore, or desks.json.
// Two Chromiums after reboot are best-effort; guessExec uses --new-window.

function emptyState() {
  return { version: 1, currentId: null, desks: [] }
}

function defaultExtras() {
  return { dnd: "leave", launchMissing: true }
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

function parseStage(clientsJson, workspacesJson) {
  var clients = parseJsonArg(clientsJson)
  var workspaces = parseJsonArg(workspacesJson)
  var groups = {}
  var windows = []
  var parked = []
  var i
  for (i = 0; i < clients.length; i++) {
    var client = clients[i]
    var lot = parseParkedLot(client)
    if (lot) {
      parked.push({
        slug: lot.slug,
        n: lot.n,
        address: String(client.address || ""),
        class: String(client.class || ""),
        initialClass: String(client.initialClass || ""),
        title: String(client.title || ""),
        floating: !!client.floating,
        monitor: monitorName(client, workspaces)
      })
      continue
    }
    var n = clientWorkspaceN(client)
    if (n < 1 || n > 10) continue
    var win = {
      address: String(client.address || ""),
      class: String(client.class || ""),
      initialClass: String(client.initialClass || ""),
      title: String(client.title || ""),
      floating: !!client.floating,
      monitor: monitorName(client, workspaces),
      workspace: n
    }
    windows.push(win)
    if (!groups[n]) groups[n] = []
    groups[n].push(win)
  }
  var wsOut = []
  for (n = 1; n <= 10; n++) {
    if (groups[n] && groups[n].length) wsOut.push({ n: n, windows: groups[n] })
  }
  return {
    workspaces: wsOut,
    windows: windows,
    parked: parked,
    lastWorkspace: pickLastWorkspace(workspaces, wsOut)
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
  return "name:" + parkLotName(slug, n)
}

function moveDispatch(workspaceSelector, address) {
  var ws = String(workspaceSelector || "")
  var addr = windowSelector(address)
  return "hl.dsp.window.move({ workspace = \"" + ws + "\", follow = false, window = \"" + addr + "\" })"
}

function focusDispatch(workspaceSelector) {
  var ws = String(workspaceSelector || "")
  return "hl.dsp.focus({ workspace = \"" + ws + "\" })"
}

function parkPlan(stage, slug, toSlug, desk) {
  var park = buildParkPlan(stage, slug)
  if (toSlug == null || toSlug === "") return park
  var restore = restorePlan(stage, toSlug, desk)
  var last = null
  if (desk && desk.lastWorkspace != null) last = desk.lastWorkspace
  else if (desk && desk.recipe && desk.recipe.lastWorkspace != null) last = desk.recipe.lastWorkspace
  return {
    park: park,
    restore: restore,
    sequential: true,
    lastWorkspace: last
  }
}

function buildParkPlan(stage, slug) {
  var clean = sanitizeSlug(slug)
  var dispatches = []
  var list = stageWindows(stage)
  var i
  for (i = 0; i < list.length; i++) {
    var win = list[i]
    var n = Number(win.workspace)
    if (n < 1 || n > 10) continue
    if (!win.address) continue
    dispatches.push(moveDispatch(parkSelector(clean, n), win.address))
  }
  return { slug: clean, dispatches: dispatches, batch: joinBatch(dispatches) }
}

function restoreFromPark(park) {
  var dispatches = []
  var list = (park && park.dispatches) || []
  var i
  for (i = 0; i < list.length; i++) {
    var lua = String(list[i] || "")
    var ws = /workspace = "name:omadesk-[^"]+-([0-9]+)"/.exec(lua)
    var addr = /window = "(address:[^"]+|0x[^"]+)"/.exec(lua)
    if (!ws || !addr) continue
    dispatches.push(moveDispatch(ws[1], addr[1]))
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
    dispatches.push(moveDispatch(String(n), client.address))
  }
  return { slug: clean, dispatches: dispatches, batch: joinBatch(dispatches) }
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
  // Two Chromiums after reboot are best-effort; --new-window is the hint we can give.
  if (lower.indexOf("chromium") >= 0 || last === "chromium" || last === "chrome" || last === "google-chrome") {
    return ["chromium", "--new-window"]
  }
  if (last) return [last]
  return []
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
  return {
    id: uniqueId(slugify(display)),
    name: display,
    lastWorkspace: last,
    updatedAt: nowIso ? String(nowIso) : "",
    extras: mergeExtras(defaultExtras(), extras),
    workspaces: workspaces
  }
}

function uniqueId(base, existingIds) {
  var id = sanitizeSlug(base)
  var taken = idSet(existingIds)
  if (!taken[id]) return id
  var n = 2
  while (taken[id + "-" + n]) n++
  return id + "-" + n
}

function saveDesk(state, recipe) {
  var next = normalizeState(state)
  var desk = normalizeDesk(recipe)
  if (!desk) return next
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

function switchPlan(stage, clientsJson, fromSlug, toSlug) {
  return {
    park: parkPlan(stage, fromSlug == null || fromSlug === "" ? "unnamed" : fromSlug),
    restore: restorePlan(clientsJson, toSlug),
    sequential: true
  }
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

function leaveDesk(state) {
  var next = normalizeState(state)
  next.currentId = null
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

function launchMissingPlan(desk, clientsJson) {
  var extras = (desk && desk.extras) || defaultExtras()
  var empty = []
  empty.launches = []
  if (extras.launchMissing === false) return empty
  var clients = clientsForMatch(clientsJson, desk)
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
      var exec = rw && isArray(rw.exec) && rw.exec.length ? copyStrings(rw.exec) : guessExec(rw)
      if (!exec || !exec.length) continue
      launches.push({
        n: n,
        workspace: String(n),
        exec: exec,
        argv: exec,
        class: String((rw && rw.class) || ""),
        title: String((rw && rw.title) || "")
      })
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
    next.desks[i] = {
      id: prev.id,
      name: prev.name,
      lastWorkspace: last != null ? last : prev.lastWorkspace,
      updatedAt: stamp,
      lastUsed: Date.parse(stamp) || Date.now(),
      extras: prev.extras,
      workspaces: workspaces
    }
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

function pickerCards(state, query) {
  var st = state || emptyState()
  var q = normalizeQuery(query)
  var desks = filterDesks(st.desks || [], q)
  var cards = []
  var i
  for (i = 0; i < desks.length; i++) {
    var desk = desks[i]
    cards.push({
      kind: "desk",
      id: desk.id,
      name: desk.name,
      here: st.currentId != null && desk.id === st.currentId,
      dnd: !!(desk.extras && desk.extras.dnd === "on"),
      tiles: deskTiles(desk),
      meta: deskSpaceMeta(desk) + formatDeskMeta(desk),
      desk: desk
    })
  }
  if (q === "") cards.push({ kind: "new", name: "+ new desk", meta: "enter starts empty", tiles: [] })
  return cards
}

function deskSpaceMeta(desk) {
  var used = 0
  var list = deskWorkspaces(desk)
  var i
  for (i = 0; i < list.length; i++) {
    if (list[i] && list[i].windows && list[i].windows.length) used += 1
  }
  return used + " space" + (used === 1 ? "" : "s") + " · last used "
}

function formatDeskMeta(desk, nowMs) {
  var stamp = desk && desk.updatedAt
  var then
  if (stamp) then = Date.parse(stamp)
  if ((!isFinite(then) || stamp == null || stamp === "") && desk && desk.lastUsed != null) {
    then = Number(desk.lastUsed)
  }
  if (!isFinite(then)) return ""
  var now = nowMs == null || nowMs === "" ? Date.now() : Number(nowMs)
  if (!isFinite(now)) now = Date.now()
  var delta = now - then
  if (delta < 0) delta = 0
  if (delta < 60000) return "now"
  if (delta < 3600000) {
    var mins = Math.floor(delta / 60000)
    return mins + (mins === 1 ? " minute ago" : " minutes ago")
  }
  if (delta < 86400000) {
    var hours = Math.floor(delta / 3600000)
    return hours + (hours === 1 ? " hour ago" : " hours ago")
  }
  var nowDate = new Date(now)
  var thenDate = new Date(then)
  var startToday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime()
  var startThen = new Date(thenDate.getFullYear(), thenDate.getMonth(), thenDate.getDate()).getTime()
  var dayDiff = Math.round((startToday - startThen) / 86400000)
  if (dayDiff === 1) return "yesterday"
  if (dayDiff > 1) return dayDiff + " days ago"
  var hours2 = Math.floor(delta / 3600000)
  return hours2 + (hours2 === 1 ? " hour ago" : " hours ago")
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

function pickLastWorkspace(workspaces, occupied) {
  var i
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

function windowSelector(address) {
  var a = String(address || "")
  if (a.indexOf("address:") === 0) return a
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
      out.push({
        address: w.address,
        class: w.class,
        initialClass: w.initialClass,
        title: w.title,
        floating: w.floating,
        monitor: w.monitor,
        workspace: w.workspace != null ? w.workspace : n
      })
    }
  }
  return out
}

function lotNumberFromName(name, slug) {
  var nm = workspaceBareName(name)
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
    workspaces.push({ n: n, windows: windows })
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
  if (!updatedAt && lastUsed != null && isFinite(Number(lastUsed))) {
    updatedAt = new Date(Number(lastUsed)).toISOString()
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
  return out
}

function normalizeRecipeWindow(w) {
  var src = w || {}
  var exec = isArray(src.exec) ? copyStrings(src.exec) : guessExec(src)
  var rec = {
    class: String(src.class || ""),
    initialClass: String(src.initialClass || src.class || ""),
    title: String(src.title || ""),
    exec: exec,
    floating: !!src.floating,
    monitor: String(src.monitor || "")
  }
  if (src.address) rec.address = String(src.address)
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
    launchMissing: true
  }
  if (base && (base.dnd === "on" || base.dnd === "off" || base.dnd === "leave")) out.dnd = base.dnd
  if (base && base.launchMissing === false) out.launchMissing = false
  if (extra && (extra.dnd === "on" || extra.dnd === "off" || extra.dnd === "leave")) out.dnd = extra.dnd
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
  var last = lastClassSegment(cls)
  var lower = last.toLowerCase()
  if (lower === "zed") return "Zed"
  if (lower === "ghostty") return "Ghostty"
  if (lower === "chromium" || lower === "chrome" || lower === "google-chrome") return "Chromium"
  if (last === "") return "app"
  return last
}

function tileLabel(ws) {
  if (!ws || !ws.windows || !ws.windows.length) return "empty"
  var w = ws.windows[0]
  var app = prettyApp(w)
  var title = String(w.title || "").replace(/^\s+|\s+$/g, "")
  if (!title) return app
  return app + " · " + title
}

function deskTiles(desk, limit) {
  var max = Number(limit)
  if (!isFinite(max) || max < 1) max = 3
  if (max > 10) max = 10
  var byN = {}
  var list = deskWorkspaces(desk)
  var i
  var last = 0
  for (i = 0; i < list.length; i++) {
    var n = Number(list[i].n)
    if (n >= 1 && n <= 10) {
      byN[n] = list[i]
      if (n > last) last = n
    }
  }
  if (desk && isArray(desk.windows)) {
    for (i = 0; i < desk.windows.length; i++) {
      var wn = Number(desk.windows[i] && desk.windows[i].workspace)
      if (wn >= 1 && wn <= 10 && wn > last) last = wn
    }
  }
  if (last < 3) last = 3
  if (last > max) last = max
  var tiles = []
  for (n = 1; n <= last; n++) {
    var label = tileLabel(byN[n])
    tiles.push({ id: n, n: n, label: label, vacant: label === "empty" })
  }
  return tiles
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
    out.push({ n: n, windows: windows })
  }
  out.sort(function(a, b) { return a.n - b.n })
  return out
}

function recipeFromStageWindow(w) {
  var src = w || {}
  return {
    address: src.address ? String(src.address) : "",
    class: String(src.class || ""),
    initialClass: String(src.initialClass || src.class || ""),
    title: String(src.title || ""),
    exec: isArray(src.exec) && src.exec.length ? copyStrings(src.exec) : guessExec(src),
    floating: !!src.floating,
    monitor: String(src.monitor || "")
  }
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

function parseParkedLot(client) {
  var name = workspaceBareName(client && client.workspace && client.workspace.name)
  if (name.indexOf("special:") === 0 || name === "special") return null
  var match = /^omadesk-(.+)-([0-9]+)$/.exec(name)
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
        name: "omadesk-" + String(p.slug || "") + "-" + String(p.n)
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
  var name = workspaceBareName(client && client.workspace && client.workspace.name)
  if (name.indexOf("special:") === 0 || name === "special") return 0
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
