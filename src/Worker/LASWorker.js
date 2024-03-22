import LASLoader from 'Parser/LASLoader';
import { expose, Transfer } from 'threads/worker';

const loader = new LASLoader();

function transferable(attributes) {
    const { origin, ...attrs } = attributes;
    return Object.values(attrs).map(a => a.buffer);
}

expose({
    async parseFile(data, options) {
        const result = await loader.parseFile(data, options);
        return Transfer(result, transferable(result.attributes));
    },
});
