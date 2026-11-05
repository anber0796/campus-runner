/**
 * 骑手端接口（rider.*）—— 学生是兼职工作者，不投标，只抢单
 *
 * 与 admin.* 的区别：这里用 openid 认人（微信身份），不需要 token。
 * 与 api.*（旧的学生端）的区别：那套是"顺路包"模型，这套是"抢单"模型。
 * 两套并存到旧页面下线为止。
 */
const claim = require('../lib/claim')
const invite = require('../lib/invite')
const config = require('../lib/config')
const { AppError } = require('../lib/errors')

const BATCH = 'batches'
const STUDENT = 'students'

async function getStudent(db, openid) {
  const res = await db.collection(STUDENT).where({ openid: openid }).limit(1).get()
  return res.data && res.data[0] ? res.data[0] : null
}

async function fetchAll(query, pageSize) {
  const size = pageSize || 100
  const out = []
  let skip = 0
  for (;;) {
    const res = await query.skip(skip).limit(size).get()
    const batch = res.data || []
    out.push.apply(out, batch)
    if (batch.length < size) break
    skip += size
    if (skip > 2000) break
  }
  return out
}

/** 批次展示所需的字段，别把内部字段全甩给前端 */
function shape(batch) {
  const count = batch.orderCount || (batch.orders || []).length
  return {
    id: batch._id,
    canteenId: batch.canteenId,
    buildingId: batch.buildingId,
    buildingIds: batch.buildingIds || [batch.buildingId],
    waveId: batch.waveId,
    floorBand: batch.floorBand,
    floorRange: (batch.minFloor || 1) + '-' + (batch.maxFloor || 1) + ' 层',
    crossBuilding: !!batch.crossBuilding,
    orderCount: count,
    price: batch.price,
    earn: claim.settle(batch),
    status: batch.status,
    tails: (batch.orders || []).map(function (o) {
      return typeof o === 'string' ? o.slice(-4) : (o.tail || '')
    }),
    claimDeadline: batch.claimDeadline || 0,
  }
}

