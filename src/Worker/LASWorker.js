import LASLoader from 'Parser/LASLoader';

const loader = new LASLoader();

self.onmessage = (event) => {
    const { id, data, options } = event.data;

    if (!options.pointCount) {
        loader.parseFile(data, options)
            .then(attributes => self.postMessage({ id, attributes }))
            .catch(() => self.postMessage({ id, attributes: undefined }));
    } else {
        loader.parseChunk(data, options)
            .then(attributes => self.postMessage({ id, attributes }))
            .catch(() => self.postMessage({ id, attributes: undefined }));
    }
};
