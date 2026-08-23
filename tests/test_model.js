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
    'hl.dsp.window.move({ workspace = "special:omadesk-writing-1", follow = false, window = "address:0x55f11fe15110" })'
  )
  const zed = plan.dispatches.filter((d) => d.indexOf("0x55f11fe15110") >= 0)[0]
  const ghost = plan.dispatches.filter((d) => d.indexOf("0x55f11fe15220") >= 0)[0]
  const chrome = plan.dispatches.filter((d) => d.indexOf("0x55f11fe15330") >= 0)[0]
  assert.ok(zed.indexOf('workspace = "special:omadesk-writing-1"') >= 0)
  assert.ok(ghost.indexOf('workspace = "special:omadesk-writing-2"') >= 0)
  assert.ok(chrome.indexOf('workspace = "special:omadesk-writing-3"') >= 0)
  plan.dispatches.forEach((lua) => {
    assert.ok(lua.indexOf("hl.dsp.window.move({") === 0)
    assert.ok(lua.indexOf("follow = false") >= 0)
    assert.ok(lua.indexOf("special:omadesk-writing-") >= 0)
    assert.ok(lua.indexOf('window = "address:0x') >= 0)
    assert.ok(lua.indexOf("movetoworkspacesilent") === -1)
  })
  assert.ok(plan.batch.indexOf("dispatch ") === 0)
  assert.ok(plan.batch.indexOf("; dispatch ") >= 0)
  assert.strictEqual(
    model.moveDispatch("special:omadesk-writing-1", "0xABC"),
    'hl.dsp.window.move({ workspace = "special:omadesk-writing-1", follow = false, window = "address:0xABC" })'
  )
  assert.strictEqual(
    model.focusDispatch("3"),
    'hl.dsp.focus({ workspace = "3" })'
  )
  assert.strictEqual(model.parkLotName("writing", 1), "omadesk-writing-1")
  assert.strictEqual(model.parkSelector("writing", 1), "special:omadesk-writing-1")
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
    assert.ok(lua.indexOf("special:omadesk-writing-") >= 0)
  })
  plan.restore.dispatches.forEach((lua) => {
    assert.ok(lua.indexOf("omadesk-") === -1)
    assert.ok(/workspace = "[12]"/.test(lua))
  })
  const unnamed = model.switchPlan(stage, clientsText, "unnamed", "call")
  unnamed.park.dispatches.forEach((lua) => {
    assert.ok(lua.indexOf("special:omadesk-unnamed-") >= 0)
  })
})

