/**
 * 结算与提现测试
 *
 *   node scripts/test-settlement.js
 */
const assert = require('assert')
const settlement = require('../cloudfunctions/packer/lib/settlement')

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
const HOUR = 3600000

function income(amount, status, agoHours) {
  return {
    type: 'claim_income',
    amount: amount,
    status: status || 'pending',
    createdAt: NOW - (agoHours || 0) * HOUR,
  }
}

function withdraw(amount, agoHours) {
  return {
    type: 'withdraw',
    amount: -amount,
    status: 'pending',
    createdAt: NOW - (agoHours || 0) * HOUR,
  }
}

// ---------- 结算 ----------

test('24 小时内的收入仍是待结算', function () {
  const r = settlement.settleDue([income(5, 'pending', 2)], NOW)
  assert.strictEqual(r.settledCount, 0)
  assert.strictEqual(r.logs[0].status, 'pending')
})

test('超过 24 小时转入已结算', function () {
  const r = settlement.settleDue([income(5, 'pending', 25)], NOW)
  assert.strictEqual(r.settledCount, 1)
  assert.strictEqual(r.logs[0].status, 'settled')
  assert.strictEqual(r.settledAmount, 5)
})

test('刚好 24 小时整 → 转入', function () {
  const r = settlement.settleDue([income(5, 'pending', 24)], NOW)
  assert.strictEqual(r.settledCount, 1)
})

test('已结算的不会被重复结算', function () {
  const r = settlement.settleDue([income(5, 'settled', 48)], NOW)
  assert.strictEqual(r.settledCount, 0)
})

test('提现流水不参与结算', function () {
  const r = settlement.settleDue([withdraw(20, 48)], NOW)
  assert.strictEqual(r.settledCount, 0)
})

// ---------- 余额 ----------

test('待结算不计入可提现', function () {
  const b = settlement.balance([income(5, 'pending', 1)])
  assert.strictEqual(b.pending, 5)
  assert.strictEqual(b.available, 0)
})

test('已结算计入可提现', function () {
  const b = settlement.balance([income(30, 'settled', 48)])
  assert.strictEqual(b.available, 30)
})

test('提现申请会立刻占用可提现（防同一天提两次同一笔）', function () {
  const b = settlement.balance([income(30, 'settled', 48), withdraw(20, 1)])
  assert.strictEqual(b.withdrawing, 20)
  assert.strictEqual(b.available, 10)
})

test('多笔收入混合计算', function () {
  const b = settlement.balance([
    income(5, 'settled', 48),
    income(7.5, 'settled', 50),
    income(3, 'pending', 1),
  ])
  assert.strictEqual(b.settled, 12.5)
  assert.strictEqual(b.pending, 3)
  assert.strictEqual(b.available, 12.5)
})

// ---------- 提现校验 ----------

test('低于 10 元不能提现', function () {
  const r = settlement.canWithdraw({ available: 30, amount: 5 })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.reason, 'below_min')
})

test('刚好 10 元可以提现（边界包含）', function () {
  assert.strictEqual(settlement.canWithdraw({ available: 10, amount: 10 }).ok, true)
})

test('超过余额不能提现', function () {
  const r = settlement.canWithdraw({ available: 12, amount: 20 })
  assert.strictEqual(r.reason, 'insufficient')
})

test('当天提过一次就不能再提', function () {
  const r = settlement.canWithdraw({ available: 50, amount: 20, withdrawalsToday: 1 })
  assert.strictEqual(r.reason, 'daily_limit')
})

test('金额非法（0 / 负数 / NaN）被拒', function () {
  ;[0, -5, NaN].forEach(function (a) {
    assert.strictEqual(settlement.canWithdraw({ available: 50, amount: a }).ok, false, '金额 ' + a)
  })
})

test('不收手续费时到账金额等于申请金额', function () {
  const r = settlement.canWithdraw({ available: 50, amount: 20 })
  assert.strictEqual(r.fee, 0)
  assert.strictEqual(r.actual, 20)
})

// ---------- 提现流水 ----------

test('提现流水金额记负数', function () {
  const log = settlement.buildWithdrawLog('u1', 20, NOW)
  assert.strictEqual(log.type, 'withdraw')
  assert.strictEqual(log.amount, -20)
  assert.strictEqual(log.status, 'pending')
})

test('提现后余额立即减少，且不能再提同一笔', function () {
  const logs = [income(30, 'settled', 48), settlement.buildWithdrawLog('u1', 20, NOW)]
  const b = settlement.balance(logs)
  assert.strictEqual(b.available, 10)
})

test('今日提现次数统计含处理中的申请', function () {
  const logs = [withdraw(20, 1)]
  assert.strictEqual(settlement.withdrawalsToday(logs, NOW), 1)
})

test('昨天的提现不计入今天的次数', function () {
  const logs = [withdraw(20, 30)]
  assert.strictEqual(settlement.withdrawalsToday(logs, NOW), 0)
})

// ---------- 汇总 ----------
console.log('\n通过 ' + passed + ' 项')
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项')
  process.exit(1)
}
