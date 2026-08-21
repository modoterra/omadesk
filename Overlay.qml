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
  property int cursorIndex: 0
  property var desksState: ({ version: 1, currentId: null, desks: [] })
  property var cards: []
  property var stage: ({})
  property string nameText: ""
  property var targetDesk: null
  property var extrasDesk: null
  property var extrasDraft: ({ dnd: "leave", theme: "leave", launchMissing: true })
  property var forgetDesk: null
  property int forgetIndex: 0
  property var closeDesk: null
  property int closeIndex: 0
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
  property bool leavingForFresh: false
  property bool restoringUnsaved: false
  property var pendingDesk: null
  property string pendingTheme: ""
  property bool extrasPickingTheme: false
  property var themeNames: []
  property string pendingForgetId: ""

  property color background: Color.menu.background
  property color foreground: Color.menu.text
  property color border: Color.menu.border
  property var borderSpec: Border.surfaceSpec("menu", "border", border, Math.max(1, Style.space(2)))
  property color scrim: Color.menu.scrim
  property color selectedBackground: Color.menu.selectedBackground
  property color fill: Util.alpha(Color.menu.text, 0.04)
  property color fillHover: Color.menu.selectedBackground
  property color fillSelected: Util.alpha(Color.menu.text, 0.18)
  property color borderSoft: Util.alpha(Color.menu.text, 0.18)
  property color tileFill: Util.alpha(Color.menu.text, 0.06)
  property color muted: Color.muted
  property color accent: Color.accent
  property color urgent: Color.urgent
  readonly property int cornerRadius: Style.cornerRadius
  property string fontFamily: Style.font.menuFamily
  property int contentMargin: Style.space(16)
  property int headerHeight: Math.max(Style.space(34), Style.font.heading + Style.spacing.controlPaddingY)
  property int cardWidth: Math.min(Style.space(680), panel.width - Style.gapsOut * 2)
  property int gridGap: Style.space(8)
  property int cellWidth: Math.max(1, Math.floor((cardWidth - card.contentLeftInset - card.contentRightInset - gridGap) / 2))
  property int tileColumns: 3
  property int tileHeight: Style.space(92)
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
    else if (root.filterText) root.setFilter("")
    else root.dismiss()
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

  function themeChipLabel() {
    var theme = root.extrasDraft && root.extrasDraft.theme ? String(root.extrasDraft.theme) : "leave"
    if (!theme || theme === "leave") return "set…"
    return theme
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
        if (Array.isArray(preview) && preview.length) return preview
      } catch (e) {}
    }
    if (Array.isArray(source.tiles) && source.tiles.length)
      return source.tiles.slice(0, limit || source.tiles.length)

    var spaces = source.workspaces
    if ((!spaces || !spaces.length) && source.recipe)
      spaces = source.recipe.workspaces
    if (!Array.isArray(spaces)) spaces = []

    var max = limit || Math.min(10, Math.max(spaces.length, 5))
    var out = []
    for (var i = 0; i < max; i++) {
      var ws = spaces[i] || null
      var id = ws && (ws.id !== undefined ? ws.id : ws.workspace)
      if (id === undefined) id = i + 1
      var clients = (ws && (ws.clients || ws.windows)) || []
      var parts = []
      for (var c = 0; c < clients.length; c++) {
        var piece = root.tileLabel(clients[c])
        if (piece) parts.push(piece)
      }
      var vacant = parts.length === 0
      out.push({ id: id, label: vacant ? "empty" : parts.join(" · "), vacant: vacant })
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
    var when = "now"
    if (here) when = "now"
    else if (desk && desk.lastUsedLabel) when = String(desk.lastUsedLabel)
    else {
      var then = NaN
      if (desk && desk.lastUsed != null && desk.lastUsed !== "") then = Number(desk.lastUsed)
      if (!isFinite(then) && desk && desk.updatedAt) then = Date.parse(desk.updatedAt)
      var delta = Date.now() - then
      if (!isFinite(then) || !isFinite(delta) || delta < 60000) when = "now"
      else if (delta < 3600000) when = Math.round(delta / 60000) + " min ago"
      else if (delta < 86400000) when = Math.round(delta / 3600000) + " hours ago"
      else if (delta < 172800000) when = "yesterday"
      else when = Math.round(delta / 86400000) + " days ago"
    }
    return used + " space" + (used === 1 ? "" : "s") + " · last used " + when
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
    return { kind: "new", name: "+ new desk", meta: "enter starts empty", tiles: [] }
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
    root.forgetIndex = 0
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
    root.closeIndex = 0
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

  function switchToUnsaved() {
    if (root.busy) return
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
        root.busy = false
        root.restoringUnsaved = false
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
        root.dismiss()
        return
      }
      root.pendingFocusWs = lastWs
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

  function switchTo(desk) {
    if (!desk || desk.kind === "new" || root.busy) return
    if (root.desksState && String(root.desksState.currentId) === String(desk.id)) {
      root.dismiss()
      return
    }
    root.busy = true
    root.targetDesk = desk
    root.switchToId = String(desk.id)
    root.refreshStage(function(ok) {
      if (!ok) {
        root.busy = false
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
      return
    }
    var plan = null
    try { plan = Model.parkPlan(root.stage, fromSlug, toSlug, desk) } catch (e) {
      root.busy = false
      return
    }
    if (!plan) {
      root.busy = false
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

    root.pendingFocusWs = String(root.lastWorkspaceOf(desk, plan))
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
    } else if (event.key === Qt.Key_Delete) {
      root.openForget()
      event.accepted = true
    } else if (event.key === Qt.Key_Backspace && !root.filterText) {
      root.openForget()
      event.accepted = true
    } else if (Util.editsFilter(event, root.filterText)) {
      root.setFilter(Util.editedFilter(event, root.filterText))
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
    } else if (event.key >= Qt.Key_1 && event.key <= Qt.Key_9 && !(event.modifiers & (Qt.ControlModifier | Qt.AltModifier | Qt.MetaModifier))) {
      root.jumpCursor(event.key - Qt.Key_0)
      event.accepted = true
    } else if (event.text === "j") {
      root.moveCursor(0, 1)
      event.accepted = true
    } else if (event.text === "k") {
      root.moveCursor(0, -1)
      event.accepted = true
    } else if (event.text === "h") {
      root.moveCursor(-1, 0)
      event.accepted = true
    } else if (event.text === "l") {
      root.moveCursor(1, 0)
      event.accepted = true
    } else if (!root.filterText && event.text === "n") {
      root.openSave()
      event.accepted = true
    } else if (!root.filterText && event.text === "s") {
      root.updateHere()
      event.accepted = true
    } else if (!root.filterText && event.text === "r") {
      root.openRename()
      event.accepted = true
    } else if (!root.filterText && event.text === "e") {
      root.openExtras()
      event.accepted = true
    } else if (!root.filterText && event.text === "x") {
      root.openClose()
      event.accepted = true
    } else if (!root.filterText && event.text === "o") {
      root.wakeHighlighted()
      event.accepted = true
    } else if (event.text && event.text.length === 1 && event.text.charCodeAt(0) >= 32 && event.text.charCodeAt(0) !== 127) {
      if (root.pickerEmpty) return
      if (event.modifiers & (Qt.ControlModifier | Qt.AltModifier | Qt.MetaModifier)) return
      root.setFilter(root.filterText + event.text)
      event.accepted = true
    }
  }

  function handleForgetKey(event) {
    if (event.key === Qt.Key_Left || event.key === Qt.Key_Right || event.key === Qt.Key_Tab || event.key === Qt.Key_Backtab || event.text === "h" || event.text === "l") {
      root.forgetIndex = root.forgetIndex === 0 ? 1 : 0
      event.accepted = true
    } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
      if (root.forgetIndex === 1) root.confirmForget()
      else root.cancelDialog()
      event.accepted = true
    }
  }

  function handleCloseKey(event) {
    if (event.key === Qt.Key_Left || event.key === Qt.Key_Right || event.key === Qt.Key_Tab || event.key === Qt.Key_Backtab || event.text === "h" || event.text === "l") {
      root.closeIndex = root.closeIndex === 0 ? 1 : 0
      event.accepted = true
    } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
      if (root.closeIndex === 1) root.confirmClose()
      else root.cancelDialog()
      event.accepted = true
    }
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

  component ChromeButton: Rectangle {
    id: btn
    property string label: ""
    property bool primary: false
    property bool danger: false
    property bool hot: false
    signal clicked()

    color: primary || hot ? root.fillSelected : root.fill
    border.width: 1
    border.color: danger ? Util.alpha(root.urgent, 0.45)
      : (primary || hot ? Util.alpha(root.foreground, 0.55) : root.border)
    implicitWidth: labelText.implicitWidth + Style.space(24)
    implicitHeight: labelText.implicitHeight + Style.space(14)

    Text {
      id: labelText
      anchors.centerIn: parent
      text: btn.label
      color: btn.danger ? root.urgent : root.foreground
      font.family: root.fontFamily
      font.pixelSize: Style.font.subtitle
    }

    MouseArea {
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onClicked: btn.clicked()
    }
  }

  component ChoiceChip: Rectangle {
    id: chip
    property string label: ""
    property bool on: false
    property bool enabledChip: true
    signal clicked()

    color: chip.on ? root.fillSelected : "transparent"
    border.width: 1
    border.color: chip.on ? Util.alpha(root.foreground, 0.45) : root.borderSoft
    opacity: chip.enabledChip ? 1 : 0.45
    implicitWidth: chipLabel.implicitWidth + Style.space(16)
    implicitHeight: chipLabel.implicitHeight + Style.space(6)

    Text {
      id: chipLabel
      anchors.centerIn: parent
      text: chip.label
      color: chip.on ? root.foreground : root.muted
      font.family: root.fontFamily
      font.pixelSize: Style.font.body
    }

    MouseArea {
      anchors.fill: parent
      enabled: chip.enabledChip
      hoverEnabled: true
      cursorShape: chip.enabledChip ? Qt.PointingHandCursor : Qt.ArrowCursor
      onClicked: chip.clicked()
    }
  }

  component WorkspaceTile: Rectangle {
    id: tile
    property var tileData: ({})
    property bool compact: false

    readonly property bool vacant: !!(tile.tileData && tile.tileData.vacant)
    readonly property string tileId: tile.tileData && tile.tileData.id !== undefined ? String(tile.tileData.id) : ""
    readonly property string tileLabel: tile.tileData ? String(tile.tileData.label || (tile.vacant ? "empty" : "")) : ""
    readonly property var panes: tile.tileData && tile.tileData.panes ? tile.tileData.panes : []
    readonly property var under: tile.tileData && tile.tileData.under ? tile.tileData.under : []
    readonly property bool hasUnder: !tile.vacant && tile.under && tile.under.length > 0
    readonly property int underStrip: tile.hasUnder ? 36 : 0
    readonly property int paneGap: 2
    readonly property int numberInset: 8
    readonly property int iconPad: 4

    color: tile.vacant ? "transparent" : root.tileFill
    border.width: 1
    border.color: tile.vacant ? root.borderSoft : Util.alpha(root.foreground, 0.12)
    radius: 0
    implicitHeight: root.tileHeight
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
          border.width: 1
          border.color: Util.alpha(root.foreground, 0.22)
          radius: 3

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
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        height: 1
        color: root.borderSoft
      }

      Row {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        anchors.leftMargin: 8
        anchors.rightMargin: 8
        anchors.topMargin: 8
        anchors.bottomMargin: 8
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
        color: root.muted
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
      x: tile.numberInset
      y: tile.numberInset
      z: 2
      text: tile.tileId
      color: root.foreground
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
      font.weight: Font.Medium
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
          if (root.mode === "forget") {
            root.handleForgetKey(event)
            return
          }
          if (root.mode === "close") {
            root.handleCloseKey(event)
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
        spacing: Style.space(8)

        Item {
          width: parent.width
          height: root.headerHeight

          Text {
            id: titleText
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            text: root.mode === "save" ? "Save current desk"
              : (root.mode === "rename" ? "Rename"
              : (root.mode === "extras" && root.extrasPickingTheme ? "Theme"
              : (root.mode === "extras" && root.extrasDesk ? String(root.extrasDesk.name || "")
              : (root.mode === "forget" && root.forgetDesk ? "Forget " + String(root.forgetDesk.name || "") + "?"
              : (root.mode === "close" && root.closeDesk ? "Close " + String(root.closeDesk.name || "") + "?"
              : "Desks")))))
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.heading
            font.weight: Font.Medium
          }

          Text {
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            visible: (root.mode === "picker" && !root.pickerEmpty) || root.mode === "extras"
            text: root.mode === "extras" ? (root.extrasPickingTheme ? "pick a theme" : "desk extras") : (root.filterText || "type to filter")
            color: root.muted
            font.family: root.fontFamily
            font.pixelSize: root.mode === "extras" ? Style.font.caption : (root.filterText ? Style.font.heading : Style.font.bodySmall)
          }
        }

        Column {
          width: parent.width
          visible: root.pickerEmpty
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
            color: root.muted
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
            wrapMode: Text.WordWrap
          }

          ChromeButton {
            label: "Save current as a desk"
            primary: true
            onClicked: root.openSave()
          }
        }

        Grid {
          id: deskGrid
          width: parent.width
          visible: root.mode === "picker" && !root.pickerEmpty
          columns: 2
          columnSpacing: root.gridGap
          rowSpacing: root.gridGap

          Repeater {
            model: deskGrid.visible ? root.cards : []

            delegate: Rectangle {
              required property int index
              required property var modelData

              readonly property var card: modelData || ({})
              readonly property bool isNew: card.kind === "new"
              readonly property bool isUnsaved: card.kind === "unsaved"
              readonly property bool hasCursor: index === root.cursorIndex
              readonly property bool isHere: !!card.here

              width: root.cellWidth
              implicitHeight: (isNew ? newBody.implicitHeight : deskBody.implicitHeight) + Style.space(24)
              color: isNew ? (hasCursor ? root.fillHover : "transparent") : (isHere ? root.fillSelected : (hasCursor ? root.fillHover : root.fill))
              border.width: 1
              border.color: hasCursor ? Util.alpha(root.foreground, 0.55) : root.borderSoft

              Column {
                id: deskBody
                visible: !isNew
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
                    font.weight: Font.DemiBold
                    elide: Text.ElideRight
                  }

                  Row {
                    id: pillRow
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: Style.space(4)

                    Rectangle {
                      visible: !!card.here
                      color: "transparent"
                      border.width: 1
                      border.color: Util.alpha(root.accent, 0.55)
                      implicitWidth: hereText.implicitWidth + Style.space(12)
                      implicitHeight: hereText.implicitHeight + Style.space(2)
                      Text {
                        id: hereText
                        anchors.centerIn: parent
                        text: "here"
                        color: root.accent
                        font.family: root.fontFamily
                        font.pixelSize: Style.font.caption
                      }
                    }
                    Rectangle {
                      visible: !isUnsaved
                      color: "transparent"
                      border.width: 1
                      border.color: card.life === "live" ? Util.alpha(root.accent, 0.4) : root.borderSoft
                      implicitWidth: lifeText.implicitWidth + Style.space(12)
                      implicitHeight: lifeText.implicitHeight + Style.space(2)
                      Text {
                        id: lifeText
                        anchors.centerIn: parent
                        text: card.life === "live" ? "live" : "dead"
                        color: card.life === "live" ? root.accent : root.muted
                        font.family: root.fontFamily
                        font.pixelSize: Style.font.caption
                      }
                    }
                    Rectangle {
                      visible: !!card.dnd
                      color: "transparent"
                      border.width: 1
                      border.color: Util.alpha(root.urgent, 0.5)
                      implicitWidth: dndText.implicitWidth + Style.space(12)
                      implicitHeight: dndText.implicitHeight + Style.space(2)
                      Text {
                        id: dndText
                        anchors.centerIn: parent
                        text: "dnd"
                        color: root.urgent
                        font.family: root.fontFamily
                        font.pixelSize: Style.font.caption
                      }
                    }
                    Rectangle {
                      visible: isUnsaved
                      color: "transparent"
                      border.width: 1
                      border.color: root.borderSoft
                      implicitWidth: draftText.implicitWidth + Style.space(12)
                      implicitHeight: draftText.implicitHeight + Style.space(2)
                      Text {
                        id: draftText
                        anchors.centerIn: parent
                        text: "draft"
                        color: root.muted
                        font.family: root.fontFamily
                        font.pixelSize: Style.font.caption
                      }
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
                      tileData: modelData
                    }
                  }
                }

                Text {
                  width: parent.width
                  text: String(card.meta || "")
                  color: root.muted
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.bodySmall
                  elide: Text.ElideRight
                }
              }

              Column {
                id: newBody
                visible: isNew
                width: parent.width - Style.space(24)
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.margins: Style.space(12)
                spacing: Style.space(10)

                Text {
                  text: String(card.name || "+ new desk")
                  color: root.muted
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.title
                  font.weight: Font.DemiBold
                }

                Text {
                  text: String(card.meta || "enter starts empty")
                  color: root.muted
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.bodySmall
                }
              }

              MouseArea {
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onContainsMouseChanged: if (containsMouse) root.cursorIndex = index
                onClicked: {
                  root.cursorIndex = index
                  root.activateHighlighted()
                }
              }
            }
          }
        }

        Column {
          width: parent.width
          visible: root.mode === "save" || root.mode === "rename"
          spacing: Style.space(14)

          Column {
            width: parent.width
            spacing: Style.space(6)

            Text {
              text: "Name"
              color: root.muted
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }

            Rectangle {
              width: parent.width
              implicitHeight: Math.max(Style.space(36), nameInput.implicitHeight + Style.space(16))
              color: root.tileFill
              border.width: 1
              border.color: Util.alpha(root.foreground, 0.45)

              TextInput {
                id: nameInput
                anchors.fill: parent
                anchors.leftMargin: Style.space(10)
                anchors.rightMargin: Style.space(10)
                verticalAlignment: TextInput.AlignVCenter
                color: root.foreground
                selectionColor: Util.alpha(root.accent, 0.35)
                selectedTextColor: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.heading
                clip: true
                cursorVisible: activeFocus
                cursorDelegate: Rectangle {
                  width: 2
                  color: root.accent
                }
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
          }

          Column {
            width: parent.width
            visible: root.mode === "save"
            spacing: Style.space(6)

            Text {
              text: "Minimap"
              color: root.muted
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }

            Grid {
              width: parent.width
              columns: 3
              columnSpacing: Style.space(6)
              rowSpacing: Style.space(6)

              Repeater {
                model: root.mode === "save" ? root.tilesFrom(root.stage, 10) : []
                delegate: WorkspaceTile {
                  width: Math.floor((parent.width - Style.space(12)) / 3)
                  tileData: modelData
                }
              }
            }
          }

          Row {
            spacing: Style.space(8)

            ChromeButton {
              label: root.mode === "rename" ? "Rename desk" : "Save"
              primary: true
              onClicked: root.confirmName()
            }

            ChromeButton {
              label: "Cancel"
              onClicked: root.cancelDialog()
            }
          }
        }

        Column {
          width: parent.width
          visible: root.mode === "extras" && !root.extrasPickingTheme
          spacing: Style.space(14)

          Item {
            width: parent.width
            implicitHeight: Math.max(dndLabel.implicitHeight, dndRow.implicitHeight)

            Text {
              id: dndLabel
              anchors.left: parent.left
              anchors.verticalCenter: parent.verticalCenter
              text: "Do not disturb"
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.subtitle
            }

            Row {
              id: dndRow
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.space(6)

              ChoiceChip {
                label: "leave"
                on: root.extrasDraft.dnd === "leave"
                onClicked: root.patchExtras({ dnd: "leave" })
              }
              ChoiceChip {
                label: "on"
                on: root.extrasDraft.dnd === "on"
                onClicked: root.patchExtras({ dnd: "on" })
              }
              ChoiceChip {
                label: "off"
                on: root.extrasDraft.dnd === "off"
                onClicked: root.patchExtras({ dnd: "off" })
              }
            }
          }

          Item {
            width: parent.width
            implicitHeight: Math.max(themeLabel.implicitHeight, themeRow.implicitHeight)

            Text {
              id: themeLabel
              anchors.left: parent.left
              anchors.verticalCenter: parent.verticalCenter
              text: "Theme"
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.subtitle
            }

            Row {
              id: themeRow
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.space(6)

              ChoiceChip {
                label: "leave"
                on: !root.extrasDraft.theme || root.extrasDraft.theme === "leave"
                onClicked: root.patchExtras({ theme: "leave" })
              }
              ChoiceChip {
                label: root.themeChipLabel()
                on: !!(root.extrasDraft.theme && root.extrasDraft.theme !== "leave")
                onClicked: root.beginThemePick()
              }
            }
          }

          Item {
            width: parent.width
            implicitHeight: Math.max(launchLabel.implicitHeight, launchRow.implicitHeight)

            Text {
              id: launchLabel
              anchors.left: parent.left
              anchors.verticalCenter: parent.verticalCenter
              text: "Launch missing windows"
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.subtitle
            }

            Row {
              id: launchRow
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.space(6)

              ChoiceChip {
                label: "yes"
                on: root.extrasDraft.launchMissing === true
                onClicked: root.patchExtras({ launchMissing: true })
              }
              ChoiceChip {
                label: "no"
                on: root.extrasDraft.launchMissing === false
                onClicked: root.patchExtras({ launchMissing: false })
              }
            }
          }

          Text {
            width: parent.width
            text: "Leave means a switch does not touch that setting. Theme changes flash the whole desktop, so they stay off unless you ask."
            color: root.muted
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
            wrapMode: Text.WordWrap
          }

          ChromeButton {
            label: "Done"
            primary: true
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
            color: root.muted
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
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

              ChoiceChip {
                label: "leave"
                on: !root.extrasDraft.theme || root.extrasDraft.theme === "leave"
                onClicked: root.pickTheme("leave")
              }

              Repeater {
                model: root.themeNames
                delegate: ChoiceChip {
                  required property string modelData
                  label: modelData
                  on: root.extrasDraft.theme === modelData
                  onClicked: root.pickTheme(modelData)
                }
              }
            }
          }

          ChromeButton {
            label: "Back"
            onClicked: root.extrasPickingTheme = false
          }
        }

        Column {
          width: parent.width
          visible: root.mode === "forget"
          spacing: Style.space(18)
          topPadding: Style.space(4)

          Text {
            width: parent.width
            text: "The recipe is deleted. Parked windows for " + String((root.forgetDesk && root.forgetDesk.name) || "this desk") + " come back onto 1–10."
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.title
            wrapMode: Text.WordWrap
          }

          Text {
            width: parent.width
            text: "Nothing is killed."
            color: root.muted
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
          }

          Row {
            spacing: Style.space(8)

            ChromeButton {
              label: "Cancel"
              hot: root.forgetIndex === 0
              onClicked: root.cancelDialog()
            }

            ChromeButton {
              label: "Forget desk"
              danger: true
              hot: root.forgetIndex === 1
              onClicked: root.confirmForget()
            }
          }
        }

        Column {
          width: parent.width
          visible: root.mode === "close"
          spacing: Style.space(18)
          topPadding: Style.space(4)

          Text {
            width: parent.width
            text: "Every window in " + String((root.closeDesk && root.closeDesk.name) || "this desk") + " will quit. The recipe stays, so you can open them again in the background."
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.title
            wrapMode: Text.WordWrap
          }

          Text {
            width: parent.width
            text: "Scratchpad is not touched."
            color: root.muted
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
          }

          Row {
            spacing: Style.space(8)

            ChromeButton {
              label: "Cancel"
              hot: root.closeIndex === 0
              onClicked: root.cancelDialog()
            }

            ChromeButton {
              label: "Close windows"
              danger: true
              hot: root.closeIndex === 1
              onClicked: root.confirmClose()
            }
          }
        }

        Item {
          width: parent.width
          visible: root.mode === "picker" || root.mode === "save" || root.mode === "rename"
          implicitHeight: Style.space(22)

          Row {
            visible: root.mode === "picker" && root.pickerEmpty
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            spacing: 0
            Text { text: "n"; color: root.foreground; font.family: root.fontFamily; font.pixelSize: Style.font.bodySmall }
            Text { text: " save current"; color: root.muted; font.family: root.fontFamily; font.pixelSize: Style.font.bodySmall }
          }

          Row {
            visible: root.mode === "picker" && root.pickerEmpty
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            spacing: 0
            Text { text: "esc"; color: root.foreground; font.family: root.fontFamily; font.pixelSize: Style.font.bodySmall }
            Text { text: " close"; color: root.muted; font.family: root.fontFamily; font.pixelSize: Style.font.bodySmall }
          }

          Row {
            visible: root.mode === "picker" && !root.pickerEmpty
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            spacing: 0
            Text { text: "enter"; color: root.foreground; font.family: root.fontFamily; font.pixelSize: Style.font.bodySmall }
            Text { text: " switch · "; color: root.muted; font.family: root.fontFamily; font.pixelSize: Style.font.bodySmall }
            Text { text: "s"; color: root.foreground; font.family: root.fontFamily; font.pixelSize: Style.font.bodySmall }
            Text { text: " update here · "; color: root.muted; font.family: root.fontFamily; font.pixelSize: Style.font.bodySmall }
            Text { text: "n"; color: root.foreground; font.family: root.fontFamily; font.pixelSize: Style.font.bodySmall }
            Text { text: " new · "; color: root.muted; font.family: root.fontFamily; font.pixelSize: Style.font.bodySmall }
            Text { text: "x"; color: root.foreground; font.family: root.fontFamily; font.pixelSize: Style.font.bodySmall }
            Text { text: " close · "; color: root.muted; font.family: root.fontFamily; font.pixelSize: Style.font.bodySmall }
            Text { text: "o"; color: root.foreground; font.family: root.fontFamily; font.pixelSize: Style.font.bodySmall }
            Text { text: " open"; color: root.muted; font.family: root.fontFamily; font.pixelSize: Style.font.bodySmall }
          }

          Row {
            visible: root.mode === "picker" && !root.pickerEmpty
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            spacing: 0
            Text { text: "r"; color: root.foreground; font.family: root.fontFamily; font.pixelSize: Style.font.bodySmall }
            Text { text: " rename · "; color: root.muted; font.family: root.fontFamily; font.pixelSize: Style.font.bodySmall }
            Text { text: "del"; color: root.foreground; font.family: root.fontFamily; font.pixelSize: Style.font.bodySmall }
            Text { text: " forget"; color: root.muted; font.family: root.fontFamily; font.pixelSize: Style.font.bodySmall }
          }

          Text {
            visible: root.mode === "save" || root.mode === "rename"
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            text: "Scratchpad stays global and is not stored."
            color: root.muted
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
          }

          Row {
            visible: root.mode === "save" || root.mode === "rename"
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            spacing: 0
            Text { text: "enter"; color: root.foreground; font.family: root.fontFamily; font.pixelSize: Style.font.bodySmall }
            Text { text: root.mode === "rename" ? " rename" : " save"; color: root.muted; font.family: root.fontFamily; font.pixelSize: Style.font.bodySmall }
          }
        }
      }
    }
  }
}
