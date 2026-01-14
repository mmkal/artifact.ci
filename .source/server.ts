// @ts-nocheck
import * as __fd_glob_27 from "../content/docs/recipes/testing/vitest.md?collection=docs"
import * as __fd_glob_26 from "../content/docs/recipes/testing/playwright.md?collection=docs"
import * as __fd_glob_25 from "../content/docs/recipes/testing/mocha.md?collection=docs"
import * as __fd_glob_24 from "../content/docs/recipes/testing/jest.md?collection=docs"
import * as __fd_glob_23 from "../content/docs/recipes/testing/ava.md?collection=docs"
import * as __fd_glob_22 from "../content/docs/recipes/other-languages/python.md?collection=docs"
import * as __fd_glob_21 from "../content/docs/recipes/other-languages/go.md?collection=docs"
import * as __fd_glob_20 from "../content/docs/recipes/more/website.md?collection=docs"
import * as __fd_glob_19 from "../content/docs/recipes/more/pdf.md?collection=docs"
import * as __fd_glob_18 from "../content/docs/recipes/more/eslint.md?collection=docs"
import * as __fd_glob_17 from "../content/docs/recipes/testing.md?collection=docs"
import * as __fd_glob_16 from "../content/docs/recipes/other-languages.md?collection=docs"
import * as __fd_glob_15 from "../content/docs/recipes/more.md?collection=docs"
import * as __fd_glob_14 from "../content/docs/recipes/index.md?collection=docs"
import * as __fd_glob_13 from "../content/docs/recipes/badges.mdx?collection=docs"
import * as __fd_glob_12 from "../content/docs/legal/privacy.mdx?collection=docs"
import * as __fd_glob_11 from "../content/docs/legal/data-retention.mdx?collection=docs"
import * as __fd_glob_10 from "../content/docs/legal/contact.mdx?collection=docs"
import * as __fd_glob_9 from "../content/docs/self-hosting.md?collection=docs"
import * as __fd_glob_8 from "../content/docs/not.md?collection=docs"
import * as __fd_glob_7 from "../content/docs/index.mdx?collection=docs"
import * as __fd_glob_6 from "../content/docs/advanced.md?collection=docs"
import { default as __fd_glob_5 } from "../content/docs/recipes/testing/meta.json?collection=docs"
import { default as __fd_glob_4 } from "../content/docs/recipes/other-languages/meta.json?collection=docs"
import { default as __fd_glob_3 } from "../content/docs/recipes/more/meta.json?collection=docs"
import { default as __fd_glob_2 } from "../content/docs/recipes/meta.json?collection=docs"
import { default as __fd_glob_1 } from "../content/docs/legal/meta.json?collection=docs"
import { default as __fd_glob_0 } from "../content/docs/meta.json?collection=docs"
import { server } from 'fumadocs-mdx/runtime/server';
import type * as Config from '../source.config';

const create = server<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>({"doc":{"passthroughs":["extractedReferences"]}});

export const docs = await create.docs("docs", "content/docs", {"meta.json": __fd_glob_0, "legal/meta.json": __fd_glob_1, "recipes/meta.json": __fd_glob_2, "recipes/more/meta.json": __fd_glob_3, "recipes/other-languages/meta.json": __fd_glob_4, "recipes/testing/meta.json": __fd_glob_5, }, {"advanced.md": __fd_glob_6, "index.mdx": __fd_glob_7, "not.md": __fd_glob_8, "self-hosting.md": __fd_glob_9, "legal/contact.mdx": __fd_glob_10, "legal/data-retention.mdx": __fd_glob_11, "legal/privacy.mdx": __fd_glob_12, "recipes/badges.mdx": __fd_glob_13, "recipes/index.md": __fd_glob_14, "recipes/more.md": __fd_glob_15, "recipes/other-languages.md": __fd_glob_16, "recipes/testing.md": __fd_glob_17, "recipes/more/eslint.md": __fd_glob_18, "recipes/more/pdf.md": __fd_glob_19, "recipes/more/website.md": __fd_glob_20, "recipes/other-languages/go.md": __fd_glob_21, "recipes/other-languages/python.md": __fd_glob_22, "recipes/testing/ava.md": __fd_glob_23, "recipes/testing/jest.md": __fd_glob_24, "recipes/testing/mocha.md": __fd_glob_25, "recipes/testing/playwright.md": __fd_glob_26, "recipes/testing/vitest.md": __fd_glob_27, });