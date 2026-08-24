import QtQuick
import Quickshell
import Quickshell.Io
import qs.Ui
import qs.Commons
import "Model.js" as Model

BarWidget {
  id: root
  moduleName: "com.mdtrr.omadesk"

  readonly property string desksPath: (Quickshell.env("HOME") || "") + "/.config/omarchy/omadesk/desks.json"
  readonly property color barFg: bar ? bar.barForeground : Color.foreground

  property var currentId: null
  property string currentName: ""
  property int savedDeskCount: 0
  property bool desksReadQueued: false
  readonly property bool hasDesk: currentName !== ""
  readonly property bool draft: !hasDesk && savedDeskCount > 0
  readonly property string chipText: hasDesk ? "/ " + currentName : (draft ? "Unsaved" : "Desks")

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
    root.savedDeskCount = (state && state.desks && state.desks.length) ? state.desks.length : 0
  }

  function reloadDesksFile() {
    if (desksReadProc.running) {
      root.desksReadQueued = true
      return
    }
    var argv = Model.boundedFileReadArgv(root.desksPath)
    if (!argv || !argv.length) {
      root.applyDesks("")
      return
    }
    desksReadProc.command = argv
    desksReadProc.running = true
  }

  function finishDesksRead(code) {
    var raw = code === 0 ? String(desksReadOut.text || "") : ""
    if (!Model.isWithinUtf8ByteLimit(raw, Model.maxDesksFileBytes())) raw = ""
    root.applyDesks(raw)
    if (root.desksReadQueued) {
      root.desksReadQueued = false
      Qt.callLater(function() { root.reloadDesksFile() })
    }
  }

  function toggleOverlay() {
    if (root.bar && root.bar.shell && typeof root.bar.shell.toggle === "function") {
      root.bar.shell.toggle(root.moduleName)
      return
    }
    Util.execDetached("omarchy-shell shell toggle " + Util.shellQuote(root.moduleName))
  }

  // Size from the label, not from a fill-anchored child. Empty-name used to
  // collapse the slot to an invisible 12px gap after the workspace numbers.
  implicitWidth: button.implicitWidth
  implicitHeight: barSize
  visible: true

  Component.onCompleted: root.reloadDesksFile()

  FileView {
    id: desksFile
    path: root.desksPath
    preload: false
    watchChanges: true
    printErrors: false
    onFileChanged: root.reloadDesksFile()
  }

  Process {
    id: desksReadProc
    stdout: StdioCollector {
      id: desksReadOut
      waitForEnd: true
    }
    onExited: function(code) {
      root.finishDesksRead(code)
    }
  }

  WidgetButton {
    id: button
    anchors.centerIn: parent
    bar: root.bar
    text: " "
    labelVisible: false
    fixedWidth: chipLabel.implicitWidth + scaledHorizontalMargin * 2
    tooltipText: "Open Desks"
    foreground: hasDesk ? Color.accent : root.barFg
    useActiveColor: false
    dimmed: false
    horizontalMargin: 6
    verticalPadding: 6
    onPressed: root.toggleOverlay()

    Text {
      id: chipLabel
      anchors.centerIn: parent
      text: root.chipText
      textFormat: Text.PlainText
      color: root.hasDesk ? Color.accent : root.barFg
      font.family: button.fontFamily
      font.pixelSize: button.fontSize
      renderType: Text.NativeRendering
    }
  }
}
