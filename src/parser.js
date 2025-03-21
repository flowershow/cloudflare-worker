import matter from "gray-matter";
import { remark } from "remark";
import stripMarkdown from "strip-markdown";

// Polyfill Buffer for browser environment
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
globalThis.Buffer = globalThis.Buffer || {
  from: (data) => {
    if (typeof data === 'string') {
      return textEncoder.encode(data);
    }
    return data;
  },
  toString: (buffer) => {
    return textDecoder.decode(buffer);
  }
};

export async function parseMarkdownFile(content, path = '') {
  try {
    const { data: frontMatter } = matter(content, {});
    console.log('Parsed frontmatter:', frontMatter);

    const title =
      frontMatter.title ||
      (await extractTitle(content)) ||
      path
        .split("/")
        .pop()
        ?.replace(/\.(mdx|md)$/, "") ||
      "";

    const description =
      frontMatter.description ||
      (await extractDescription(content)) ||
      "";

    return {
      ...frontMatter,
      title,
      description
    };
  } catch (error) {
    throw new Error(`Error parsing markdown: ${error}`);
  }
}

const extractTitle = async (source) => {
  const heading = source.trim().match(/^(?:#\s+(.*))/m);
  if (heading && heading[1]) {
    const title = heading[1]
      // replace wikilink with only text value
      .replace(/\[\[([\S\s]*?)]]/, "$1")
      // remove markdown formatting
      .replace(/[_*~`>]/g, "") // remove markdown characters
      .replace(/\[(.*?)\]\(.*?\)/g, "$1"); // remove links but keep the text
    return title.trim();
  }
  return null;
};

const extractDescription = async (source) => {
  const content = source
    // remove frontmatter
    .replace(/---[\s\S]*---/g, "")
    // remove commented lines
    .replace(/{\/\*.*\*\/}/g, "")
    // remove youtube links
    .replace(/^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/gm, "")
    // replace wikilinks with only text
    .replace(/([^!])\[\[(\S*?)\]]/g, "$1$2")
    // remove wikilink images
    .replace(/!\[[\S]*?]]/g, "");

  // remove markdown formatting
  const stripped = await remark()
    .use(stripMarkdown, {
      remove: ["heading", "blockquote", "list", "image", "html", "code"],
    })
    .process(content);

  if (stripped.value) {
    const description = stripped.value.toString().slice(0, 200);
    return description + "...";
  }
  return null;
};
