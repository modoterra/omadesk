#!/usr/bin/env node

const fs = require("fs")
const path = require("path")
const vm = require("vm")
const assert = require("assert")

const source = fs.readFileSync(path.join(__dirname, "..", "Model.js"), "utf8")
const model = {}
vm.createContext(model)
vm.runInContext(source, model)

const clientsText = fs.readFileSync(path.join(__dirname, "fixtures", "clients.json"), "utf8")
const workspacesText = fs.readFileSync(path.join(__dirname, "fixtures", "workspaces.json"), "utf8")
const clients = JSON.parse(clientsText)
const workspaces = JSON.parse(workspacesText)

function namesOf(desks) {
  return desks.map((d) => d.name)
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function same(actual, expected) {
  assert.deepStrictEqual(clone(actual), expected)
}

var tests = 0
function test(name, fn) {
  fn()
  tests += 1
}

test("1 filter ca ranks Call first", function() {
  const desks = namesOf(model.filterDesks(model.demoDesks().desks, "ca"))
  assert.strictEqual(desks[0], "Call")
  assert.ok(desks.indexOf("Writing") === -1)
  assert.ok(desks.indexOf("Review") === -1)
  const among = model.filterDesks(
    [{ name: "Call" }, { name: "Writing" }, { name: "Review" }],
    "ca"
  )
  assert.strictEqual(among[0].name, "Call")
})

test("2 parseStage drops scratchpad and omadesk-*", function() {
  const stage = model.parseStage(clientsText, workspacesText)
  const addrs = stage.windows.map((w) => w.address)
  assert.ok(addrs.indexOf("0x55f11fe15110") >= 0)
  assert.ok(addrs.indexOf("0x55f11fe15220") >= 0)
  assert.ok(addrs.indexOf("0x55f11fe15330") >= 0)
  assert.ok(addrs.indexOf("0x55f11fe15aaa") === -1)
  assert.ok(addrs.indexOf("0x55f11fe15bbb") === -1)
  assert.ok(addrs.indexOf("0x55f11fe15ccc") === -1)
  stage.windows.forEach((w) => {
    assert.ok(w.workspace >= 1 && w.workspace <= 10)
  })
  const blob = JSON.stringify(stage)
  assert.ok(blob.indexOf("scratchpad") === -1)
  assert.ok(blob.indexOf("omadesk-") === -1)
  assert.strictEqual(stage.lastWorkspace, 3)
  assert.strictEqual(stage.windows.length, 3)
  assert.strictEqual(stage.windows[0].monitor, "DP-1")
  const parsedAgain = model.parseStage(clients, workspaces)
  assert.strictEqual(parsedAgain.windows.length, 3)
})

test("3 parkPlan lua syntax", function() {
  const stage = model.parseStage(clientsText, workspacesText)
  const plan = model.parkPlan(stage, "writing")
  assert.ok(plan.dispatches.length >= 3)
  const first = plan.dispatches[0]
  assert.strictEqual(
    first,
    'hl.dsp.window.move({ workspace = "name:omadesk-writing-1", follow = false, window = "address:0x55f11fe15110" })'
  )
  const zed = plan.dispatches.filter((d) => d.indexOf("0x55f11fe15110") >= 0)[0]
  const ghost = plan.dispatches.filter((d) => d.indexOf("0x55f11fe15220") >= 0)[0]
  const chrome = plan.dispatches.filter((d) => d.indexOf("0x55f11fe15330") >= 0)[0]
  assert.ok(zed.indexOf('workspace = "name:omadesk-writing-1"') >= 0)
  assert.ok(ghost.indexOf('workspace = "name:omadesk-writing-2"') >= 0)
  assert.ok(chrome.indexOf('workspace = "name:omadesk-writing-3"') >= 0)
  plan.dispatches.forEach((lua) => {
    assert.ok(lua.indexOf("hl.dsp.window.move({") === 0)
    assert.ok(lua.indexOf("follow = false") >= 0)
    assert.ok(lua.indexOf("name:omadesk-writing-") >= 0)
    assert.ok(lua.indexOf('window = "address:0x') >= 0)
    assert.ok(lua.indexOf("movetoworkspacesilent") === -1)
  })
  assert.ok(plan.batch.indexOf("dispatch ") === 0)
  assert.ok(plan.batch.indexOf("; dispatch ") >= 0)
  assert.strictEqual(
    model.moveDispatch("name:omadesk-writing-1", "0xABC"),
    'hl.dsp.window.move({ workspace = "name:omadesk-writing-1", follow = false, window = "address:0xABC" })'
  )
  assert.strictEqual(
    model.focusDispatch("3"),
    'hl.dsp.focus({ workspace = "3" })'
  )
  assert.strictEqual(model.parkLotName("writing", 1), "omadesk-writing-1")
  assert.strictEqual(model.parkSelector("writing", 1), "name:omadesk-writing-1")
})

test("4 empty stage empty park plan", function() {
  const empty = model.parkPlan({ workspaces: [], windows: [], lastWorkspace: null }, "writing")
  same(empty.dispatches, [])
  assert.strictEqual(empty.batch, "")
  const empty2 = model.parkPlan(model.parseStage("[]", "[]"), "writing")
  same(empty2.dispatches, [])
})

test("5b restoreFromPark inverts a park plan", function() {
  const stage = model.parseStage(clientsText, workspacesText)
  const park = model.parkPlan(stage, "omadesk-dev")
  const back = model.restoreFromPark(park)
  assert.strictEqual(back.dispatches.length, park.dispatches.length)
  assert.ok(back.dispatches[0].indexOf('workspace = "1"') >= 0)
  assert.ok(back.dispatches[0].indexOf("0x55f11fe15110") >= 0)
  assert.ok(back.batch.indexOf("dispatch ") === 0)
})

test("5 restorePlan empty lot and mixed slugs", function() {
  const emptyLot = model.restorePlan("[]", "writing")
  same(emptyLot.dispatches, [])
  assert.strictEqual(emptyLot.batch, "")
  const writing = model.restorePlan(clientsText, "writing")
  assert.strictEqual(writing.dispatches.length, 1)
  assert.strictEqual(
    writing.dispatches[0],
    'hl.dsp.window.move({ workspace = "1", follow = false, window = "address:0x55f11fe15bbb" })'
  )
  writing.dispatches.forEach((lua) => {
    assert.ok(lua.indexOf("omadesk-call") === -1)
    assert.ok(lua.indexOf("scratchpad") === -1)
  })
  const call = model.restorePlan(clients, "call")
  assert.strictEqual(call.dispatches.length, 2)
  const meet = call.dispatches.filter((d) => d.indexOf("0x55f11fe15ccc") >= 0)[0]
  const notes = call.dispatches.filter((d) => d.indexOf("0x55f11fe15c2c") >= 0)[0]
  assert.ok(meet.indexOf('workspace = "1"') >= 0)
  assert.ok(notes.indexOf('workspace = "2"') >= 0)
  call.dispatches.forEach((lua) => {
    assert.ok(lua.indexOf("0x55f11fe15bbb") === -1)
    assert.ok(lua.indexOf("0x55f11fe15aaa") === -1)
  })
})

test("6 readDesks invalid JSON fails; empty text is empty state", function() {
  const bad = model.readDesks("{")
  assert.strictEqual(bad.ok, false)
  assert.ok(/invalid JSON/i.test(bad.error))
  const empty = model.readDesks("")
  assert.strictEqual(empty.ok, true)
  assert.strictEqual(empty.state.currentId, null)
  same(empty.state.desks, [])
  assert.strictEqual(empty.state.version, 1)
  const ws = model.readDesks("  \n\t  ")
  assert.strictEqual(ws.ok, true)
  assert.strictEqual(ws.state.currentId, null)
  same(ws.state.desks, [])
  const missing = model.readDesks(null)
  assert.strictEqual(missing.ok, true)
  same(missing.state, clone(model.emptyState()))
})

test("7 write/read round-trip; version required", function() {
  const ver = model.readDesks(JSON.stringify({ version: 2, desks: [] }))
  assert.strictEqual(ver.ok, false)
  const noVer = model.readDesks(JSON.stringify({ desks: [] }))
  assert.strictEqual(noVer.ok, false)
  const demo = model.demoDesks()
  const written = model.writeDesks(demo)
  assert.ok(written.charAt(written.length - 1) === "\n")
  const round = model.readDesks(written)
  assert.strictEqual(round.ok, true)
  same(round.state, clone(model.readDesks(model.writeDesks(round.state)).state))
  assert.strictEqual(round.state.version, 1)
  assert.strictEqual(round.state.currentId, "writing")
  assert.strictEqual(round.state.desks.length, 3)
})

test("8 snapshot does not store scratchpad", function() {
  const stage = model.parseStage(clientsText, workspacesText)
  const recipe = model.snapshotRecipe(stage, "Writing", model.defaultExtras(), stage.lastWorkspace, "2026-08-19T16:40:00Z")
  const blob = JSON.stringify(recipe)
  assert.ok(blob.indexOf("scratchpad") === -1)
  assert.ok(blob.indexOf("special:") === -1)
  recipe.workspaces.forEach((ws) => {
    assert.ok(ws.n >= 1 && ws.n <= 10)
  })
  const addrs = []
  recipe.workspaces.forEach((ws) => {
    (ws.windows || []).forEach((w) => addrs.push(w.address || ""))
  })
  assert.ok(addrs.indexOf("0x55f11fe15aaa") === -1)
  assert.ok(addrs.indexOf("0x55f11fe15bbb") === -1)
  assert.strictEqual(recipe.id, "writing")
  assert.strictEqual(recipe.lastWorkspace, 3)
  const dirty = {
    version: 1,
    currentId: "writing",
    desks: [{
      id: "writing",
      name: "Writing",
      lastWorkspace: 3,
      extras: model.defaultExtras(),
      workspaces: [
        {
          n: 1,
          windows: [
            { class: "dev.zed.Zed", title: "charcana" },
            { class: "foot", title: "scratch", workspace: "special:scratchpad" }
          ]
        }
      ]
    }]
  }
  const cleaned = model.readDesks(model.writeDesks(dirty)).state
  const wins = cleaned.desks[0].workspaces[0].windows
  assert.strictEqual(wins.length, 1)
  assert.strictEqual(wins[0].class, "dev.zed.Zed")
  assert.ok(JSON.stringify(cleaned).indexOf("scratchpad") === -1)
  assert.ok(JSON.stringify(cleaned).indexOf("foot") === -1)
})

test("9 uniqueId duplicate names", function() {
  assert.strictEqual(model.uniqueId("writing", []), "writing")
  assert.strictEqual(model.uniqueId("writing", ["writing"]), "writing-2")
  assert.strictEqual(model.uniqueId("writing", ["writing", "writing-2"]), "writing-3")
  assert.strictEqual(model.uniqueId("My Desk", ["my-desk"]), "my-desk-2")
})

test("10 slugify", function() {
  assert.strictEqual(model.slugify("My Desk"), "my-desk")
  assert.strictEqual(model.slugify("Writing"), "writing")
  assert.strictEqual(model.slugify("  Call  "), "call")
})

test("11 switchPlan sequential park then restore", function() {
  const stage = model.parseStage(clientsText, workspacesText)
  const plan = model.switchPlan(stage, clientsText, "writing", "call")
  assert.strictEqual(plan.sequential, true)
  assert.ok(plan.park && plan.restore)
  assert.ok(isArray(plan.park.dispatches))
  assert.ok(isArray(plan.restore.dispatches))
  assert.ok(!plan.dispatches)
  const keys = Object.keys(plan)
  assert.ok(keys.indexOf("park") >= 0)
  assert.ok(keys.indexOf("restore") >= 0)
  assert.ok(keys.indexOf("park") < keys.indexOf("restore"))
  plan.park.dispatches.forEach((lua) => {
    assert.ok(lua.indexOf("name:omadesk-writing-") >= 0)
  })
  plan.restore.dispatches.forEach((lua) => {
    assert.ok(lua.indexOf("name:omadesk-") === -1)
    assert.ok(/workspace = "[12]"/.test(lua))
  })
  const unnamed = model.switchPlan(stage, clientsText, "unnamed", "call")
  unnamed.park.dispatches.forEach((lua) => {
    assert.ok(lua.indexOf("name:omadesk-unnamed-") >= 0)
  })
})

test("12 match order address then class+workspace", function() {
  const live = [
    { address: "0xBBB", class: "Ghostty", initialClass: "Ghostty", workspace: { id: 1, name: "1" } },
    { address: "0xAAA", class: "other", initialClass: "other", workspace: { id: 2, name: "2" } },
    { address: "0xCCC", class: "Ghostty", initialClass: "Ghostty", workspace: { id: 1, name: "1" } }
  ]
  const byAddr = model.matchWindow({ address: "0xAAA", class: "Ghostty" }, live, [], 1)
  assert.strictEqual(byAddr.address, "0xAAA")
  const byClass = model.matchWindow({ class: "Ghostty" }, live, [], 1)
  assert.strictEqual(byClass.address, "0xBBB")
  const skipped = model.matchWindow({ class: "Ghostty" }, live, ["0xBBB"], 1)
  assert.strictEqual(skipped.address, "0xCCC")
})

test("13 launchMissing skip when extras.launchMissing === false", function() {
  const desk = {
    extras: { dnd: "leave", launchMissing: false },
    workspaces: [
      { n: 1, windows: [{ class: "dev.zed.Zed", title: "charcana", exec: ["zed"] }] }
    ]
  }
  same(model.launchMissingPlan(desk, "[]").launches, [])
  const on = {
    extras: model.defaultExtras(),
    workspaces: [
      { n: 1, windows: [{ class: "dev.zed.Zed", title: "charcana", exec: ["zed"] }] }
    ]
  }
  const launched = model.launchMissingPlan(on, "[]").launches
  assert.strictEqual(launched.length, 1)
  assert.strictEqual(launched[0].n, 1)
  same(launched[0].exec, ["zed"])
})

test("14 updateDesk keeps id/name/extras", function() {
  const state = model.demoDesks()
  const stage = model.parseStage(clientsText, workspacesText)
  const next = model.updateDesk(state, "call", stage, "2026-08-19T17:00:00Z")
  const call = next.desks.filter((d) => d.id === "call")[0]
  assert.strictEqual(call.id, "call")
  assert.strictEqual(call.name, "Call")
  assert.strictEqual(call.extras.dnd, "on")
  assert.strictEqual(call.extras.launchMissing, true)
  assert.strictEqual(call.updatedAt, "2026-08-19T17:00:00Z")
  assert.strictEqual(call.lastWorkspace, 3)
  assert.strictEqual(state.desks.filter((d) => d.id === "call")[0].name, "Call")
})

test("15 renameDesk keeps id", function() {
  const next = model.renameDesk(model.demoDesks(), "writing", "Prose")
  const desk = next.desks.filter((d) => d.id === "writing")[0]
  assert.strictEqual(desk.id, "writing")
  assert.strictEqual(desk.name, "Prose")
  assert.strictEqual(next.currentId, "writing")
})

test("16 forgetDesk removes recipe only", function() {
  const before = model.demoDesks()
  const next = model.forgetDesk(before, "review")
  assert.strictEqual(next.desks.length, before.desks.length - 1)
  assert.strictEqual(next.desks.filter((d) => d.id === "review").length, 0)
  assert.strictEqual(next.currentId, "writing")
  const gone = model.forgetDesk(before, "writing")
  assert.strictEqual(gone.currentId, null)
  assert.strictEqual(gone.desks.length, 2)
})

test("17 default extras launchMissing true, dnd leave", function() {
  const extras = model.defaultExtras()
  assert.strictEqual(extras.launchMissing, true)
  assert.strictEqual(extras.dnd, "leave")
  assert.strictEqual(model.dndAction(extras), null)
  assert.strictEqual(model.dndAction({ dnd: "on" }), "on")
  assert.strictEqual(model.dndAction({ dnd: "off" }), "off")
})

test("18 cursor h/j/k/l and jump 1-9", function() {
  assert.strictEqual(model.moveCursor(1, "h", 4, 2), 0)
  assert.strictEqual(model.moveCursor(0, "l", 4, 2), 1)
  assert.strictEqual(model.moveCursor(0, "j", 4, 2), 2)
  assert.strictEqual(model.moveCursor(2, "k", 4, 2), 0)
  assert.strictEqual(model.moveCursor(0, "left", 4), 0)
  assert.strictEqual(model.moveCursor(0, "right", 4), 1)
  assert.strictEqual(model.moveCursor(3, "down", 4, 2), 3)
  assert.strictEqual(model.moveCursor(1, "up", 4, 2), 0)
  assert.strictEqual(model.moveCursor(9, "l", 0, 2), 0)
  assert.strictEqual(model.jumpCursor(1, 9), 0)
  assert.strictEqual(model.jumpCursor(9, 9), 8)
  assert.strictEqual(model.jumpCursor(5, 4), 0)
  assert.strictEqual(model.jumpCursor(4, 4), 3)
})

test("19 sanitizeSlug rejects slashes", function() {
  const slug = model.sanitizeSlug("foo/bar")
  assert.ok(slug.indexOf("/") === -1)
  assert.strictEqual(slug, "foo-bar")
  assert.ok(model.parkLotName("a/b", 1).indexOf("/") === -1)
  assert.strictEqual(model.sanitizeSlug(""), "unnamed")
  assert.strictEqual(model.sanitizeSlug("///"), "unnamed")
})

test("20 extras helpers, cards, currentSlug, guessExec", function() {
  assert.strictEqual(model.currentSlug({ currentId: null }), "unnamed")
  assert.strictEqual(model.currentSlug(model.demoDesks()), "writing")
  same(model.guessExec({ class: "dev.zed.Zed" }), ["zed"])
  same(model.guessExec({ class: "Zed" }), ["zed"])
  same(model.guessExec({ class: "com.mitchellh.ghostty" }), ["ghostty"])
  same(model.guessExec({ class: "chromium" }), ["chromium", "--new-window"])
  const cards = model.pickerCards(model.demoDesks(), "")
  assert.strictEqual(cards[0].kind, "desk")
  assert.strictEqual(cards[0].id, "writing")
  assert.strictEqual(cards[0].here, true)
  assert.strictEqual(cards[0].tiles[0].label, "Zed · charcana")
  assert.strictEqual(cards.filter((c) => c.kind === "new")[0].name, "+ new desk")
  const filtered = model.pickerCards(model.demoDesks(), "ca")
  assert.strictEqual(filtered[0].name, "Call")
  assert.strictEqual(filtered[0].dnd, true)
  assert.ok(!filtered.filter((c) => c.kind === "new").length)
  const now = Date.parse("2026-08-19T16:40:00Z")
  assert.strictEqual(model.formatDeskMeta({ updatedAt: "2026-08-19T16:40:00Z" }, now), "now")
  assert.ok(model.formatDeskMeta({ updatedAt: "2026-08-19T13:40:00Z" }, now).indexOf("ago") >= 0)
  assert.strictEqual(model.formatDeskMeta({ updatedAt: "2026-08-18T16:40:00Z" }, now), "yesterday")
  assert.strictEqual(
    model.desksPath("/home/hallas"),
    "/home/hallas/.config/omarchy/omadesk/desks.json"
  )
  const merged = model.setExtras(model.demoDesks(), "writing", { dnd: "off", theme: "dusk" })
  const writing = merged.desks.filter((d) => d.id === "writing")[0]
  assert.strictEqual(writing.extras.dnd, "off")
  assert.ok(!writing.extras.theme)
  const saved = model.saveDesk(model.emptyState(), model.snapshotRecipe(
    model.parseStage(clientsText, workspacesText),
    "Writing",
    model.defaultExtras(),
    3,
    "2026-08-19T16:40:00Z"
  ))
  assert.strictEqual(saved.currentId, "writing")
  assert.strictEqual(saved.desks.length, 1)
  assert.strictEqual(model.moveCursor(0, 4, 1, 0, 2), 1)
  assert.strictEqual(model.moveCursor(0, 4, 0, 1, 2), 2)
  assert.strictEqual(model.jumpCursor(2, 4, 1), 0)
  const emptyRead = model.readDesks("")
  assert.ok(isArray(emptyRead.desks))
  const switched = model.parkPlan(model.parseStage(clientsText, workspacesText), "writing", "call")
  assert.strictEqual(switched.sequential, true)
  assert.ok(switched.park.dispatches.length)
  assert.ok(switched.restore.dispatches.length)
})

function isArray(value) {
  return Array.isArray(value)
}

assert.strictEqual(tests, 21)
console.log("ok")
