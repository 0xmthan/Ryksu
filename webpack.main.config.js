const { IgnorePlugin } = require('webpack')

module.exports = {
  /**
   * This is the main entry point for your application, it's the first file
   * that runs in the main process.
   */
  entry: './src/main.js',
  externals: {
    'node-fetch': 'commonjs2 node-fetch',
  },
  // Put your normal webpack config below here
  module: {
    rules: require('./webpack.rules'),
  },
  plugins: [
    // minecraft-data ships every Bedrock version's data behind lazy getters; we only
    // connect to Java servers, so skip bundling it (keeps bedrock/common, which is loaded eagerly)
    new IgnorePlugin({
      resourceRegExp: /\/data\/bedrock\/(?!common\/)/,
      contextRegExp: /minecraft-data$/,
    }),
  ],
}
