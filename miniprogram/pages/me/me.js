const api = require('../../utils/api')
const wavesLib = require('../../utils/waves')

Page({
  data: {
    student: null,
    statusText: '',
    statusClass: 'tag-gray',
    canteenText: '',
    waveText: '',
    loading: true,
  },

  onShow() {
    this.load()
  },

  load() {
    const that = this
    api.getStudent()
      .then(function (res) {
        const s = res.student || {}
        const statusMap = {
          active: { text: '已认证', cls: 'tag-green' },
          pending: { text: '审核中', cls: 'tag-amber' },
          none: { text: '未认证', cls: 'tag-gray' },
        }
        const st = statusMap[s.status] || statusMap.none
        const waveText = (s.waveIds || []).map(function (id) {
          const w = wavesLib.byId(id)
          return w ? w.time : id
        }).join('、')

        that.setData({
          loading: false,
          student: s,
          statusText: st.text,
          statusClass: st.cls,
          canteenText: (s.canteenNames || []).join('、') || '未选择',
          waveText: waveText || '未选择',
        })
      })
      .catch(function (e) {
        that.setData({ loading: false })
        wx.showToast({ title: e.message || '加载失败', icon: 'none' })
      })
  },

  goRegister() {
    wx.navigateTo({ url: '/pages/register/register' })
  },

  goOrder() {
    wx.switchTab({ url: '/pages/order/order' })
  },

  goGrab() {
    wx.navigateTo({ url: '/pages/grab/grab' })
  },

  goPickup() {
    wx.navigateTo({ url: '/pages/pickup/pickup' })
  },

  goInvite() {
    wx.navigateTo({ url: '/pages/invite/invite' })
  },

  goAdmin() {
    wx.navigateTo({ url: '/pages/admin/login/login' })
  },
})
