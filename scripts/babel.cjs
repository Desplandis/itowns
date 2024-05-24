const babel = require('@babel/core');
const fs = require('fs');
const path = require('path');

const root = path.resolve('./');
const fileItowns = `${root}/src/Parser/PntsParser.js`;
const fileGeodesy = `${root}/packages/Geodesy/src/OrientationUtils.js`;
const fileDebug = `${root}/utils/debug/GeometryDebug.js`;

console.warn(fs.existsSync(fileItowns), fs.existsSync(fileGeodesy));

function buildOptions(filename) {
    const programmaticOptions = {
        filename,
        inputSourceMap: undefined,
        sourceMaps: true,
        sourceFileName: filename,
        rootMode: 'upward',
        caller: {
            name: 'babel-loader',
            target: 'web',
            supportsStaticESM: true,
            supportsDynamicImport: true,
            supportsTopLevelAwait: true,
        },
    };

    return programmaticOptions;
}

async function test(file) {
    const config = await babel.loadPartialConfigAsync(
        buildOptions(file),
    );

    return config;
}

console.warn('----');
test(fileItowns).then(c => console.warn(c));
test(fileGeodesy).then(c => console.warn(c));
test(fileDebug).then(c => console.warn(c));
