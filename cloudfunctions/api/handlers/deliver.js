const commission = require('../lib/commission')
const { AppError } = require('../lib/errors')
const config = require('../lib/config')
const packsHandler = require('./packs')

async function loadOwnPack(db, packId, openid) {
  const res = await db.collection('packs').doc(packId).get()
  const pack = res.data
  if (!pack) throw AppError(404, '包不存在')
  if (pack.acceptedBy !== openid) throw AppError(403, '这不是你的单')
  return pack
}

module.exports = {
  /**
   * 到店核销取餐。
   * 这是"学生真的到了食堂"最可靠的信号——不依赖 GPS（校园楼间漂移严重，PRD 6.2）。
   */
  'deliver.pickup': async function (args) {
    const db = args.db
    const pack = await loadOwnPack(db, args.event.packId, args.ctx.OPENID)
    const orders = pack.orders || []
    const idx = orders.findIndex(function (o) { return o.id === args.event.orderId })
    if (idx < 0) throw AppError(404, '这一单不在包里')
    if (orders[idx].picked) {
      return packsHandler.decorate(pack)
    }

    const data = {}
    data['orders.' + idx + '.picked'] = true
    data['orders.' + idx + '.pickedAt'] = Date.now()
    data.updatedAt = Date.now()

    await db.collection('packs').doc(pack._id).update({ data: data })

    const allPicked = orders.every(function (o, i) {
      return i === idx ? true : !!o.picked
    })

    if (allPicked && pack.status === 'accepted') {
      await db.collection('packs')
        .where({ _id: pack._id, status: 'accepted' })
        .update({ data: { status: 'picked', pickedAt: Date.now(), updatedAt: Date.now() } })
    }

    const fresh = await db.collection('packs').doc(pack._id).get()
    return packsHandler.decorate(fresh.data)
  },

  /**
   * 送达完成：写照片、推进状态、生成待结算流水。
   * 注意——平台侧"点送达"仍然由学生自己在平台骑手 App 里做（PRD 8.4），
   * 我们只记录影子副本，不做状态回传。
   */
  'deliver.complete': async function (args) {
    const db = args.db
    const event = args.event
    const pack = await loadOwnPack(db, event.packId, args.ctx.OPENID)

    if (!(pack.orders || []).every(function (o) { return o.picked })) {
      throw AppError(400, '还有餐没取，不能标记送达')
    }
    if (!event.photo) {
      throw AppError(400, '请先上传送达照片')
    }

    const income = commission.calcPackIncome(pack.orders)

    const r = await db.collection('packs')
      .where({ _id: pack._id, status: 'picked' })
      .update({
        data: {
          status: 'delivered',
          deliveredAt: Date.now(),
          photo: event.photo,
          income: income,
          updatedAt: Date.now(),
        },
      })

    const updated = r && r.stats ? r.stats.updated : 0
    if (updated !== 1) {
      throw AppError(409, '状态已变化，请刷新后重试')
    }

    await db.collection('wallet_logs').add({
      data: {
        tenantId: config.TENANT_ID,
        openid: args.ctx.OPENID,
        packId: pack._id,
        type: 'delivery_income',
        amount: income.total,
        status: 'pending',
        title: pack.canteenName + ' · ' + (pack.orders || []).length + ' 单',
        createdAt: Date.now(),
      },
    })

    const fresh = await db.collection('packs').doc(pack._id).get()
    return packsHandler.decorate(fresh.data)
  },
}
