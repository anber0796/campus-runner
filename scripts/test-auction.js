/**
 * 竞价引擎单元测试
 *
 *   node scripts/test-auction.js
 *
 * 竞价这种东西，规则写错一行的后果是"钱给错了人"或"该成交的流拍"，
 * 在线上根本看不出来。只能靠断言把每个边界钉死。
 */
const assert = require('assert')
const auction = require('../cloudfunctions/packer/lib/auction')

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

const NOW = new Date('2026-11-05T11:45:00').getTime()

function mkStudent(o) {
  return Object.assign({
    id: 'S1',
    status: 'active',
    credit: 100,
    batchesToday: 0,
    buildingId: 'B3',
  }, o || {})
}

function mkBatch(o) {
  return Object.assign({
    id: 'B1',
    canteenId: 'C1',
    buildingId: 'B3',
    waveId: 'W2',
    orderCount: 3,
    status: 'BIDDING',
    bidDeadline: NOW + 10 * 60000,
  }, o || {})
}

function mkBid(o) {
  return Object.assign({
    id: 'bid1',
    studentId: 'S1',
    price: 1.0,
    createdAt: NOW,
    status: 'active',
  }, o || {})
}

// ---------- 准入 ----------

test('正常学生可以出价', function () {
  assert.strictEqual(auction.canBid(mkStudent(), mkBatch(), NOW).ok, true)
})

test('未认证学生不能出价', function () {
  const r = auction.canBid(mkStudent({ status: 'pending' }), mkBatch(), NOW)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.reason, 'not_certified')
})

test('信用分低于 80 只能被指派，不能竞价', function () {
  const r = auction.canBid(mkStudent({ credit: 79 }), mkBatch(), NOW)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.reason, 'credit_too_low')
})

test('刚好 80 分可以竞价（边界包含）', function () {
  assert.strictEqual(auction.canBid(mkStudent({ credit: 80 }), mkBatch(), NOW).ok, true)
})

test('惩罚期内不能出价', function () {
  const r = auction.canBid(mkStudent({ punishUntil: NOW + 3600000 }), mkBatch(), NOW)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.reason, 'punished')
})

test('惩罚期过了可以正常出价', function () {
  const r = auction.canBid(mkStudent({ punishUntil: NOW - 1000 }), mkBatch(), NOW)
  assert.strictEqual(r.ok, true)
})

test('当日接满 6 批不能再抢', function () {
  const r = auction.canBid(mkStudent({ batchesToday: 6 }), mkBatch(), NOW)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.reason, 'daily_limit')
})

test('已过竞价截止时间不能再出价', function () {
  const r = auction.canBid(mkStudent(), mkBatch({ bidDeadline: NOW - 1 }), NOW)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.reason, 'expired')
})

test('批次太小（少于 2 单）不出价', function () {
  const r = auction.canBid(mkStudent(), mkBatch({ orderCount: 1 }), NOW)
  assert.strictEqual(r.reason, 'batch_too_small')
})

test('楼栋不在覆盖范围 → 不能抢', function () {
  const batch = mkBatch({ buildingIds: ['B3', 'B5'] })
  const r = auction.canBid(mkStudent({ coverageBuildings: ['B3'] }), batch, NOW)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.reason, 'building_not_covered')
})

test('楼栋在覆盖范围 → 可以抢', function () {
  const batch = mkBatch({ buildingIds: ['B3', 'B5'] })
  const r = auction.canBid(mkStudent({ coverageBuildings: ['B3', 'B5'] }), batch, NOW)
  assert.strictEqual(r.ok, true)
})

test('没填覆盖楼栋时，按主楼兜底', function () {
  assert.strictEqual(auction.canServe(mkStudent(), mkBatch()), true)
  assert.strictEqual(auction.canServe(mkStudent(), mkBatch({ buildingId: 'B9' })), false)
})

// ---------- 价格 ----------

test('低于底价被拒（防恶意砸价）', function () {
  const r = auction.validatePrice(0.3)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.reason, 'below_floor')
})

test('高于封顶被拒', function () {
  const r = auction.validatePrice(5)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.reason, 'above_ceiling')
})

test('底价和封顶都是闭区间', function () {
  assert.strictEqual(auction.validatePrice(0.5).ok, true)
  assert.strictEqual(auction.validatePrice(3.0).ok, true)
})

test('非法价格（0、负数、NaN、字符串垃圾）一律拒绝', function () {
  ;[0, -1, NaN, Infinity, 'abc', null].forEach(function (p) {
    assert.strictEqual(auction.validatePrice(p).ok, false, '价格 ' + p + ' 应被拒')
  })
})

test('价格保留两位小数', function () {
  assert.strictEqual(auction.validatePrice(1.234).value, 1.23)
})

// ---------- 排序与开标 ----------

test('价低者中标', function () {
  const bids = [mkBid({ id: 'a', price: 1.2 }), mkBid({ id: 'b', price: 0.9 }), mkBid({ id: 'c', price: 1.5 })]
  const r = auction.awardBatch(mkBatch(), bids)
  assert.strictEqual(r.winner.id, 'b')
  assert.strictEqual(r.price, 0.9)
})

test('同价时先出价者中标', function () {
  const bids = [
    mkBid({ id: 'late', price: 0.9, createdAt: NOW + 5000 }),
    mkBid({ id: 'early', price: 0.9, createdAt: NOW + 1000 }),
  ]
  assert.strictEqual(auction.awardBatch(mkBatch(), bids).winner.id, 'early')
})

test('无人出价 → 流拍', function () {
  const r = auction.awardBatch(mkBatch(), [])
  assert.strictEqual(r.winner, null)
  assert.strictEqual(r.reason, 'no_bids')
})

test('撤回的出价不参与排名', function () {
  const bids = [mkBid({ id: 'a', price: 0.6, status: 'withdrawn' }), mkBid({ id: 'b', price: 1.1 })]
  assert.strictEqual(auction.awardBatch(mkBatch(), bids).winner.id, 'b')
})

test('所有出价都低于底价 → 宁可流拍也不成交', function () {
  const bids = [mkBid({ id: 'a', price: 0.2 }), mkBid({ id: 'b', price: 0.3 })]
  const r = auction.awardBatch(mkBatch(), bids)
  assert.strictEqual(r.winner, null)
  assert.ok(r.reason.indexOf('all_invalid') === 0)
})

// ---------- 结算 ----------

test('整批结算 = 中标单价 × 单数', function () {
  assert.strictEqual(auction.settle(0.9, 4), 3.6)
})

test('结算保留两位小数，不产生浮点尾巴', function () {
  assert.strictEqual(auction.settle(0.87, 3), 2.61)
})

test('0 单结算为 0', function () {
  assert.strictEqual(auction.settle(1.5, 0), 0)
})

// ---------- 确认窗口 ----------

test('中标后超过 5 分钟未确认 → 作废', function () {
  const award = { awardedAt: NOW }
  assert.strictEqual(auction.isConfirmExpired(award, NOW + 6 * 60000), true)
  assert.strictEqual(auction.isConfirmExpired(award, NOW + 4 * 60000), false)
})

test('没有中标记录时不算过期', function () {
  assert.strictEqual(auction.isConfirmExpired(null, NOW), false)
})

// ---------- 汇总 ----------
console.log('\n通过 ' + passed + ' 项')
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项')
  process.exit(1)
}
