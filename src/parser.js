import matter from 'gray-matter';

export async function parseMarkdownFile(content) {
  try {
    // Parse the markdown content
    const { data: frontmatter } = matter(content);

    // For now, just extract the title from frontmatter
    // This can be extended later to extract more metadata
    const metadata = {
      title: frontmatter.title || 'Untitled',
      // Add more metadata fields here as needed
    };

    return {
      success: true,
      metadata
    };
  } catch (error) {
    console.error('Error parsing markdown:', error);
    return {
      success: false,
      error: error.message
    };
  }
}