import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import qs.Ui
import "Model.js" as Model

Item {
  id: root

  property var shell: null
  property var manifest: null
  property bool opened: false
  property string mode: "picker"
  property string filterText: ""
  property bool filterOpen: false
  property int cursorIndex: 0
  property var desksState: ({ version: 1, currentId: null, desks: [] })
  property var cards: []
  property var gridCards: []
  property var stage: ({})
  property string nameText: ""
  property var targetDesk: null
  property var extrasDesk: null
  property var extrasDraft: ({ dnd: "leave", theme: "leave", launchMissing: true })
  property var forgetDesk: null
  property var closeDesk: null
  property bool busy: false
  property bool desksDirReady: false
  property bool debugDemo: false
  property string pendingWrite: ""
  property string clientsJson: ""
  property string workspacesJson: ""
  property string monitorsJson: ""
  property var stageCallback: null
  property bool stageQueued: false
  property string batchPhase: ""
  property var pendingLaunches: []
  property var pendingFocusWs: ""
  property var pendingDnd: ""
  property string switchToId: ""
  property var pendingFocusN: null
  property bool leavingForFresh: false
  property bool restoringUnsaved: false
  property var pendingDesk: null
  property string pendingTheme: ""
  property bool extrasPickingTheme: false
  property var themeNames: []
  property string pendingForgetId: ""

  property color accent: Color.accent
  property color urgent: Color.urgent
  property color background: Color.popups.background
  property color foreground: Color.popups.text
  property color border: Color.popups.border
  property var borderSpec: Border.surfaceSpec("popups", "border", border, Math.max(1, Style.space(2)))
  property color scrim: Color.menu.scrim
  property color selectedBackground: Style.selectedFillFor(foreground, accent)
  property color fill: Style.normalFillFor(foreground, accent)
  property color fillHover: Style.hoverFillFor(foreground, accent)
  property color fillSelected: Style.selectedFillFor(foreground, accent)
  property color borderSoft: Style.normalBorderFor(foreground, accent)
  property color tileFill: Style.normalFillFor(foreground, accent)
  property color dim: Qt.darker(foreground, 1.4)
  readonly property int cornerRadius: Style.cornerRadius
  property string fontFamily: Style.font.family
  property int contentMargin: Style.spacing.popupPadding
  property int cardWidth: Math.min(Style.space(680), panel.width - Style.gapsOut * 2)
  property int gridGap: Style.space(8)
  property int cellWidth: Math.max(1, Math.floor((cardWidth - card.contentLeftInset - card.contentRightInset - gridGap) / 2))
  property int tileColumns: 2
  readonly property string desksDir: (Quickshell.env("HOME") || "") + "/.config/omarchy/omadesk"
  readonly property string desksPath: desksDir + "/desks.json"
  readonly property bool dialogOpen: root.mode !== "picker"
  readonly property int deskCount: (root.desksState && root.desksState.desks && root.desksState.desks.length) ? root.desksState.desks.length : 0
  readonly property bool pickerEmpty: root.mode === "picker" && root.deskCount === 0
  readonly property var mascotLines: [
    "      +---------+",
    "      |  o   o  |",
    "      |    ~    |",
    "      +----+----+",
    "     /|         |\\",
    "     \\|_________|/",
    "       ||     ||",
    "      _||     ||_"
  ]

  readonly property string termProbePy: "import os,sys\nfor pid in sys.argv[1:]:\n  try:\n    p=int(pid)\n  except Exception:\n    continue\n  cwd=''\n  try:\n    cwd=os.readlink('/proc/%d/cwd'%p)\n  except Exception:\n    cwd=''\n  cmd=[]\n  children=[]\n  try:\n    children=open('/proc/%d/task/%d/children'%(p,p)).read().split()\n  except Exception:\n    children=[]\n  for c in children:\n    try:\n      raw=open('/proc/%s/cmdline'%c,'rb').read().split(b'\\0')\n      args=[a.decode('utf-8','replace') for a in raw if a]\n    except Exception:\n      args=[]\n    if args:\n      cmd=args\n      break\n  print('\\t'.join([str(p), cwd]+cmd))\n"

  function pluginId() {
    return (root.manifest && root.manifest.id) || "com.mdtrr.omadesk"
  }

  function emptyState() {
    if (typeof Model.emptyState === "function") return Model.emptyState()
    return { version: 1, currentId: null, desks: [] }
  }

  function open(payloadJson) {
    var payload = ({})
    try { payload = JSON.parse(payloadJson || "{}") } catch (e) { payload = ({}) }
    if (payload.debugDemo) root.debugDemo = true

    root.opened = true
    root.mode = "picker"
    root.filterText = ""
    root.filterOpen = false
    root.cursorIndex = 0
    root.busy = false
    root.reloadDesksFile()
    root.refreshStage(null)
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })

    // Hidden debug path: only the omadesk-dev slugs may park/restore live windows.
    if (payload.debugPark && payload.fromSlug && payload.toSlug)
      root.debugParkRestore(String(payload.fromSlug), String(payload.toSlug))
  }

  function close() {
    root.opened = false
    root.mode = "picker"
  }

  function dismiss() {
    root.opened = false
    root.mode = "picker"
    if (root.shell && typeof root.shell.hide === "function")
      root.shell.hide(root.pluginId())
  }

  function toggle() {
    if (root.opened) root.dismiss()
    else root.open("{}")
  }

  function cancelDialog() {
    if (root.mode === "extras" && root.extrasPickingTheme) {
      root.extrasPickingTheme = false
      Qt.callLater(function() { keyCatcher.forceActiveFocus() })
      return
    }
    root.mode = "picker"
    root.nameText = ""
    root.targetDesk = null
    root.extrasDesk = null
    root.forgetDesk = null
    root.closeDesk = null
    root.extrasPickingTheme = false
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function applyEscape() {
    if (root.dialogOpen) root.cancelDialog()
    else if (root.filterOpen || root.filterText) root.closeFilter()
    else root.dismiss()
  }

  function openFilter() {
    root.filterOpen = true
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function closeFilter() {
    root.filterOpen = false
    root.setFilter("")
  }

  function setFilter(text) {
    root.filterText = String(text || "")
    root.cursorIndex = 0
    root.rebuildCards()
  }

  function reloadDesksFile() {
    desksFile.reload()
  }

  function applyDesksRaw(raw) {
    var next = null
    if (typeof Model.readDesks === "function") {
      try {
        var parsed = Model.readDesks(raw)
        if (parsed && parsed.ok === false) next = root.emptyState()
        else if (parsed && parsed.state) next = parsed.state
        else next = parsed
      } catch (e) { next = null }
    }
    if (!next) {
      try {
        var fallback = JSON.parse(String(raw || "").trim() || "null")
        if (fallback && typeof fallback === "object") next = fallback
      } catch (e) {
        next = null
      }
    }
    if (!next || typeof next !== "object") next = root.emptyState()
    if (!next.desks) next.desks = []
    var emptyFile = !next.desks.length
    if (emptyFile && root.debugDemo && typeof Model.demoDesks === "function") {
      try { next = Model.demoDesks() } catch (e) { next = next }
    }
    root.desksState = next
    root.rebuildCards()
  }

  function persistDesks() {
    var raw = ""
    if (typeof Model.writeDesks === "function") {
      try { raw = Model.writeDesks(root.desksState) } catch (e) { raw = "" }
    }
    if (typeof raw !== "string" || raw === "")
      raw = JSON.stringify(root.desksState || root.emptyState(), null, 2) + "\n"
    root.pendingWrite = raw
    if (!root.desksDirReady) {
      mkdirProc.command = ["mkdir", "-p", root.desksDir]
      mkdirProc.running = true
      return
    }
    desksFile.setText(raw)
  }

  function deskList() {
    return (root.desksState && Array.isArray(root.desksState.desks)) ? root.desksState.desks : []
  }

  function deskById(id) {
    if (id === undefined || id === null || id === "") return null
    var desks = root.deskList()
    for (var i = 0; i < desks.length; i++) {
      if (String(desks[i].id) === String(id)) return desks[i]
    }
    return null
  }

  function extrasOf(desk) {
    var extras = (desk && desk.extras) ? desk.extras : ({})
    var launch = extras.launchMissing
    var launchYes = !(launch === false || launch === "no" || launch === "off")
    var dnd = extras.dnd
    if (dnd === true) dnd = "on"
    if (dnd === false) dnd = "off"
    if (dnd !== "on" && dnd !== "off") dnd = "leave"
    var theme = extras.theme
    if (!theme || theme === "set" || theme === "set…") theme = "leave"
    else theme = String(theme)
    return {
      dnd: dnd,
      theme: theme,
      launchMissing: launchYes
    }
  }

  function patchExtras(patch) {
    var next = {
      dnd: root.extrasDraft && root.extrasDraft.dnd ? root.extrasDraft.dnd : "leave",
      theme: root.extrasDraft && root.extrasDraft.theme ? root.extrasDraft.theme : "leave",
      launchMissing: !(root.extrasDraft && root.extrasDraft.launchMissing === false)
    }
    if (patch) {
      if (patch.dnd !== undefined) next.dnd = patch.dnd
      if (patch.theme !== undefined) next.theme = patch.theme
      if (patch.launchMissing !== undefined) next.launchMissing = patch.launchMissing
    }
    root.extrasDraft = next
  }

  readonly property string themeChipText: {
    var theme = root.extrasDraft && root.extrasDraft.theme ? String(root.extrasDraft.theme) : "leave"
    if (!theme || theme === "leave") return "Set…"
    return theme
  }

  readonly property string headerTitleText: {
    if (root.filterOpen) return root.filterText || "Search Desks…"
    if (root.mode === "save") return "Save Current Desk"
    if (root.mode === "rename") return "Rename Desk"
    if (root.mode === "extras" && root.extrasPickingTheme) return "Theme"
    if (root.mode === "extras" && root.extrasDesk) return String(root.extrasDesk.name || "Extras")
    return "Desks"
  }

  readonly property string headerMetaText: {
    if (root.filterOpen) return ""
    if (root.mode === "extras" && root.extrasPickingTheme) return "Pick a theme"
    if (root.mode === "extras") return "Desk extras"
    if (root.mode === "picker" && !root.pickerEmpty) return "Type / to filter"
    return ""
  }

  readonly property string forgetMessageText: {
    var name = (root.forgetDesk && root.forgetDesk.name) ? String(root.forgetDesk.name) : "this desk"
    return "Forget " + name + "? Parked windows return to 1–10. Nothing is killed."
  }

  readonly property string closeMessageText: {
    var name = (root.closeDesk && root.closeDesk.name) ? String(root.closeDesk.name) : "this desk"
    return "Close every window in " + name + "? The recipe stays. Scratchpad is not touched."
  }

  readonly property bool showingPicker: root.mode === "picker" || root.mode === "forget" || root.mode === "close"
  readonly property int newDeskIndex: {
    var list = root.cards || []
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].kind === "new") return i
    }
    return -1
  }

  function cardFill(hasCursor, isHere) {
    if (isHere) return root.fillSelected
    if (hasCursor) return root.fillHover
    return root.fill
  }

  function cardBorderSpec(hasCursor, isHere) {
    if (hasCursor) return Border.controlSpec("hover-cursor", root.foreground, root.accent)
    if (isHere) return Border.controlSpec("selected", root.foreground, root.accent)
    return Border.controlSpec("normal", root.foreground, root.accent)
  }

  function beginThemePick() {
    root.extrasPickingTheme = true
    root.loadThemes()
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function pickTheme(name) {
    root.patchExtras({ theme: name || "leave" })
    root.extrasPickingTheme = false
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function loadThemes() {
    if (themeListProc.running) return
    themeListProc.command = ["omarchy", "theme", "list"]
    themeListProc.running = true
  }

  function tileLabel(client) {
    if (!client) return ""
    if (client.label) return String(client.label)
    var klass = String(client.class || client.initialClass || "")
    var title = String(client.title || client.initialTitle || "")
    if (klass && title) return klass + " · " + title
    return title || klass
  }

  function iconSource(iconOrWin) {
    var names = []
    if (iconOrWin && typeof iconOrWin === "object") {
      if (iconOrWin.icon) names.push(String(iconOrWin.icon))
      if (typeof Model.iconNames === "function") {
        try {
          var extra = Model.iconNames(iconOrWin) || []
          var e
          for (e = 0; e < extra.length; e++) names.push(extra[e])
        } catch (err) {}
      }
      if (iconOrWin.class) names.push(String(iconOrWin.class))
    } else if (iconOrWin) {
      names.push(String(iconOrWin))
    }
    var i
    for (i = 0; i < names.length; i++) {
      if (!names[i]) continue
      var path = Quickshell.iconPath(names[i], true)
      if (path) return path
    }
    return ""
  }

  function iconLetters(app) {
    if (typeof Model.iconLetters === "function") {
      try { return Model.iconLetters(app) } catch (e) {}
    }
    return "?"
  }

  function terminalPids(stage) {
    var out = []
    var seen = {}
    function add(win) {
      if (!win || win.pid == null) return
      if (typeof Model.isTerminalClass === "function") {
        try { if (!Model.isTerminalClass(win)) return } catch (e) { return }
      }
      var p = Number(win.pid)
      if (!isFinite(p) || p < 1 || seen[p]) return
      seen[p] = true
      out.push(String(p))
    }
    var wins = (stage && stage.windows) || []
    var i
    for (i = 0; i < wins.length; i++) add(wins[i])
    var parked = (stage && stage.parked) || []
    for (i = 0; i < parked.length; i++) add(parked[i])
    return out
  }

  function tilesFrom(source, limit) {
    if (!source) return []
    if (typeof Model.previewTiles === "function") {
      try {
        var preview = Model.previewTiles(source, limit)
        if (Array.isArray(preview)) return preview
      } catch (e) {}
    }
    if (Array.isArray(source.tiles) && source.tiles.length)
      return source.tiles.slice(0, limit || source.tiles.length)

    var spaces = source.workspaces
    if ((!spaces || !spaces.length) && source.recipe)
      spaces = source.recipe.workspaces
    if (!Array.isArray(spaces)) spaces = []

    var out = []
    var i
    for (i = 0; i < spaces.length; i++) {
      var ws = spaces[i] || null
      var clients = (ws && Array.isArray(ws.windows) && ws.windows) || (ws && ws.clients) || []
      if (!Array.isArray(clients) || !clients.length) continue
      var n = ws.n != null ? Number(ws.n) : Number(ws.workspace)
      if (!(n >= 1 && n <= 10)) continue
      var parts = []
      for (var c = 0; c < clients.length; c++) {
        var piece = root.tileLabel(clients[c])
        if (piece) parts.push(piece)
      }
      out.push({ n: n, label: parts.join(" · "), vacant: false })
    }
    return out
  }

  function deskMeta(desk, here) {
    if (typeof Model.formatDeskMeta === "function") {
      try {
        var space = typeof Model.deskSpaceMeta === "function" ? Model.deskSpaceMeta(desk) : ""
        return space + Model.formatDeskMeta(desk, Date.now(), !!here)
      } catch (e) {}
    }
    var tiles = root.tilesFrom(desk, 10)
    var used = 0
    for (var i = 0; i < tiles.length; i++) {
      if (!tiles[i].vacant) used += 1
    }
    var when = "Now"
    if (here) when = "Now"
    else if (desk && desk.lastUsedLabel) when = String(desk.lastUsedLabel)
    else {
      var then = NaN
      if (desk && desk.lastUsed != null && desk.lastUsed !== "") then = Number(desk.lastUsed)
      if (!isFinite(then) && desk && desk.updatedAt) then = Date.parse(desk.updatedAt)
      var delta = Date.now() - then
      if (!isFinite(then) || !isFinite(delta) || delta < 60000) when = "Now"
      else if (delta < 3600000) when = Math.round(delta / 60000) + " Minutes Ago"
      else if (delta < 86400000) when = Math.round(delta / 3600000) + " Hours Ago"
      else if (delta < 172800000) when = "Yesterday"
      else when = Math.round(delta / 86400000) + " Days Ago"
    }
    return used + " Space" + (used === 1 ? "" : "s") + " · Last Used " + when
  }

  function deskToCard(desk) {
    var extras = root.extrasOf(desk)
    var here = !!(root.desksState && String(root.desksState.currentId) === String(desk.id))
    var currentId = root.desksState ? root.desksState.currentId : null
    var life = "dead"
    if (typeof Model.deskLife === "function") {
      try { life = Model.deskLife(desk, root.stage, currentId) } catch (e) { life = "dead" }
    }
    var tiles = root.tilesFrom(desk, 10)
    if (typeof Model.deskPreviewSource === "function" && typeof Model.deskTiles === "function") {
      try { tiles = Model.deskTiles(Model.deskPreviewSource(desk, root.stage, currentId)) } catch (e) {}
    }
    return {
      kind: "desk",
      id: desk.id,
      name: desk.name || "",
      here: here,
      life: life,
      dnd: extras.dnd === "on",
      tiles: tiles,
      meta: root.deskMeta(desk, here),
      desk: desk
    }
  }

  function newDeskCard() {
    return { kind: "new", name: "+ New Desk", meta: "Enter Starts Empty", tiles: [] }
  }

  function rebuildCards() {
    var cards = []
    if (typeof Model.pickerCards === "function") {
      try { cards = Model.pickerCards(root.desksState, root.filterText, root.stage) || [] } catch (e) { cards = [] }
    }
    if (!Array.isArray(cards) || cards.length === 0) {
      var desks = root.deskList()
      if (typeof Model.filterDesks === "function") {
        try {
          var filtered = Model.filterDesks(desks, root.filterText)
          if (Array.isArray(filtered)) desks = filtered
          else if (filtered && Array.isArray(filtered.desks)) desks = filtered.desks
        } catch (e) {}
      } else if (root.filterText) {
        var q = String(root.filterText).toLowerCase()
        var hit = []
        for (var i = 0; i < desks.length; i++) {
          if (String(desks[i].name || "").toLowerCase().indexOf(q) >= 0) hit.push(desks[i])
        }
        desks = hit
      }
      cards = []
      for (var j = 0; j < desks.length; j++) cards.push(root.deskToCard(desks[j]))
    }
    var hasNew = false
    for (var k = 0; k < cards.length; k++) {
      if (cards[k] && cards[k].kind === "new") hasNew = true
    }
    if (!hasNew && !root.filterText) cards.push(root.newDeskCard())
    for (var t = 0; t < cards.length; t++) {
      if (!cards[t] || cards[t].kind === "new" || cards[t].kind === "unsaved") continue
      var src = root.deskById(cards[t].id) || cards[t].desk || cards[t]
      var currentId = root.desksState ? root.desksState.currentId : null
      cards[t].here = !!(currentId && String(currentId) === String(cards[t].id))
      cards[t].meta = root.deskMeta(src, cards[t].here)
      if (typeof Model.deskLife === "function") {
        try { cards[t].life = Model.deskLife(src, root.stage, currentId) } catch (e) {}
      }
      if (typeof Model.deskPreviewSource === "function" && typeof Model.deskTiles === "function") {
        try { cards[t].tiles = Model.deskTiles(Model.deskPreviewSource(src, root.stage, currentId)) } catch (e) {}
      } else if (!(cards[t].tiles && cards[t].tiles.length)) {
        cards[t].tiles = root.tilesFrom(src, 10)
      }
      if (cards[t].dnd === undefined)
        cards[t].dnd = root.extrasOf(src).dnd === "on"
    }
    root.cards = cards
    var grid = []
    for (var g = 0; g < cards.length; g++) {
      if (cards[g] && cards[g].kind !== "new") grid.push({ index: g, card: cards[g] })
    }
    root.gridCards = grid
    if (root.cursorIndex >= cards.length) root.cursorIndex = Math.max(0, cards.length - 1)
    if (root.cursorIndex < 0) root.cursorIndex = 0
  }

  function cardAt(index) {
    if (index < 0 || index >= root.cards.length) return null
    return root.cards[index]
  }

  function highlightedCard() {
    return root.cardAt(root.cursorIndex)
  }

  function highlightedDesk() {
    if (typeof Model.targetedNamedDesk === "function") {
      try { return Model.targetedNamedDesk(root.highlightedCard(), root.desksState) } catch (e) {}
    }
    var card = root.highlightedCard()
    if (card && card.kind === "desk")
      return root.deskById(card.id) || card.desk || null
    return null
  }

  function moveCursor(dx, dy) {
    var count = root.cards.length
    if (count === 0) return
    var next = root.cursorIndex
    if (typeof Model.moveCursor === "function") {
      try {
        var moved = Model.moveCursor(root.cursorIndex, count, dx, dy, 2)
        if (moved && typeof moved === "object") {
          if (typeof moved.cursor === "number") moved = moved.cursor
          else if (typeof moved.index === "number") moved = moved.index
        }
        moved = Number(moved)
        if (isFinite(moved)) next = moved
        else next = NaN
      } catch (e) {
        next = NaN
      }
    } else {
      next = NaN
    }
    if (!isFinite(next)) {
      if (dy !== 0) next = root.cursorIndex + dy * 2
      else next = root.cursorIndex + dx
    }
    if (next < 0) next = 0
    if (next >= count) next = count - 1
    root.cursorIndex = next
  }

  function jumpCursor(n) {
    var count = root.cards.length
    if (count === 0) return
    var next = n - 1
    if (typeof Model.jumpCursor === "function") {
      try {
        var jumped = Model.jumpCursor(root.cursorIndex, count, n)
        if (jumped && typeof jumped === "object") {
          if (typeof jumped.cursor === "number") jumped = jumped.cursor
          else if (typeof jumped.index === "number") jumped = jumped.index
        }
        jumped = Number(jumped)
        if (isFinite(jumped)) next = jumped
      } catch (e) {}
    }
    if (next < 0) next = 0
    if (next >= count) next = count - 1
    root.cursorIndex = next
  }

  function uniqueDeskId(name) {
    var ids = []
    var desks = root.deskList()
    for (var i = 0; i < desks.length; i++) ids.push(desks[i].id)
    if (typeof Model.uniqueId === "function") {
      try {
        var id = Model.uniqueId(name, ids)
        if (id) return String(id)
      } catch (e) {}
    }
    var slug = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    if (!slug) slug = "desk"
    var candidate = slug
    var n = 2
    var used = ({})
    for (var j = 0; j < ids.length; j++) used[String(ids[j])] = true
    while (used[candidate]) {
      candidate = slug + "-" + n
      n += 1
    }
    return candidate
  }

  function snapshotRecipe(name) {
    if (typeof Model.snapshotRecipe === "function") {
      try {
        return Model.snapshotRecipe(
          root.stage,
          name || "",
          typeof Model.defaultExtras === "function" ? Model.defaultExtras() : ({ dnd: "leave", launchMissing: true }),
          root.stage && root.stage.lastWorkspace,
          new Date().toISOString()
        )
      } catch (e) { return null }
    }
    return root.stage || null
  }

  function assignState(next) {
    if (next && typeof next === "object") root.desksState = next
    root.rebuildCards()
    root.persistDesks()
  }

  function openSave() {
    root.mode = "save"
    root.nameText = ""
    if (nameInput) nameInput.text = ""
    root.refreshStage(function(ok) {
      Qt.callLater(function() {
        if (nameInput) nameInput.forceActiveFocus()
      })
      if (!ok) return
    })
  }

  function openRename() {
    var desk = root.highlightedDesk()
    if (!desk) return
    root.mode = "rename"
    root.targetDesk = desk
    root.nameText = String(desk.name || "")
    Qt.callLater(function() {
      if (nameInput) {
        nameInput.text = root.nameText
        nameInput.selectAll()
        nameInput.forceActiveFocus()
      }
    })
  }

  function openExtras() {
    var desk = root.highlightedDesk()
    if (!desk) return
    root.mode = "extras"
    root.extrasPickingTheme = false
    root.extrasDesk = desk
    root.extrasDraft = root.extrasOf(desk)
    root.loadThemes()
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function openForget() {
    var desk = root.highlightedDesk()
    if (!desk) return
    root.mode = "forget"
    root.forgetDesk = desk
    if (confirmDialog) confirmDialog.selectedIndex = 0
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function openClose() {
    if (root.busy) return
    var card = root.highlightedCard()
    if (!card || card.kind === "new") return
    if (card.kind === "unsaved") {
      root.closeDesk = { id: "unnamed", name: "Unsaved" }
    } else {
      var desk = root.highlightedDesk()
      if (!desk) return
      root.closeDesk = desk
    }
    if (card.kind !== "unsaved" && card.life === "dead") {
      root.closeDesk = null
      return
    }
    root.mode = "close"
    if (confirmDialog) confirmDialog.selectedIndex = 0
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function confirmClose() {
    var desk = root.closeDesk
    if (!desk) { root.cancelDialog(); return }
    if (root.busy) return
    root.busy = true
    root.refreshStage(function(ok) {
      if (!ok) {
        root.busy = false
        return
      }
      var plan = null
      if (typeof Model.closePlan === "function") {
        try {
          plan = Model.closePlan(desk, root.stage, root.desksState ? root.desksState.currentId : null)
        } catch (e) { plan = null }
      }
      var batch = root.batchString(plan)
      root.mode = "picker"
      root.closeDesk = null
      if (!batch) {
        root.busy = false
        Qt.callLater(function() { keyCatcher.forceActiveFocus() })
        return
      }
      root.pendingRestore = ""
      root.startBatch(batch, "close")
    })
  }

  function wakeHighlighted() {
    if (root.busy) return
    var card = root.highlightedCard()
    if (!card || card.kind === "new" || card.kind === "unsaved") return
    var desk = root.highlightedDesk()
    if (!desk) return
    root.busy = true
    root.refreshStage(function(ok) {
      if (!ok) {
        root.busy = false
        return
      }
      var launches = []
      if (typeof Model.wakePlan === "function") {
        try {
          launches = Model.wakePlan(desk, root.stage, root.desksState ? root.desksState.currentId : null)
          if (launches && Array.isArray(launches.launches)) launches = launches.launches
        } catch (e) { launches = [] }
      }
      if (!Array.isArray(launches)) launches = []
      for (var i = 0; i < launches.length; i++) root.launchOne(launches[i])
      root.busy = false
      Qt.callLater(function() {
        root.refreshStage(function() {
          Qt.callLater(function() { keyCatcher.forceActiveFocus() })
        })
      })
    })
  }

  function confirmSave() {
    var name = String(nameInput ? nameInput.text : root.nameText).replace(/^\s+|\s+$/g, "")
    if (!name) return
    root.refreshStage(function(ok) {
      if (!ok) return
      var recipe = root.snapshotRecipe(name)
      if (!recipe || typeof recipe !== "object") {
        recipe = { name: name, extras: { dnd: "leave", launchMissing: true }, lastUsed: Date.now() }
      } else {
        recipe.name = name
      }
      var next = null
      if (typeof Model.saveDesk === "function") {
        try { next = Model.saveDesk(root.desksState, recipe) } catch (e) { next = null }
      }
      if (!next) {
        var id = root.uniqueDeskId(name)
        var desk = recipe && recipe.workspaces ? recipe : {
          id: id,
          name: name,
          recipe: recipe,
          extras: { dnd: "leave", launchMissing: true },
          lastUsed: Date.now()
        }
        if (desk && typeof desk === "object") {
          desk.id = id
          desk.name = name
        }
        next = Util.cloneJson(root.desksState || root.emptyState())
        if (!next.desks) next.desks = []
        next.desks.push(desk)
        next.currentId = id
      }
      root.mode = "picker"
      root.nameText = ""
      root.assignState(next)
      Qt.callLater(function() { keyCatcher.forceActiveFocus() })
    })
  }

  function confirmRename() {
    var desk = root.targetDesk
    if (!desk) { root.cancelDialog(); return }
    var name = String(nameInput ? nameInput.text : root.nameText).replace(/^\s+|\s+$/g, "")
    if (!name) return
    var next = null
    if (typeof Model.renameDesk === "function") {
      try { next = Model.renameDesk(root.desksState, desk.id, name) } catch (e) { next = null }
    }
    if (!next) {
      next = Util.cloneJson(root.desksState || root.emptyState())
      var desks = next.desks || []
      for (var i = 0; i < desks.length; i++) {
        if (String(desks[i].id) === String(desk.id)) desks[i].name = name
      }
    }
    root.mode = "picker"
    root.targetDesk = null
    root.assignState(next)
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function confirmName() {
    if (root.mode === "save") root.confirmSave()
    else if (root.mode === "rename") root.confirmRename()
  }

  function confirmExtras() {
    var desk = root.extrasDesk
    if (!desk) { root.cancelDialog(); return }
    var next = null
    if (typeof Model.setExtras === "function") {
      try { next = Model.setExtras(root.desksState, desk.id, root.extrasDraft) } catch (e) { next = null }
    }
    if (!next) {
      next = Util.cloneJson(root.desksState || root.emptyState())
      var desks = next.desks || []
      for (var i = 0; i < desks.length; i++) {
        if (String(desks[i].id) === String(desk.id)) desks[i].extras = Util.cloneJson(root.extrasDraft)
      }
    }
    root.mode = "picker"
    root.extrasDesk = null
    root.assignState(next)
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function confirmForget() {
    var desk = root.forgetDesk
    if (!desk) { root.cancelDialog(); return }
    if (root.busy) return
    root.busy = true
    root.pendingForgetId = String(desk.id)
    root.refreshStage(function(ok) {
      if (!ok) {
        root.busy = false
        root.pendingForgetId = ""
        return
      }
      var restoreBatch = ""
      if (typeof Model.forgetRestorePlan === "function") {
        try { restoreBatch = root.batchString(Model.forgetRestorePlan(root.clientsJson, desk)) } catch (e) { restoreBatch = "" }
      } else if (typeof Model.restorePlan === "function") {
        try { restoreBatch = root.batchString(Model.restorePlan(root.clientsJson, desk.id)) } catch (e) { restoreBatch = "" }
      }
      if (restoreBatch) {
        root.pendingRestore = restoreBatch
        root.startBatch(restoreBatch, "forget-restore")
        return
      }
      root.finishForget()
    })
  }

  function finishForget() {
    var id = root.pendingForgetId
    var next = null
    if (typeof Model.forgetDesk === "function") {
      try { next = Model.forgetDesk(root.desksState, id) } catch (e) { next = null }
    }
    if (!next) {
      next = Util.cloneJson(root.desksState || root.emptyState())
      var kept = []
      var desks = next.desks || []
      for (var i = 0; i < desks.length; i++) {
        if (String(desks[i].id) !== String(id)) kept.push(desks[i])
      }
      next.desks = kept
      if (next.currentId !== undefined && String(next.currentId) === String(id))
        next.currentId = null
    }
    root.mode = "picker"
    root.forgetDesk = null
    root.pendingForgetId = ""
    root.busy = false
    root.batchPhase = ""
    root.pendingRestore = ""
    root.assignState(next)
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function updateHere() {
    var id = root.desksState ? root.desksState.currentId : null
    if (!id) return
    root.refreshStage(function(ok) {
      if (!ok) return
      var next = null
      if (typeof Model.updateDesk === "function") {
        try { next = Model.updateDesk(root.desksState, id, root.stage, new Date().toISOString()) } catch (e) { next = null }
      }
      if (!next) {
        next = Util.cloneJson(root.desksState || root.emptyState())
        var desks = next.desks || []
        for (var i = 0; i < desks.length; i++) {
          if (String(desks[i].id) === String(id)) {
            desks[i].lastUsed = Date.now()
          }
        }
      }
      root.assignState(next)
    })
  }

  function activateHighlighted() {
    if (root.pickerEmpty) {
      root.openSave()
      return
    }
    var card = root.highlightedCard()
    if (!card || card.kind === "new") {
      root.startFresh()
      return
    }
    if (card.kind === "unsaved") {
      root.switchToUnsaved()
      return
    }
    root.switchTo(root.deskById(card.id) || card.desk)
  }

  function startFresh() {
    if (root.busy) return
    root.busy = true
    root.targetDesk = null
    root.pendingDesk = null
    root.switchToId = ""
    root.leavingForFresh = true
    root.restoringUnsaved = false
    root.refreshStage(function(ok) {
      if (!ok) {
        root.busy = false
        root.leavingForFresh = false
        return
      }
      var windows = (root.stage && root.stage.windows) ? root.stage.windows : []
      if (root.currentSlug() === "unnamed" && (!windows || !windows.length)) {
        root.busy = false
        root.leavingForFresh = false
        root.dismiss()
        return
      }
      root.runFresh()
    })
  }

  function clickedWorkspaceN(value) {
    if (typeof Model.focusWorkspaceN === "function") {
      try {
        var n = Model.focusWorkspaceN(value)
        if (n) return n
      } catch (e) {}
    }
    var raw = Number(value)
    if (raw >= 1 && raw <= 10) return raw
    return null
  }

  function focusWorkspaceNow(n) {
    if (n == null || n === "") return
    var lua = root.focusDispatch(String(n))
    if (!lua) return
    Quickshell.execDetached(["hyprctl", "dispatch", lua])
  }

  function switchToUnsaved(workspaceN) {
    if (root.busy) return
    var clicked = root.clickedWorkspaceN(workspaceN)
    root.pendingFocusN = clicked
    root.busy = true
    root.targetDesk = null
    root.pendingDesk = null
    root.switchToId = ""
    root.leavingForFresh = false
    root.restoringUnsaved = true
    root.refreshStage(function(ok) {
      if (!ok) {
        root.busy = false
        root.restoringUnsaved = false
        root.pendingFocusN = null
        return
      }
      if (root.desksState && root.desksState.currentId) {
        root.runParkRestore(root.currentSlug(), "unnamed", null)
        return
      }
      var parked = []
      if (typeof Model.unnamedParkedWindows === "function") {
        try { parked = Model.unnamedParkedWindows(root.stage) || [] } catch (e) { parked = [] }
      }
      if (!Array.isArray(parked) || !parked.length) {
        var list = (root.stage && root.stage.parked) ? root.stage.parked : []
        parked = []
        for (var i = 0; i < list.length; i++) {
          if (list[i] && list[i].slug === "unnamed") parked.push(list[i])
        }
      }
      var onStage = (root.stage && root.stage.windows) ? root.stage.windows : []
      if (!parked.length || (onStage && onStage.length)) {
        if (clicked != null) root.focusWorkspaceNow(clicked)
        root.busy = false
        root.restoringUnsaved = false
        root.pendingFocusN = null
        root.dismiss()
        return
      }
      var restoreBatch = ""
      var lastWs = "1"
      if (typeof Model.restorePlan === "function") {
        try { restoreBatch = root.batchString(Model.restorePlan(root.stage, "unnamed", null)) } catch (e) { restoreBatch = "" }
      }
      if (typeof Model.parkPlan === "function") {
        try {
          var focusPlan = Model.parkPlan(root.stage, "unnamed", "unnamed", null)
          if (focusPlan && focusPlan.lastWorkspace != null) lastWs = String(focusPlan.lastWorkspace)
        } catch (e) {}
      }
      if (!restoreBatch) {
        root.busy = false
        root.restoringUnsaved = false
        root.pendingFocusN = null
        root.dismiss()
        return
      }
      root.pendingFocusWs = clicked != null ? String(clicked) : lastWs
      root.pendingFocusN = null
      root.pendingDnd = ""
      root.pendingTheme = ""
      root.pendingLaunches = []
      root.pendingDesk = null
      root.pendingPark = ""
      root.pendingRestore = restoreBatch
      root.startBatch(restoreBatch, "restore")
    })
  }

  function runFresh() {
    var plan = null
    if (typeof Model.freshPlan === "function") {
      try { plan = Model.freshPlan(root.stage, root.currentSlug()) } catch (e) { plan = null }
    }
    if (!plan) {
      root.busy = false
      root.leavingForFresh = false
      return
    }
    root.pendingFocusWs = "1"
    root.pendingDnd = ""
    root.pendingTheme = ""
    root.pendingLaunches = []
    root.pendingDesk = null
    root.pendingPark = root.batchString(plan.park || plan)
    root.pendingRestore = ""
    root.startBatch(root.pendingPark, "park")
  }

  function currentSlug() {
    if (typeof Model.currentSlug === "function") {
      try {
        var slug = Model.currentSlug(root.desksState)
        if (slug) return String(slug)
      } catch (e) {}
    }
    if (root.desksState && root.desksState.currentId) return String(root.desksState.currentId)
    return "unnamed"
  }

  function allowedDebugSlug(slug) {
    var s = String(slug || "")
    return s === "omadesk-dev" || s === "omadesk-dev-a" || s === "omadesk-dev-b" ||
      s === "dev" || s === "dev-a" || s === "dev-b"
  }

  function debugParkRestore(fromSlug, toSlug) {
    if (!root.allowedDebugSlug(fromSlug) || !root.allowedDebugSlug(toSlug)) return
    root.refreshStage(function(ok) {
      if (!ok) return
      root.runParkRestore(fromSlug, toSlug, null)
    })
  }

  function switchTo(desk, workspaceN) {
    if (!desk || desk.kind === "new" || root.busy) return
    var clicked = root.clickedWorkspaceN(workspaceN)
    root.pendingFocusN = clicked
    if (root.desksState && String(root.desksState.currentId) === String(desk.id)) {
      if (clicked != null) root.focusWorkspaceNow(clicked)
      root.pendingFocusN = null
      root.dismiss()
      return
    }
    root.busy = true
    root.targetDesk = desk
    root.switchToId = String(desk.id)
    root.refreshStage(function(ok) {
      if (!ok) {
        root.busy = false
        root.pendingFocusN = null
        return
      }
      root.runParkRestore(root.currentSlug(), String(desk.id), desk)
    })
  }

  function batchString(obj) {
    if (!obj) return ""
    if (typeof obj === "string") return obj
    if (obj.batch) return String(obj.batch)
    if (obj.park && obj.park.batch) return String(obj.park.batch)
    if (Array.isArray(obj.dispatches) && obj.dispatches.length) {
      var parts = []
      for (var i = 0; i < obj.dispatches.length; i++)
        parts.push("dispatch " + obj.dispatches[i])
      return parts.join("; ")
    }
    return ""
  }

  function lastWorkspaceOf(desk, plan) {
    if (plan && plan.lastWorkspace !== undefined && plan.lastWorkspace !== null)
      return plan.lastWorkspace
    if (desk && desk.recipe && desk.recipe.lastWorkspace !== undefined)
      return desk.recipe.lastWorkspace
    if (desk && desk.lastWorkspace !== undefined) return desk.lastWorkspace
    if (root.stage && root.stage.lastWorkspace !== undefined) return root.stage.lastWorkspace
    return 1
  }

  function runParkRestore(fromSlug, toSlug, desk) {
    // Two Chromiums on two workspaces work during the day because we move
    // specific parked addresses. After reboot that case is best-effort
    // (`--new-window` if we have it).
    if (typeof Model.parkPlan !== "function") {
      root.busy = false
      root.pendingFocusN = null
      return
    }
    var plan = null
    try { plan = Model.parkPlan(root.stage, fromSlug, toSlug, desk) } catch (e) {
      root.busy = false
      root.pendingFocusN = null
      return
    }
    if (!plan) {
      root.busy = false
      root.pendingFocusN = null
      return
    }

    var parkBatch = ""
    if (plan.park) parkBatch = root.batchString(plan.park)
    else parkBatch = root.batchString(plan)

    var restoreBatch = ""
    if (String(fromSlug) === String(toSlug) && typeof Model.restoreFromPark === "function") {
      try { restoreBatch = root.batchString(Model.restoreFromPark(plan.park || plan)) } catch (e) { restoreBatch = "" }
    } else if (plan.restore) {
      restoreBatch = root.batchString(plan.restore)
    } else if (typeof Model.restorePlan === "function") {
      try { restoreBatch = root.batchString(Model.restorePlan(root.stage, toSlug, desk)) } catch (e) { restoreBatch = "" }
    }

    if (root.pendingFocusN != null && root.pendingFocusN !== "")
      root.pendingFocusWs = String(root.pendingFocusN)
    else
      root.pendingFocusWs = String(root.lastWorkspaceOf(desk, plan))
    root.pendingFocusN = null
    root.pendingDnd = ""
    root.pendingTheme = ""
    root.pendingLaunches = []
    root.pendingDesk = desk || null
    if (desk) {
      var extras = root.extrasOf(desk)
      if (extras.dnd === "on" || extras.dnd === "off") root.pendingDnd = extras.dnd
      if (typeof Model.themeAction === "function") {
        try {
          var theme = Model.themeAction(extras)
          if (theme) root.pendingTheme = String(theme)
        } catch (e) { root.pendingTheme = extras.theme && extras.theme !== "leave" ? String(extras.theme) : "" }
      } else if (extras.theme && extras.theme !== "leave") {
        root.pendingTheme = String(extras.theme)
      }
    }

    root.pendingPark = parkBatch
    root.pendingRestore = restoreBatch
    root.startBatch(parkBatch, "park")
  }

  property string pendingPark: ""
  property string pendingRestore: ""

  function startBatch(batch, phase) {
    root.batchPhase = phase
    if (!batch) {
      Qt.callLater(function() { root.onBatchExited(0, phase) })
      return
    }
    if (batchProc.running) {
      root.busy = false
      root.leavingForFresh = false
      root.restoringUnsaved = false
      root.pendingFocusN = null
      return
    }
    batchProc.command = ["hyprctl", "--batch", batch]
    batchProc.running = true
  }

  function onBatchExited(code, phase) {
    if (code !== 0) {
      root.busy = false
      root.batchPhase = ""
      root.leavingForFresh = false
      root.restoringUnsaved = false
      root.pendingForgetId = ""
      root.pendingFocusN = null
      return
    }
    if (phase === "park") {
      Qt.callLater(function() { root.startBatch(root.pendingRestore, "restore") })
      return
    }
    if (phase === "restore") {
      Qt.callLater(function() { root.afterRestore() })
      return
    }
    if (phase === "forget-restore") {
      Qt.callLater(function() { root.finishForget() })
      return
    }
    if (phase === "close") {
      root.busy = false
      root.batchPhase = ""
      Qt.callLater(function() {
        root.refreshStage(function() {
          Qt.callLater(function() { keyCatcher.forceActiveFocus() })
        })
      })
      return
    }
  }

  function afterRestore() {
    var desk = root.pendingDesk
    var extras = desk ? root.extrasOf(desk) : null
    if (desk && extras && extras.launchMissing) {
      root.refreshStage(function(ok) {
        root.pendingLaunches = []
        if (ok && typeof Model.launchMissingPlan === "function") {
          try {
            var launches = Model.launchMissingPlan(desk, root.stage)
            if (launches && Array.isArray(launches.launches)) launches = launches.launches
            root.pendingLaunches = Array.isArray(launches) ? launches : []
          } catch (e) { root.pendingLaunches = [] }
        }
        root.runFocus()
      })
      return
    }
    root.pendingLaunches = []
    root.runFocus()
  }

  function focusDispatch(ws) {
    if (typeof Model.focusDispatch === "function") {
      try {
        var d = Model.focusDispatch(String(ws))
        if (d) return String(d)
      } catch (e) {}
    }
    return "hl.dsp.focus({ workspace = \"" + String(ws) + "\" })"
  }

  function runFocus() {
    var ws = root.pendingFocusWs || "1"
    var lua = root.focusDispatch(ws)
    if (!lua) {
      root.finishSwitch()
      return
    }
    if (focusProc.running) {
      root.finishSwitch()
      return
    }
    focusProc.command = ["hyprctl", "dispatch", lua]
    focusProc.running = true
  }

  function launchMissing() {
    var launches = Array.isArray(root.pendingLaunches) ? root.pendingLaunches : []
    for (var i = 0; i < launches.length; i++) root.launchOne(launches[i])
  }

  function launchOne(item) {
    if (!item) return
    var argv = item.argv || item.args || []
    if (typeof argv === "string") argv = [argv]
    if ((!argv || !argv.length) && item.exec) {
      if (Array.isArray(item.exec)) argv = item.exec
      else argv = [String(item.exec)]
    }
    if (!argv || !argv.length) return
    var cmd = "uwsm-app --"
    for (var i = 0; i < argv.length; i++)
      cmd += " " + Util.shellQuote(argv[i])
    var ws = item.workspace !== undefined && item.workspace !== null ? String(item.workspace) : ""
    var mon = item.monitor ? String(item.monitor) : ""
    var rules = []
    if (ws) rules.push("workspace = " + JSON.stringify(ws))
    if (mon) rules.push("monitor = " + JSON.stringify(mon))
    if (rules.length) {
      var lua = "hl.dsp.exec_cmd(" + JSON.stringify(cmd) + ", { " + rules.join(", ") + " })"
      Quickshell.execDetached(["hyprctl", "dispatch", lua])
    } else {
      // placement is best-effort
      Quickshell.execDetached(["uwsm-app", "--"].concat(argv))
    }
  }

  function applyDnd() {
    if (!root.pendingDnd) return
    dndProc.command = ["omarchy-shell", "notifications", "setDnd", root.pendingDnd]
    dndProc.running = true
  }

  function applyTheme() {
    if (!root.pendingTheme) return
    if (themeSetProc.running) return
    themeSetProc.command = ["omarchy", "theme", "set", root.pendingTheme]
    themeSetProc.running = true
  }

  function finishSwitch() {
    root.launchMissing()
    root.applyDnd()
    root.applyTheme()
    if (root.leavingForFresh || root.restoringUnsaved) {
      var fresh = null
      if (typeof Model.leaveDesk === "function") {
        try { fresh = Model.leaveDesk(root.desksState, Date.now()) } catch (e) { fresh = null }
      }
      if (!fresh) {
        fresh = Util.cloneJson(root.desksState || root.emptyState())
        fresh.currentId = null
      }
      root.desksState = fresh
      root.persistDesks()
    } else if (root.switchToId) {
      var next = null
      if (typeof Model.useDesk === "function") {
        try { next = Model.useDesk(root.desksState, root.switchToId, Date.now()) } catch (e) { next = null }
      }
      if (!next) {
        next = Util.cloneJson(root.desksState || root.emptyState())
        next.currentId = root.switchToId
        var desks = next.desks || []
        for (var i = 0; i < desks.length; i++) {
          if (String(desks[i].id) === String(root.switchToId))
            desks[i].lastUsed = Date.now()
        }
      }
      root.desksState = next
      root.persistDesks()
    }
    root.busy = false
    root.batchPhase = ""
    root.pendingPark = ""
    root.pendingRestore = ""
    root.pendingLaunches = []
    root.pendingDnd = ""
    root.pendingTheme = ""
    root.pendingDesk = null
    root.switchToId = ""
    root.pendingFocusN = null
    root.leavingForFresh = false
    root.restoringUnsaved = false
    root.dismiss()
  }

  function refreshStage(cb) {
    if (clientsProc.running || workspacesProc.running || monitorsProc.running) {
      root.stageCallback = cb
      root.stageQueued = true
      return
    }
    root.stageCallback = cb
    root.clientsJson = ""
    root.workspacesJson = ""
    root.monitorsJson = ""
    clientsProc.command = ["hyprctl", "-j", "clients"]
    clientsProc.running = true
  }

  function failStage() {
    var cb = root.stageCallback
    root.stageCallback = null
    root.stageQueued = false
    if (typeof cb === "function") cb(false)
  }

  function finishStage() {
    var stage = null
    if (typeof Model.parseStage === "function") {
      try { stage = Model.parseStage(root.clientsJson, root.workspacesJson, root.monitorsJson) } catch (e) { stage = null }
      if (!stage) {
        root.failStage()
        return
      }
    } else {
      try {
        var clients = JSON.parse(root.clientsJson || "[]")
        var workspaces = JSON.parse(root.workspacesJson || "[]")
        if (!Array.isArray(clients) || !Array.isArray(workspaces)) {
          root.failStage()
          return
        }
        stage = { clients: clients, workspaces: workspaces }
      } catch (e) {
        root.failStage()
        return
      }
    }
    root.stage = stage
    var pids = root.terminalPids(stage)
    if (!pids.length || termProbeProc.running) {
      root.completeStage(true)
      return
    }
    var cmd = ["python3", "-c", root.termProbePy]
    var t
    for (t = 0; t < pids.length; t++) cmd.push(pids[t])
    termProbeProc.command = cmd
    termProbeProc.running = true
  }

  function completeStage(ok) {
    if (ok) root.rebuildCards()
    var cb = root.stageCallback
    root.stageCallback = null
    if (root.stageQueued) {
      root.stageQueued = false
      root.refreshStage(cb)
      return
    }
    if (typeof cb === "function") cb(!!ok)
  }

  function handlePickerKey(event) {
    if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
      root.activateHighlighted()
      event.accepted = true
      return
    }
    if ((event.key === Qt.Key_Slash || event.text === "/") && !root.filterOpen) {
      root.openFilter()
      event.accepted = true
      return
    }
    if (root.filterOpen) {
      if (Util.editsFilter(event, root.filterText)) {
        root.setFilter(Util.editedFilter(event, root.filterText))
        event.accepted = true
        return
      }
      if (event.text && event.text.length === 1 && event.text.charCodeAt(0) >= 32 && event.text.charCodeAt(0) !== 127) {
        if (event.modifiers & (Qt.ControlModifier | Qt.AltModifier | Qt.MetaModifier)) return
        root.setFilter(root.filterText + event.text)
        event.accepted = true
        return
      }
      if (event.key === Qt.Key_Delete) {
        event.accepted = true
        return
      }
    }
    if (event.key === Qt.Key_Delete && !root.filterOpen) {
      root.openForget()
      event.accepted = true
    } else if (event.key === Qt.Key_Backspace && !root.filterOpen) {
      root.openForget()
      event.accepted = true
    } else if (event.key === Qt.Key_Down) {
      root.moveCursor(0, 1)
      event.accepted = true
    } else if (event.key === Qt.Key_Up) {
      root.moveCursor(0, -1)
      event.accepted = true
    } else if (event.key === Qt.Key_Left) {
      root.moveCursor(-1, 0)
      event.accepted = true
    } else if (event.key === Qt.Key_Right) {
      root.moveCursor(1, 0)
      event.accepted = true
    } else if (!root.filterOpen && event.key >= Qt.Key_1 && event.key <= Qt.Key_9 && !(event.modifiers & (Qt.ControlModifier | Qt.AltModifier | Qt.MetaModifier))) {
      root.jumpCursor(event.key - Qt.Key_0)
      event.accepted = true
    } else if (!root.filterOpen && event.text === "j") {
      root.moveCursor(0, 1)
      event.accepted = true
    } else if (!root.filterOpen && event.text === "k") {
      root.moveCursor(0, -1)
      event.accepted = true
    } else if (!root.filterOpen && event.text === "h") {
      root.moveCursor(-1, 0)
      event.accepted = true
    } else if (!root.filterOpen && event.text === "l") {
      root.moveCursor(1, 0)
      event.accepted = true
    } else if (!root.filterOpen && event.text === "n") {
      root.openSave()
      event.accepted = true
    } else if (!root.filterOpen && event.text === "s") {
      root.updateHere()
      event.accepted = true
    } else if (!root.filterOpen && event.text === "r") {
      root.openRename()
      event.accepted = true
    } else if (!root.filterOpen && event.text === "e") {
      root.openExtras()
      event.accepted = true
    } else if (!root.filterOpen && event.text === "x") {
      root.openClose()
      event.accepted = true
    } else if (!root.filterOpen && event.text === "o") {
      root.wakeHighlighted()
      event.accepted = true
    }
  }

  function handleConfirmKey(event) {
    if (confirmDialog && confirmDialog.handleKey(event)) {
      event.accepted = true
      return true
    }
    return false
  }

  function handleExtrasKey(event) {
    if (root.extrasPickingTheme) {
      if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
        event.accepted = true
        return
      }
      return
    }
    if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
      root.confirmExtras()
      event.accepted = true
    }
  }

  IpcHandler {
    target: "com.mdtrr.omadesk"
    function open(): void { root.open("{}") }
    function close(): void { root.dismiss() }
    function show(): void { root.open("{}") }
    function hide(): void { root.dismiss() }
    function toggle(): void { root.toggle() }
  }

  FileView {
    id: desksFile
    path: root.desksPath
    watchChanges: true
    atomicWrites: true
    printErrors: false
    onLoaded: {
      root.desksDirReady = true
      root.applyDesksRaw(text())
    }
    onLoadFailed: root.applyDesksRaw("")
    onFileChanged: reload()
  }

  Process {
    id: mkdirProc
    onExited: function(code) {
      if (code === 0) root.desksDirReady = true
      if (root.pendingWrite !== "") {
        var raw = root.pendingWrite
        root.pendingWrite = ""
        if (code === 0) desksFile.setText(raw)
      }
    }
  }

  Process {
    id: clientsProc
    stdout: StdioCollector {
      id: clientsOut
      waitForEnd: true
    }
    onExited: function(code) {
      if (code !== 0) {
        root.failStage()
        return
      }
      root.clientsJson = clientsOut.text || ""
      workspacesProc.command = ["hyprctl", "-j", "workspaces"]
      workspacesProc.running = true
    }
  }

  Process {
    id: workspacesProc
    stdout: StdioCollector {
      id: workspacesOut
      waitForEnd: true
    }
    onExited: function(code) {
      if (code !== 0) {
        root.failStage()
        return
      }
      root.workspacesJson = workspacesOut.text || ""
      monitorsProc.command = ["hyprctl", "-j", "monitors"]
      monitorsProc.running = true
    }
  }

  Process {
    id: monitorsProc
    stdout: StdioCollector {
      id: monitorsOut
      waitForEnd: true
    }
    onExited: function(code) {
      root.monitorsJson = code === 0 ? (monitorsOut.text || "[]") : "[]"
      root.finishStage()
    }
  }

  Process {
    id: batchProc
    onExited: function(code) {
      root.onBatchExited(code, root.batchPhase)
    }
  }

  Process {
    id: focusProc
    onExited: function(code) {
      var persist = true
      if (typeof Model.shouldPersistSwitch === "function") {
        try { persist = !!Model.shouldPersistSwitch(true, code === 0) } catch (e) { persist = true }
      }
      if (persist) root.finishSwitch()
      else root.busy = false
    }
  }

  Process {
    id: dndProc
  }

  Process {
    id: themeSetProc
  }

  Process {
    id: termProbeProc
    stdout: StdioCollector {
      id: termProbeOut
      waitForEnd: true
    }
    onExited: function(code) {
      if (code === 0 && typeof Model.parseTerminalProbe === "function" && typeof Model.applyTerminalHints === "function") {
        try {
          var hints = Model.parseTerminalProbe(termProbeOut.text || "")
          Model.applyTerminalHints(root.stage, hints)
        } catch (e) {}
      }
      root.completeStage(true)
    }
  }

  Process {
    id: themeListProc
    stdout: StdioCollector {
      id: themeListOut
      waitForEnd: true
    }
    onExited: function(code) {
      var names = []
      if (code === 0 && typeof Model.parseThemeList === "function") {
        try { names = Model.parseThemeList(themeListOut.text || "") } catch (e) { names = [] }
      }
      if (!Array.isArray(names) || !names.length) {
        var raw = String(themeListOut.text || "").split(/\n/)
        names = []
        for (var i = 0; i < raw.length; i++) {
          var line = String(raw[i] || "").replace(/^\s+|\s+$/g, "")
          if (line) names.push(line)
        }
      }
      root.themeNames = names
    }
  }

  component StatusPill: BorderSurface {
    id: pill
    property string label: ""
    property color tone: root.dim

    color: "transparent"
    borderSpec: Border.controlSpec("normal", pill.tone, root.accent)
    radius: Style.cornerRadius
    implicitWidth: pillLabel.implicitWidth + Style.space(10)
    implicitHeight: pillLabel.implicitHeight + Style.space(4)

    Text {
      id: pillLabel
      anchors.centerIn: parent
      text: pill.label
      color: pill.tone
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
      font.bold: true
      font.letterSpacing: 1
    }
  }

  component WorkspaceTile: BorderSurface {
    id: tile
    property var tileData: ({})
    property bool compact: false
    property bool clickable: false
    signal activated()

    readonly property bool vacant: !!(tile.tileData && tile.tileData.vacant)
    readonly property string tileId: {
      var d = tile.tileData || ({})
      var n = Number(d.n)
      if (n >= 1 && n <= 10) return String(n)
      return ""
    }
    readonly property string tileLabel: tile.tileData ? String(tile.tileData.label || (tile.vacant ? "Empty" : "")) : ""
    readonly property var panes: tile.tileData && tile.tileData.panes ? tile.tileData.panes : []
    readonly property var under: tile.tileData && tile.tileData.under ? tile.tileData.under : []
    readonly property bool hasUnder: !tile.vacant && tile.under && tile.under.length > 0
    readonly property int underStrip: tile.hasUnder ? 36 : 0
    readonly property int paneGap: 2
    readonly property int numberInset: 8
    readonly property int iconPad: 4

    color: tile.vacant ? "transparent" : root.tileFill
    borderSpec: Border.controlSpec("normal", root.foreground, root.accent)
    radius: Style.cornerRadius
    readonly property real aspect: {
      var a = Number(tile.tileData && tile.tileData.aspect)
      if (isFinite(a) && a >= 0.3 && a <= 5) return a
      return 16 / 9
    }
    implicitHeight: Math.round(width / tile.aspect) + (tile.hasUnder ? tile.underStrip : 0)
    implicitWidth: Style.space(96)
    clip: true

    Item {
      id: map
      anchors.fill: parent
      anchors.margins: 2
      anchors.bottomMargin: tile.hasUnder ? tile.underStrip + 2 : 2
      visible: !tile.vacant && tile.panes && tile.panes.length

      Repeater {
        model: map.visible ? tile.panes : []

        delegate: Rectangle {
          required property var modelData
          readonly property real px: Number(modelData && modelData.x)
          readonly property real py: Number(modelData && modelData.y)
          readonly property real pw: Number(modelData && modelData.w)
          readonly property real ph: Number(modelData && modelData.h)

          x: map.width * (isFinite(px) ? px : 0) + tile.paneGap / 2
          y: map.height * (isFinite(py) ? py : 0) + tile.paneGap / 2
          width: Math.max(Style.space(8), map.width * (isFinite(pw) ? pw : 0) - tile.paneGap)
          height: Math.max(Style.space(8), map.height * (isFinite(ph) ? ph : 0) - tile.paneGap)
          color: Util.alpha(root.foreground, modelData && modelData.floating ? 0.10 : 0.05)
          border.width: Style.normalBorderWidth
          border.color: Style.normalBorderFor(root.foreground, root.accent)
          radius: Style.cornerRadius

          Image {
            id: paneIcon
            anchors.centerIn: parent
            width: Math.max(0, Math.min(Style.space(22), Math.min(parent.width, parent.height) - tile.iconPad * 2))
            height: width
            fillMode: Image.PreserveAspectFit
            asynchronous: true
            sourceSize.width: width * Screen.devicePixelRatio
            sourceSize.height: height * Screen.devicePixelRatio
            source: root.iconSource(modelData)
            visible: status === Image.Ready
          }

          Text {
            visible: paneIcon.status !== Image.Ready
            anchors.centerIn: parent
            text: root.iconLetters(modelData)
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Math.max(Style.font.caption, Math.min(parent.width, parent.height) * 0.32)
            font.weight: Font.DemiBold
          }
        }
      }
    }

    Item {
      visible: tile.hasUnder
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.bottom: parent.bottom
      height: tile.underStrip

      Rectangle {
        id: underRule
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        height: 1
        color: root.borderSoft
      }

      Item {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: underRule.bottom
        anchors.bottom: parent.bottom

        Row {
          anchors.left: parent.left
          anchors.verticalCenter: parent.verticalCenter
          anchors.leftMargin: 8
          spacing: 8

          Repeater {
            model: tile.hasUnder ? tile.under : []

            delegate: Item {
              required property var modelData
              width: 16
              height: 16

            Image {
              id: underIcon
              anchors.fill: parent
              fillMode: Image.PreserveAspectFit
              asynchronous: true
              sourceSize.width: width * Screen.devicePixelRatio
              sourceSize.height: height * Screen.devicePixelRatio
              source: root.iconSource(modelData)
              visible: status === Image.Ready
              opacity: 0.9
            }

            Text {
              visible: underIcon.status !== Image.Ready
              anchors.centerIn: parent
              text: root.iconLetters(modelData)
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.weight: Font.DemiBold
            }
            }
          }
        }
      }
    }

    Rectangle {
      visible: tile.vacant
      anchors.centerIn: parent
      color: root.tileFill
      border.width: 0
      radius: 0
      implicitWidth: emptyLabel.implicitWidth + 16
      implicitHeight: emptyLabel.implicitHeight + 8

      Text {
        id: emptyLabel
        anchors.centerIn: parent
        text: "Empty"
        color: root.dim
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
      }
    }

    Text {
      visible: !tile.vacant && !(tile.panes && tile.panes.length)
      anchors.fill: parent
      anchors.margins: Style.space(6)
      text: tile.tileLabel
      color: Util.alpha(root.foreground, 0.78)
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
      wrapMode: Text.Wrap
      maximumLineCount: 2
      elide: Text.ElideRight
      verticalAlignment: Text.AlignVCenter
      horizontalAlignment: Text.AlignHCenter
    }

    Text {
      visible: tile.tileId !== ""
      x: tile.numberInset
      y: tile.numberInset
      z: 2
      text: tile.tileId
      color: root.foreground
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
      font.weight: Font.Medium
    }

    MouseArea {
      anchors.fill: parent
      enabled: tile.clickable
      hoverEnabled: tile.clickable
      cursorShape: tile.clickable ? Qt.PointingHandCursor : Qt.ArrowCursor
      z: 3
      preventStealing: true
      onClicked: tile.activated()
    }
  }

  PanelWindow {
    id: panel
    visible: root.opened
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "com-mdtrr-omadesk"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
    exclusionMode: ExclusionMode.Ignore

    Rectangle {
      anchors.fill: parent
      color: root.scrim
    }

    MouseArea {
      anchors.fill: parent
      onClicked: root.dismiss()
    }

    BorderSurface {
      id: card
      width: root.cardWidth
      implicitHeight: Math.min(
        contentColumn.implicitHeight + card.contentTopInset + card.contentBottomInset,
        Math.max(Style.space(200), panel.height - Math.max(Style.space(80), panel.height * 0.12) - Style.gapsOut * 2)
      )
      radius: root.cornerRadius
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.top: parent.top
      anchors.topMargin: Math.max(Style.space(80), panel.height * 0.12)
      color: root.background
      borderSpec: root.borderSpec
      padding: root.contentMargin

      MouseArea { anchors.fill: parent; onClicked: {} }

      Item {
        id: keyCatcher
        anchors.fill: parent
        focus: true
        Keys.priority: Keys.BeforeItem
        Keys.onPressed: function(event) {
          if (event.key === Qt.Key_Escape) {
            root.applyEscape()
            event.accepted = true
            return
          }
          if (nameInput && nameInput.activeFocus) {
            if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
              root.confirmName()
              event.accepted = true
            }
            return
          }
          if (root.mode === "forget" || root.mode === "close") {
            root.handleConfirmKey(event)
            return
          }
          if (root.mode === "extras") {
            root.handleExtrasKey(event)
            return
          }
          if (root.mode === "save" || root.mode === "rename") {
            if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
              root.confirmName()
              event.accepted = true
            }
            return
          }
          root.handlePickerKey(event)
        }
      }

      Column {
        id: contentColumn
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.topMargin: card.contentTopInset
        anchors.leftMargin: card.contentLeftInset
        anchors.rightMargin: card.contentRightInset
        spacing: Style.space(12)

        PanelHero {
          width: parent.width
          title: root.headerTitleText
          meta: root.headerMetaText
          foreground: root.foreground
          fontFamily: root.fontFamily

          iconComponent: Component {
            Text {
              text: "󰍺"
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.display
            }
          }
        }

        Column {
          width: parent.width
          visible: root.pickerEmpty && root.showingPicker
          spacing: Style.space(18)
          topPadding: Style.space(20)
          bottomPadding: Style.space(8)

          Column {
            width: parent.width
            spacing: 0

            Repeater {
              model: root.mascotLines

              Text {
                required property string modelData
                width: parent.width
                text: modelData
                color: root.foreground
                font.family: Style.font.family
                font.pixelSize: Style.font.title
                font.weight: Font.Normal
                font.preferShaping: false
                wrapMode: Text.NoWrap
                textFormat: Text.PlainText
              }
            }
          }

          Text {
            width: parent.width
            text: "Arrange the windows you want in this room, then save it."
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.title
            wrapMode: Text.WordWrap
          }

          Text {
            width: parent.width
            text: "A desk is the current 1–10 workspaces, given a name. Switching parks this room and brings the other one back."
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
            wrapMode: Text.WordWrap
          }

          Button {
            text: "Save Current Desk"
            bordered: true
            selected: true
            foreground: root.foreground
            fontFamily: root.fontFamily
            onClicked: root.openSave()
          }
        }

        Grid {
          id: deskGrid
          width: parent.width
          visible: root.showingPicker && !root.pickerEmpty
          columns: 2
          columnSpacing: root.gridGap
          rowSpacing: root.gridGap

          Repeater {
            model: deskGrid.visible ? root.gridCards : []

            delegate: BorderSurface {
              required property var modelData

              readonly property var card: (modelData && modelData.card) || ({})
              readonly property int cardIndex: modelData && modelData.index != null ? modelData.index : 0
              readonly property bool isUnsaved: card.kind === "unsaved"
              readonly property bool hasCursor: cardIndex === root.cursorIndex
              readonly property bool isHere: !!card.here

              width: root.cellWidth
              implicitHeight: deskBody.implicitHeight + Style.space(24)
              color: root.cardFill(hasCursor, isHere)
              borderSpec: root.cardBorderSpec(hasCursor, isHere)
              radius: Style.cornerRadius

              Column {
                id: deskBody
                width: parent.width - Style.space(24)
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.margins: Style.space(12)
                spacing: Style.space(10)

                Item {
                  width: parent.width
                  height: Math.max(nameLabel.implicitHeight, pillRow.implicitHeight)

                  Text {
                    id: nameLabel
                    anchors.left: parent.left
                    anchors.right: pillRow.left
                    anchors.rightMargin: Style.space(8)
                    anchors.verticalCenter: parent.verticalCenter
                    text: String(card.name || "")
                    color: root.foreground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.title
                    font.bold: true
                    elide: Text.ElideRight
                  }

                  Row {
                    id: pillRow
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: Style.space(4)

                    StatusPill {
                      visible: !isUnsaved && card.life === "live"
                      label: "LIVE"
                      tone: root.accent
                    }
                    StatusPill {
                      visible: !!card.dnd
                      label: "DND"
                      tone: root.urgent
                    }
                    StatusPill {
                      visible: isUnsaved
                      label: "DRAFT"
                      tone: root.dim
                    }
                  }
                }

                Grid {
                  width: parent.width
                  columns: root.tileColumns
                  columnSpacing: Style.space(6)
                  rowSpacing: Style.space(6)

                  Repeater {
                    model: card.tiles || []
                    delegate: WorkspaceTile {
                      width: Math.floor((parent.width - Style.space(6) * (root.tileColumns - 1)) / root.tileColumns)
                      height: implicitHeight
                      tileData: modelData
                      clickable: true
                      onActivated: {
                        root.cursorIndex = cardIndex
                        var n = modelData && modelData.n
                        if (isUnsaved) {
                          root.switchToUnsaved(n)
                          return
                        }
                        var desk = root.deskById(card.id) || card.desk
                        root.switchTo(desk, n)
                      }
                    }
                  }
                }

                Text {
                  width: parent.width
                  text: String(card.meta || "")
                  color: root.dim
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.bodySmall
                  elide: Text.ElideRight
                }
              }

              MouseArea {
                anchors.fill: parent
                z: -1
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onContainsMouseChanged: if (containsMouse) root.cursorIndex = cardIndex
                onClicked: {
                  root.cursorIndex = cardIndex
                  root.activateHighlighted()
                }
              }
            }
          }
        }

        CursorSurface {
          visible: deskGrid.visible && root.newDeskIndex >= 0
          width: parent.width
          implicitHeight: newDeskBody.implicitHeight + Style.spacing.rowPaddingX
          hasCursor: root.cursorIndex === root.newDeskIndex
          foreground: root.foreground

          Column {
            id: newDeskBody
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            anchors.leftMargin: Style.space(10)
            anchors.rightMargin: Style.space(10)
            spacing: Style.space(1)

            Text {
              text: String((root.cardAt(root.newDeskIndex) && root.cardAt(root.newDeskIndex).name) || "+ New Desk")
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.body
            }

            Text {
              text: String((root.cardAt(root.newDeskIndex) && root.cardAt(root.newDeskIndex).meta) || "Enter Starts Empty")
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }
          }

          MouseArea {
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onContainsMouseChanged: if (containsMouse && root.newDeskIndex >= 0)
              root.cursorIndex = root.newDeskIndex
            onClicked: {
              if (root.newDeskIndex >= 0) root.cursorIndex = root.newDeskIndex
              root.activateHighlighted()
            }
          }
        }

        Column {
          width: parent.width
          visible: root.mode === "save" || root.mode === "rename"
          spacing: Style.space(12)

          Column {
            width: parent.width
            spacing: Style.space(10)

            PanelSectionHeader {
              text: "NAME"
              foreground: root.foreground
              fontFamily: root.fontFamily
            }

            TextField {
              id: nameInput
              width: parent.width
              placeholderText: "Name"
              foreground: root.foreground
              accent: root.accent
              font.family: root.fontFamily
              Keys.onPressed: function(event) {
                if (event.key === Qt.Key_Escape) {
                  root.cancelDialog()
                  event.accepted = true
                } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
                  root.confirmName()
                  event.accepted = true
                }
              }
            }
          }

          PanelSeparator {
            visible: root.mode === "save"
            foreground: root.foreground
          }

          Column {
            width: parent.width
            visible: root.mode === "save"
            spacing: Style.space(10)

            PanelSectionHeader {
              text: "MINIMAP"
              foreground: root.foreground
              fontFamily: root.fontFamily
            }

            Grid {
              width: parent.width
              columns: root.tileColumns
              columnSpacing: Style.space(6)
              rowSpacing: Style.space(6)

              Repeater {
                model: root.mode === "save" ? root.tilesFrom(root.stage, 10) : []
                delegate: WorkspaceTile {
                  width: Math.floor((parent.width - Style.space(6) * (root.tileColumns - 1)) / root.tileColumns)
                  height: implicitHeight
                  tileData: modelData
                }
              }
            }
          }

          Text {
            width: parent.width
            text: "Scratchpad stays global and is not stored."
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            wrapMode: Text.WordWrap
          }

          Row {
            spacing: Style.space(8)

            Button {
              text: root.mode === "rename" ? "Rename Desk" : "Save"
              bordered: true
              selected: true
              foreground: root.foreground
              fontFamily: root.fontFamily
              onClicked: root.confirmName()
            }

            Button {
              text: "Cancel"
              bordered: true
              foreground: root.foreground
              fontFamily: root.fontFamily
              onClicked: root.cancelDialog()
            }
          }
        }

        Column {
          width: parent.width
          visible: root.mode === "extras" && !root.extrasPickingTheme
          spacing: Style.space(12)

          Column {
            width: parent.width
            spacing: Style.space(10)

            PanelSectionHeader {
              text: "DO NOT DISTURB"
              foreground: root.foreground
              fontFamily: root.fontFamily
            }

            ButtonGroup {
              options: [
                { value: "leave", label: "Leave" },
                { value: "on", label: "On" },
                { value: "off", label: "Off" }
              ]
              value: root.extrasDraft && root.extrasDraft.dnd ? root.extrasDraft.dnd : "leave"
              foreground: root.foreground
              fontFamily: root.fontFamily
              onChanged: function(v) { root.patchExtras({ dnd: v }) }
            }
          }

          PanelSeparator { foreground: root.foreground }

          Column {
            width: parent.width
            spacing: Style.space(10)

            PanelSectionHeader {
              text: "THEME"
              foreground: root.foreground
              fontFamily: root.fontFamily
            }

            ButtonGroup {
              options: [
                { value: "leave", label: "Leave" },
                { value: "set", label: root.themeChipText }
              ]
              value: (!root.extrasDraft || !root.extrasDraft.theme || root.extrasDraft.theme === "leave") ? "leave" : "set"
              foreground: root.foreground
              fontFamily: root.fontFamily
              onChanged: function(v) {
                if (v === "leave") root.patchExtras({ theme: "leave" })
                else root.beginThemePick()
              }
            }
          }

          PanelSeparator { foreground: root.foreground }

          Toggle {
            width: parent.width
            label: "Launch Missing Windows"
            description: "Open recipe windows that are not already running."
            foreground: root.foreground
            accent: root.accent
            fontFamily: root.fontFamily
            checked: !!(root.extrasDraft && root.extrasDraft.launchMissing)
            onClicked: root.patchExtras({ launchMissing: !(root.extrasDraft && root.extrasDraft.launchMissing) })
          }

          Text {
            width: parent.width
            text: "Leave means a switch does not touch that setting. Theme changes flash the whole desktop, so they stay off unless you ask."
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            wrapMode: Text.WordWrap
          }

          Button {
            text: "Done"
            bordered: true
            selected: true
            foreground: root.foreground
            fontFamily: root.fontFamily
            onClicked: root.confirmExtras()
          }
        }

        Column {
          width: parent.width
          visible: root.mode === "extras" && root.extrasPickingTheme
          spacing: Style.space(10)

          Text {
            width: parent.width
            text: "A switch will run omarchy theme set. Leave keeps whatever is on the desktop."
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            wrapMode: Text.WordWrap
          }

          Flickable {
            width: parent.width
            height: Math.min(themeFlow.implicitHeight, Style.space(280))
            contentWidth: width
            contentHeight: themeFlow.implicitHeight
            clip: true
            boundsBehavior: Flickable.StopAtBounds

            Flow {
              id: themeFlow
              width: parent.width
              spacing: Style.space(6)

              Button {
                text: "Leave"
                bordered: true
                selected: !root.extrasDraft.theme || root.extrasDraft.theme === "leave"
                foreground: root.foreground
                fontFamily: root.fontFamily
                onClicked: root.pickTheme("leave")
              }

              Repeater {
                model: root.themeNames
                delegate: Button {
                  required property string modelData
                  text: modelData
                  bordered: true
                  selected: root.extrasDraft.theme === modelData
                  foreground: root.foreground
                  fontFamily: root.fontFamily
                  onClicked: root.pickTheme(modelData)
                }
              }
            }
          }

          Button {
            text: "Back"
            bordered: true
            foreground: root.foreground
            fontFamily: root.fontFamily
            onClicked: root.extrasPickingTheme = false
          }
        }
      }

      ConfirmDialog {
        id: confirmDialog
        anchors.fill: parent
        opened: root.mode === "forget" || root.mode === "close"
        z: 10
        message: root.mode === "forget" ? root.forgetMessageText : root.closeMessageText
        cancelText: "Cancel"
        confirmText: root.mode === "forget" ? "Forget" : "Close"
        background: root.background
        foreground: root.foreground
        scrim: root.scrim
        selectedBackground: root.selectedBackground
        selectedText: root.accent
        fontFamily: root.fontFamily
        cornerRadius: root.cornerRadius
        onCanceled: root.cancelDialog()
        onConfirmed: {
          if (root.mode === "forget") root.confirmForget()
          else root.confirmClose()
        }
      }
    }
  }
}
