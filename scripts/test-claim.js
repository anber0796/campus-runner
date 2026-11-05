/**
 * 抢单引擎测试
 *
 *   node scripts/test-claim.js
 *
 * 抢单的核心风险是"两个人抢到同一批"，那是钱和餐的双重事故。
 * 准入判定在这里测，原子性由数据库条件更新保证（judgeClaim 只做结果判定）。
 */
const assert = require('assert')
const claim = require('../cloudfunctions/packer/lib/claim')

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
    claimsToday: 0,
    activeClaims: 0,
    buildingId: 'B3',
  }, o || {})
}

function mkBatch(o) {
  return Object.assign({
    id: 'B1',
    status: 'POOLED',
    price: 1.2,
    orderCount: 3,
    buildingId: 'B3',
    claimDeadline: NOW + 10 * 60000,
  }, o || {})
}

// ---------- 准入 ----------

test('正常学生可以抢', function () {
  assert.strictEqual(claim.canClaim(mkStudent(), mkBatch(), NOW).ok, true)
})

test('未认证不能抢', function () {
  assert.strictEqual(claim.canClaim(mkStudent({ status: 'pending' }), mkBatch(), NOW).reason, 'not_certified')
})

test('信用低于 80 不能抢', function () {
  assert.strictEqual(claim.canClaim(mkStudent({ credit: 79 }), mkBatch(), NOW).reason, 'credit_too_low')
})

test('惩罚期内不能抢', function () {
  assert.strictEqual(
    claim.canClaim(mkStudent({ punishUntil: NOW + 3600000 }), mkBatch(), NOW).reason,
    'punished'
  )
})

test('当日抢满 6 批不能继续', function () {
  assert.strictEqual(claim.canClaim(mkStudent({ claimsToday: 6 }), mkBatch(), NOW).reason, 'daily_limit')
})

test('手上已有 2 个未完成批次不能继续抢', function () {
  assert.strictEqual(claim.canClaim(mkStudent({ activeClaims: 2 }), mkBatch(), NOW).reason, 'active_limit')
})

test('已被抢走的批次不能抢', function () {
  assert.strictEqual(claim.canClaim(mkStudent(), mkBatch({ status: 'CLAIMED' }), NOW).reason, 'already_taken')
})

test('过截止时间不能抢', function () {
  assert.strictEqual(
    claim.canClaim(mkStudent(), mkBatch({ claimDeadline: NOW - 1 }), NOW).reason,
    'expired'
  )
})

test('楼栋不在覆盖范围不能抢', function () {
  const r = claim.canClaim(
    mkStudent({ coverageBuildings: ['B3'] }),
    mkBatch({ buildingIds: ['B3', 'B5'] }),
    NOW
  )
  assert.strictEqual(r.reason, 'building_not_covered')
})

test('覆盖范围内可以抢多楼批次', function () {
  const r = claim.canClaim(
    mkStudent({ coverageBuildings: ['B3', 'B5'] }),
    mkBatch({ buildingIds: ['B3', 'B5'] }),
    NOW
  )
  assert.strictEqual(r.ok, true)
})

test('没定价的批次不能抢（代理商没发价）', function () {
  assert.strictEqual(claim.canClaim(mkStudent(), mkBatch({ price: 0 }), NOW).reason, 'no_price')
})

// ---------- 原子结果 ----------

test('条件更新成功 → 抢到', function () {
  assert.strictEqual(claim.judgeClaim(1).ok, true)
})

test('条件更新 0 行 → 手慢了', function () {
  const r = claim.judgeClaim(0)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.reason, 'already_taken')
})

// ---------- 结算 ----------

test('结算 = 代理商定价 × 单数（学生不能改价）', function () {
  assert.strictEqual(claim.settle({ price: 1.25, orderCount: 4 }), 5)
})

test('结算保留两位小数', function () {
  assert.strictEqual(claim.settle({ price: 0.87, orderCount: 3 }), 2.61)
})

// ---------- 确认窗口 ----------

test('抢到后超过 10 分钟没动作 → 释放', function () {
  const b = { claimedAt: NOW }
  assert.strictEqual(claim.isClaimExpired(b, NOW + 11 * 60000), true)
  assert.strictEqual(claim.isClaimExpired(b, NOW + 9 * 60000), false)
})

// ---------- 汇总 ----------
console.log('\n通过 ' + passed + ' 项')
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项')
  process.exit(1)
}
