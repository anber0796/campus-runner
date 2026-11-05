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
      // 同一层内按商家名排序：同一家的单挨在一起，到了店门口一次取完
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
    inputNo: '',
    busy: false,
    allPicked: false,
    groups: [],
    nextStop: null,
    undoId: '',
  },

  onLoad(query) {
    // 从「我的任务」点进来时带 id，直接定位到那一批
    this.wantId = (query && query.id) || ''
  },

  onShow() {
    this.load()
  },

  load() {
    const that = this
    this.setData({ loading: true, error: '' })
    riderApi
      .myBatches()
      .then(function (d) {
        const active = d.active || []
        that.setData({ loading: false, batches: active })
        // 带了 id 就定位；只有一批也直接进去，省一次点击
        if (that.wantId && !that.data.current) {
          const hit = active.filter(function (b) { return b.id === that.wantId })[0]
          if (hit) that.select(hit.id)
          return
        }
        if (active.length === 1 && !that.data.current) that.select(active[0].id)
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
    // 全部取齐后，取餐板块整块隐藏，页面只剩「送达」
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

    this.setData({
      current: batch,
      orders: orders,
      allPicked: allPicked,
      groups: groups,
      nextStop: nextStop,
    })
  },

  onInputNo(e) {
    this.setData({ inputNo: e.detail.value })
  },

  // 扫码取餐：扫小票条码/运单码，比手输快得多
  scan() {
    const that = this
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['barCode', 'qrCode'],
      success: function (res) {
        that.doPickup(res.result)
      },
      fail: function () {
        wx.showToast({ title: '没扫到，可以手输运单号', icon: 'none' })
      },
    })
  },

  manualPickup() {
    this.doPickup(this.data.inputNo)
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
      .then(function () {
        that.setData({ busy: false, undoId: orderId })
        wx.showToast({ title: '已取餐', icon: 'success' })
        that.load()
        that.select(that.data.current.id)
        // 3 秒内可以撤销，过期自动收起
        clearTimeout(that._undoTimer)
        that._undoTimer = setTimeout(function () {
          that.setData({ undoId: '' })
        }, 3000)
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
        that.select(that.data.current.id)
      })
      .catch(function (err) {
        wx.showToast({ title: err.message || '撤销失败', icon: 'none' })
      })
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
      .then(function (r) {
        that.setData({ busy: false, inputNo: '' })
        wx.showToast({ title: '已取餐', icon: 'success' })
        that.load()
        that.select(that.data.current.id)
      })
      .catch(function (e) {
        that.setData({ busy: false })
        wx.showToast({ title: e.message || '取餐失败', icon: 'none' })
      })
  },

  // 送达：拍照留证
  deliver(e) {
    const that = this
    const orderId = e.currentTarget.dataset.id

    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      // 直接进相机，省一次选择
      sourceType: ['camera'],
      camera: 'back',
      success: function (res) {
        const photo = res.tempFiles[0].tempFilePath
        that.setData({ busy: true })
        riderApi
          .deliver(that.data.current.id, orderId, photo)
          .then(function () {
            that.setData({ busy: false })
            wx.showToast({ title: '已送达', icon: 'success' })
            that.load()
            that.select(that.data.current.id)
          })
          .catch(function (err) {
            that.setData({ busy: false })
            wx.showToast({ title: err.message || '提交失败', icon: 'none' })
          })
      },
    })
  },


})
