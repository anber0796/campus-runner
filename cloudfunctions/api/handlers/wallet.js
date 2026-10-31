module.exports = {
  'wallet.summary': async function (args) {
    const db = args.db
    const openid = args.ctx.OPENID
    const $ = db.command.aggregate

    // 按状态汇总，避免把全部流水拉到内存里累加
    const agg = await db.collection('wallet_logs')
      .aggregate()
      .match({ openid: openid })
      .group({ _id: '$status', total: $.sum('$amount') })
      .end()

    const sums = { pending: 0, settled: 0 }
    ;(agg.list || []).forEach(function (row) {
      if (row._id === 'pending' || row._id === 'settled') {
        sums[row._id] = Math.round(row.total * 100) / 100
      }
    })

    const logs = await db.collection('wallet_logs')
      .where({ openid: openid })
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get()

    return {
      pending: sums.pending,
      settled: sums.settled,
      logs: logs.data || [],
    }
  },
}
