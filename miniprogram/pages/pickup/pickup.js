const riderApi = require('../../utils/riderApi')

/**
 * 按「档口在食堂的几楼」分组，楼层从低到高。
 * 目的是让骑手一层一层往上取，不用上上下下折返——
 * 食堂里最费时间的不是排队，是来回跑。
 */
function groupByStallFloor(orders) {
  const map = {}
  ;(orders || []).forEach(function (o) {
    const f = o.stallFloor || 1
    if (!map[f]) map[f] = []
    map[f].push(o)
  })

  return Object.keys(map)
    .map(Number)
    .sort(function (a, b) { return a - b })
    .map(function (f) {
      const list = map[f].slice().sort(function (a, b) {
        const sa = String(a.stallName || '')
        const sb = String(b.stallName || '')
        if (sa !== sb) return sa.localeCompare(sb)
        return String(a.tail).localeCompare(String(b.tail))
      })
      const stalls = []
      list.forEach(function (o) {
        if (o.stallName && stalls.indexOf(o.stallName) < 0) stalls.push(o.stallName)
      })
      return {
        floor: f,
        label: f + ' 楼',
        count: list.length,
        stallCount: stalls.length,
        pickedCount: list.filter(function (o) { return o.picked }).length,
        allDone: list.every(function (o) { return o.picked }),
        stallText: stalls.join('、'),
        orders: list,
      }
    })
}

Page({
  data: {
    loading: true,
    error: '',
    batches: [],
    current: null,
    orders: [],
    groups: [],
    nextStop: null,
    allPicked: false,
    undoId: '',
    inputNo: '',
    busy: false,
    primary: null,
  },

  onLoad(query) {
    this.wantId = (query && query.id) || ''
  },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    this.load()
    wx.stopPullDownRefresh()
  },

  load() {
    const that = this
    this.setData({ loading: true, error: '' })
    riderApi
      .myBatches()
      .then(function (d) {
        // 取餐页只处理"还没取齐"的批次；取齐的直接去送达页
        const active = (d.active || []).filter(function (b) {
          return b.status === 'ASSIGNED' || b.status === 'CLAIMED'
        })
        that.setData({ loading: false, batches: active })
        if (!active.length) {
          that.setData({ current: null, groups: [], nextStop: null, primary: null, allPicked: false })
          return
        }
        const want = that.wantId && active.filter(function (b) { return b.id === that.wantId })[0]
        const target = want || that.data.current || active[0]
        that.select(target.id)
      })
      .then(function () {
        // 刚取完最后一件：这一批已经从"待取餐"消失，直接送他去送达页
        if (that._jumpAfterPick) {
          that._jumpAfterPick = false
          wx.redirectTo({ url: '/pages/delivery/delivery?id=' + that._deliverId })
        }
      })
      .catch(function (e) {
        that.setData({ loading: false, error: e.message || '加载失败' })
      })
  },

  selectBatch(e) {
    this.select(e.currentTarget.dataset.id)
  },

  select(id) {
    const batch = this.data.batches.filter(function (b) { return b.id === id })[0]
    if (!batch) return

    const orders = batch.orderList || []
    const allPicked = orders.length > 0 && orders.every(function (o) { return o.picked })
    const groups = groupByStallFloor(orders)

    // 下一站：按楼层从低到高，第一个还没取的商家
    let nextStop = null
    for (let i = 0; i < groups.length && !nextStop; i++) {
      const g = groups[i]
      for (let j = 0; j < g.orders.length; j++) {
        if (!g.orders[j].picked) {
          nextStop = {
            floorLabel: g.floor + 'F',
            stallName: g.orders[j].stallName || '档口',
            tail: g.orders[j].tail,
            remain: orders.filter(function (o) { return !o.picked }).length,
          }
          break
        }
      }
    }

    const remain = orders.length - orders.filter(function (o) { return o.picked }).length
    const primary = allPicked
      ? { kind: 'go-deliver', label: '已取齐 ' + orders.length + ' 单', sub: '去送达' }
      : { kind: 'pick', label: '扫码取餐', sub: '还剩 ' + remain + ' 单' }

    this.setData({
      current: batch,
      orders: orders,
      allPicked: allPicked,
      groups: groups,
      nextStop: nextStop,
      primary: primary,
    })
  },

  onInputNo(e) {
    this.setData({ inputNo: e.detail.value })
  },

  scan() {
    const that = this
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['barCode', 'qrCode'],
      success: function (res) { that.doPickup(res.result) },
      fail: function () { wx.showToast({ title: '没扫到，可以手输运单号', icon: 'none' }) },
    })
  },

  manualPickup() {
    this.doPickup(this.data.inputNo)
  },

  doPickup(orderNo) {
    if (this.data.busy) return
    const no = String(orderNo || '').trim()
    if (!no) return wx.showToast({ title: '请输入运单号', icon: 'none' })
    if (!this.data.current) return wx.showToast({ title: '先选一批', icon: 'none' })

    const that = this
    this.setData({ busy: true })
    riderApi
      .pickup(this.data.current.id, no)
      .then(function () {
        that.setData({ busy: false, inputNo: '' })
        wx.showToast({ title: '已取餐', icon: 'success' })
        that.load()
      })
      .catch(function (e) {
        that.setData({ busy: false })
        wx.showToast({ title: e.message || '取餐失败', icon: 'none' })
      })
  },

  // 直接点「取餐」，不用扫码也不用输单号
  pickOrder(e) {
    if (this.data.busy) return
    const orderId = e.currentTarget.dataset.id
    if (!this.data.current) return wx.showToast({ title: '先选一批', icon: 'none' })

    const that = this
    this.setData({ busy: true })
    riderApi
      .pickup(this.data.current.id, '', orderId)
      .then(function (r) {
        that.setData({ busy: false, undoId: orderId })
        wx.showToast({ title: '已取餐', icon: 'success' })
        if (r && r.allPicked) {
          that._jumpAfterPick = true
          that._deliverId = that.data.current.id
        }
        that.load()
        clearTimeout(that._undoTimer)
        that._undoTimer = setTimeout(function () { that.setData({ undoId: '' }) }, 3000)
      })
      .catch(function (err) {
        that.setData({ busy: false })
        wx.showToast({ title: err.message || '取餐失败', icon: 'none' })
      })
  },

  undoPick(e) {
    const that = this
    const orderId = e.currentTarget.dataset.id
    clearTimeout(this._undoTimer)
    riderApi
      .unpick(this.data.current.id, orderId)
      .then(function () {
        that.setData({ undoId: '' })
        wx.showToast({ title: '已撤销', icon: 'none' })
        that.load()
      })
      .catch(function (err) {
        wx.showToast({ title: err.message || '撤销失败', icon: 'none' })
      })
  },

  primaryTap() {
    const p = this.data.primary
    if (!p || this.data.busy) return
    if (p.kind === 'pick') return this.scan()
    if (p.kind === 'go-deliver') {
      wx.navigateTo({ url: '/pages/delivery/delivery?id=' + this.data.current.id })
    }
  },
})
