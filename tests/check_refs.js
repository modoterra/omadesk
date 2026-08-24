#!/usr/bin/env node
// Static sanity check: every bare function call in Model.js must resolve to a
// declaration in Model.js or a JS builtin. Catches leftovers after a removal.

const fs = require("fs")
const path = require("path")

const file = path.join(__dirname, "..", "Model.js")
const raw = fs.readFileSync(file, "utf8")

// Blank out comments and string bodies so prose like "workspace (version 1)"
// is not mistaken for a call. Newlines are kept so line numbers stay accurate.
const src = raw
  .replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, " "))
  .replace(/\/\/[^\n]*/g, (s) => s.replace(/[^\n]/g, " "))
  .replace(/"(?:[^"\\\n]|\\.)*"/g, (s) => '"' + " ".repeat(Math.max(0, s.length - 2)) + '"')
  .replace(/'(?:[^'\\\n]|\\.)*'/g, (s) => "'" + " ".repeat(Math.max(0, s.length - 2)) + "'")

const declared = new Set()
const declRe = /^function\s+([A-Za-z0-9_$]+)\s*\(/gm
let m
while ((m = declRe.exec(src))) declared.add(m[1])

// Local helpers declared inside functions, plus var-assigned functions.
const innerRe = /\bfunction\s+([A-Za-z0-9_$]+)\s*\(/g
while ((m = innerRe.exec(src))) declared.add(m[1])

const builtins = new Set([
  "String", "Number", "Boolean", "Array", "Object", "JSON", "Math", "Date",
  "RegExp", "Error", "isFinite", "isNaN", "parseInt", "parseFloat", "encodeURIComponent",
  "decodeURIComponent", "if", "for", "while", "switch", "return", "typeof", "catch",
  "function", "new", "delete", "void", "in", "of", "do", "else", "try", "throw"
])

const called = new Map()
const callRe = /(^|[^.\w$])([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g
while ((m = callRe.exec(src))) {
  const name = m[2]
  if (builtins.has(name)) continue
  const line = src.slice(0, m.index).split("\n").length
  if (!called.has(name)) called.set(name, line)
}

const missing = []
for (const [name, line] of called) {
  if (!declared.has(name)) missing.push(`${file}:${line}  ${name}()`)
}

if (missing.length) {
  console.error("undefined function references:")
  for (const row of missing) console.error("  " + row)
  process.exit(1)
}
console.log(`ok: ${declared.size} declarations, ${called.size} call targets all resolve`)
