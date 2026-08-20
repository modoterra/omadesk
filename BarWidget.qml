import QtQuick
import Quickshell
import Quickshell.Io
import qs.Ui
import qs.Commons
import "Model.js" as Model

BarWidget {
  id: root
  moduleName: "modoterra.omadesk"

  readonly property string desksDir: (Quickshell.env("HOME") || "") + "/.config/omarchy/omadesk"
  readonly property string desksPath: desksDir + "/desks.json"
  readonly property color quietForeground: bar ? bar.foreground : Color.foreground

  property var currentId: null
  property string currentName: ""
  readonly property bool hasDesk: currentName !== ""
  readonly property string chipText: hasDesk ? "/ " + currentName : ""

  function deskNameFor(state, id) {
    if (id === null || id === undefined || !state || !state.desks)
      return ""
    var desks = state.desks
    for (var i = 0; i < desks.length; i++) {
      var desk = desks[i]
      if (desk && String(desk.id) === String(id))
        return String(desk.name || "").trim()
    }
    return ""
  }

  function applyDesks(raw) {
    var parsed = null
    try {
      parsed = Model.readDesks(raw)
    } catch (e) {
      parsed = null
    }
    var state = null
    if (parsed && parsed.ok === false) state = null
    else if (parsed && parsed.state) state = parsed.state
    else state = parsed
    var id = null
    if (state && state.currentId !== undefined && state.currentId !== null && String(state.currentId) !== "")
      id = state.currentId
    root.currentId = id
    root.currentName = root.deskNameFor(state, id)
  }

  function toggleOverlay() {
    if (root.bar && root.bar.shell && typeof root.bar.shell.toggle === "function") {
      root.bar.shell.toggle(root.moduleName)
      return
    }
    Util.execDetached("omarchy-shell shell toggle " + Util.shellQuote(root.moduleName))
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  FileView {
    id: desksFile
    path: root.desksPath
    watchChanges: true
    printErrors: false
    onLoaded: root.applyDesks(text())
    onLoadFailed: root.applyDesks("")
    onFileChanged: reload()
  }

  // FileView cannot observe a path that does not exist yet.
  FileView {
    path: root.desksDir
    watchChanges: true
    printErrors: false
    onFileChanged: desksFile.reload()
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.chipText
    foreground: root.hasDesk ? Color.accent : root.quietForeground
    useActiveColor: false
    dimmed: !root.hasDesk
    keepSpace: true
    hasVisualContent: true
    horizontalMargin: 6
    verticalPadding: 6
    onPressed: root.toggleOverlay()
  }
}
