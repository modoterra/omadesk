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
  assert.ok(cards.filter((c) => c.kind === "new").length === 1)
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
    "25 minutes ago"
  )
  assert.strictEqual(
    model.formatDeskMeta({ updatedAt: "2026-08-20T21:58:28.528Z", lastUsed: used }, now),
    "now"
  )
  assert.strictEqual(
    model.formatDeskMeta({ updatedAt: "2026-08-20T21:58:28.528Z", lastUsed: saved }, now),
    "25 minutes ago"
  )
  assert.strictEqual(
    model.formatDeskMeta({ updatedAt: "2026-08-20T21:58:28.528Z", lastUsed: saved }, now, true),
    "now"
  )
  const demo = model.demoDesks()
  const cards = model.pickerCards(demo, "")
  const writing = cards.filter((c) => c.id === "writing")[0]
  assert.ok(writing.meta.indexOf("last used now") >= 0)
  const switched = model.useDesk(demo, "call", used)
  assert.strictEqual(switched.currentId, "call")
  const call = switched.desks.filter((d) => d.id === "call")[0]
  const writingAfter = switched.desks.filter((d) => d.id === "writing")[0]
  assert.strictEqual(call.lastUsed, used)
  assert.strictEqual(writingAfter.lastUsed, used)
  const later = used + 10 * 60000
  const afterCards = model.pickerCards(switched, "", null, later)
  assert.ok(afterCards.filter((c) => c.id === "call")[0].meta.indexOf("last used now") >= 0)
  assert.ok(afterCards.filter((c) => c.id === "writing")[0].meta.indexOf("10 minutes ago") >= 0)
  const left = model.leaveDesk(switched, used + 120000)
  assert.strictEqual(left.currentId, null)
  assert.strictEqual(left.desks.filter((d) => d.id === "call")[0].lastUsed, used + 120000)
})

test("26 tiles default to five and grow with occupied spaces", function() {
  const writing = model.demoDesks().desks[0]
  const tiles = model.deskTiles(writing)
  assert.strictEqual(tiles.length, 5)
  assert.strictEqual(tiles[0].label, "Zed · charcana")
  assert.strictEqual(tiles[3].vacant, true)
  assert.strictEqual(tiles[4].vacant, true)
  const wide = {
    workspaces: [
      { n: 1, windows: [{ class: "dev.zed.Zed", title: "a" }] },
      { n: 7, windows: [{ class: "chromium", title: "b" }] }
    ]
  }
  const grown = model.deskTiles(wide)
  assert.strictEqual(grown.length, 7)
  assert.strictEqual(grown[6].n, 7)
  assert.strictEqual(grown[6].vacant, false)
  const many = {
    windows: [
      { class: "com.mitchellh.ghostty", title: "one", workspace: 2 },
      { class: "chromium", title: "two", workspace: 2 },
      { class: "com.mitchellh.ghostty", title: "three", workspace: 2 }
    ]
  }
  const stacked = model.deskTiles(many)
  assert.ok(stacked[1].label.indexOf("Ghostty") >= 0)
  assert.ok(stacked[1].label.indexOf("Chromium") >= 0)
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
  assert.ok(cards[0].meta.indexOf("2 screens") >= 0)
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
  assert.strictEqual(model.targetedNamedDesk({ kind: "new", name: "+ new desk" }, state), null)
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

console.log("ok")


