const riderApi = require('../../utils/riderApi')

Page({
  data: {
    loading: true,
    error: '',
    batches: [],
    current: null,
    orders: [],
    inputNo: '',
    busy: false,
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
    this.setData({ current: batch, orders: batch.orderList || [] })
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
      sourceType: ['camera', 'album'],
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
