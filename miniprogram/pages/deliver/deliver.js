const api = require('../../utils/api')
const fmt = require('../../utils/format')

Page({
  data: {
    loading: true,
    pack: null,
    photo: '',
    submitting: false,
    allPicked: false,
  },

  onLoad(query) {
    this.packId = query.id
  },

  onShow() {
    this.load()
  },

  load() {
    const that = this
    api.getPack(this.packId)
      .then(function (pack) { that.render(pack) })
      .catch(function (e) {
        that.setData({ loading: false })
        wx.showToast({ title: e.message || '加载失败', icon: 'none' })
      })
  },

  render(pack) {
    const orders = (pack.income.detail || []).map(function (o) {
      return Object.assign({}, o, { tail: fmt.tail(o.tail) })
    })
    this.setData({
      loading: false,
      pack: Object.assign({}, pack, { orders: orders }),
      allPicked: orders.length > 0 && orders.every(function (o) { return o.picked }),
    })
  },

  // 到店逐档口核销：这是证明"真到了食堂"最可靠的信号，不依赖 GPS
  pickup(e) {
    const that = this
    const orderId = e.currentTarget.dataset.id
    api.pickupOrder(this.packId, orderId)
      .then(function (pack) { that.render(pack) })
      .catch(function (e) {
        wx.showToast({ title: e.message || '核销失败', icon: 'none' })
      })
  },

  choosePhoto() {
    const that = this
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      sizeType: ['compressed'],
      success: function (res) {
        that.setData({ photo: res.tempFiles[0].tempFilePath })
        wx.showToast({ title: '已拍照留证', icon: 'none' })
      },
    })
  },

  submit() {
    if (this.data.submitting) return
    if (!this.data.allPicked) {
      wx.showToast({ title: '还有餐没取', icon: 'none' })
      return
    }
    if (!this.data.photo) {
      wx.showToast({ title: '请拍一张送达照片', icon: 'none' })
      return
    }
    const that = this
    this.setData({ submitting: true })
    api.deliverPack(this.packId, this.data.photo)
      .then(function () {
        wx.showToast({ title: '送达完成', icon: 'success' })
        setTimeout(function () {
          wx.switchTab({ url: '/pages/order/order' })
        }, 700)
      })
      .catch(function (e) {
        that.setData({ submitting: false })
        wx.showToast({ title: e.message || '提交失败', icon: 'none' })
      })
  },
})
