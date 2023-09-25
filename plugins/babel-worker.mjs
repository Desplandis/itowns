import babel from '@babel/core';

function workerPlugin() {
    return {
        visitor: {
            NewExpression(path) {
                // console.log(Object.keys(path));
                const node = path.node;
                if (node.callee.name !== 'Worker') {
                    return;
                }

                console.log(node.arguments[0]);
                if (node.arguments[0]?.name !== 'URL') {
                    return;
                }

                // console.log(node);
                console.log(node.arguments);
                // console.log(Object.keys(path.node));
                // console.log(path.node);
            },
        },
    };
}

export default workerPlugin;
