const babel = require('@babel/core');
const fs = require('fs');

const fileItowns = 'C:\\Users\\Bogato\\Documents\\itowns-1\\packages\\itowns\\src\\Parser\\PntsParser.js';
const fileGeodesy = 'C:\\Users\\Bogato\\Documents\\itowns-1\\packages\\Geodesy\\src\\OrientationUtils.js';

console.log(fs.existsSync(fileItowns));
console.log(fs.existsSync(fileGeodesy));

function buildOptions(filename) {
    const programmaticOptions = {
        filename,
        inputSourceMap: undefined,
        sourceMaps: true,
        sourceFileName: filename,
        rootMode: "upward",
        caller: {
          name: 'babel-loader',
          target: 'web',
          supportsStaticESM: true,
          supportsDynamicImport: true,
          supportsTopLevelAwait: true
        }
      };
    
      return programmaticOptions;
}

async function test() {
    const config = await babel.loadPartialConfigAsync(
        buildOptions(fileItowns) 
    );

    return config;
}

test().then((c) => console.log(c));