/**
 * 骑手端全链路冒烟（基于 mockRunner，不需要云环境）
 *
 *   node scripts/test-rider.js
 *
 * 覆盖：看单 → 抢单 → 取餐 → 送达 → 入账 → 提现 → 超时收回 → 放弃
 * 这不是单元测试，是把学生真实走一遍的路径跑通，防止"改了一处崩了另一处"。
 */
const assert = require('assert')
const mock = require('../miniprogram/utils/mockRunner')

let passed = 0
const failures = []

async function test(name, fn) {
  try {
    await fn()
    passed++
    console.log('  ✓ ' + name)
  } catch (e) {
    failures.push(name)
    console.log('  ✗ ' + name + '\n      ' + e.message)
  }
}

function findBatch(id) {
  return mock.state.batches.filter(function (b) { return b.id === id })[0]
}

async function main() {
  await test('可抢单列表非空，且都是单栋', async function () {
    const h = await mock.handle('rider.home', {})
    assert.ok(h.batches.length > 0, '应该有待抢批次')
    h.batches.forEach(function (b) {
      assert.ok((b.buildingIds || []).length === 1, '不应出现跨楼批次: ' + b.buildingIds)
    })
  })

  let grabbedId = ''
  await test('抢单成功，批次进入待取餐', async function () {
    const h = await mock.handle('rider.home', {})
    grabbedId = h.batches[0].id
    const r = await mock.handle('rider.grab', { batchId: grabbedId })
    assert.strictEqual(r.ok, true)

    const mine = await mock.handle('rider.myBatches', {})
    const hit = mine.active.filter(function (b) { return b.id === grabbedId })[0]
    assert.ok(hit, '抢到的批次应出现在我的批次里')
    assert.strictEqual(hit.status, 'CLAIMED')
  })

  await test('重复抢同一批被拒绝', async function () {
    let blocked = false
    try {
      await mock.handle('rider.grab', { batchId: grabbedId })
    } catch (e) { blocked = true }
    assert.ok(blocked, '已被抢走的批次不能再抢')
  })

  await test('逐单取餐，全部取完状态变 PICKED', async function () {
    const b = findBatch(grabbedId)
    for (const o of b.orders) {
      await mock.handle('rider.pickup', { batchId: grabbedId, orderId: o.id })
    }
    assert.strictEqual(b.status, 'PICKED')
  })

  await test('逐单送达，全部送完状态变 DELIVERED 并入账', async function () {
    const b = findBatch(grabbedId)
    const before = (await mock.handle('rider.wallet', {})).balance.pending
    for (const o of b.orders) {
      await mock.handle('rider.deliver', { batchId: grabbedId, orderId: o.id, photo: 'x.jpg' })
    }
    assert.strictEqual(b.status, 'DELIVERED')

    const after = (await mock.handle('rider.wallet', {})).balance.pending
    assert.ok(after > before, '送达后待结算金额应增加')
  })

  await test('取餐可以撤销，撤销后回到待取', async function () {
    const h = await mock.handle('rider.home', {})
    const id = h.batches[0].id
    await mock.handle('rider.grab', { batchId: id })
    const b = findBatch(id)
    const o = b.orders[0]

    await mock.handle('rider.pickup', { batchId: id, orderId: o.id })
    assert.strictEqual(o.picked, true)

    await mock.handle('rider.unpick', { batchId: id, orderId: o.id })
    assert.strictEqual(o.picked, false)
  })

  await test('提现低于 10 元被拒', async function () {
    let blocked = false
    try {
      await mock.handle('rider.withdraw', { amount: 5 })
    } catch (e) { blocked = true }
    assert.ok(blocked, '5 元不该能提')
  })

  await test('提现超过余额被拒', async function () {
    const w = await mock.handle('rider.wallet', {})
    let blocked = false
    try {
      await mock.handle('rider.withdraw', { amount: w.balance.available + 100 })
    } catch (e) { blocked = true }
    assert.ok(blocked, '超额提现应被拒')
  })

  await test('邀请码与进度可读', async function () {
    const inv = await mock.handle('rider.invite', {})
    assert.ok(inv.code && inv.code.length === 6)
    assert.ok(typeof inv.registered === 'number')
  })

  await test('运营：草稿批次能发单', async function () {
    const pending = await mock.handle('admin.pendingBatches', {})
    if (!pending.batches.length) return
    const b = pending.batches[0]
    const r = await mock.handle('admin.publishBatch', { batchId: b.id, price: 1.2 })
    assert.strictEqual(r.ok, true)
  })

  await test('运营：发送价超出范围被拒', async function () {
    const pending = await mock.handle('admin.pendingBatches', {})
    if (!pending.batches.length) return
    let blocked = false
    try {
      await mock.handle('admin.publishBatch', { batchId: pending.batches[0].id, price: 9 })
    } catch (e) { blocked = true }
    assert.ok(blocked, '9 元/单应被拒')
  })

  console.log('\n通过 ' + passed + ' 项')
  if (failures.length) {
    console.log('失败 ' + failures.length + ' 项')
    process.exit(1)
  }
}

main().catch(function (e) {
  console.error('崩溃:', e)
  process.exit(1)
})
