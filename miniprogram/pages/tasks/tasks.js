const riderApi = require('../../utils/riderApi')

function leftText(deadline) {
  if (!deadline) return ''
  const ms = deadline - Date.now()
  if (ms <= 0) return '已截止'
  const min = Math.floor(ms / 60000)
  return min < 1 ? '即将截止' : '剩 ' + min + ' 分'
}

function fmtTime(ts) {
  const d = new Date(ts)
  return (d.getMonth() + 1) + '-' + d.getDate() + ' ' +
    String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

const STATUS = {
  ASSIGNED: { text: '待取餐', cls: 'tag tag-amber' },
  CLAIMED: { text: '待取餐', cls: 'tag tag-amber' },
  PICKED: { text: '待送达', cls: 'tag' },
  DELIVERED: { text: '已完成', cls: 'tag tag-green' },
}

Page({
  data: {
    loading: true,
    error: '',
    tab: 'pool',
    pool: [],
    pick: [],
    deliver: [],
    done: [],
    student: null,
    canClaim: null,
    busy: false,
  },

  onShow() {
    this.load()
    const that = this
    clearInterval(this._timer)
    // 每 20 秒刷新一次倒计时；到点的重新拉一遍数据
    this._timer = setInterval(function () { that.tick() }, 20000)
  },

  onHide() {
    clearInterval(this._timer)
  },

  onUnload() {
    clearInterval(this._timer)
  },

  tick() {
    if (!this.data.pool.length) return
    let expired = false
    const pool = this.data.pool.map(function (b) {
      const t = leftText(b.claimDeadline)
      if (t === '已截止') expired = true
      return Object.assign({}, b, { leftText: t, urgent: t === '即将截止' || t === '已截止' })
    })
    this.setData({ pool: pool })
    if (expired) this.load()
  },

  onPullDownRefresh() {
    this.load()
    wx.stopPullDownRefresh()
  },

  load() {
    const that = this
    this.setData({ loading: true, error: '' })

    Promise.all([riderApi.home(), riderApi.myBatches()])
      .then(function (res) {
        const home = res[0] || {}
        const mine = res[1] || {}
        const active = mine.active || []

        const decorate = function (b) {
          const st = STATUS[b.status] || { text: b.status, cls: 'tag tag-gray' }
          return Object.assign({}, b, {
            statusText: st.text,
            statusClass: st.cls,
            earnText: '¥' + (b.earn || 0),
            priceText: b.price ? '¥' + b.price + '/单' : '',
            buildingText: (b.buildingIds || [b.buildingId]).join(' + '),
            tailText: (b.tails || []).join(' / '),
            orderText: b.orderCount + ' 单',
            leftText: leftText(b.claimDeadline),
            urgent: leftText(b.claimDeadline) === '即将截止',
            walkText: b.walkMinutes ? '步行 ' + b.walkMinutes + ' 分钟' : '',
            timeText: b.deliveredAt ? fmtTime(b.deliveredAt) : '',
          })
        }

        that.setData({
          loading: false,
          student: home.student || null,
          canClaim: home.canClaim || null,
          pool: (home.batches || []).map(decorate),
          pick: active.filter(function (b) {
            return b.status === 'ASSIGNED' || b.status === 'CLAIMED'
          }).map(decorate),
          deliver: active.filter(function (b) { return b.status === 'PICKED' }).map(decorate),
          done: (mine.finished || []).map(decorate),
        })
      })
      .catch(function (e) {
        that.setData({ loading: false, error: e.message || '加载失败' })
      })
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab })
  },

  grab(e) {
    const that = this
    const id = e.currentTarget.dataset.id
    const target = this.data.pool.filter(function (b) { return b.id === id })[0]
    if (!target || this.data.busy) return

    wx.showModal({
      title: '抢这一批？',
      content: target.buildingText + ' · ' + target.orderText + ' · 到手 ' + target.earnText,
      confirmText: '抢',
      success: function (res) {
        if (!res.confirm) return
        that.setData({ busy: true })
        riderApi
          .grab(id)
          .then(function () {
            that.setData({ busy: false, tab: 'pick' })
            wx.showToast({ title: '抢到了', icon: 'success' })
            that.load()
          })
          .catch(function (err) {
            that.setData({ busy: false })
            wx.showToast({ title: err.message || '手慢了', icon: 'none' })
            that.load()
          })
      },
    })
  },

  goPickup(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/pickup/pickup?id=' + id })
  },
})
