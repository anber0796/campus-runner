// app.js
const config = require('./utils/config')

App({
  globalData: {
    student: null,
    env: config.CLOUD_ENV,
    useMock: config.USE_MOCK,
  },

  onLaunch() {
    if (!config.USE_MOCK && wx.cloud) {
      wx.cloud.init({ env: config.CLOUD_ENV, traceUser: true })
    }
  },
})
