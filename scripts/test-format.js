/**
 * 剩余时间计算的测试
 *
 *   node scripts/test-format.js
 *
 * 倒计时是学生判断"先送哪单"的唯一依据，算错一档颜色就会误导人：
 * 剩 5 分钟该是红的，剩 6 分钟还是橙的——差一分钟，优先级完全不同。
 */
const assert = require('assert')
const fmt = require('../miniprogram/utils/format')

let passed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed++
    console.log('  ✓ ' + name)
  } catch (e) {
    failures.push(name)
    console.log('  ✗ ' + name + '\n      ' + e.message)
  }
}

const NOW = new Date('2026-11-06T12:00:00').getTime()
const MIN = 60000

// ---------- remain ----------

test('剩 30 分钟 → normal', function () {
  const r = fmt.remain(NOW + 30 * MIN, NOW)
  assert.strictEqual(r.text, '剩 30 分')
  assert.strictEqual(r.level, 'ok')
})

test('剩 11 分钟 → 仍是 normal', function () {
  assert.strictEqual(fmt.remain(NOW + 11 * MIN, NOW).level, 'ok')
})

test('剩 10 分钟 → 进入 warn', function () {
  const r = fmt.remain(NOW + 10 * MIN, NOW)
  assert.strictEqual(r.level, 'warn')
})

test('剩 6 分钟 → 仍是 warn', function () {
  assert.strictEqual(fmt.remain(NOW + 6 * MIN, NOW).level, 'warn')
})

test('剩 5 分钟 → 进入 urgent', function () {
  const r = fmt.remain(NOW + 5 * MIN, NOW)
  assert.strictEqual(r.level, 'urgent')
  assert.strictEqual(r.text, '剩 5 分')
})

test('剩 0 分钟 → urgent（还没超时）', function () {
  assert.strictEqual(fmt.remain(NOW, NOW).level, 'urgent')
})

test('超时 1 分钟 → over，文案变「超时」', function () {
  const r = fmt.remain(NOW - 1 * MIN, NOW)
  assert.strictEqual(r.level, 'over')
  assert.strictEqual(r.text, '超时 1 分')
})

test('超时 12 分钟 → over，分钟数正确', function () {
  assert.strictEqual(fmt.remain(NOW - 12 * MIN, NOW).text, '超时 12 分')
})

test('没有承诺时间 → 返回 null，不瞎显示', function () {
  assert.strictEqual(fmt.remain(0, NOW), null)
  assert.strictEqual(fmt.remain(null, NOW), null)
})

// ---------- tightest ----------

test('取最紧的一单', function () {
  const orders = [
    { dueAt: NOW + 20 * MIN },
    { dueAt: NOW + 8 * MIN },
    { dueAt: NOW + 15 * MIN },
  ]
  const r = fmt.tightest(orders, NOW)
  assert.strictEqual(r.min, 8)
})

test('已送达的单不参与"最紧"', function () {
  const orders = [
    { dueAt: NOW + 2 * MIN, delivered: true },
    { dueAt: NOW + 20 * MIN },
  ]
  const r = fmt.tightest(orders, NOW)
  assert.strictEqual(r.min, 20)
})

test('超时的单会被选中（负数最小）', function () {
  const orders = [
    { dueAt: NOW + 20 * MIN },
    { dueAt: NOW - 3 * MIN },
  ]
  const r = fmt.tightest(orders, NOW)
  assert.strictEqual(r.level, 'over')
  assert.strictEqual(r.text, '超时 3 分')
})

test('没有 dueAt 的单被忽略', function () {
  const r = fmt.tightest([{ id: 'a' }, { dueAt: NOW + 9 * MIN }], NOW)
  assert.strictEqual(r.min, 9)
})

test('空列表 / 全都没 dueAt → null', function () {
  assert.strictEqual(fmt.tightest([], NOW), null)
  assert.strictEqual(fmt.tightest([{ id: 'a' }], NOW), null)
  assert.strictEqual(fmt.tightest(null, NOW), null)
})

console.log('\n通过 ' + passed + ' 项')
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项')
  process.exit(1)
}
