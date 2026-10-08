const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');

const isDev = process.env.NODE_ENV === 'development';
const devtool = isDev ? 'source-map' : false;

module.exports = [
  {
    mode: isDev ? 'development' : 'production',
    devtool,
    entry: './src/main.ts',
    target: 'node',
    output: {
      filename: 'main.js',
      path: path.resolve(__dirname, 'dist'),
      libraryTarget: 'commonjs2',
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
      ],
    },
    resolve: {
      extensions: ['.ts', '.js'],
    },
    externals: {
      'dbus-next': 'commonjs2 dbus-next',
    },
    optimization: {
      minimize: !isDev,
      minimizer: [
        new TerserPlugin({
          terserOptions: {
            compress: {
              pure_funcs: ['console.debug', 'console.trace'],
            },
          },
        }),
      ],
    },
  },
];
