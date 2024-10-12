import chalk from 'chalk';
import { execSync } from 'child_process';

// Verify Puppeteer configuration
const pupSkip = process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD;

if (!pupSkip) {
    console.log(chalk.yellow(`Warning PUPPETEER_SKIP_CHROMIUM_DOWNLOAD is undefined,
the installation'll be longer because Puppeteer'll download Chromium,
only needed for testing. Read CODING.md for more information.\n`));
}

console.log(chalk.green('Node.js version :', process.versions.node));

const npmVersion = execSync('npm --version', {
    encoding: 'utf8',
});
if (npmVersion) {
    console.log(chalk.green('Npm version :', npmVersion), '\n');
}