test("11b freshPlan parks current and restores nothing", function() {
  const stage = model.parseStage(clientsText, workspacesText)
  const plan = model.freshPlan(stage, "writing")
  assert.strictEqual(plan.fresh, true)
  assert.strictEqual(plan.sequential, true)
  assert.ok(plan.park.dispatches.length >= 3)
  plan.park.dispatches.forEach((lua) => {
    assert.ok(lua.indexOf("special:omadesk-writing-") >= 0)
  })
  same(plan.restore.dispatches, [])
  assert.strictEqual(plan.restore.batch, "")
  assert.strictEqual(plan.lastWorkspace, 1)
  const empty = model.freshPlan({ workspaces: [], windows: [], lastWorkspace: null }, "writing")
  same(empty.park.dispatches, [])
  const left = model.leaveDesk(model.demoDesks())
  assert.strictEqual(left.currentId, null)
  assert.strictEqual(left.desks.length, 3)
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

test("17 default extras launchMissing true, dnd leave, theme leave", function() {
  const extras = model.defaultExtras()
  assert.strictEqual(extras.launchMissing, true)
  assert.strictEqual(extras.dnd, "leave")
  assert.strictEqual(extras.theme, "leave")
  assert.strictEqual(model.dndAction(extras), null)
  assert.strictEqual(model.dndAction({ dnd: "on" }), "on")
  assert.strictEqual(model.dndAction({ dnd: "off" }), "off")
  assert.strictEqual(model.themeAction(extras), null)
  assert.strictEqual(model.themeAction({ theme: "leave" }), null)
  assert.strictEqual(model.themeAction({ theme: "Dazzle Dusk" }), "Dazzle Dusk")
  same(model.parseThemeList("Aether\nCatppuccin\nDazzle Dusk\n\nTokyo Night\n"), [
    "Aether",
    "Catppuccin",
    "Dazzle Dusk",
    "Tokyo Night"
  ])
  same(model.parseThemeList("Usage: omarchy theme list\nAether\nAether\n"), ["Aether"])
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
  assert.strictEqual(model.sanitizeSlug("omadesk-Writing"), "writing")
  assert.strictEqual(model.parkLotName("omadesk-call", 2), "omadesk-call-2")
})

test("20 extras helpers, cards, currentSlug, guessExec", function() {
  assert.strictEqual(model.currentSlug({ currentId: null }), "unnamed")
  assert.strictEqual(model.currentSlug(model.demoDesks()), "writing")
  same(model.guessExec({ class: "dev.zed.Zed" }), ["zed"])
  same(model.guessExec({ class: "Zed" }), ["zed"])
  same(model.guessExec({ class: "com.mitchellh.ghostty" }), ["ghostty"])
  same(model.guessExec({ class: "chromium" }), ["chromium", "--new-window"])
  same(model.guessExec({ class: "GeForceNOW" }), ["gtk-launch", "com.nvidia.geforcenow.desktop"])
  same(
    model.guessExec({ class: "chrome-x.com__-Profile_1" }),
    ["chromium", "--profile-directory=Profile 1", "--app=https://x.com"]
  )
  same(model.guessExec({ class: "chrome-x.com__-Profile_1" }).indexOf("com__-profile_1"), -1)
  same(model.guessExec({ class: "mpv" }), ["mpv"])
  assert.strictEqual(model.guessExec({ class: "chrome-x.com__-Profile_1", exec: ["com__-profile_1"] }).join(" "),
    "chromium --profile-directory=Profile 1 --app=https://x.com")
  same(
    model.resolveExec({ class: "GeForceNOW", exec: ["geforcenow"] }),
    ["gtk-launch", "com.nvidia.geforcenow.desktop"]
  )
  const missing = model.launchMissingPlan({
    extras: model.defaultExtras(),
    workspaces: [{
      n: 2,
      windows: [{ class: "chrome-x.com__-Profile_1", title: "X", exec: ["com__-profile_1"] }]
    }]
  }, "[]")
  same(missing.launches[0].exec, ["chromium", "--profile-directory=Profile 1", "--app=https://x.com"])
  const cards = model.pickerCards(model.demoDesks(), "")
  assert.strictEqual(cards[0].kind, "desk")
  assert.strictEqual(cards[0].id, "writing")
  assert.strictEqual(cards[0].here, true)
  assert.strictEqual(cards[0].tiles[0].label, "Zed · charcana")
  assert.strictEqual(cards.filter((c) => c.kind === "new").length, 0)
  const filtered = model.pickerCards(model.demoDesks(), "ca")
  assert.strictEqual(filtered[0].name, "Call")
  assert.strictEqual(filtered[0].dnd, true)
  assert.strictEqual(filtered.filter((c) => c.kind === "new").length, 0)
  const now = Date.parse("2026-08-19T16:40:00Z")
  assert.strictEqual(model.formatDeskMeta({ updatedAt: "2026-08-19T16:40:00Z" }, now), "Now")
  assert.ok(model.formatDeskMeta({ updatedAt: "2026-08-19T13:40:00Z" }, now).indexOf("Ago") >= 0)
  assert.strictEqual(model.formatDeskMeta({ updatedAt: "2026-08-18T16:40:00Z" }, now), "Yesterday")
  assert.strictEqual(
    model.desksPath("/home/hallas"),
    "/home/hallas/.config/omarchy/omadesk/desks.json"
  )
  const merged = model.setExtras(model.demoDesks(), "writing", { dnd: "off", theme: "Dazzle Dusk" })
  const writing = merged.desks.filter((d) => d.id === "writing")[0]
  assert.strictEqual(writing.extras.dnd, "off")
  assert.strictEqual(writing.extras.theme, "Dazzle Dusk")
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

test("21 launchMissing after restore, not the pre-park other desk", function() {
  const desk = {
    extras: model.defaultExtras(),
    workspaces: [{
      n: 1,
      windows: [{ class: "chromium", title: "Meet", exec: ["chromium", "--new-window"] }]
    }]
  }
  const otherDeskOnStage = {
    windows: [{ address: "0xAAA", class: "chromium", title: "draft", workspace: 1 }],
    parked: []
  }
  const skipped = model.launchMissingPlan(desk, otherDeskOnStage).launches
  assert.strictEqual(skipped.length, 0)
  const postRestoreMissing = { windows: [], parked: [] }
  const launched = model.launchMissingPlan(desk, postRestoreMissing).launches
  assert.strictEqual(launched.length, 1)
  same(launched[0].exec, ["chromium", "--new-window"])
  const postRestorePresent = {
    windows: [{ address: "0xBBB", class: "chromium", title: "Meet", workspace: 1 }],
    parked: []
  }
  same(model.launchMissingPlan(desk, postRestorePresent).launches, [])
})

test("22 forgetRestorePlan moves parked windows onto 1-10", function() {
  const plan = model.forgetRestorePlan(clientsText, { id: "call", name: "Call" })
  assert.strictEqual(plan.dispatches.length, 2)
  plan.dispatches.forEach((lua) => {
    assert.ok(/workspace = "[12]"/.test(lua))
    assert.ok(lua.indexOf("omadesk-") === -1)
    assert.ok(lua.indexOf("scratchpad") === -1)
  })
  const empty = model.forgetRestorePlan("[]", { id: "review" })
  same(empty.dispatches, [])
  const gone = model.forgetDesk(model.demoDesks(), "call")
  assert.strictEqual(gone.desks.filter((d) => d.id === "call").length, 0)
})

test("23 unsaved card and +new parks to unnamed lots", function() {
  const named = model.demoDesks()
  const without = model.pickerCards(named, "")
  assert.strictEqual(without.filter((c) => c.kind === "unsaved").length, 0)
  const left = model.leaveDesk(named)
  const cards = model.pickerCards(left, "")
  assert.strictEqual(cards[0].kind, "unsaved")
  assert.strictEqual(cards[0].name, "Unsaved")
  assert.strictEqual(cards[0].here, true)
  assert.strictEqual(cards[0].meta, "This Room Is Not Saved")
  assert.strictEqual(cards.filter((c) => c.kind === "new").length, 0)
  const parkedUnnamed = {
    windows: [],
    parked: [{
      slug: "unnamed",
      n: 1,
      address: "0x111",
      class: "dev.zed.Zed",
      title: "scratch"
    }]
  }
  const parkedCards = model.pickerCards(named, "", parkedUnnamed)
  assert.strictEqual(parkedCards[0].kind, "unsaved")
  assert.strictEqual(parkedCards[0].here, false)
  assert.strictEqual(parkedCards[0].meta, "Parked Untitled Room")
  assert.ok(parkedCards[0].tiles[0].label.indexOf("Zed") >= 0)
  const filtered = model.pickerCards(left, "ca")
  assert.strictEqual(filtered.filter((c) => c.kind === "unsaved").length, 0)
  const stage = model.parseStage(clientsText, workspacesText)
  const fresh = model.freshPlan(stage, "unnamed")
  fresh.park.dispatches.forEach((lua) => {
    assert.ok(lua.indexOf("special:omadesk-unnamed-") >= 0)
  })
})

test("24 broader exec guesses and gtk-launch desktop ids", function() {
  same(model.guessExec({ class: "org.gnome.Nautilus" }), ["gtk-launch", "org.gnome.Nautilus.desktop"])
  same(model.guessExec({ class: "org.mozilla.firefox" }), ["gtk-launch", "org.mozilla.firefox.desktop"])
  same(model.guessExec({ class: "com.obsproject.Studio" }), ["gtk-launch", "com.obsproject.Studio.desktop"])
  same(model.guessExec({ class: "firefox" }), ["firefox"])
  same(model.guessExec({ class: "steam" }), ["steam"])
  same(model.guessExec({ class: "cursor" }), ["cursor"])
  same(
    model.resolveExec({ class: "org.gnome.Nautilus", exec: ["nautilus"] }),
    ["gtk-launch", "org.gnome.Nautilus.desktop"]
  )
  assert.ok(model.isDesktopIdClass("org.gnome.Nautilus"))
  assert.ok(!model.isDesktopIdClass("chromium"))
  assert.strictEqual(model.prettyApp({ class: "chrome-x.com__-Profile_1" }), "x.com")
  assert.strictEqual(model.prettyApp({ class: "GeForceNOW" }), "GeForce NOW")
  assert.strictEqual(model.prettyApp({ class: "dev.zed.Zed" }), "Zed")
})

test("25 last used follows switch, not last save; here is now", function() {
  const saved = Date.parse("2026-08-20T21:58:28.528Z")
  const used = Date.parse("2026-08-20T22:23:29.759Z")
  const now = Date.parse("2026-08-20T22:24:12.680Z")
  assert.strictEqual(
    model.formatDeskMeta({ updatedAt: "2026-08-20T21:58:28.528Z" }, now),
    "25 Minutes Ago"
  )
  assert.strictEqual(
    model.formatDeskMeta({ updatedAt: "2026-08-20T21:58:28.528Z", lastUsed: used }, now),
    "Now"
  )
  assert.strictEqual(
    model.formatDeskMeta({ updatedAt: "2026-08-20T21:58:28.528Z", lastUsed: saved }, now),
    "25 Minutes Ago"
  )
  assert.strictEqual(
    model.formatDeskMeta({ updatedAt: "2026-08-20T21:58:28.528Z", lastUsed: saved }, now, true),
    "Now"
  )
  const demo = model.demoDesks()
  const cards = model.pickerCards(demo, "")
  const writing = cards.filter((c) => c.id === "writing")[0]
  assert.ok(writing.meta.indexOf("Last Used Now") >= 0)
  const switched = model.useDesk(demo, "call", used)
  assert.strictEqual(switched.currentId, "call")
  const call = switched.desks.filter((d) => d.id === "call")[0]
  const writingAfter = switched.desks.filter((d) => d.id === "writing")[0]
  assert.strictEqual(call.lastUsed, used)
  assert.strictEqual(writingAfter.lastUsed, used)
  const later = used + 10 * 60000
  const afterCards = model.pickerCards(switched, "", null, later)
  assert.ok(afterCards.filter((c) => c.id === "call")[0].meta.indexOf("Last Used Now") >= 0)
  assert.ok(afterCards.filter((c) => c.id === "writing")[0].meta.indexOf("10 Minutes Ago") >= 0)
  const left = model.leaveDesk(switched, used + 120000)
  assert.strictEqual(left.currentId, null)
  assert.strictEqual(left.desks.filter((d) => d.id === "call")[0].lastUsed, used + 120000)
})

test("26 tiles only include workspaces that have windows", function() {
  const writing = model.demoDesks().desks[0]
  const tiles = model.deskTiles(writing)
  assert.strictEqual(tiles.length, 3)
  assert.strictEqual(tiles[0].label, "Zed · charcana")
  tiles.forEach((t) => { assert.strictEqual(t.vacant, false) })
  const wide = {
    workspaces: [
      { n: 1, windows: [{ class: "dev.zed.Zed", title: "a" }] },
      { n: 7, windows: [{ class: "chromium", title: "b" }] }
    ]
  }
  const grown = model.deskTiles(wide)
  assert.strictEqual(grown.length, 2)
  assert.strictEqual(grown[0].n, 1)
  assert.strictEqual(grown[1].n, 7)
  const many = {
    windows: [
      { class: "com.mitchellh.ghostty", title: "one", workspace: 2 },
      { class: "chromium", title: "two", workspace: 2 },
      { class: "com.mitchellh.ghostty", title: "three", workspace: 2 }
    ]
  }
  const stacked = model.deskTiles(many)
  assert.strictEqual(stacked.length, 1)
  assert.strictEqual(stacked[0].n, 2)
  assert.ok(stacked[0].label.indexOf("Ghostty") >= 0)
  assert.ok(stacked[0].label.indexOf("Chromium") >= 0)
})

test("27 live vs dead, closePlan, wakePlan parks in the background", function() {
  const demo = model.demoDesks()
  const stage = model.parseStage(clientsText, workspacesText)
  assert.strictEqual(model.deskLife(demo.desks[0], stage, "writing"), "live")
  assert.strictEqual(model.deskLife(demo.desks.filter((d) => d.id === "review")[0], stage, "writing"), "dead")
  const cards = model.pickerCards(demo, "", stage)
  assert.strictEqual(cards.filter((c) => c.id === "writing")[0].life, "live")
  assert.strictEqual(cards.filter((c) => c.id === "review")[0].life, "dead")
  const closeHere = model.closePlan(demo.desks[0], stage, "writing")
  assert.ok(closeHere.dispatches.length >= 3)
  closeHere.dispatches.forEach((lua) => {
    assert.ok(lua.indexOf("hl.dsp.window.close({") === 0)
    assert.ok(lua.indexOf("window = \"address:0x") >= 0)
    assert.ok(lua.indexOf("scratchpad") === -1)
  })
  const closeCall = model.closePlan(demo.desks.filter((d) => d.id === "call")[0], stage, "writing")
  assert.ok(closeCall.dispatches.length >= 1)
  closeCall.dispatches.forEach((lua) => {
    assert.ok(lua.indexOf("0x55f11fe15aaa") === -1)
  })
  const wakeReview = model.wakePlan(demo.desks.filter((d) => d.id === "review")[0], stage, "writing")
  assert.ok(wakeReview.launches.length >= 1)
  wakeReview.launches.forEach((item) => {
    assert.ok(String(item.workspace).indexOf("special:omadesk-review-") === 0)
  })
  const wakeHere = model.wakePlan({
    id: "writing",
    extras: model.defaultExtras(),
    workspaces: [{ n: 8, windows: [{ class: "mpv", exec: ["mpv"] }] }]
  }, stage, "writing")
  assert.strictEqual(wakeHere.launches[0].n, 8)
  assert.strictEqual(wakeHere.launches[0].workspace, "8")
  assert.strictEqual(
    model.closeDispatch("0xABC"),
    'hl.dsp.window.close({ window = "address:0xABC" })'
  )
})

test("28 restore puts workspaces back on their monitors", function() {
  const monitors = [
    { name: "DP-1", focused: true, disabled: false, activeWorkspace: { id: 1, name: "1" } },
    { name: "HDMI-A-1", focused: false, disabled: false, activeWorkspace: { id: 4, name: "4" } }
  ]
  const stage = model.parseStage(clientsText, workspacesText, JSON.stringify(monitors))
  assert.strictEqual(stage.layout.length, 2)
  assert.strictEqual(stage.layout[0].n, 1)
  assert.strictEqual(stage.layout[0].monitor, "DP-1")
  assert.strictEqual(stage.layout[0].focused, true)
  assert.strictEqual(stage.layout[1].n, 4)
  assert.strictEqual(stage.layout[1].monitor, "HDMI-A-1")
  assert.ok(stage.monitors.indexOf("HDMI-A-1") >= 0)
  assert.strictEqual(stage.lastWorkspace, 1)
  const recipe = model.snapshotRecipe(stage, "Dual", model.defaultExtras(), stage.lastWorkspace, "2026-08-20T22:00:00Z")
  assert.strictEqual(recipe.layout.length, 2)
  assert.strictEqual(recipe.workspaces.filter((w) => w.n === 1)[0].monitor, "DP-1")
  const desk = {
    id: "dual",
    name: "Dual",
    layout: [
      { n: 1, monitor: "DP-1", focused: true },
      { n: 4, monitor: "HDMI-A-1" }
    ],
    workspaces: [
      { n: 1, monitor: "DP-1", windows: [{ class: "dev.zed.Zed", address: "0x1" }] },
      { n: 4, monitor: "HDMI-A-1", windows: [{ class: "chromium", address: "0x4" }] }
    ]
  }
  const parked = {
    parked: [
      { slug: "dual", n: 1, address: "0x1" },
      { slug: "dual", n: 4, address: "0x4" }
    ],
    monitors: ["DP-1", "HDMI-A-1"]
  }
  const plan = model.restorePlan(parked, "dual", desk)
  const moves = plan.dispatches.filter((d) => d.indexOf("window.move") >= 0)
  const layouts = plan.dispatches.filter((d) => d.indexOf("workspace.move") >= 0)
  assert.strictEqual(moves.length, 2)
  assert.strictEqual(layouts.length, 2)
  assert.ok(layouts[0].indexOf('workspace = "1"') >= 0 && layouts[0].indexOf('monitor = "DP-1"') >= 0)
  assert.ok(layouts[1].indexOf('workspace = "4"') >= 0 && layouts[1].indexOf('monitor = "HDMI-A-1"') >= 0)
  const oneScreen = model.restorePlan({ parked: parked.parked, monitors: ["DP-1"] }, "dual", desk)
  const oneLayout = oneScreen.dispatches.filter((d) => d.indexOf("workspace.move") >= 0)
  assert.strictEqual(oneLayout.length, 1)
  assert.ok(oneLayout[0].indexOf("HDMI") === -1)
  assert.strictEqual(
    model.workspaceMoveDispatch("4", "HDMI-A-1"),
    'hl.dsp.workspace.move({ workspace = "4", monitor = "HDMI-A-1" })'
  )
  const cards = model.pickerCards({ version: 1, currentId: "dual", desks: [desk] }, "")
  assert.ok(cards[0].meta.indexOf("2 Screens") >= 0)
  const woke = model.wakePlan(desk, { windows: [], parked: [], monitors: ["DP-1", "HDMI-A-1"] }, "writing")
  const onHdmi = woke.launches.filter((item) => String(item.workspace).indexOf("omadesk-dual-4") >= 0)[0]
  assert.ok(onHdmi)
  assert.strictEqual(onHdmi.monitor, "HDMI-A-1")
})

test("29 forgetRestorePlan unparks only that desk onto 1-10, never layout", function() {
  const dualClients = JSON.stringify([
    {
      address: "0xdual01",
      class: "dev.zed.Zed",
      workspace: { id: -80, name: "special:omadesk-dual-1" }
    },
    {
      address: "0xdual04",
      class: "chromium",
      workspace: { id: -81, name: "name:omadesk-dual-4" }
    },
    {
      address: "0xscratch",
      class: "foot",
      workspace: { id: -98, name: "special:scratchpad" }
    },
    {
      address: "0xwriting",
      class: "firefox",
      workspace: { id: -82, name: "special:omadesk-writing-1" }
    }
  ])
  const dualDesk = {
    id: "dual",
    name: "Dual",
    layout: [
      { n: 1, monitor: "DP-1", focused: true },
      { n: 4, monitor: "HDMI-A-1" }
    ],
    workspaces: [
      { n: 1, monitor: "DP-1", windows: [{ class: "dev.zed.Zed", address: "0xdual01" }] },
      { n: 4, monitor: "HDMI-A-1", windows: [{ class: "chromium", address: "0xdual04" }] }
    ]
  }
  const plan = model.forgetRestorePlan(dualClients, dualDesk)
  const moves = plan.dispatches.filter((d) => d.indexOf("window.move") >= 0)
  const layouts = plan.dispatches.filter((d) => d.indexOf("workspace.move") >= 0)
  assert.strictEqual(moves.length, 2)
  assert.strictEqual(layouts.length, 0)
  assert.ok(!plan.layout || plan.layout.length === 0)
  const one = moves.filter((d) => d.indexOf("0xdual01") >= 0)[0]
  const four = moves.filter((d) => d.indexOf("0xdual04") >= 0)[0]
  assert.ok(one.indexOf('workspace = "1"') >= 0)
  assert.ok(four.indexOf('workspace = "4"') >= 0)
  plan.dispatches.forEach((lua) => {
    assert.ok(lua.indexOf("scratchpad") === -1)
    assert.ok(lua.indexOf("0xscratch") === -1)
    assert.ok(lua.indexOf("0xwriting") === -1)
    assert.ok(/workspace = "(?:[1-9]|10)"/.test(lua))
    assert.ok(lua.indexOf("hl.dsp.window.move({") === 0)
  })
  const blob = JSON.stringify(plan)
  assert.ok(blob.indexOf("scratchpad") === -1)
  assert.ok(blob.indexOf("workspace.move") === -1)
  const switched = model.parkPlan(
    { parked: [], windows: [], monitors: ["DP-1", "HDMI-A-1"] },
    "writing",
    "dual",
    dualDesk
  )
  const switchLayouts = switched.restore.dispatches.filter((d) => d.indexOf("workspace.move") >= 0)
  assert.strictEqual(switchLayouts.length, 2)
  const oneScreen = model.restorePlan(
    { parked: [{ slug: "dual", n: 1, address: "0xdual01" }, { slug: "dual", n: 4, address: "0xdual04" }], monitors: ["DP-1"] },
    "dual",
    dualDesk
  )
  const oneLayout = oneScreen.dispatches.filter((d) => d.indexOf("workspace.move") >= 0)
  assert.strictEqual(oneLayout.length, 1)
  assert.ok(oneLayout[0].indexOf("HDMI") === -1)
  assert.ok(oneLayout[0].indexOf('monitor = "DP-1"') >= 0)
})

test("30 targetedNamedDesk only resolves a desk card", function() {
  const state = model.demoDesks()
  const writing = state.desks.filter((d) => d.id === "writing")[0]
  const fromDesk = model.targetedNamedDesk({ kind: "desk", id: "writing", desk: writing }, state)
  assert.strictEqual(fromDesk.id, "writing")
  assert.strictEqual(fromDesk.name, "Writing")
  assert.strictEqual(model.targetedNamedDesk({ kind: "new", name: "+ New Desk" }, state), null)
  assert.strictEqual(model.targetedNamedDesk({ kind: "unsaved", name: "Unsaved" }, state), null)
  assert.strictEqual(model.targetedNamedDesk({ kind: "new", id: "writing" }, state), null)
  assert.strictEqual(model.targetedNamedDesk({ kind: "unsaved", id: state.currentId }, state), null)
  assert.strictEqual(model.targetedNamedDesk(null, state), null)
  assert.strictEqual(model.targetedNamedDesk({ kind: "desk", id: "missing" }, state), null)
})

test("31 persist switch after restore even if focus fails", function() {
  assert.strictEqual(model.shouldPersistSwitch(true, false), true)
  assert.strictEqual(model.shouldPersistSwitch(true, true), true)
  assert.strictEqual(model.shouldPersistSwitch(false, true), false)
  assert.strictEqual(model.shouldPersistSwitch(false, false), false)
  const used = Date.parse("2026-08-20T22:00:00Z")
  const next = model.useDesk(model.demoDesks(), "call", used)
  assert.strictEqual(next.currentId, "call")
  assert.strictEqual(next.desks.filter((d) => d.id === "call")[0].lastUsed, used)
})

test("32 dispatch quoting rejects quotes and newlines", function() {
  assert.strictEqual(model.moveDispatch("1", '0x"evil'), "")
  assert.strictEqual(model.moveDispatch("1", "0x\nABC"), "")
  assert.strictEqual(model.moveDispatch('ws"x', "0xABC"), "")
  assert.strictEqual(model.closeDispatch("0x\rABC"), "")
  assert.strictEqual(model.focusDispatch('3"'), "")
  assert.strictEqual(model.safeMonitor('DP-"1'), "")
  assert.strictEqual(model.safeMonitor("HDMI-A-1\n"), "")
  assert.strictEqual(model.workspaceMoveDispatch("1", 'HDMI"A'), "")
  const stage = {
    windows: [{ address: '0x"bad', workspace: 1, class: "foot" }],
    workspaces: [{ n: 1, windows: [{ address: '0x"bad', class: "foot" }] }]
  }
  same(model.parkPlan(stage, "writing").dispatches, [])
  same(model.closePlan({ id: "writing" }, stage, "writing").dispatches, [])
  assert.strictEqual(
    model.moveDispatch("special:omadesk-writing-1", "0xABC"),
    'hl.dsp.window.move({ workspace = "special:omadesk-writing-1", follow = false, window = "address:0xABC" })'
  )
})

test("33 parseParkedLot special: and name: lots; scratchpad stays out", function() {
  const special = model.parseParkedLot({ workspace: { id: -83, name: "special:omadesk-call-1" } })
  assert.strictEqual(special.slug, "call")
  assert.strictEqual(special.n, 1)
  const named = model.parseParkedLot({ workspace: { id: 13, name: "name:omadesk-call-2" } })
  assert.strictEqual(named.slug, "call")
  assert.strictEqual(named.n, 2)
  const bare = model.parseParkedLot({ workspace: { id: 11, name: "omadesk-writing-1" } })
  assert.strictEqual(bare.slug, "writing")
  assert.strictEqual(bare.n, 1)
  const hyphen = model.parseParkedLot({ workspace: { name: "special:omadesk-my-desk-3" } })
  assert.strictEqual(hyphen.slug, "my-desk")
  assert.strictEqual(hyphen.n, 3)
  const asString = model.parseParkedLot({ workspace: "special:omadesk-call-1" })
  assert.strictEqual(asString.slug, "call")
  assert.strictEqual(asString.n, 1)
  assert.strictEqual(model.parseParkedLot({ workspace: { name: "special:scratchpad" } }), null)
  assert.strictEqual(model.parseParkedLot({ workspace: { name: "scratchpad" } }), null)
  const stage = model.parseStage(clientsText, workspacesText)
  const lots = stage.parked.map((p) => p.slug + ":" + p.n).sort()
  same(lots, ["call:1", "call:2", "writing:1"])
  stage.parked.forEach((p) => {
    assert.ok(p.n >= 1 && p.n <= 10)
    assert.ok(p.address)
  })
  assert.strictEqual(stage.parked.filter((p) => p.address === "0x55f11fe15aaa").length, 0)
})

test("34 empty and invalid parseStage yield an empty stage", function() {
  const empty = model.parseStage("", "")
  same(empty.windows, [])
  same(empty.parked, [])
  same(empty.workspaces, [])
  const bad = model.parseStage("{", "not-json")
  same(bad.windows, [])
  same(bad.parked, [])
  const arr = model.readDesks("[]")
  assert.strictEqual(arr.ok, false)
  assert.ok(/invalid JSON/i.test(arr.error))
  const obj = model.readDesks("{}")
  assert.strictEqual(obj.ok, false)
})

test("35 saveDesk uniquifies a second desk with the same display name", function() {
  const stage = model.parseStage(clientsText, workspacesText)
  const extras = model.defaultExtras()
  const firstRecipe = model.snapshotRecipe(stage, "Writing", extras, 3, "2026-08-20T22:00:00Z")
  const first = model.saveDesk(model.emptyState(), firstRecipe)
  assert.strictEqual(first.desks.length, 1)
  const firstId = first.desks[0].id
  assert.ok(firstId)
  const secondRecipe = model.snapshotRecipe(stage, "Writing", extras, 3, "2026-08-20T22:01:00Z")
  const second = model.saveDesk(first, secondRecipe)
  assert.strictEqual(second.desks.length, 2)
  assert.strictEqual(second.desks[0].id, firstId)
  assert.strictEqual(second.desks[0].name, "Writing")
  assert.strictEqual(second.desks[1].name, "Writing")
  assert.ok(second.desks[1].id)
  assert.ok(second.desks[0].id !== second.desks[1].id)
  assert.strictEqual(second.currentId, second.desks[1].id)
  const again = model.saveDesk(first, firstRecipe)
  assert.strictEqual(again.desks[0].id, firstId)
  assert.ok(again.desks[1].id !== firstId)
})

test("36 empty connected monitors emit no workspace.move; missing display still skipped", function() {
  const dualDesk = {
    id: "dual",
    name: "Dual",
    layout: [
      { n: 1, monitor: "DP-1", focused: true },
      { n: 4, monitor: "HDMI-A-1" }
    ],
    workspaces: [
      { n: 1, monitor: "DP-1", windows: [{ class: "dev.zed.Zed", address: "0xdual01" }] },
      { n: 4, monitor: "HDMI-A-1", windows: [{ class: "chromium", address: "0xdual04" }] }
    ]
  }
  const parked = {
    parked: [
      { slug: "dual", n: 1, address: "0xdual01" },
      { slug: "dual", n: 4, address: "0xdual04" }
    ],
    monitors: []
  }
  const emptyConn = model.restorePlan(parked, "dual", dualDesk)
  const emptyLayouts = emptyConn.dispatches.filter((d) => d.indexOf("workspace.move") >= 0)
  assert.strictEqual(emptyLayouts.length, 0)
  const switched = model.parkPlan(
    { parked: parked.parked, windows: [], monitors: [] },
    "writing",
    "dual",
    dualDesk
  )
  const switchLayouts = switched.restore.dispatches.filter((d) => d.indexOf("workspace.move") >= 0)
  assert.strictEqual(switchLayouts.length, 0)
  const oneScreen = model.restorePlan({ parked: parked.parked, monitors: ["DP-1"] }, "dual", dualDesk)
  const oneLayout = oneScreen.dispatches.filter((d) => d.indexOf("workspace.move") >= 0)
  assert.strictEqual(oneLayout.length, 1)
  assert.ok(oneLayout[0].indexOf("HDMI") === -1)
  assert.ok(oneLayout[0].indexOf('monitor = "DP-1"') >= 0)
  emptyConn.dispatches.forEach((lua) => {
    assert.ok(lua.indexOf("scratchpad") === -1)
  })
})

test("37 unnamed close skips named lots and scratchpad; wake still parks in the background", function() {
  const stage = model.parseStage(clientsText, workspacesText)
  stage.parked = (stage.parked || []).concat([{
    slug: "unnamed",
    n: 1,
    address: "0xunnamed01",
    class: "foot",
    title: "scratch file"
  }])
  const unsaved = { id: "unnamed", name: "Unsaved" }
  const closeParked = model.closePlan(unsaved, stage, "writing")
  const parkedAddrs = closeParked.dispatches.join(" ")
  assert.ok(parkedAddrs.indexOf("0xunnamed01") >= 0)
  assert.ok(parkedAddrs.indexOf("0x55f11fe15110") === -1)
  assert.ok(parkedAddrs.indexOf("0x55f11fe15bbb") === -1)
  assert.ok(parkedAddrs.indexOf("0x55f11fe15ccc") === -1)
  assert.ok(parkedAddrs.indexOf("0x55f11fe15aaa") === -1)
  assert.ok(parkedAddrs.indexOf("scratchpad") === -1)
  closeParked.dispatches.forEach((lua) => {
    assert.ok(lua.indexOf("hl.dsp.window.close({") === 0)
  })
  const closeHere = model.closePlan(unsaved, stage, null)
  const hereAddrs = closeHere.dispatches.join(" ")
  assert.ok(hereAddrs.indexOf("0x55f11fe15110") >= 0)
  assert.ok(hereAddrs.indexOf("0x55f11fe15bbb") === -1)
  assert.ok(hereAddrs.indexOf("0x55f11fe15ccc") === -1)
  assert.ok(hereAddrs.indexOf("0x55f11fe15aaa") === -1)
  assert.ok(hereAddrs.indexOf("scratchpad") === -1)
  const park = model.parkPlan(stage, "unnamed")
  park.dispatches.forEach((lua) => {
    assert.ok(lua.indexOf("scratchpad") === -1)
    assert.ok(lua.indexOf("0x55f11fe15aaa") === -1)
  })
  const review = model.demoDesks().desks.filter((d) => d.id === "review")[0]
  const wake = model.wakePlan(review, stage, "writing")
  assert.ok(wake.launches.length >= 1)
  wake.launches.forEach((item) => {
    assert.ok(String(item.workspace).indexOf("special:omadesk-review-") === 0)
  })
})

test("38 disabled monitors are omitted from layout and connected names", function() {
  const monitors = [
    { name: "DP-1", focused: true, disabled: false, activeWorkspace: { id: 1, name: "1" } },
    { name: "HDMI-A-1", focused: false, disabled: true, activeWorkspace: { id: 4, name: "4" } }
  ]
  const stage = model.parseStage(clientsText, workspacesText, JSON.stringify(monitors))
  assert.ok(stage.monitors.indexOf("DP-1") >= 0)
  assert.ok(stage.monitors.indexOf("HDMI-A-1") === -1)
  stage.layout.forEach((row) => {
    assert.ok(row.monitor !== "HDMI-A-1")
  })
  const desk = {
    id: "dual",
    layout: [
      { n: 1, monitor: "DP-1" },
      { n: 4, monitor: "HDMI-A-1" }
    ]
  }
  const layouts = model.restorePlan({ parked: [], monitors: stage.monitors }, "dual", desk)
    .dispatches.filter((d) => d.indexOf("workspace.move") >= 0)
  assert.strictEqual(layouts.length, 1)
  assert.ok(layouts[0].indexOf("HDMI") === -1)
})

test("39 unknown window class is not launched as a command", function() {
  same(model.guessExec({ class: "TotallyUnknownApp" }), [])
  same(model.resolveExec({ class: "TotallyUnknownApp" }), [])
  same(model.resolveExec({ class: "TotallyUnknownApp", exec: ["TotallyUnknownApp"] }), [])
  const launched = model.launchMissingPlan({
    extras: model.defaultExtras(),
    workspaces: [{ n: 1, windows: [{ class: "TotallyUnknownApp", title: "mystery" }] }]
  }, "[]")
  same(launched.launches, [])
  same(model.guessExec({ class: "mpv" }), ["mpv"])
})

test("40 saved desks never take the unnamed parking id", function() {
  assert.strictEqual(model.uniqueId("unnamed", []), "unnamed-2")
  assert.strictEqual(model.uniqueId("Unnamed", ["writing"]), "unnamed-2")
  assert.strictEqual(model.uniqueId("---", []), "unnamed-2")
  assert.strictEqual(model.uniqueId("unnamed", ["unnamed-2"]), "unnamed-3")
  assert.strictEqual(model.uniqueId("writing", []), "writing")
  const stage = model.parseStage(clientsText, workspacesText)
  const extras = model.defaultExtras()
  const saved = model.saveDesk(model.emptyState(), model.snapshotRecipe(stage, "Unnamed", extras, 3, "2026-08-21T12:00:00Z"))
  const id = saved.desks[0].id
  assert.ok(id)
  assert.notStrictEqual(id, "unnamed")
  assert.strictEqual(saved.currentId, id)
  const park = model.parkPlan(stage, model.currentSlug(saved))
  assert.ok(park.dispatches.length >= 3)
  park.dispatches.forEach((lua) => {
    assert.ok(lua.indexOf("special:omadesk-" + id + "-") >= 0)
    assert.ok(!/workspace = "special:omadesk-unnamed-[0-9]+"/.test(lua))
  })
  const mixed = {
    parked: [
      { slug: "unnamed", n: 1, address: "0xunsaved01", class: "foot" },
      { slug: id, n: 1, address: "0xnamed01", class: "dev.zed.Zed" },
      { slug: id, n: 2, address: "0xnamed02", class: "com.mitchellh.ghostty" }
    ],
    windows: [],
    monitors: ["DP-1"]
  }
  const restore = model.restorePlan(mixed, id, saved.desks[0])
  const restoreAddrs = restore.dispatches.join(" ")
  assert.ok(restoreAddrs.indexOf("0xnamed01") >= 0)
  assert.ok(restoreAddrs.indexOf("0xnamed02") >= 0)
  assert.ok(restoreAddrs.indexOf("0xunsaved01") === -1)
  const forget = model.forgetRestorePlan(mixed, saved.desks[0])
  const forgetAddrs = forget.dispatches.join(" ")
  assert.ok(forgetAddrs.indexOf("0xnamed01") >= 0)
  assert.ok(forgetAddrs.indexOf("0xunsaved01") === -1)
  const closeSaved = model.closePlan(saved.desks[0], mixed, "writing")
  const closeSavedAddrs = closeSaved.dispatches.join(" ")
  assert.ok(closeSavedAddrs.indexOf("0xnamed01") >= 0)
  assert.ok(closeSavedAddrs.indexOf("0xunsaved01") === -1)
  const closeUnsaved = model.closePlan({ id: "unnamed", name: "Unsaved" }, mixed, "writing")
  const closeUnsavedAddrs = closeUnsaved.dispatches.join(" ")
  assert.ok(closeUnsavedAddrs.indexOf("0xunsaved01") >= 0)
  assert.ok(closeUnsavedAddrs.indexOf("0xnamed01") === -1)
  const unsavedCards = model.pickerCards(saved, "", mixed)
  assert.strictEqual(unsavedCards.filter((c) => c.kind === "unsaved").length, 1)
  assert.strictEqual(unsavedCards.filter((c) => c.kind === "desk" && c.id === id).length, 1)
  const fresh = model.freshPlan(stage, "unnamed")
  fresh.park.dispatches.forEach((lua) => {
    assert.ok(/workspace = "special:omadesk-unnamed-[0-9]+"/.test(lua))
    assert.ok(lua.indexOf("omadesk-" + id + "-") === -1)
  })
})

test("41 parkPlan skips scratchpad and never emits NaN lots", function() {
  const stage = {
    windows: [
      { address: "0xzed01", workspace: 1, class: "dev.zed.Zed" },
      { address: "0xscstr", workspace: "special:scratchpad", class: "foot", title: "scratch" },
      { address: "0xscobj", workspace: { id: -98, name: "special:scratchpad" }, class: "foot" },
      { address: "0xspecial", workspace: { id: -99, name: "special" }, class: "foot" },
      { address: "0xnone", class: "mpv" },
      { address: "0xghost", workspace: { id: 2, name: "2" }, class: "com.mitchellh.ghostty" }
    ]
  }
  const plan = model.parkPlan(stage, "writing")
  const blob = plan.dispatches.join(" ")
  assert.ok(blob.indexOf("0xzed01") >= 0)
  assert.ok(blob.indexOf('workspace = "special:omadesk-writing-1"') >= 0)
  assert.ok(blob.indexOf("0xghost") >= 0)
  assert.ok(blob.indexOf('workspace = "special:omadesk-writing-2"') >= 0)
  assert.ok(blob.indexOf("0xscstr") === -1)
  assert.ok(blob.indexOf("0xscobj") === -1)
  assert.ok(blob.indexOf("0xspecial") === -1)
  assert.ok(blob.indexOf("0xnone") === -1)
  plan.dispatches.forEach((lua) => {
    assert.ok(lua.indexOf("NaN") === -1)
    assert.ok(lua.indexOf("scratchpad") === -1)
    assert.ok(/workspace = "special:omadesk-writing-([1-9]|10)"/.test(lua))
  })
  const parsed = model.parkPlan(model.parseStage(clientsText, workspacesText), "writing")
  parsed.dispatches.forEach((lua) => {
    assert.ok(lua.indexOf("0x55f11fe15aaa") === -1)
    assert.ok(lua.indexOf("NaN") === -1)
    assert.ok(lua.indexOf("scratchpad") === -1)
  })
  const unnamed = model.parkPlan(stage, "unnamed")
  unnamed.dispatches.forEach((lua) => {
    assert.ok(lua.indexOf("scratchpad") === -1)
    assert.ok(lua.indexOf("NaN") === -1)
    assert.ok(lua.indexOf("0xscstr") === -1)
  })
})

test("42 restoring unsaved focuses a restored unnamed workspace, not the outgoing last", function() {
  const stage = {
    windows: [{ address: "0xwriting", workspace: 3, class: "dev.zed.Zed" }],
    parked: [
      { slug: "unnamed", n: 2, address: "0xunsaved2", class: "foot" },
      { slug: "unnamed", n: 4, address: "0xunsaved4", class: "com.mitchellh.ghostty" },
      { slug: "writing", n: 1, address: "0xother", class: "chromium" }
    ],
    lastWorkspace: 3
  }
  const plan = model.parkPlan(stage, "writing", "unnamed", null)
  assert.strictEqual(plan.sequential, true)
  const restoreAddrs = plan.restore.dispatches.join(" ")
  assert.ok(restoreAddrs.indexOf("0xunsaved2") >= 0)
  assert.ok(restoreAddrs.indexOf("0xunsaved4") >= 0)
  assert.ok(restoreAddrs.indexOf("0xwriting") === -1)
  assert.ok(restoreAddrs.indexOf("0xother") === -1)
  assert.ok(restoreAddrs.indexOf("scratchpad") === -1)
  assert.strictEqual(plan.lastWorkspace, 2)
  assert.notStrictEqual(plan.lastWorkspace, 3)
  const switched = model.switchPlan(stage, stage, "writing", "unnamed", null)
  assert.strictEqual(switched.lastWorkspace, 2)
  const named = model.parkPlan(stage, "unnamed", "writing", {
    id: "writing",
    lastWorkspace: 3,
    workspaces: []
  })
  assert.strictEqual(named.lastWorkspace, 3)
  const badLast = model.parkPlan(stage, "unnamed", "writing", {
    id: "writing",
    lastWorkspace: 11,
    workspaces: []
  })
  assert.ok(Number(badLast.lastWorkspace) >= 1 && Number(badLast.lastWorkspace) <= 10)
  assert.notStrictEqual(Number(badLast.lastWorkspace), 11)
})

test("43 unnamed close while here also closes leaked unnamed lots, not named or scratchpad", function() {
  const leaked = {
    windows: [],
    parked: [
      { slug: "unnamed", n: 1, address: "0xunsaved01", class: "foot" },
      { slug: "unnamed", n: 2, address: "0xunsaved02", class: "com.mitchellh.ghostty" },
      { slug: "writing", n: 1, address: "0xwriting01", class: "dev.zed.Zed" }
    ]
  }
  const plan = model.closePlan({ id: "unnamed", name: "Unsaved" }, leaked, null)
  const blob = plan.dispatches.join(" ")
  assert.ok(blob.indexOf("0xunsaved01") >= 0)
  assert.ok(blob.indexOf("0xunsaved02") >= 0)
  assert.ok(blob.indexOf("0xwriting01") === -1)
  assert.ok(blob.indexOf("scratchpad") === -1)
  plan.dispatches.forEach((lua) => {
    assert.ok(lua.indexOf("hl.dsp.window.close({") === 0)
  })
  const mixed = model.closePlan({ id: "unnamed", name: "Unsaved" }, {
    windows: [
      { address: "0xhere01", workspace: 1, class: "mpv" },
      { address: "0xsc", workspace: "special:scratchpad", class: "foot" }
    ],
    parked: [
      { slug: "unnamed", n: 3, address: "0xleak01", class: "foot" },
      { slug: "call", n: 1, address: "0xcall01", class: "chromium" }
    ]
  }, null)
  const mixedBlob = mixed.dispatches.join(" ")
  assert.ok(mixedBlob.indexOf("0xhere01") >= 0)
  assert.ok(mixedBlob.indexOf("0xleak01") >= 0)
  assert.ok(mixedBlob.indexOf("0xsc") === -1)
  assert.ok(mixedBlob.indexOf("0xcall01") === -1)
  assert.ok(mixedBlob.indexOf("scratchpad") === -1)
})

test("44 restore moves every occupied workspace onto its monitor, including two on one display", function() {
  const desk = {
    id: "dual",
    name: "Dual",
    layout: [
      { n: 1, monitor: "DP-1", focused: true },
      { n: 4, monitor: "HDMI-A-1" }
    ],
    workspaces: [
      { n: 1, monitor: "DP-1", windows: [{ class: "dev.zed.Zed", address: "0x1" }] },
      { n: 2, monitor: "DP-1", windows: [{ class: "com.mitchellh.ghostty", address: "0x2" }] },
      { n: 4, monitor: "HDMI-A-1", windows: [{ class: "chromium", address: "0x4" }] }
    ]
  }
  const parked = {
    parked: [
      { slug: "dual", n: 1, address: "0x1" },
      { slug: "dual", n: 2, address: "0x2" },
      { slug: "dual", n: 4, address: "0x4" }
    ],
    monitors: ["DP-1", "HDMI-A-1"]
  }
  const plan = model.restorePlan(parked, "dual", desk)
  const layouts = plan.dispatches.filter((d) => d.indexOf("workspace.move") >= 0)
  assert.strictEqual(layouts.length, 3)
  assert.strictEqual(layouts.filter((d) => d.indexOf('workspace = "1"') >= 0 && d.indexOf('monitor = "DP-1"') >= 0).length, 1)
  assert.strictEqual(layouts.filter((d) => d.indexOf('workspace = "2"') >= 0 && d.indexOf('monitor = "DP-1"') >= 0).length, 1)
  assert.strictEqual(layouts.filter((d) => d.indexOf('workspace = "4"') >= 0 && d.indexOf('monitor = "HDMI-A-1"') >= 0).length, 1)
  const oneScreen = model.restorePlan({ parked: parked.parked, monitors: ["DP-1"] }, "dual", desk)
  const oneLayout = oneScreen.dispatches.filter((d) => d.indexOf("workspace.move") >= 0)
  assert.strictEqual(oneLayout.length, 2)
  assert.ok(oneLayout.join(" ").indexOf("HDMI") === -1)
  const emptyConn = model.restorePlan({ parked: parked.parked, monitors: [] }, "dual", desk)
  assert.strictEqual(emptyConn.dispatches.filter((d) => d.indexOf("workspace.move") >= 0).length, 0)
  const switched = model.parkPlan(
    { parked: parked.parked, windows: [], monitors: ["DP-1", "HDMI-A-1"] },
    "writing",
    "dual",
    desk
  )
  assert.strictEqual(switched.restore.dispatches.filter((d) => d.indexOf("workspace.move") >= 0).length, 3)
  emptyConn.dispatches.forEach((lua) => {
    assert.ok(lua.indexOf("scratchpad") === -1)
    assert.ok(lua.indexOf("workspace.move") === -1)
  })
})

test("45 empty here with unnamed lots is a parked unsaved room, not a live empty one", function() {
  const state = {
    version: 1,
    currentId: null,
    desks: [{ id: "writing", name: "Writing", extras: model.defaultExtras(), workspaces: [] }]
  }
  const stage = {
    windows: [],
    parked: [
      { slug: "unnamed", n: 2, address: "0xunsaved01", class: "foot", title: "notes" },
      { slug: "writing", n: 1, address: "0xwriting01", class: "dev.zed.Zed" }
    ]
  }
  const cards = model.pickerCards(state, "", stage)
  const unsaved = cards.filter((c) => c.kind === "unsaved")[0]
  assert.ok(unsaved)
  assert.strictEqual(unsaved.here, false)
  assert.ok(String(unsaved.meta).indexOf("Parked") >= 0)
  const occupied = (unsaved.tiles || []).filter((t) => !t.vacant)
  assert.ok(occupied.length >= 1)
  assert.ok(occupied[0].label.indexOf("foot") >= 0 || occupied[0].label.indexOf("notes") >= 0)
  const restore = model.restorePlan(stage, "unnamed", null)
  const restoreAddrs = restore.dispatches.join(" ")
  assert.ok(restoreAddrs.indexOf("0xunsaved01") >= 0)
  assert.ok(restoreAddrs.indexOf("0xwriting01") === -1)
  assert.ok(restoreAddrs.indexOf("scratchpad") === -1)
  assert.ok(/workspace = "2"/.test(restoreAddrs))
  const stillHere = model.pickerCards(state, "", {
    windows: [{ address: "0xhere01", workspace: 1, class: "mpv" }],
    parked: [{ slug: "unnamed", n: 2, address: "0xunsaved01", class: "foot" }]
  })
  assert.strictEqual(stillHere.filter((c) => c.kind === "unsaved")[0].here, true)
  const named = model.demoDesks()
  const parkedWhileNamed = model.pickerCards(named, "", stage)
  assert.strictEqual(parkedWhileNamed.filter((c) => c.kind === "unsaved")[0].here, false)
})

test("46 wake and launchMissing skip a missing display, still launch the window", function() {
  const desk = {
    id: "dual",
    extras: model.defaultExtras(),
    layout: [
      { n: 1, monitor: "DP-1", focused: true },
      { n: 4, monitor: "HDMI-A-1" }
    ],
    workspaces: [
      { n: 1, monitor: "DP-1", windows: [{ class: "dev.zed.Zed", exec: ["zed"] }] },
      { n: 4, monitor: "HDMI-A-1", windows: [{ class: "chromium", exec: ["chromium", "--new-window"] }] }
    ]
  }
  const laptop = { windows: [], parked: [], monitors: ["DP-1"] }
  const woke = model.wakePlan(desk, laptop, "writing")
  const onLaptop = woke.launches.filter((item) => String(item.workspace).indexOf("omadesk-dual-1") >= 0)[0]
  const onHdmi = woke.launches.filter((item) => String(item.workspace).indexOf("omadesk-dual-4") >= 0)[0]
  assert.ok(onLaptop)
  assert.ok(onHdmi)
  assert.strictEqual(onLaptop.monitor, "DP-1")
  assert.ok(!onHdmi.monitor)
  assert.ok(String(onHdmi.workspace).indexOf("omadesk-dual-4") >= 0)
  same(onHdmi.exec, ["chromium", "--new-window"])
  const emptyConn = model.wakePlan(desk, { windows: [], parked: [], monitors: [] }, "writing")
  emptyConn.launches.forEach((item) => {
    assert.ok(!item.monitor)
  })
  const both = model.wakePlan(desk, { windows: [], parked: [], monitors: ["DP-1", "HDMI-A-1"] }, "writing")
  const hdmiBoth = both.launches.filter((item) => String(item.workspace).indexOf("omadesk-dual-4") >= 0)[0]
  assert.strictEqual(hdmiBoth.monitor, "HDMI-A-1")
  const launched = model.launchMissingPlan(desk, laptop).launches
  const hdmiLaunch = launched.filter((item) => String(item.n) === "4")[0]
  assert.ok(hdmiLaunch)
  assert.ok(!hdmiLaunch.monitor)
})

test("47 windowPanes follow dwindle and scrolling geometry; icons not names", function() {
  const scroll = model.windowPanes([
    { class: "foot", at: [0, 0], size: [400, 800] },
    { class: "chromium", at: [400, 0], size: [400, 800] }
  ])
  assert.strictEqual(scroll.length, 2)
  assert.ok(Math.abs(scroll[0].x - 0) < 1e-9)
  assert.ok(Math.abs(scroll[0].w - 0.5) < 1e-9)
  assert.ok(Math.abs(scroll[1].x - 0.5) < 1e-9)
  assert.ok(Math.abs(scroll[1].w - 0.5) < 1e-9)
  assert.strictEqual(scroll[0].icon, "foot")
  assert.strictEqual(scroll[1].icon, "chromium")
  const dwindle = model.windowPanes([
    { class: "dev.zed.Zed", x: 0, y: 0, w: 800, h: 400 },
    { class: "com.mitchellh.ghostty", x: 0, y: 400, w: 800, h: 400 }
  ])
  assert.strictEqual(dwindle.length, 2)
  assert.ok(Math.abs(dwindle[0].h - 0.5) < 1e-9)
  assert.ok(Math.abs(dwindle[1].y - 0.5) < 1e-9)
  assert.strictEqual(dwindle[0].icon, "zed")
  assert.strictEqual(dwindle[1].icon, "com.mitchellh.ghostty")
  const stage = model.parseStage(clientsText, workspacesText)
  assert.ok(stage.windows[0].w > 0)
  const tiles = model.deskTiles(stage)
  assert.ok(tiles[0].panes.length >= 1)
  assert.ok(tiles[0].panes[0].icon)
  assert.strictEqual(model.iconName({ class: "dev.zed.Zed" }), "zed")
  assert.strictEqual(model.iconName({ class: "chrome-music.apple.com__-Profile_1" }), "chromium")
  const recipe = model.snapshotRecipe(stage, "Geom", model.defaultExtras(), 3, "2026-08-21T18:00:00Z")
  const zed = recipe.workspaces[0].windows[0]
  assert.ok(zed.w > 0)
  assert.ok(zed.icon)
  const covered = model.windowPanes([
    { class: "foot", x: 0, y: 0, w: 400, h: 400 },
    { class: "com.mitchellh.ghostty", x: 0, y: 400, w: 400, h: 400 },
    { class: "chromium", x: 0, y: 0, w: 800, h: 800, fullscreen: 2 }
  ])
  assert.strictEqual(covered.length, 1)
  assert.strictEqual(covered[0].icon, "chromium")
  assert.ok(Math.abs(covered[0].w - 1) < 1e-9)
  assert.ok(Math.abs(covered[0].h - 1) < 1e-9)
  const maximized = model.windowPanes([
    { class: "foot", x: 12, y: 50, w: 400, h: 500 },
    { class: "chromium", x: 0, y: 0, w: 1920, h: 1080 }
  ])
  assert.strictEqual(maximized.length, 1)
  assert.strictEqual(maximized[0].icon, "chromium")
  const stacked = [
    { class: "foot", x: 0, y: 0, w: 400, h: 400, address: "0xa" },
    { class: "com.mitchellh.ghostty", x: 0, y: 400, w: 400, h: 400, address: "0xb" },
    { class: "chromium", x: 0, y: 0, w: 800, h: 800, fullscreen: 2, address: "0xc" }
  ]
  const under = model.windowsUnder(stacked)
  assert.strictEqual(under.length, 2)
  assert.strictEqual(under[0].icon, "foot")
  assert.strictEqual(under[1].icon, "com.mitchellh.ghostty")
  const tile = model.deskTiles({ workspaces: [{ n: 1, windows: stacked }] })[0]
  assert.strictEqual(tile.panes.length, 1)
  assert.strictEqual(tile.panes[0].icon, "chromium")
  assert.strictEqual(tile.under.length, 2)
  same(model.windowsUnder([
    { class: "foot", x: 0, y: 0, w: 400, h: 800 },
    { class: "chromium", x: 400, y: 0, w: 400, h: 800 }
  ]), [])
})

test("49 iconLetters: one word first+last, two words initials", function() {
  assert.strictEqual(model.iconLetters({ class: "firefox" }), "Fx")
  assert.strictEqual(model.iconLetters({ class: "org.mozilla.firefox" }), "Fx")
  assert.strictEqual(model.iconLetters({ class: "chromium" }), "Cm")
  assert.strictEqual(model.iconLetters({ class: "dev.zed.Zed" }), "Zd")
  assert.strictEqual(model.iconLetters({ class: "com.mitchellh.ghostty" }), "Gy")
  assert.strictEqual(model.iconLetters({ class: "GeForceNOW" }), "GN")
  assert.strictEqual(model.iconLetters({ class: "chrome-music.apple.com__-Profile_1" }), "MA")
  assert.strictEqual(model.iconLetters({ class: "X" }), "X")
})

test("48 terminal exec keeps cwd and a non-shell command", function() {
  same(
    model.terminalExec({
      class: "com.mitchellh.ghostty",
      cwd: "/home/hallas/Work/charcana",
      cmd: ["nvim", "README.md"]
    }),
    ["ghostty", "--working-directory=/home/hallas/Work/charcana", "-e", "nvim", "README.md"]
  )
  same(
    model.terminalExec({ class: "foot", cwd: "/tmp", cmd: ["bash"] }),
    ["foot", "-D", "/tmp"]
  )
  same(
    model.resolveExec({
      class: "com.mitchellh.ghostty",
      exec: ["ghostty"],
      cwd: "/home/hallas/Work",
      cmd: ["htop"]
    }),
    ["ghostty", "--working-directory=/home/hallas/Work", "-e", "htop"]
  )
  const hints = model.parseTerminalProbe("1102\t/home/hallas/Work/omadesk\thtop\n1101\t/home/hallas\tbash\n")
  assert.strictEqual(hints[0].pid, 1102)
  assert.strictEqual(hints[0].cwd, "/home/hallas/Work/omadesk")
  same(hints[0].cmd, ["htop"])
  assert.strictEqual(hints[1].pid, 1101)
  assert.ok(!hints[1].cmd)
  const stage = {
    windows: [
      { pid: 1102, class: "com.mitchellh.ghostty", workspace: 2, address: "0x1" }
    ],
    workspaces: [{ n: 2, windows: [{ pid: 1102, class: "com.mitchellh.ghostty", workspace: 2, address: "0x1" }] }]
  }
  model.applyTerminalHints(stage, hints)
  assert.strictEqual(stage.windows[0].cwd, "/home/hallas/Work/omadesk")
  same(stage.windows[0].cmd, ["htop"])
  const recipe = model.snapshotRecipe(stage, "Term", model.defaultExtras(), 2, "2026-08-21T18:00:00Z")
  const win = recipe.workspaces[0].windows[0]
  assert.strictEqual(win.cwd, "/home/hallas/Work/omadesk")
  same(win.cmd, ["htop"])
  same(win.exec[0], "ghostty")
  assert.ok(win.exec.indexOf("-e") >= 0)
  const launched = model.launchMissingPlan({
    extras: model.defaultExtras(),
    workspaces: recipe.workspaces
  }, "[]").launches
  assert.strictEqual(launched.length, 1)
  assert.ok(launched[0].exec.indexOf("htop") >= 0)
})

test("58 idle terminal still stores cwd and relaunches there", function() {
  const stage = {
    windows: [
      { pid: 9, class: "com.mitchellh.ghostty", workspace: 1, address: "0xterm" }
    ],
    workspaces: [{
      n: 1,
      windows: [{ pid: 9, class: "com.mitchellh.ghostty", workspace: 1, address: "0xterm" }]
    }]
  }
  model.applyTerminalHints(stage, [{ pid: 9, cwd: "/home/hallas/Work/omadesk" }])
  assert.strictEqual(stage.windows[0].cwd, "/home/hallas/Work/omadesk")
  const recipe = model.snapshotRecipe(stage, "Term", model.defaultExtras(), 1, "2026-08-22T12:00:00Z")
  const win = recipe.workspaces[0].windows[0]
  assert.strictEqual(win.cwd, "/home/hallas/Work/omadesk")
  assert.ok(!win.cmd)
  const launched = model.launchMissingPlan({
    extras: model.defaultExtras(),
    workspaces: recipe.workspaces
  }, "[]").launches
  assert.strictEqual(launched.length, 1)
  same(launched[0].exec, ["ghostty", "--working-directory=/home/hallas/Work/omadesk"])
})

test("50 minimap aspect matches the monitor", function() {
  const monitors = [
    { name: "DP-1", width: 2560, height: 1440, disabled: false, focused: true, activeWorkspace: { id: 1, name: "1" } },
    { name: "HDMI-A-1", width: 3440, height: 1440, disabled: false, focused: false, activeWorkspace: { id: 4, name: "4" } }
  ]
  const stage = model.parseStage(clientsText, workspacesText, JSON.stringify(monitors))
  assert.ok(Math.abs(stage.monitorSizes["DP-1"].w / stage.monitorSizes["DP-1"].h - 2560 / 1440) < 1e-9)
  const tiles = model.deskTiles(stage)
  assert.ok(Math.abs(tiles[0].aspect - 2560 / 1440) < 1e-9)
  const portrait = model.parseMonitorSizes(JSON.stringify([
    { name: "eDP-1", width: 1920, height: 1080, transform: 1, disabled: false }
  ]))
  assert.strictEqual(portrait["eDP-1"].w, 1080)
  assert.strictEqual(portrait["eDP-1"].h, 1920)
  assert.ok(Math.abs(model.aspectForMonitor("eDP-1", portrait) - 1080 / 1920) < 1e-9)
})

test("51 switchFocusWorkspace prefers the clicked workspace", function() {
  assert.strictEqual(model.switchFocusWorkspace({ lastWorkspace: 3 }, 7), 7)
  assert.strictEqual(model.switchFocusWorkspace({ lastWorkspace: 3 }, "5"), 5)
  assert.strictEqual(model.switchFocusWorkspace({ lastWorkspace: 3 }, null), 3)
  assert.strictEqual(model.switchFocusWorkspace({ recipe: { lastWorkspace: 4 } }, "x"), 4)
  assert.strictEqual(model.switchFocusWorkspace({ lastWorkspace: 11 }, 0), 1)
  assert.strictEqual(model.switchFocusWorkspace({}, undefined), 1)
  assert.strictEqual(model.focusWorkspaceN(7), 7)
  assert.strictEqual(model.focusWorkspaceN("10"), 10)
  assert.strictEqual(model.focusWorkspaceN(0), null)
  assert.strictEqual(model.focusWorkspaceN("null"), null)
})

test("53 named close while here also closes leaked lots of that desk", function() {
  const writing = { id: "writing", name: "Writing" }
  const fixtures = model.parseStage(clientsText, workspacesText)
  const closeHere = model.closePlan(writing, fixtures, "writing")
  const hereBlob = closeHere.dispatches.join(" ")
  assert.ok(hereBlob.indexOf("0x55f11fe15110") >= 0)
  assert.ok(hereBlob.indexOf("0x55f11fe15bbb") >= 0)
  assert.ok(hereBlob.indexOf("0x55f11fe15ccc") === -1)
  assert.ok(hereBlob.indexOf("0x55f11fe15c2c") === -1)
  assert.ok(hereBlob.indexOf("0x55f11fe15aaa") === -1)
  assert.ok(hereBlob.indexOf("scratchpad") === -1)
  const stage = {
    windows: [
      { address: "0xhere01", workspace: 1, class: "dev.zed.Zed" },
      { address: "0xsc", workspace: "special:scratchpad", class: "foot" }
    ],
    parked: [
      { slug: "writing", n: 2, address: "0xleak01", class: "com.mitchellh.ghostty" },
      { slug: "call", n: 1, address: "0xcall01", class: "chromium" },
      { slug: "unnamed", n: 1, address: "0xunsaved01", class: "foot" }
    ]
  }
  const plan = model.closePlan(writing, stage, "writing")
  const blob = plan.dispatches.join(" ")
  assert.ok(blob.indexOf("0xhere01") >= 0)
  assert.ok(blob.indexOf("0xleak01") >= 0)
  assert.ok(blob.indexOf("0xcall01") === -1)
  assert.ok(blob.indexOf("0xunsaved01") === -1)
  assert.ok(blob.indexOf("0xsc") === -1)
  assert.ok(blob.indexOf("scratchpad") === -1)
  const emptyHere = {
    windows: [],
    parked: [
      { slug: "writing", n: 1, address: "0xleak01", class: "com.mitchellh.ghostty" },
      { slug: "call", n: 1, address: "0xcall01", class: "chromium" }
    ]
  }
  assert.strictEqual(model.deskLife(writing, emptyHere, "writing"), "live")
  assert.strictEqual(model.deskLife({ id: "call", name: "Call" }, emptyHere, "writing"), "live")
  const closeEmpty = model.closePlan(writing, emptyHere, "writing")
  const emptyBlob = closeEmpty.dispatches.join(" ")
  assert.ok(emptyBlob.indexOf("0xleak01") >= 0)
  assert.ok(emptyBlob.indexOf("0xcall01") === -1)
  const switched = model.parkPlan(stage, "writing", "call", { id: "call" })
  const restoreAddrs = switched.restore.dispatches.join(" ")
  assert.ok(restoreAddrs.indexOf("0xcall01") >= 0)
  assert.ok(restoreAddrs.indexOf("0xleak01") === -1)
  assert.ok(restoreAddrs.indexOf("0xhere01") === -1)
  assert.ok(restoreAddrs.indexOf("0xunsaved01") === -1)
  const parkAddrs = switched.park.dispatches.join(" ")
  assert.ok(parkAddrs.indexOf("0xhere01") >= 0)
  const leakPark = switched.park.dispatches.filter((d) => d.indexOf("0xleak01") >= 0)[0]
  assert.ok(leakPark)
  assert.ok(leakPark.indexOf('workspace = "special:omadesk-writing-2"') >= 0)
  assert.ok(parkAddrs.indexOf("0xcall01") === -1)
  assert.ok(parkAddrs.indexOf("0xunsaved01") === -1)
  assert.ok(parkAddrs.indexOf("0xsc") === -1)
})

test("54 park hides leftover lots of the outgoing desk, not call or unsaved", function() {
  const stage = {
    windows: [
      { address: "0xhere01", workspace: 1, class: "dev.zed.Zed" },
      { address: "0xsc", workspace: "special:scratchpad", class: "foot" }
    ],
    parked: [
      { slug: "writing", n: 2, address: "0xleak01", class: "com.mitchellh.ghostty" },
      { slug: "call", n: 1, address: "0xcall01", class: "chromium" },
      { slug: "unnamed", n: 1, address: "0xunsaved01", class: "foot" }
    ]
  }
  const switched = model.parkPlan(stage, "writing", "call", { id: "call" })
  const parkBlob = switched.park.dispatches.join(" ")
  assert.ok(parkBlob.indexOf("0xhere01") >= 0)
  assert.ok(parkBlob.indexOf('workspace = "special:omadesk-writing-1"') >= 0)
  const leak = switched.park.dispatches.filter((d) => d.indexOf("0xleak01") >= 0)[0]
  assert.ok(leak)
  assert.ok(leak.indexOf('workspace = "special:omadesk-writing-2"') >= 0)
  assert.ok(parkBlob.indexOf("0xcall01") === -1)
  assert.ok(parkBlob.indexOf("0xunsaved01") === -1)
  assert.ok(parkBlob.indexOf("0xsc") === -1)
  switched.park.dispatches.forEach((lua) => {
    assert.ok(lua.indexOf("special:omadesk-writing-") >= 0)
    assert.ok(lua.indexOf("scratchpad") === -1)
  })
  const restoreBlob = switched.restore.dispatches.join(" ")
  assert.ok(restoreBlob.indexOf("0xcall01") >= 0)
  assert.ok(restoreBlob.indexOf("0xleak01") === -1)
  assert.ok(restoreBlob.indexOf("0xhere01") === -1)
  assert.ok(restoreBlob.indexOf("0xunsaved01") === -1)
  const fixtures = model.parseStage(clientsText, workspacesText)
  const fromFixtures = model.parkPlan(fixtures, "writing", "call", { id: "call" })
  const parkedWriting = fromFixtures.park.dispatches.filter((d) => d.indexOf("0x55f11fe15bbb") >= 0)[0]
  assert.ok(parkedWriting)
  assert.ok(parkedWriting.indexOf('workspace = "special:omadesk-writing-1"') >= 0)
  const restoreFix = fromFixtures.restore.dispatches.join(" ")
  assert.ok(restoreFix.indexOf("0x55f11fe15bbb") === -1)
  assert.ok(restoreFix.indexOf("0x55f11fe15ccc") >= 0)
  assert.ok(restoreFix.indexOf("0x55f11fe15aaa") === -1)
  const toWriting = model.parkPlan(stage, "unnamed", "writing", { id: "writing" })
  const fromUnnamed = toWriting.park.dispatches.join(" ")
  assert.ok(fromUnnamed.indexOf("0xhere01") >= 0)
  const unsavedLot = toWriting.park.dispatches.filter((d) => d.indexOf("0xunsaved01") >= 0)[0]
  assert.ok(unsavedLot)
  assert.ok(unsavedLot.indexOf('workspace = "special:omadesk-unnamed-1"') >= 0)
  assert.ok(fromUnnamed.indexOf("0xcall01") === -1)
  assert.ok(fromUnnamed.indexOf("0xleak01") === -1)
  const writingRestore = toWriting.restore.dispatches.join(" ")
  assert.ok(writingRestore.indexOf("0xleak01") >= 0)
  assert.ok(writingRestore.indexOf("0xunsaved01") === -1)
  assert.ok(writingRestore.indexOf("0xhere01") === -1)
})

test("55 switch does not relaunch closed windows of a live desk", function() {
  const desk = {
    id: "writing",
    extras: model.defaultExtras(),
    workspaces: [
      { n: 1, windows: [{ class: "dev.zed.Zed", exec: ["zed"] }] },
      { n: 2, windows: [{ class: "com.mitchellh.ghostty", exec: ["ghostty"] }] },
      { n: 3, windows: [{ class: "chromium", exec: ["chromium", "--new-window"] }] }
    ]
  }
  const livePartial = {
    windows: [
      { address: "0xzed", workspace: 1, class: "dev.zed.Zed" },
      { address: "0xghost", workspace: 2, class: "com.mitchellh.ghostty" }
    ],
    parked: [{ slug: "call", n: 1, address: "0xcall01", class: "chromium" }]
  }
  const twoArg = model.launchMissingPlan(desk, livePartial).launches
  assert.strictEqual(twoArg.length, 1)
  same(twoArg[0].exec, ["chromium", "--new-window"])
  same(model.launchMissingPlan(desk, livePartial, "writing").launches, [])
  const leakedLive = {
    windows: [],
    parked: [
      { slug: "writing", n: 1, address: "0xzed", class: "dev.zed.Zed" },
      { slug: "call", n: 1, address: "0xcall01", class: "chromium" }
    ]
  }
  same(model.launchMissingPlan(desk, leakedLive, "writing").launches, [])
  const dead = {
    windows: [],
    parked: [{ slug: "call", n: 1, address: "0xcall01", class: "chromium" }]
  }
  const fromDead = model.launchMissingPlan(desk, dead, "writing").launches
  assert.strictEqual(fromDead.length, 3)
  fromDead.forEach((item) => {
    assert.ok(item.exec && item.exec.length)
  })
  const woke = model.wakePlan(desk, livePartial, "call")
  assert.ok(woke.launches.length >= 1)
  woke.launches.forEach((item) => {
    assert.ok(String(item.workspace).indexOf("special:omadesk-writing-") === 0)
  })
})

test("56 unnamed currentId and unnamed desk id are the unsaved room", function() {
  const writing = { id: "writing", name: "Writing", extras: model.defaultExtras(), workspaces: [] }
  const unnamedDesk = {
    id: "unnamed",
    name: "Unnamed",
    extras: model.defaultExtras(),
    workspaces: [{ n: 1, windows: [{ class: "foot", exec: ["foot"] }] }]
  }
  const state = { version: 1, currentId: "unnamed", desks: [writing, unnamedDesk] }
  const stage = {
    windows: [{ address: "0xhere01", workspace: 1, class: "mpv" }],
    parked: [
      { slug: "unnamed", n: 2, address: "0xunsaved01", class: "foot" },
      { slug: "writing", n: 1, address: "0xwriting01", class: "dev.zed.Zed" }
    ]
  }
  const unsaved = model.unsavedCard(state, stage)
  assert.ok(unsaved)
  assert.strictEqual(unsaved.here, true)
  const cards = model.pickerCards(state, "", stage)
  assert.strictEqual(cards.filter((c) => c.kind === "unsaved")[0].here, true)
  assert.strictEqual(cards.filter((c) => c.kind === "desk" && c.id === "unnamed").length, 0)
  assert.strictEqual(cards.filter((c) => c.kind === "desk" && c.id === "writing")[0].here, false)
  assert.strictEqual(model.isCurrentDesk(unnamedDesk, "unnamed"), false)
  assert.strictEqual(model.isCurrentDesk(writing, "unnamed"), false)
  assert.strictEqual(model.targetedNamedDesk({ kind: "desk", id: "unnamed", desk: unnamedDesk }, state), null)
  const closeUnsaved = model.closePlan({ id: "unnamed", name: "Unsaved" }, stage, "unnamed")
  const closeBlob = closeUnsaved.dispatches.join(" ")
  assert.ok(closeBlob.indexOf("0xhere01") >= 0)
  assert.ok(closeBlob.indexOf("0xunsaved01") >= 0)
  assert.ok(closeBlob.indexOf("0xwriting01") === -1)
  const closeWriting = model.closePlan(writing, stage, "unnamed")
  const writingClose = closeWriting.dispatches.join(" ")
  assert.ok(writingClose.indexOf("0xwriting01") >= 0)
  assert.ok(writingClose.indexOf("0xhere01") === -1)
  assert.ok(writingClose.indexOf("0xunsaved01") === -1)
  const switched = model.parkPlan(stage, model.currentSlug(state), "writing", writing)
  const parkBlob = switched.park.dispatches.join(" ")
  assert.ok(parkBlob.indexOf("0xhere01") >= 0)
  assert.ok(parkBlob.indexOf("special:omadesk-unnamed-") >= 0)
  assert.ok(parkBlob.indexOf("0xwriting01") === -1)
  const restoreBlob = switched.restore.dispatches.join(" ")
  assert.ok(restoreBlob.indexOf("0xwriting01") >= 0)
  assert.ok(restoreBlob.indexOf("0xunsaved01") === -1)
  assert.ok(restoreBlob.indexOf("0xhere01") === -1)
  const read = model.readDesks(JSON.stringify(state))
  assert.strictEqual(read.ok, true)
  assert.strictEqual(read.state.currentId, null)
  const used = model.useDesk(model.demoDesks(), "unnamed")
  assert.strictEqual(used.currentId, null)
})

test("52 live tiles use n not id and skip empty workspaces", function() {
  const stage = model.parseStage(clientsText, workspacesText)
  const tiles = model.deskTiles(stage)
  assert.strictEqual(tiles.length, 3)
  assert.strictEqual(model.previewTiles(stage).length, 3)
  tiles.forEach((t) => {
    assert.strictEqual(t.vacant, false)
    assert.ok(t.n >= 1 && t.n <= 10)
    assert.strictEqual(t.id, undefined)
  })
  assert.strictEqual(tiles[0].n, 1)
  assert.strictEqual(tiles[1].n, 2)
  assert.strictEqual(tiles[2].n, 3)
  assert.strictEqual(model.deskTiles({}).length, 0)
  assert.strictEqual(model.deskTiles({ workspaces: [{ n: 1, windows: 2 }, { n: 8, windows: 0 }] }).length, 0)
  const hypr = {
    workspaces: [
      { id: 1, name: "1", windows: 1, monitor: "DP-1" },
      { id: 2, name: "2", windows: 1, monitor: "DP-1" },
      { id: 5, name: "5", windows: 0, monitor: "DP-1" }
    ],
    windows: [
      { class: "foot", workspace: 1, at: [0, 0], size: [400, 400] },
      { class: "chromium", workspace: 2, at: [0, 0], size: [400, 400] }
    ]
  }
  const fromHypr = model.deskTiles(hypr)
  assert.strictEqual(fromHypr.length, 2)
  assert.strictEqual(fromHypr[0].n, 1)
  assert.strictEqual(fromHypr[1].n, 2)
  fromHypr.forEach((t) => {
    assert.strictEqual(t.vacant, false)
    assert.strictEqual(t.id, undefined)
  })
  assert.strictEqual(hypr.workspaces[0].windows, 1)
})

test("57 reboot restore keeps chromium profile, terminal cwd, and floating size", function() {
  assert.strictEqual(
    model.profileFromArgv(["chromium", "--profile-directory=Profile 1", "--type=renderer"]),
    "Profile 1"
  )
  same(model.guessExec({ class: "chromium" }), ["chromium", "--new-window"])
  same(
    model.guessExec({ class: "chromium", profile: "Profile 1" }),
    ["chromium", "--profile-directory=Profile 1", "--new-window"]
  )
  const stage = {
    windows: [
      {
        pid: 10,
        class: "chromium",
        workspace: 2,
        floating: true,
        x: 100,
        y: 80,
        w: 1280,
        h: 800,
        address: "0xa"
      },
      {
        pid: 11,
        class: "com.mitchellh.ghostty",
        workspace: 3,
        x: 0,
        y: 0,
        w: 900,
        h: 700,
        address: "0xb"
      }
    ],
    workspaces: [
      {
        n: 2,
        windows: [{
          pid: 10,
          class: "chromium",
          workspace: 2,
          floating: true,
          x: 100,
          y: 80,
          w: 1280,
          h: 800
        }]
      },
      {
        n: 3,
        windows: [{
          pid: 11,
          class: "com.mitchellh.ghostty",
          workspace: 3,
          x: 0,
          y: 0,
          w: 900,
          h: 700
        }]
      }
    ]
  }
  model.applyTerminalHints(stage, [
    { pid: 10, cwd: "/home/hallas", cmd: ["chromium", "--profile-directory=Profile 1"] },
    { pid: 11, cwd: "/home/hallas/Work/omadesk", cmd: ["nvim", "Overlay.qml"] }
  ])
  assert.strictEqual(stage.windows[0].profile, "Profile 1")
  assert.ok(!stage.windows[0].cmd)
  assert.strictEqual(stage.windows[1].cwd, "/home/hallas/Work/omadesk")
  same(stage.windows[1].cmd, ["nvim", "Overlay.qml"])
  const recipe = model.snapshotRecipe(stage, "Work", model.defaultExtras(), 2, "2026-08-22T12:00:00Z")
  const chrome = recipe.workspaces.filter((w) => w.n === 2)[0].windows[0]
  assert.strictEqual(chrome.profile, "Profile 1")
  same(chrome.exec, ["chromium", "--profile-directory=Profile 1", "--new-window"])
  assert.strictEqual(chrome.w, 1280)
  assert.strictEqual(chrome.h, 800)
  assert.strictEqual(chrome.floating, true)
  const term = recipe.workspaces.filter((w) => w.n === 3)[0].windows[0]
  assert.strictEqual(term.cwd, "/home/hallas/Work/omadesk")
  same(term.cmd, ["nvim", "Overlay.qml"])
  const launches = model.launchMissingPlan(recipe, { windows: [], parked: [] }, "work").launches
  const chromeLaunch = launches.filter((item) => item.n === 2)[0]
  same(chromeLaunch.exec, ["chromium", "--profile-directory=Profile 1", "--new-window"])
  assert.strictEqual(chromeLaunch.w, 1280)
  assert.strictEqual(chromeLaunch.floating, true)
  const chromeRules = model.launchExecRules(chromeLaunch)
  assert.ok(chromeRules.indexOf("float") >= 0)
  assert.ok(chromeRules.indexOf("size 1280 800") >= 0)
  assert.ok(chromeRules.indexOf("move 100 80") >= 0)
  const termLaunch = launches.filter((item) => item.n === 3)[0]
  assert.ok(termLaunch.exec.indexOf("nvim") >= 0)
  const termRules = model.launchExecRules(termLaunch)
  assert.ok(termRules.indexOf("float") === -1)
  assert.ok(termRules.indexOf("workspace 3") >= 0)
})

test("59 workspace tiledLayout toggle uses Omarchy ids and lua rules", function() {
  assert.strictEqual(model.normalizeTiledLayout("scrolling"), "scrolling")
  assert.strictEqual(model.normalizeTiledLayout("Scroll"), "scrolling")
  assert.strictEqual(model.normalizeTiledLayout(""), "dwindle")
  assert.strictEqual(model.normalizeTiledLayout("master"), "dwindle")
  assert.strictEqual(model.nextTiledLayout("dwindle"), "scrolling")
  assert.strictEqual(model.nextTiledLayout("scrolling"), "dwindle")
  assert.strictEqual(model.hasHyprWorkspaceId(1), true)
  assert.strictEqual(model.hasHyprWorkspaceId(-83), true)
  assert.strictEqual(model.hasHyprWorkspaceId(0), false)
  assert.strictEqual(model.hasHyprWorkspaceId(null), false)
  assert.strictEqual(
    model.workspaceLayoutRuleLua(3, "scrolling"),
    'hl.workspace_rule({ workspace = "3", layout = "scrolling" })\n'
  )
  assert.strictEqual(
    model.workspaceLayoutRuleLua("special:omadesk-call-1", "dwindle"),
    'hl.workspace_rule({ workspace = "special:omadesk-call-1", layout = "dwindle" })\n'
  )
  assert.strictEqual(model.workspaceLayoutKeyword(3, "scrolling"), "3, layout:scrolling")
  assert.strictEqual(model.workspaceLayoutKeyword("special:omadesk-call-1", "scrolling"), "special:omadesk-call-1, layout:scrolling")
  assert.strictEqual(model.workspaceLayoutTarget({ n: 3, hyprId: 3 }, "writing", true), "3")
  assert.strictEqual(model.workspaceLayoutTarget({ n: 5, hyprId: 5 }, "main", true), "5")
  assert.strictEqual(model.workspaceLayoutTarget({ n: 1, hyprId: -83 }, "call", false), "special:omadesk-call-1")
  assert.strictEqual(model.workspaceLayoutTarget({ n: 2 }, "writing", false), "special:omadesk-writing-2")
  assert.strictEqual(model.workspaceLayoutTarget({ n: 1 }, "", true), "1")
  assert.strictEqual(model.workspaceLayoutTarget({ n: 1, vacant: true }, "writing", true), "1")
  assert.strictEqual(model.workspaceLayoutTarget({ n: 1, hyprId: -83 }, "call", true), "1")
  assert.strictEqual(model.workspaceLayoutTarget({ n: 4, vacant: true }, "writing", false), "special:omadesk-writing-4")
  assert.strictEqual(model.workspaceLayoutTarget({ n: 0 }, "writing", true), "")
  assert.strictEqual(model.workspaceLayoutPersistId("3"), "3")
  assert.strictEqual(model.workspaceLayoutPersistId("special:omadesk-call-1"), "omadesk-call-1")
  assert.strictEqual(
    model.workspaceLayoutsDir("/home/ada", ""),
    "/home/ada/.local/state/omarchy/workspace-layouts"
  )
  assert.strictEqual(
    model.workspaceLayoutsDir("/home/ada", "/tmp/state"),
    "/tmp/state/omarchy/workspace-layouts"
  )
  const withLayouts = workspaces.map(function(ws) {
    const row = clone(ws)
    if (row.id === 1) row.tiledLayout = "scrolling"
    if (row.id === -83) row.tiledLayout = "scrolling"
    return row
  })
  const stage = model.parseStage(clientsText, JSON.stringify(withLayouts))
  const ws1 = stage.workspaces.filter((w) => w.n === 1)[0]
  assert.strictEqual(ws1.tiledLayout, "scrolling")
  assert.strictEqual(ws1.hyprId, 1)
  const callLot = stage.parked.filter((p) => p.slug === "call" && p.n === 1)[0]
  assert.strictEqual(callLot.tiledLayout, "scrolling")
  assert.strictEqual(callLot.hyprId, -83)
  const liveTiles = model.deskTiles(stage)
  assert.strictEqual(liveTiles[0].tiledLayout, "scrolling")
  assert.strictEqual(liveTiles[0].hyprId, 1)
  const parkedStage = model.parkedToStage(stage.parked.filter((p) => p.slug === "call"))
  const parkedTile = model.deskTiles(parkedStage)[0]
  assert.strictEqual(parkedTile.n, 1)
  assert.strictEqual(parkedTile.tiledLayout, "scrolling")
  assert.strictEqual(parkedTile.hyprId, -83)
})

test("60 same-desk pane move: numbered when here, lot when parked", function() {
  const addr = "0x55f11fe15110"
  assert.strictEqual(
    model.sameDeskMoveDispatch(addr, 1, 3, "writing", true),
    'hl.dsp.window.move({ workspace = "3", follow = false, window = "address:0x55f11fe15110" })'
  )
  assert.strictEqual(
    model.sameDeskMoveDispatch(addr, 1, 2, "writing", false),
    'hl.dsp.window.move({ workspace = "special:omadesk-writing-2", follow = false, window = "address:0x55f11fe15110" })'
  )
  assert.strictEqual(
    model.sameDeskMoveDispatch(addr, 1, 2, "unnamed", false),
    'hl.dsp.window.move({ workspace = "special:omadesk-unnamed-2", follow = false, window = "address:0x55f11fe15110" })'
  )
  assert.strictEqual(model.sameDeskMoveDispatch(addr, 2, 2, "writing", true), "")
  assert.strictEqual(model.sameDeskMoveDispatch("", 1, 3, "writing", true), "")
  assert.strictEqual(model.sameDeskMoveDispatch(addr, 1, 0, "writing", true), "")
  const panes = model.windowPanes([
    { class: "foot", address: "0xaaa", at: [0, 0], size: [400, 800] },
    { class: "chromium", address: "0xbbb", at: [400, 0], size: [400, 800] }
  ])
  assert.strictEqual(panes[0].address, "0xaaa")
  assert.strictEqual(panes[1].address, "0xbbb")
})

test("61 next empty workspace is the first free n, one vacant tile", function() {
  const stage = model.parseStage(clientsText, workspacesText)
  assert.strictEqual(model.nextEmptyWorkspaceN(stage), 4)
  const withEmpty = model.deskTiles(stage, 10, true)
  assert.strictEqual(withEmpty.length, 4)
  assert.strictEqual(withEmpty[3].n, 4)
  assert.strictEqual(withEmpty[3].vacant, true)
  assert.strictEqual(model.deskTiles(stage).length, 3)
  const holes = {
    workspaces: [
      { n: 1, windows: [{ class: "foot", at: [0, 0], size: [100, 100] }] },
      { n: 3, windows: [{ class: "chromium", at: [0, 0], size: [100, 100] }] }
    ]
  }
  assert.strictEqual(model.nextEmptyWorkspaceN(holes), 2)
  const holeTiles = model.deskTiles(holes, 10, true)
  assert.strictEqual(holeTiles[2].n, 2)
  assert.strictEqual(holeTiles[2].vacant, true)
  const packed = { workspaces: [] }
  var n
  for (n = 1; n <= 10; n++) {
    packed.workspaces.push({ n: n, windows: [{ class: "foot", at: [0, 0], size: [40, 40] }] })
  }
  assert.strictEqual(model.nextEmptyWorkspaceN(packed), 0)
  assert.strictEqual(model.deskTiles(packed, 10, true).length, 10)
  assert.strictEqual(model.nextEmptyWorkspaceN({}), 0)
  assert.strictEqual(model.sameDeskMoveDispatch("0xaaa", 1, 4, "writing", true).indexOf('workspace = "4"') >= 0, true)
})

test("62 space count uses live occupied tiles, not an empty recipe", function() {
  const main = { id: "main", name: "Main", extras: model.defaultExtras(), workspaces: [] }
  const testDesk = {
    id: "test",
    name: "Test",
    extras: model.defaultExtras(),
    workspaces: [{ n: 1, windows: [{ class: "foot", exec: ["foot"] }] }]
  }
  const state = { version: 1, currentId: "main", desks: [main, testDesk] }
  const live = {
    windows: [
      { address: "0x1", workspace: 1, class: "foot" },
      { address: "0x2", workspace: 2, class: "chromium" }
    ],
    workspaces: [
      { n: 1, windows: [{ address: "0x1", class: "foot" }] },
      { n: 2, windows: [{ address: "0x2", class: "chromium" }] }
    ]
  }
  assert.ok(model.deskSpaceMeta(main).indexOf("0 Spaces") === 0)
  assert.ok(model.deskSpaceMeta(main, live, "main").indexOf("2 Spaces") === 0)
  assert.ok(model.deskSpaceMeta(testDesk, live, "main").indexOf("1 Space ·") === 0)
  const cards = model.pickerCards(state, "", live)
  const mainCard = cards.filter((c) => c.id === "main")[0]
  const testCard = cards.filter((c) => c.id === "test")[0]
  assert.ok(mainCard.meta.indexOf("2 Spaces") === 0)
  assert.strictEqual(mainCard.tiles.filter((t) => !t.vacant).length, 2)
  assert.ok(testCard.meta.indexOf("1 Space ·") === 0)
  const parked = {
    windows: live.windows,
    workspaces: live.workspaces,
    parked: [
      { slug: "test", n: 1, address: "0xa", class: "foot" },
      { slug: "test", n: 3, address: "0xb", class: "chromium" }
    ]
  }
  const parkedCards = model.pickerCards(state, "", parked)
  assert.ok(parkedCards.filter((c) => c.id === "test")[0].meta.indexOf("2 Spaces") === 0)
})

test("63 workspace layout apply argv writes Omarchy lua then evals", function() {
  const dir = "/home/ada/.local/state/omarchy/workspace-layouts"
  const argv = model.workspaceLayoutApplyArgv(dir, 2, "scrolling")
  assert.strictEqual(argv[0], "bash")
  assert.strictEqual(argv[1], "-c")
  assert.ok(argv[2].indexOf("mkdir -p --") >= 0)
  assert.ok(argv[2].indexOf("hyprctl eval") >= 0)
  assert.ok(argv[2].indexOf("hyprctl keyword workspace") >= 0)
  assert.strictEqual(argv[4], dir)
  assert.strictEqual(argv[5], 'hl.workspace_rule({ workspace = "2", layout = "scrolling" })')
  assert.strictEqual(argv[6], dir + "/2.lua")
  assert.strictEqual(argv[7], "2, layout:scrolling")
  const special = model.workspaceLayoutApplyArgv(dir, "special:omadesk-call-1", "dwindle")
  assert.strictEqual(special[6], dir + "/omadesk-call-1.lua")
  assert.strictEqual(special[7], "special:omadesk-call-1, layout:dwindle")
  same(model.workspaceLayoutApplyArgv(dir, "", "scrolling"), [])
  same(model.workspaceLayoutApplyArgv("", 2, "scrolling"), [])
})

test("64 picker here is only the current desk; parked windows still count as live", function() {
  const main = { id: "main", name: "Main", extras: model.defaultExtras(), workspaces: [] }
  const testDesk = {
    id: "test",
    name: "Test",
    extras: model.defaultExtras(),
    workspaces: [{ n: 1, windows: [{ class: "foot", exec: ["foot"] }] }]
  }
  const state = { version: 1, currentId: "main", desks: [main, testDesk] }
  const stage = {
    windows: [{ address: "0x1", workspace: 1, class: "foot" }],
    workspaces: [{ n: 1, windows: [{ address: "0x1", class: "foot" }], hyprId: 1, tiledLayout: "scrolling" }],
    parked: [{ slug: "test", n: 1, address: "0xa", class: "foot", hyprId: -89, tiledLayout: "dwindle" }]
  }
  const cards = model.pickerCards(state, "", stage)
  const mainCard = cards.filter((c) => c.id === "main")[0]
  const testCard = cards.filter((c) => c.id === "test")[0]
  assert.strictEqual(mainCard.here, true)
  assert.strictEqual(testCard.here, false)
  assert.strictEqual(mainCard.life, "live")
  assert.strictEqual(testCard.life, "live")
})

test("65 extras theme applies now only on the current desk", function() {
  const writing = { id: "writing", name: "Writing" }
  const call = { id: "call", name: "Call" }
  const extras = { theme: "Dazzle Dusk" }
  assert.strictEqual(model.extrasThemeNow(writing, extras, "writing"), "Dazzle Dusk")
  assert.strictEqual(model.extrasThemeNow(call, extras, "writing"), null)
  assert.strictEqual(model.extrasThemeNow(writing, { theme: "leave" }, "writing"), null)
  assert.strictEqual(model.extrasThemeNow(writing, extras, null), null)
  assert.strictEqual(model.extrasThemeNow(writing, extras, "unnamed"), null)
})

test("66 updateDesk keeps monitor sizes from the stage", function() {
  const monitors = [
    { name: "DP-1", width: 2560, height: 1440, disabled: false, focused: true, activeWorkspace: { id: 1, name: "1" } }
  ]
  const stage = model.parseStage(clientsText, workspacesText, JSON.stringify(monitors))
  const recipe = model.snapshotRecipe(stage, "Wide", model.defaultExtras(), 3, "2026-08-21T12:00:00Z")
  assert.strictEqual(recipe.monitorSizes["DP-1"].w, 2560)
  assert.strictEqual(recipe.monitorSizes["DP-1"].h, 1440)
  const saved = model.saveDesk(model.emptyState(), recipe)
  const id = saved.desks[0].id
  const updated = model.updateDesk(saved, id, stage, "2026-08-22T12:00:00Z")
  const desk = updated.desks.filter((d) => d.id === id)[0]
  assert.ok(desk.monitorSizes)
  assert.strictEqual(desk.monitorSizes["DP-1"].w, 2560)
  assert.strictEqual(desk.monitorSizes["DP-1"].h, 1440)
  const noMons = model.updateDesk(saved, id, model.parseStage(clientsText, workspacesText), "2026-08-22T12:01:00Z")
  const kept = noMons.desks.filter((d) => d.id === id)[0]
  assert.strictEqual(kept.monitorSizes["DP-1"].w, 2560)
  const ultrawide = model.parseStage(clientsText, workspacesText, JSON.stringify([
    { name: "DP-1", width: 3440, height: 1440, disabled: false, focused: true, activeWorkspace: { id: 1, name: "1" } }
  ]))
  const resized = model.updateDesk(saved, id, ultrawide, "2026-08-22T13:00:00Z")
  assert.strictEqual(resized.desks.filter((d) => d.id === id)[0].monitorSizes["DP-1"].w, 3440)
})

console.log("ok")



