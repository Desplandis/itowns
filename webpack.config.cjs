const path = require('path');
const ESLintPlugin = require('eslint-webpack-plugin');

const mode = process.env.NODE_ENV;
const debugBuild = mode === 'development';

const include = [
    path.resolve(__dirname, 'src'),
    path.resolve(__dirname, 'test'),
    path.resolve(__dirname, 'utils'),
    path.resolve(__dirname, 'packages/Geodesy'),
];

const exclude = [
    path.resolve(__dirname, '.git'),
    path.resolve(__dirname, 'node_modules'),
];

const alias = {
    '@itowns/geodesy': path.resolve(__dirname, 'packages/Geodesy/src/Main.js'),
};

module.exports = () => {
    console.log('TO REMOVE');
    return {
        mode,
        context: path.resolve(__dirname),
        resolve: {
            alias,
        },
        entry: {
            itowns: [
                'core-js',
                './src/MainBundle.js',
            ],
            debug: {
                import: './utils/debug/Main.js',
                dependOn: 'itowns',
            },
            itowns_widgets: {
                import: './src/Utils/gui/Main.js',
                dependOn: 'itowns',
            },
        },
        devtool: 'source-map',
        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: '[name].js',
            library: '[name]',
            libraryTarget: 'umd',
            umdNamedDefine: true,
        },
        module: {
            rules: [
                {
                    test: /\.js$/,
                    exclude,
                    include,
                    use: {
                        loader: 'babel-loader',
                        options: {
                            rootMode: 'upward',
                        },
                    },
                },
            ],
        },
        plugins: [
        ],
        devServer: {
            devMiddleware: {
                publicPath: '/dist/',
            },
            static: {
                directory: path.resolve(__dirname, './'),
                watch: {
                    ignored: exclude,
                },
            },
            client: {
                overlay: {
                    errors: true,
                    runtimeErrors: false,
                    warnings: false,
                },
            },
        },
    };
};
