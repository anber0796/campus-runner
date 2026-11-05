/**
 * 邀请裂变测试
 *
 *   node scripts/test-invite.js
 *
 * 这是唯一直接往外送钱的模块，20/30 元的奖励一旦被刷，损失是实打实的。
 * 所以防刷规则要和奖励规则写得一样死。
 */
const assert = require('assert')
const invite = require('../cloudfunctions/packer/lib/invite')

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

const NOW = new Date('2026-11-05T12:00:00').getTime()

function mkInvitees(n, withFirstOrder) {
  const out = []
  for (let i = 0; i < n; i++) {
    out.push({
      registeredAt: NOW - 2 * 86400000,
      firstOrderAt: withFirstOrder ? NOW - 86400000 : null,
    })
  }
  return out
}

// ---------- 奖励计算 ----------

test('9 人注册 → 0 元（没满 10）', function () {
  assert.strictEqual(invite.calcInviteReward(mkInvitees(9, false)).amount, 0)
})

test('满 10 人注册 → 20 元', function () {
  const r = invite.calcInviteReward(mkInvitees(10, false))
  assert.strictEqual(r.amount, 20)
  assert.strictEqual(r.teams.register, 1)
  assert.strictEqual(r.teams.firstOrder, 0)
})

test('10 人注册且都完成首单 → 20 + 30 = 50 元', function () {
  assert.strictEqual(invite.calcInviteReward(mkInvitees(10, true)).amount, 50)
})

test('25 人注册 → 两个档位共 40 元', function () {
  assert.strictEqual(invite.calcInviteReward(mkInvitees(25, false)).amount, 40)
})

test('注册 20 人、其中 10 人下单 → 两个注册档 + 一个首单档 = 70 元', function () {
  const list = mkInvitees(10, true).concat(mkInvitees(10, false))
  const r = invite.calcInviteReward(list)
  assert.strictEqual(r.registered, 20)
  assert.strictEqual(r.firstOrdered, 10)
  assert.strictEqual(r.teams.register, 2)
  assert.strictEqual(r.teams.firstOrder, 1)
  assert.strictEqual(r.amount, 2 * 20 + 1 * 30)
})

test('首单超过 7 天才完成 → 只算注册档，不算首单档', function () {
  const veryLate = []
  for (let i = 0; i < 10; i++) {
    veryLate.push({
      registeredAt: NOW - 30 * 86400000,
      firstOrderAt: NOW - 20 * 86400000, // 间隔 10 天 > 7 天窗口
    })
  }
  const r = invite.calcInviteReward(veryLate)
  assert.strictEqual(r.registered, 10)
  assert.strictEqual(r.firstOrdered, 0, '超窗的首单不该计入')
  assert.strictEqual(r.amount, 20)
})

test('首单在 7 天窗口内 → 计入', function () {
  const list = []
  for (let i = 0; i < 10; i++) {
    list.push({ registeredAt: NOW - 10 * 86400000, firstOrderAt: NOW - 5 * 86400000 })
  }
  const r = invite.calcInviteReward(list)
  assert.strictEqual(r.firstOrdered, 10)
  assert.strictEqual(r.amount, 50)
})

test('显示还差几个人的进度', function () {
  const r = invite.calcInviteReward(mkInvitees(7, false))
  assert.strictEqual(r.nextRegisterGap, 3)
})

test('空列表不报错', function () {
  assert.strictEqual(invite.calcInviteReward([]).amount, 0)
  assert.strictEqual(invite.calcInviteReward(null).amount, 0)
})

// ---------- 防刷 ----------

function mkUser(o) {
  return Object.assign({
    openid: 'o1',
    phone: '13800000001',
    deviceId: 'd1',
    createdAt: NOW - 10 * 86400000,
  }, o || {})
}

test('自己邀请自己 → 拒绝', function () {
  const u = mkUser()
  assert.strictEqual(invite.validateInvite(u, u, NOW).reason, 'self_invite')
})

test('同手机号 → 拒绝', function () {
  const a = mkUser()
  const b = mkUser({ openid: 'o2', deviceId: 'd2' })
  assert.strictEqual(invite.validateInvite(a, b, NOW).reason, 'same_phone')
})

test('同设备 → 拒绝', function () {
  const a = mkUser()
  const b = mkUser({ openid: 'o2', phone: '13900000002' })
  assert.strictEqual(invite.validateInvite(a, b, NOW).reason, 'same_device')
})

test('已经被邀请过 → 拒绝（一人只能被邀一次）', function () {
  const a = mkUser()
  const b = mkUser({ openid: 'o2', phone: '13900000002', deviceId: 'd2', invitedBy: 'someone' })
  assert.strictEqual(invite.validateInvite(a, b, NOW).reason, 'already_invited')
})

test('邀请人账号不足 24 小时 → 拒绝（挡批量注册）', function () {
  const a = mkUser({ createdAt: NOW - 3600000 })
  const b = mkUser({ openid: 'o2', phone: '13900000002', deviceId: 'd2' })
  assert.strictEqual(invite.validateInvite(a, b, NOW).reason, 'inviter_too_new')
})

test('正常邀请 → 通过', function () {
  const a = mkUser()
  const b = mkUser({ openid: 'o2', phone: '13900000002', deviceId: 'd2' })
  assert.strictEqual(invite.validateInvite(a, b, NOW).ok, true)
})

// ---------- 邀请码 ----------

test('邀请码 6 位', function () {
  assert.strictEqual(invite.genCode().length, 6)
})

test('邀请码不含易混淆字符 0/O/1/I/L', function () {
  for (let i = 0; i < 200; i++) {
    const c = invite.genCode()
    assert.ok(!/[0O1IL]/.test(c), '出现了易混淆字符: ' + c)
  }
})

test('注入随机源时结果可预测（便于测试）', function () {
  const code = invite.genCode(function () { return 0 })
  assert.strictEqual(code, '222222')
})

// ---------- 汇总 ----------
console.log('\n通过 ' + passed + ' 项')
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项')
  process.exit(1)
}
