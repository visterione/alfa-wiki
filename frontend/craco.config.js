const webpack = require('webpack');

module.exports = {
  webpack: {
    configure: (webpackConfig) => {
      // Добавляем ProvidePlugin для автоматического предоставления jQuery
      webpackConfig.plugins.push(
        new webpack.ProvidePlugin({
          $: 'jquery',
          jQuery: 'jquery',
          'window.jQuery': 'jquery',
          'window.$': 'jquery'
        })
      );

      return webpackConfig;
    }
  }
};
