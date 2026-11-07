/**
 * 超时释放测试
 *
 *   node scripts/test-release.js
 *
 * 这里错一行的后果：要么学生被误扣分（无辜），要么被永久锁死（更糟）。
 */
const assert = require('assert')
const release = require('../cloudfunctions/packer/lib/release')

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

const NOW = new Date('2026-11-07T12:00:00').getTime()
const MIN = 60000

function mkBatch(o) {
  return Object.assign({
    _id: 'B1',
    status: 'CLAIMED',
    claimedBy: 'u1',
    claimedAt: NOW - 20 * MIN,
    orders: [{ picked: false }, { picked: false }],
  }, o || {})
}

// ---------- 判定 ----------

test('抢单 20 分钟没取 → 该释放', function () {
  const r = release.findExpired([mkBatch()], NOW)
  assert.strictEqual(r.length, 1)
  assert.strictEqual(r[0].batchId, 'B1')
  assert.strictEqual(r[0].ageMin, 20)
})

test('抢单 5 分钟 → 不释放', function () {
  const r = release.findExpired([mkBatch({ claimedAt: NOW - 5 * MIN })], NOW)
  assert.strictEqual(r.length, 0)
})

test('刚好 15 分钟 → 释放（边界包含）', function () {
  const r = release.findExpired([mkBatch({ claimedAt: NOW - 15 * MIN })], NOW)
  assert.strictEqual(r.length, 1)
})

test('已经取过一单 → 人到了，不释放', function () {
  const r = release.findExpired([
    mkBatch({ orders: [{ picked: true }, { picked: false }] }),
  ], NOW)
  assert.strictEqual(r.length, 0, '人已经在店里了，不该收回')
})

test('不是 CLAIMED 状态的不动', function () {
  ;['POOLED', 'ASSIGNED', 'PICKED', 'DELIVERED'].forEach(function (st) {
    const r = release.findExpired([mkBatch({ status: st })], NOW)
    assert.strictEqual(r.length, 0, st + ' 不该被释放')
  })
})

test('没有 claimedAt 的脏数据不误伤', function () {
  const r = release.findExpired([mkBatch({ claimedAt: null })], NOW)
  assert.strictEqual(r.length, 0)
})

test('多个批次只挑到期的', function () {
  const r = release.findExpired([
    mkBatch({ _id: 'A', claimedAt: NOW - 30 * MIN }),
    mkBatch({ _id: 'B', claimedAt: NOW - 2 * MIN }),
    mkBatch({ _id: 'C', claimedAt: NOW - 16 * MIN }),
  ], NOW)
  assert.deepStrictEqual(r.map(function (x) { return x.batchId }), ['A', 'C'])
})

test('空列表不报错', function () {
  assert.deepStrictEqual(release.findExpired([], NOW), [])
  assert.deepStrictEqual(release.findExpired(null, NOW), [])
})

test('可以自定义超时时间', function () {
  const r = release.findExpired([mkBatch({ claimedAt: NOW - 8 * MIN })], NOW, { timeoutMin: 5 })
  assert.strictEqual(r.length, 1)
})

// ---------- 并发保护 ----------

test('条件更新成功才算释放', function () {
  assert.strictEqual(release.judgeRelease(1), true)
  assert.strictEqual(release.judgeRelease(0), false)
})

console.log('\n通过 ' + passed + ' 项')
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项')
  process.exit(1)
}
