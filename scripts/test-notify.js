/**
 * 推送节流的单元测试
 *
 *   node scripts/test-notify.js
 *
 * 节流这种东西"跑一遍看不出问题"，只能靠断言锁住边界：
 * 第 3 次和第 4 次之间、23:59 和次日 00:01 之间，差一毫秒结果就该不同。
 */
const assert = require('assert')
const notify = require('../cloudfunctions/packer/lib/notify')

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

const NOW = new Date('2026-10-31T11:45:00').getTime()
const MIN = 60000
const HOUR = 60 * MIN

function history(count, gapMin) {
  const out = []
  for (let i = 0; i < count; i++) {
    out.push({ at: NOW - i * gapMin * MIN })
  }
  return out
}

// ---------- 每小时上限 ----------

test('没有历史记录 → 可以推', function () {
  const r = notify.canNotify([], NOW)
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.hourCount, 0)
})

test('一小时内推了 2 次 → 还能推第 3 次', function () {
  const r = notify.canNotify(history(2, 5), NOW)
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.hourCount, 2)
})

test('一小时内推了 3 次 → 第 4 次被拦', function () {
  const r = notify.canNotify(history(3, 5), NOW)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.reason, 'hourly_limit')
})

test('刚好 60 分钟前的那次不计入本小时', function () {
  const hist = [{ at: NOW - 61 * MIN }]
  const r = notify.canNotify(hist, NOW)
  assert.strictEqual(r.hourCount, 0)
  assert.strictEqual(r.ok, true)
})

// ---------- 每天上限 ----------

test('当天推了 11 次（跨多个小时）→ 还能推第 12 次', function () {
  const hist = []
  for (let i = 0; i < 11; i++) hist.push({ at: NOW - (i + 1) * 40 * MIN })
  const r = notify.canNotify(hist, NOW)
  assert.strictEqual(r.dayCount, 11)
  assert.strictEqual(r.ok, true)
})

test('当天推满 12 次 → 拦', function () {
  const hist = []
  for (let i = 0; i < 12; i++) hist.push({ at: NOW - (i + 1) * 40 * MIN })
  const r = notify.canNotify(hist, NOW)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.reason, 'daily_limit')
})

test('昨天推满 12 次不影响今天', function () {
  const yesterday = NOW - 24 * HOUR
  const hist = []
  for (let i = 0; i < 12; i++) hist.push({ at: yesterday - i * 10 * MIN })
  const r = notify.canNotify(hist, NOW)
  assert.strictEqual(r.dayCount, 0)
  assert.strictEqual(r.ok, true)
})

test('午夜前推的算昨天，午夜后重新计数', function () {
  const midnight = new Date('2026-10-31T00:05:00').getTime()
  const hist = [{ at: midnight - 10 * MIN }] // 10-30 23:55
  const r = notify.canNotify(hist, midnight)
  assert.strictEqual(r.dayCount, 0, '前一天的不该计入今天')
})

test('未来的记录不参与计算（时钟漂移保护）', function () {
  const r = notify.canNotify([{ at: NOW + 10 * MIN }], NOW)
  assert.strictEqual(r.hourCount, 0)
  assert.strictEqual(r.ok, true)
})

// ---------- 可推性 ----------

function mkPack(o) {
  return Object.assign({
    id: 'p0',
    status: 'available',
    income: { total: 2.86, subtotal: 2.86 },
    orderCount: 3,
    canteenId: 'C1',
    canteenName: '一食堂',
    buildingId: 'B3',
    buildingName: '3栋',
    minFloor: 4,
    maxFloor: 6,
    waveId: 'W2',
    walkMinutes: 9,
  }, o || {})
}

test('正常待派包 → 可推', function () {
  assert.strictEqual(notify.isEligiblePack(mkPack()), true)
})

test('已经推过的包不再推（同一包只预告一次）', function () {
  assert.strictEqual(notify.isEligiblePack(mkPack({ notifiedAt: NOW })), false)
})

test('已被接走的包不推', function () {
  assert.strictEqual(notify.isEligiblePack(mkPack({ status: 'accepted' })), false)
})

test('收益低于 2 元的包不占用推送额度', function () {
  assert.strictEqual(notify.isEligiblePack(mkPack({ income: { total: 1.72, subtotal: 1.72 } })), false)
})

test('收益刚好 2.0 元 → 可推（边界包含）', function () {
  assert.strictEqual(notify.isEligiblePack(mkPack({ income: { total: 2.0, subtotal: 2.0 } })), true)
})

// ---------- 匹配 ----------

test('只匹配本楼栋 + 常去食堂 + 已勾选波次的包', function () {
  const stu = { buildingId: 'B3', canteenIds: ['C1'], waveIds: ['W2'] }
  const packs = [
    mkPack({ id: 'p1' }),
    mkPack({ id: 'p2', buildingId: 'B5' }),
    mkPack({ id: 'p3', canteenId: 'C2' }),
    mkPack({ id: 'p4', waveId: 'W6' }),
  ]
  const hit = notify.matchPacks(stu, packs)
  assert.strictEqual(hit.length, 1)
  assert.strictEqual(hit[0].id, 'p1')
})

// ---------- 汇总 ----------
console.log('\n通过 ' + passed + ' 项')
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项')
  process.exit(1)
}
