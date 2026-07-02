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

      // Позволяем импортировать .mjs-модули (напр. pdfjs-dist) без ошибок fullySpecified
      webpackConfig.module.rules.push({
        test: /\.mjs$/,
        include: /node_modules/,
        type: 'javascript/auto',
        resolve: { fullySpecified: false }
      });

      return webpackConfig;
    }
  }
};
