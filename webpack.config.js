'use strict';

const path = require('path');
const webpack = require('webpack');

module.exports = (env, argv) => {
    let config = {
        mode: argv.mode,
        devtool: 'none',
        entry: [
            './src/index.ts'
        ],
        output: {
            filename: 'basic-java.js',
            library: ['BasicJava']
        },
        module: {
            rules: [
                {
                    test: /\.tsx?$/,
                    loader: 'ts-loader'
                }
            ],
        },
        resolve: {
            extensions: ['.ts', '.tsx', '.js']
        },
        node: {
            fs: "empty"
        },
        target: 'web'
    }

    if (argv.mode == 'production') {
        delete config.devtool;
    }

    return config;
};