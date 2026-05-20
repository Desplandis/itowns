# Documentation

The documentation of itowns is available on the itowns website:
http://www.itowns-project.org/itowns/docs/

## Writing documentation

The documentation is composed of two parts: the API reference, and
tutorials.

### API reference

The API reference is written in the source of itowns, using
[JSDoc](http://usejsdoc.org/) comment syntax, and generated with
[TypeDoc](https://typedoc.org/). [Markdown](https://commonmark.org/help/)
is supported inside doc comments.

TypeDoc reads type information directly from TypeScript (and JavaScript files
via `allowJs`), so `@param` and `@returns` tags do not need explicit types in
`.ts` files. For `.js` files, types in JSDoc tags are still picked up by the
TypeScript compiler.

Use `@category` tags to place symbols into the correct navigation group (Base,
View, Layer, Source, etc.). See `typedoc.config.mjs` at the repo root for the
full `categoryOrder` list.

#### How to document a class

A typical class should have the following documenting parts:

```js
/**
 * The description of the class.
 *
 * @category Layer
 */
class AClass {
    /** Description of a property. */
    prop;

    /**
     * @param param - Description of the parameter.
     */
    constructor(param) {}

    /**
     * Description and explanation of the method.
     *
     * @param param - Description of the parameter.
     * @returns The returned value.
     */
    method() {}
}
```

If you are not sure about a tag, a reviewer will tell you what to use in your
pull request.

### Tutorials

Tutorials are Markdown files stored in `docs/tutorials/`. They are included
in the generated docs via TypeDoc's `projectDocuments` option.

Each tutorial file must start with YAML frontmatter specifying its title and
group:

```markdown
---
title: My Tutorial
group: Getting started
---

Tutorial content here...
```

Cross-references to API symbols use `{@link ClassName}` syntax. Links between
tutorials use standard Markdown links: `[text](./OtherTutorial.md)`.

If you want to add images to the tutorial, add them inside
`docs/tutorials/images`, and name under `$TUTORIAL_NAME_xxx`, `$TUTORIAL_NAME`
being the name of the markdown file containing the tutorial, and `xxx` the
number of the picture.

## Generating documentation

Make sure all dependencies are installed (do a `npm install` if not), and simply
run this command:

```
npm run doc
```

The generation process results in the creation of a `out/` folder in `docs/`.

## Consulting the documentation locally

If you have `npm start` running, you can browse the documentation at
`http://localhost:8080/docs/out/`.

Otherwise, open `docs/out/index.html` directly in a browser, or serve it with
any static file server.