module.exports = {
  /** 抢单大厅：我能抢的批次 */
  'rider.home': async function (args) {
    const db = args.db
    const student = await getStudent(db, args.ctx.OPENID)
    if (!student) throw AppError(403, '请先完成注册')
    if (student.status !== 'active') throw AppError(403, '认证通过后才能接单')

    const all = await fetchAll(db.collection(BATCH).where({
      tenantId: config.TENANT_ID,
      status: 'POOLED',
    }))

    const cover = student.coverageBuildings || [student.buildingId]
    const now = Date.now()

    const list = all
      .filter(function (b) {
        const need = b.buildingIds || [b.buildingId]
        return need.every(function (x) { return cover.indexOf(x) >= 0 })
      })
      .filter(function (b) { return !b.claimDeadline || now <= b.claimDeadline })
      .map(shape)
      // 价高的排前面——学生优先看到划算的
      .sort(function (a, b) {
        if (b.earn !== a.earn) return b.earn - a.earn
        return b.orderCount - a.orderCount
      })

    const gate = claim.canClaim(student, { status: 'POOLED', price: 1, buildingId: student.buildingId }, now)
    return {
      student: {
        name: student.name,
        credit: student.credit,
        claimsToday: student.claimsToday || 0,
        activeClaims: student.activeClaims || 0,
        coverage: cover,
      },
      canClaim: gate,
      batches: list,
    }
  },

  /**
   * 抢单。原子性靠条件更新：
   * 只有 status 仍是 POOLED 才能改成 CLAIMED，两个人同抢只有一个人 updated === 1。
   */
  'rider.grab': async function (args) {
    const db = args.db
    const openid = args.ctx.OPENID
    const batchId = args.event.batchId
    const _ = db.command

    const student = await getStudent(db, openid)
    if (!student) throw AppError(403, '请先完成注册')

    const res = await db.collection(BATCH).doc(batchId).get()
    const batch = res.data
    if (!batch) throw AppError(404, '批次不存在')

    const gate = claim.canClaim(student, batch, Date.now())
    if (!gate.ok) throw AppError(409, gate.reason)

    const upd = await db.collection(BATCH)
      .where({ _id: batchId, status: 'POOLED' })
      .update({
        data: {
          status: 'CLAIMED',
          claimedBy: openid,
          claimedAt: Date.now(),
          updatedAt: Date.now(),
          version: _.inc(1),
        },
      })

    const judge = claim.judgeClaim(upd && upd.stats ? upd.stats.updated : 0)
    if (!judge.ok) throw AppError(409, '手慢了，这批已被抢走')

    // 学生侧计数：当日抢单数 + 手上未完成数
    await db.collection(STUDENT).doc(student._id).update({
      data: {
        claimsToday: _.inc(1),
        activeClaims: _.inc(1),
        updatedAt: Date.now(),
      },
    })

    return { ok: true, batch: shape(batch) }
  },

  /** 我的批次 */
  'rider.myBatches': async function (args) {
    const db = args.db
    const openid = args.ctx.OPENID
    const list = await fetchAll(db.collection(BATCH).where({ claimedBy: openid }))
    const shaped = list.map(shape)
    return {
      active: shaped.filter(function (b) { return b.status !== 'DELIVERED' }),
      finished: shaped.filter(function (b) { return b.status === 'DELIVERED' }),
    }
  },

  /**
   * 取餐：扫码或手输运单号。
   * 支持输完整单号或只输尾号——现场手输时没人想敲 18 位。
   */
  'rider.pickup': async function (args) {
    const db = args.db
    const openid = args.ctx.OPENID
    const batchId = args.event.batchId
    const orderNo = String(args.event.orderNo || '').trim()
    if (!orderNo) throw AppError(400, '请输入或扫描运单号')

    const res = await db.collection(BATCH).doc(batchId).get()
    const batch = res.data
    if (!batch) throw AppError(404, '批次不存在')
    if (batch.claimedBy !== openid) throw AppError(403, '这不是你的批次')

    const orders = batch.orders || []
    let hit = -1
    for (let i = 0; i < orders.length; i++) {
      const o = orders[i]
      const no = typeof o === 'string' ? o : (o.channelOrderNo || o.id || '')
      if (no === orderNo || (no && no.slice(-4) === orderNo)) { hit = i; break }
    }
    if (hit < 0) throw AppError(404, '这批里没有这个运单号')

    const data = {}
    data['orders.' + hit + '.picked'] = true
    data['orders.' + hit + '.pickedAt'] = Date.now()
    data.updatedAt = Date.now()

    await db.collection(BATCH).doc(batchId).update({ data: data })

    const fresh = await db.collection(BATCH).doc(batchId).get()
    const allPicked = (fresh.data.orders || []).every(function (o) {
      return typeof o === 'string' ? false : !!o.picked
    })
    if (allPicked) {
      await db.collection(BATCH).where({ _id: batchId, status: 'CLAIMED' })
        .update({ data: { status: 'PICKED', pickedAt: Date.now() } })
    }

    return { ok: true, allPicked: allPicked }
  },

  /** 单笔送达（拍照留证） */
  'rider.deliver': async function (args) {
    const db = args.db
    const openid = args.ctx.OPENID
    const batchId = args.event.batchId
    const orderId = args.event.orderId
    const photo = args.event.photo
    if (!photo) throw AppError(400, '请先上传送达照片')

    const res = await db.collection(BATCH).doc(batchId).get()
    const batch = res.data
    if (!batch) throw AppError(404, '批次不存在')
    if (batch.claimedBy !== openid) throw AppError(403, '这不是你的批次')

    const orders = batch.orders || []
    const idx = orders.findIndex(function (o) { return (o.id || o) === orderId })
    if (idx < 0) throw AppError(404, '这一单不在批次里')

    const data = {}
    data['orders.' + idx + '.delivered'] = true
    data['orders.' + idx + '.deliveredAt'] = Date.now()
    data['orders.' + idx + '.photo'] = photo
    data.updatedAt = Date.now()
    await db.collection(BATCH).doc(batchId).update({ data: data })

    const fresh = await db.collection(BATCH).doc(batchId).get()
    const allDone = (fresh.data.orders || []).every(function (o) {
      return typeof o === 'string' ? false : !!o.delivered
    })

    if (allDone) {
      await db.collection(BATCH).where({ _id: batchId, status: 'PICKED' })
        .update({ data: { status: 'DELIVERED', deliveredAt: Date.now() } })

      await db.collection('wallet_logs').add({
        data: {
          tenantId: config.TENANT_ID,
          openid: openid,
          batchId: batchId,
          type: 'claim_income',
          amount: claim.settle(fresh.data),
          status: 'pending',
          title: (fresh.data.floorRange || '') + ' · ' + (fresh.data.orderCount || 0) + ' 单',
          createdAt: Date.now(),
        },
      })
      await db.collection(STUDENT).doc((await getStudent(db, openid))._id).update({
        data: { activeClaims: db.command.inc(-1) },
      })
    }

    return { ok: true, allDone: allDone }
  },

  /** 我的邀请码与进度 */
  'rider.invite': async function (args) {
    const db = args.db
    const student = await getStudent(db, args.ctx.OPENID)
    if (!student) throw AppError(403, '请先完成注册')

    let code = student.inviteCode
    if (!code) {
      code = invite.genCode()
      await db.collection(STUDENT).doc(student._id).update({ data: { inviteCode: code } })
    }

    const res = await db.collection(STUDENT).where({ invitedBy: student.openid }).get()
    const invitees = (res.data || []).map(function (s) {
      return { registeredAt: s.createdAt, firstOrderAt: s.firstOrderAt || null }
    })

    return Object.assign({ code: code }, invite.calcInviteReward(invitees))
  },

  /** 填别人的邀请码 */
  'rider.bindInvite': async function (args) {
    const db = args.db
    const code = String(args.event.code || '').trim().toUpperCase()
    if (!code) throw AppError(400, '请输入邀请码')

    const me = await getStudent(db, args.ctx.OPENID)
    if (!me) throw AppError(403, '请先完成注册')

    const res = await db.collection(STUDENT).where({ inviteCode: code }).limit(1).get()
    const inviter = res.data && res.data[0]
    if (!inviter) throw AppError(404, '邀请码无效')

    const check = invite.validateInvite(inviter, me, Date.now())
    if (!check.ok) throw AppError(409, check.reason)

    await db.collection(STUDENT).doc(me._id).update({
      data: { invitedBy: inviter.openid, invitedAt: Date.now() },
    })
    return { ok: true, inviter: inviter.name || '' }
  },
}
